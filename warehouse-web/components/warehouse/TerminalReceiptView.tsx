"use client";

import {
  AlertCircle,
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  History,
  Link2,
  RefreshCw,
  Upload,
  XCircle
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, PaginationBar, StatusBadge } from "@/components/warehouse/CommonUi";
import { apiErrorMessage, getJson, postFormData } from "@/lib/client-api";
import type {
  TerminalReceiptImportList,
  TerminalReceiptImportSummary,
  TerminalReceiptPreview,
  TerminalReceiptPreviewRow,
  Toast
} from "@/lib/types";

const previewPageSize = 20;

export function TerminalReceiptView({
  canImport,
  showToast
}: {
  canImport: boolean;
  showToast: (toast: Toast) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TerminalReceiptPreview | null>(null);
  const [history, setHistory] = useState<TerminalReceiptImportList>({ items: [], total: 0 });
  const [previewPage, setPreviewPage] = useState(1);
  const [busy, setBusy] = useState<"preview" | "commit" | "history" | null>(null);

  const loadHistory = useCallback(async () => {
    setBusy((current) => current ?? "history");
    try {
      setHistory(await getJson<TerminalReceiptImportList>("/api/terminal-receipts?limit=20"));
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取签收导入记录失败") });
    } finally {
      setBusy((current) => current === "history" ? null : current);
    }
  }, [showToast]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const previewRows = useMemo(() => {
    if (!preview) return [];
    const start = (previewPage - 1) * previewPageSize;
    return preview.rows.slice(start, start + previewPageSize);
  }, [preview, previewPage]);

  function selectFile(nextFile?: File) {
    setFile(nextFile ?? null);
    setPreview(null);
    setPreviewPage(1);
  }

  async function requestPreview() {
    if (!file) {
      showToast({ tone: "error", message: "请先选择签收系统导出的 .xlsx 文件" });
      return;
    }
    setBusy("preview");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "preview");
      const result = await postFormData<TerminalReceiptPreview>("/api/terminal-receipts", formData);
      setPreview(result);
      setPreviewPage(1);
      showToast({ tone: "success", message: `已读取 ${result.totalRows} 条签收记录，请确认匹配结果` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取签收 Excel 失败") });
    } finally {
      setBusy(null);
    }
  }

  async function commitImport() {
    if (!file || !preview) return;
    setBusy("commit");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mode", "commit");
      const result = await postFormData<TerminalReceiptImportSummary>("/api/terminal-receipts", formData);
      showToast({
        tone: "success",
        message: result.replayed
          ? `该文件已导入过，本次没有重复写入数据`
          : `签收记录已导入 ${result.importedRows} 条，匹配条码 ${result.matchedRows} 条`
      });
      selectFile();
      if (inputRef.current) inputRef.current.value = "";
      await loadHistory();
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "导入签收记录失败") });
    } finally {
      setBusy(null);
    }
  }

  const canCommit = Boolean(
    canImport &&
    preview &&
    preview.importableRows > 0 &&
    preview.invalidRows === 0 &&
    busy === null
  );

  return (
    <div className="grid gap-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-work">
                <Link2 className="h-4 w-4" />
              </span>
              <div>
                <h2 className="text-sm font-semibold text-ink">终端签收关联</h2>
                <p className="mt-0.5 text-xs text-muted">按唯一箱码关联收货单位，不改变库存数量和条码当前归属</p>
              </div>
            </div>
          </div>
          <button className="secondary-button h-9 px-3" onClick={() => void loadHistory()} disabled={busy !== null}>
            <RefreshCw className={`h-4 w-4 ${busy === "history" ? "animate-spin" : ""}`} />
            刷新记录
          </button>
        </div>

        {canImport ? (
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label className="label" htmlFor="terminal-receipt-file">签收明细 Excel</label>
              <label
                className="flex min-h-20 cursor-pointer items-center gap-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-3 transition hover:border-emerald-400 hover:bg-emerald-50/40"
                htmlFor="terminal-receipt-file"
              >
                <FileSpreadsheet className="h-6 w-6 shrink-0 text-work" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink">{file?.name ?? "选择 .xlsx 文件"}</span>
                  <span className="mt-1 block text-xs text-muted">
                    {file ? `${formatFileSize(file.size)} · 重新选择会清除当前预览` : "需要包含码、扫码时间、扫码人、商品名称、单位和收货单位名称"}
                  </span>
                </span>
              </label>
              <input
                ref={inputRef}
                id="terminal-receipt-file"
                className="sr-only"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
            </div>
            <div className="flex gap-2">
              <button className="secondary-button" onClick={() => void requestPreview()} disabled={!file || busy !== null}>
                <FileCheck2 className="h-4 w-4" />
                {busy === "preview" ? "读取中" : "预览匹配"}
              </button>
              <button className="primary-button" onClick={() => void commitImport()} disabled={!canCommit}>
                <Upload className="h-4 w-4" />
                {busy === "commit" ? "导入中" : "确认导入"}
              </button>
            </div>
          </div>
        ) : (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            当前账号可以查看签收导入历史和条码签收详情，只有仓库管理员与超级管理员可以导入文件。
          </div>
        )}

        {preview ? <ReceiptPreview preview={preview} rows={previewRows} page={previewPage} onPageChange={setPreviewPage} /> : null}
      </section>

      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-work" />
            <h2 className="text-sm font-semibold text-ink">最近导入</h2>
          </div>
          <span className="text-xs text-muted">共 {history.total} 个批次</span>
        </div>
        {history.items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3">文件与时间</th>
                  <th className="px-4 py-3">导入结果</th>
                  <th className="px-4 py-3">条码匹配</th>
                  <th className="px-4 py-3">操作人</th>
                </tr>
              </thead>
              <tbody>
                {history.items.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="table-cell">
                      <p className="max-w-md truncate font-medium text-ink">{item.fileName}</p>
                      <p className="mt-1 font-mono text-xs text-muted">{item.createdAt}</p>
                    </td>
                    <td className="table-cell text-slate-600">
                      <p>导入 {item.importedRows} / {item.totalRows} 条</p>
                      <p className="mt-1 text-xs text-muted">重复 {item.duplicateRows} · 错误 {item.invalidRows}</p>
                    </td>
                    <td className="table-cell text-slate-600">
                      <p>匹配 {item.matchedRows} 条</p>
                      <p className="mt-1 text-xs text-amber-700">未匹配 {item.unmatchedRows} 条</p>
                    </td>
                    <td className="table-cell text-slate-600">{item.operatorName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-4">
            <EmptyState icon={FileSpreadsheet} title="暂无签收导入记录" detail="导入签收系统导出的码明细后，批次结果会显示在这里。" />
          </div>
        )}
      </section>
    </div>
  );
}

