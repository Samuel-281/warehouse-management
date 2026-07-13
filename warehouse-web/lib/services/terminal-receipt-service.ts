import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";
import type {
  TerminalReceiptImportList,
  TerminalReceiptImportSummary,
  TerminalReceiptPreview,
  TerminalReceiptPreviewRow,
  TerminalReceiptRecord
} from "@/lib/types";
import { formatAppDateTime } from "@/lib/warehouse-utils";

const MAX_FILE_SIZE = 15 * 1024 * 1024;
const MAX_DATA_ROWS = 10_000;
const MAX_PREVIEW_ROWS = 500;
const requiredHeaders = ["码", "扫码时间", "扫码人", "商品名称", "扫码商品单位", "收货单位名称"] as const;
type RequiredHeader = (typeof requiredHeaders)[number];

type ParsedReceiptRow = {
  rowNumber: number;
  barcode: string;
  scannedAt: Date | null;
  scannedAtText: string;
  scannerName: string;
  externalGoodsName: string;
  goodsUnit: string;
  receivingOrganizationName: string;
  fingerprint?: string;
  issue?: string;
};

type MatchedItem = {
  id: string;
  goods: { name: string };
  ownerType: "WAREHOUSE" | "SALESPERSON";
  warehouse: { name: string } | null;
  salesperson: { name: string } | null;
};

type AnalyzedRow = ParsedReceiptRow & {
  inventoryItemId?: string;
  status: TerminalReceiptPreviewRow["status"];
  matchedGoodsName?: string;
  matchedOwner?: string;
};

type WorkbookAnalysis = {
  preview: TerminalReceiptPreview;
  rows: AnalyzedRow[];
};

export async function previewTerminalReceiptImport(fileName: string, buffer: Buffer) {
  return (await analyzeWorkbook(fileName, buffer)).preview;
}