function ReceiptPreview({
  preview,
  rows,
  page,
  onPageChange
}: {
  preview: TerminalReceiptPreview;
  rows: TerminalReceiptPreviewRow[];
  page: number;
  onPageChange: (page: number) => void;
}) {
  const previewTotal = preview.rows.length;
  return (
    <div className="border-t border-slate-200">
      <div className="grid grid-cols-2 gap-px bg-slate-200 md:grid-cols-5">
        <PreviewMetric label="文件记录" value={preview.totalRows} tone="neutral" />
        <PreviewMetric label="匹配条码" value={preview.matchedRows} tone="success" />
        <PreviewMetric label="尚未匹配" value={preview.unmatchedRows} tone="warning" />
        <PreviewMetric label="重复跳过" value={preview.duplicateRows} tone="neutral" />
        <PreviewMetric label="格式错误" value={preview.invalidRows} tone="error" />
      </div>

      <div className="flex items-start gap-2 border-y border-slate-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          未匹配记录仍可导入，条码以后进入仓库系统时可以继续关联。格式错误行必须先修正；重复记录不会再次写入。
          {preview.previewTruncated ? ` 当前仅展示前 ${preview.rows.length} 行预览。` : ""}
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px]">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-3">Excel 行 / 状态</th>
              <th className="px-4 py-3">箱码</th>
              <th className="px-4 py-3">收货单位</th>
              <th className="px-4 py-3">扫码信息</th>
              <th className="px-4 py-3">外部商品</th>
              <th className="px-4 py-3">系统匹配</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.rowNumber}-${row.barcode}`} className="hover:bg-slate-50">
                <td className="table-cell">
                  <p className="text-xs text-muted">第 {row.rowNumber} 行</p>
                  <div className="mt-1"><ReceiptStatus status={row.status} /></div>
                </td>
                <td className="table-cell font-mono font-semibold text-work">{row.barcode || "-"}</td>
                <td className="table-cell font-medium text-ink">{row.receivingOrganizationName || "-"}</td>
                <td className="table-cell text-slate-600">
                  <p>{row.scannerName || "-"}</p>
                  <p className="mt-1 font-mono text-xs text-muted">{row.scannedAt || "-"}</p>
                </td>
                <td className="table-cell text-slate-600">
                  <p>{row.externalGoodsName || "-"}</p>
                  <p className="mt-1 text-xs text-muted">单位：{row.goodsUnit || "-"}</p>
                </td>
                <td className="table-cell text-slate-600">
                  <p>{row.matchedGoodsName ?? row.issue ?? "待条码进入系统后关联"}</p>
                  {row.matchedOwner ? <p className="mt-1 text-xs text-muted">{row.matchedOwner}</p> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {previewTotal > previewPageSize ? (
        <PaginationBar page={page} pageSize={previewPageSize} total={previewTotal} onPageChange={onPageChange} />
      ) : null}
    </div>
  );
}

function PreviewMetric({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "warning" | "error" }) {
  const color = tone === "success" ? "text-emerald-700" : tone === "warning" ? "text-amber-700" : tone === "error" ? "text-red-700" : "text-ink";
  return (
    <div className="bg-white px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${color}`}>{value.toLocaleString("zh-CN")}</p>
    </div>
  );
}

function ReceiptStatus({ status }: { status: TerminalReceiptPreviewRow["status"] }) {
  if (status === "matched") return <StatusBadge label="匹配成功" />;
  if (status === "unmatched") return <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertCircle className="h-3.5 w-3.5" />尚未匹配</span>;
  if (status === "duplicate") return <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500"><CheckCircle2 className="h-3.5 w-3.5" />重复跳过</span>;
  return <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-700"><XCircle className="h-3.5 w-3.5" />格式错误</span>;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