export async function importTerminalReceipts(input: {
  fileName: string;
  buffer: Buffer;
  operatorName: string;
  allowNoNewRows?: boolean;
}): Promise<TerminalReceiptImportSummary> {
  const prisma = getPrisma();
  const fileHash = hashBuffer(input.buffer);
  const previousImport = await prisma.terminalReceiptImport.findUnique({ where: { fileHash } });
  if (previousImport) return { ...mapImportSummary(previousImport), replayed: true };

  const analysis = await analyzeWorkbook(input.fileName, input.buffer);
  if (analysis.preview.invalidRows > 0) {
    throw new ApiError(`文件中有 ${analysis.preview.invalidRows} 行格式错误，请修正后重新导入`, 400);
  }
  if (analysis.preview.importableRows === 0 && !input.allowNoNewRows) {
    throw new ApiError("文件中没有可导入的新签收记录", 400);
  }

  const importableRows = analysis.rows.filter((row) => row.status === "matched" || row.status === "unmatched");

  try {
    return await prisma.$transaction(async (tx) => {
      const racedImport = await tx.terminalReceiptImport.findUnique({ where: { fileHash } });
      if (racedImport) return { ...mapImportSummary(racedImport), replayed: true };

      const importBatch = await tx.terminalReceiptImport.create({
        data: {
          fileName: input.fileName,
          fileHash,
          totalRows: analysis.preview.totalRows,
          importedRows: importableRows.length,
          matchedRows: analysis.preview.matchedRows,
          unmatchedRows: analysis.preview.unmatchedRows,
          duplicateRows: analysis.preview.duplicateRows,
          invalidRows: analysis.preview.invalidRows,
          operatorName: input.operatorName
        }
      });

      const created = importableRows.length > 0
        ? await tx.terminalReceiptRecord.createMany({
            data: importableRows.map((row) => ({
              importId: importBatch.id,
              inventoryItemId: row.inventoryItemId,
              barcode: row.barcode,
              scannedAt: row.scannedAt as Date,
              scannerName: row.scannerName,
              externalGoodsName: row.externalGoodsName,
              goodsUnit: row.goodsUnit,
              receivingOrganizationName: row.receivingOrganizationName,
              fingerprint: row.fingerprint as string,
              matchStatus: row.status === "matched" ? "MATCHED" : "UNMATCHED"
            })),
            skipDuplicates: true
          })
        : { count: 0 };

      if (created.count !== importableRows.length) {
        await tx.terminalReceiptImport.update({
          where: { id: importBatch.id },
          data: {
            importedRows: created.count,
            duplicateRows: analysis.preview.duplicateRows + (importableRows.length - created.count)
          }
        });
      }

      const result = await tx.terminalReceiptImport.findUniqueOrThrow({ where: { id: importBatch.id } });
      return mapImportSummary(result);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const racedImport = await prisma.terminalReceiptImport.findUnique({ where: { fileHash } });
      if (racedImport) return { ...mapImportSummary(racedImport), replayed: true };
    }
    throw error;
  }
}

export async function listTerminalReceiptImports(limit = 20): Promise<TerminalReceiptImportList> {
  const prisma = getPrisma();
  const take = Number.isFinite(limit) ? Math.min(100, Math.max(1, Math.floor(limit))) : 20;
  const [total, items] = await Promise.all([
    prisma.terminalReceiptImport.count(),
    prisma.terminalReceiptImport.findMany({ orderBy: { createdAt: "desc" }, take })
  ]);
  return { total, items: items.map(mapImportSummary) };
}

export async function getTerminalReceiptsForItem(itemId: string, barcodes: string[]): Promise<TerminalReceiptRecord[]> {
  const prisma = getPrisma();
  const records = await prisma.terminalReceiptRecord.findMany({
    where: {
      OR: [
        { inventoryItemId: itemId },
        { inventoryItemId: null, barcode: { in: Array.from(new Set(barcodes.filter(Boolean))) } }
      ]
    },
    orderBy: [{ scannedAt: "desc" }, { createdAt: "desc" }],
    take: 100
  });

  return records.map((record) => ({
    id: record.id,
    barcode: record.barcode,
    scannedAt: formatAppDateTime(record.scannedAt),
    scannerName: record.scannerName,
    externalGoodsName: record.externalGoodsName,
    goodsUnit: record.goodsUnit,
    receivingOrganizationName: record.receivingOrganizationName,
    matchStatus: record.matchStatus === "MATCHED" ? "matched" : "unmatched",
    importedAt: formatAppDateTime(record.createdAt)
  }));
}

async function analyzeWorkbook(fileName: string, buffer: Buffer): Promise<WorkbookAnalysis> {
  validateFile(fileName, buffer);
  const fileHash = hashBuffer(buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
  } catch {
    throw new ApiError("无法读取 Excel 文件，请确认文件没有损坏且格式为 .xlsx", 400);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new ApiError("Excel 文件中没有可读取的工作表", 400);
  const header = findHeaderRow(worksheet);
  if (!header) {
    throw new ApiError(`Excel 缺少必要列：${requiredHeaders.join("、")}`, 400);
  }

  const parsedRows: ParsedReceiptRow[] = [];
  for (let rowNumber = header.rowNumber + 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const rawValues = requiredHeaders.map((name) => cellText(row.getCell(header.columns[name])));
    if (rawValues.every((value) => !value)) continue;
    if (parsedRows.length >= MAX_DATA_ROWS) {
      throw new ApiError(`单个文件最多允许 ${MAX_DATA_ROWS.toLocaleString("zh-CN")} 条签收记录`, 400);
    }

    const [barcode, scannedAtText, scannerName, externalGoodsName, goodsUnit, receivingOrganizationName] = rawValues;
    const scannedAt = parseScanTime(row.getCell(header.columns["扫码时间"]), scannedAtText);
    const missing = requiredHeaders.filter((_, index) => !rawValues[index]);
    let issue = missing.length > 0 ? `缺少${missing.join("、")}` : undefined;
    if (!issue && !scannedAt) issue = "扫码时间格式无法识别";
    if (!issue && barcode.length > 128) issue = "条码长度超过 128 个字符";
    const fingerprint = issue || !scannedAt
      ? undefined
      : receiptFingerprint({ barcode, scannedAt, scannerName, externalGoodsName, goodsUnit, receivingOrganizationName });

    parsedRows.push({
      rowNumber,
      barcode,
      scannedAt,
      scannedAtText,
      scannerName,
      externalGoodsName,
      goodsUnit,
      receivingOrganizationName,
      fingerprint,
      issue
    });
  }

  if (parsedRows.length === 0) throw new ApiError("Excel 文件中没有签收数据行", 400);

  const prisma = getPrisma();
  const validRows = parsedRows.filter((row) => row.fingerprint);
  const barcodes = Array.from(new Set(validRows.map((row) => row.barcode)));
  const fingerprints = Array.from(new Set(validRows.map((row) => row.fingerprint as string)));
  const [items, corrections, existingRecords] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { barcode: { in: barcodes } },
      include: { goods: true, warehouse: true, salesperson: true }
    }),
    prisma.barcodeCorrection.findMany({
      where: { oldBarcode: { in: barcodes } },
      include: { item: { include: { goods: true, warehouse: true, salesperson: true } } }
    }),
    prisma.terminalReceiptRecord.findMany({
      where: { fingerprint: { in: fingerprints } },
      select: { fingerprint: true }
    })
  ]);

  const itemByBarcode = new Map<string, MatchedItem>();
  for (const item of items) itemByBarcode.set(item.barcode, item);
  for (const correction of corrections) itemByBarcode.set(correction.oldBarcode, correction.item);
  const existingFingerprints = new Set(existingRecords.map((record) => record.fingerprint));
  const fileFingerprints = new Set<string>();

  const rows: AnalyzedRow[] = parsedRows.map((row) => {
    if (row.issue || !row.fingerprint || !row.scannedAt) return { ...row, status: "invalid" };
    if (existingFingerprints.has(row.fingerprint) || fileFingerprints.has(row.fingerprint)) {
      return { ...row, status: "duplicate", issue: "该签收记录已经导入或在文件中重复" };
    }
    fileFingerprints.add(row.fingerprint);
    const item = itemByBarcode.get(row.barcode);
    if (!item) return { ...row, status: "unmatched", issue: "仓库系统中尚未找到该条码" };
    return {
      ...row,
      status: "matched",
      inventoryItemId: item.id,
      matchedGoodsName: item.goods.name,
      matchedOwner: formatMatchedOwner(item)
    };
  });

  const matchedRows = rows.filter((row) => row.status === "matched").length;
  const unmatchedRows = rows.filter((row) => row.status === "unmatched").length;
  const duplicateRows = rows.filter((row) => row.status === "duplicate").length;
  const invalidRows = rows.filter((row) => row.status === "invalid").length;
  const previewRows = rows.slice(0, MAX_PREVIEW_ROWS).map(mapPreviewRow);

  return {
    rows,
    preview: {
      fileName,
      fileHash,
      totalRows: rows.length,
      importableRows: matchedRows + unmatchedRows,
      matchedRows,
      unmatchedRows,
      duplicateRows,
      invalidRows,
      rows: previewRows,
      previewTruncated: rows.length > MAX_PREVIEW_ROWS
    }
  };
}

function findHeaderRow(worksheet: ExcelJS.Worksheet) {
  const scanLimit = Math.min(10, worksheet.rowCount);
  for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const columns = {} as Record<RequiredHeader, number>;
    row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
      const header = normalizeHeader(cellText(cell));
      const required = requiredHeaders.find((name) => normalizeHeader(name) === header);
      if (required) columns[required] = columnNumber;
    });
    if (requiredHeaders.every((name) => columns[name])) return { rowNumber, columns };
  }
  return null;
}

function normalizeHeader(value: string) {
  return value.replace(/[\s\u3000]+/g, "").trim();
}

function cellText(cell: ExcelJS.Cell) {
  const value = cell.value;
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : cell.text.trim();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) return formatAppDateTime(value);
  return cell.text.trim();
}

function parseScanTime(cell: ExcelJS.Cell, value: string) {
  if (cell.value instanceof Date && !Number.isNaN(cell.value.getTime())) return cell.value;
  const normalized = value.trim().replaceAll("/", "-");
  const match = normalized.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = "00"] = match;
  const date = new Date(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute}:${second}+08:00`
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

function receiptFingerprint(input: {
  barcode: string;
  scannedAt: Date;
  scannerName: string;
  externalGoodsName: string;
  goodsUnit: string;
  receivingOrganizationName: string;
}) {
  return createHash("sha256")
    .update([
      input.barcode,
      input.scannedAt.toISOString(),
      input.scannerName,
      input.externalGoodsName,
      input.goodsUnit,
      input.receivingOrganizationName
    ].join("\u001f"))
    .digest("hex");
}

function hashBuffer(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validateFile(fileName: string, buffer: Buffer) {
  if (!fileName.toLowerCase().endsWith(".xlsx")) throw new ApiError("请选择 .xlsx 格式的 Excel 文件", 400);
  if (buffer.length === 0) throw new ApiError("上传的文件为空", 400);
  if (buffer.length > MAX_FILE_SIZE) throw new ApiError("Excel 文件不能超过 15 MB", 400);
}

function formatMatchedOwner(item: MatchedItem) {
  if (item.ownerType === "SALESPERSON") return `销售人员：${item.salesperson?.name ?? "未知"}`;
  return `仓库：${item.warehouse?.name ?? "未知"}`;
}

function mapPreviewRow(row: AnalyzedRow): TerminalReceiptPreviewRow {
  return {
    rowNumber: row.rowNumber,
    barcode: row.barcode,
    scannedAt: row.scannedAt ? formatAppDateTime(row.scannedAt) : row.scannedAtText,
    scannerName: row.scannerName,
    externalGoodsName: row.externalGoodsName,
    goodsUnit: row.goodsUnit,
    receivingOrganizationName: row.receivingOrganizationName,
    status: row.status,
    matchedGoodsName: row.matchedGoodsName,
    matchedOwner: row.matchedOwner,
    issue: row.issue
  };
}

function mapImportSummary(value: {
  id: string;
  fileName: string;
  totalRows: number;
  importedRows: number;
  matchedRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  invalidRows: number;
  operatorName: string;
  createdAt: Date;
}): TerminalReceiptImportSummary {
  return {
    id: value.id,
    fileName: value.fileName,
    totalRows: value.totalRows,
    importedRows: value.importedRows,
    matchedRows: value.matchedRows,
    unmatchedRows: value.unmatchedRows,
    duplicateRows: value.duplicateRows,
    invalidRows: value.invalidRows,
    operatorName: value.operatorName,
    createdAt: formatAppDateTime(value.createdAt)
  };
}
