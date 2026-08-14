import type { Prisma } from "@prisma/client";

import { ApiError } from "@/lib/api-response";
import { getPrisma } from "@/lib/db";
import type { ProductCategoryRecord } from "@/lib/types";
import { formatAppDateTime } from "@/lib/warehouse-utils";

type DbClient = Prisma.TransactionClient;

export function normalizeProductCategoryName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export async function ensureQinceProductCategory(tx: DbClient, value: string) {
  const normalizedName = normalizeProductCategoryName(value);
  if (!normalizedName) return null;
  return tx.productCategory.upsert({
    where: { normalizedName },
    create: { name: normalizedName, normalizedName, source: "QINCE" },
    update: {}
  });
}

export async function linkMatchedReceiptCategories(tx: DbClient, importId: string) {
  const receipts = await tx.terminalReceiptRecord.findMany({
    where: { importId, matchStatus: "MATCHED" },
    select: { id: true, externalGoodsName: true, trackedBarcodeId: true }
  });
  for (const receipt of receipts) {
    const category = await ensureQinceProductCategory(tx, receipt.externalGoodsName);
    if (!category) continue;
    await tx.terminalReceiptRecord.update({ where: { id: receipt.id }, data: { productCategoryId: category.id } });
    if (receipt.trackedBarcodeId) {
      await tx.trackedBarcode.update({ where: { id: receipt.trackedBarcodeId }, data: { productCategoryId: category.id } });
    }
  }
}

export async function listProductCategories(input: { status?: string } = {}): Promise<ProductCategoryRecord[]> {
  const prisma = getPrisma();
  const status = input.status === "enabled" ? "ENABLED" : input.status === "disabled" ? "DISABLED" : undefined;
  const categories = await prisma.productCategory.findMany({
    where: status ? { status } : undefined,
    orderBy: [{ status: "asc" }, { name: "asc" }]
  });
  return categories.map(mapProductCategory);
}

export async function createProductCategory(name: string): Promise<ProductCategoryRecord> {
  const normalizedName = normalizeProductCategoryName(name);
  if (!normalizedName) throw new ApiError("请输入商品品类名称", 400);
  if (normalizedName.length > 120) throw new ApiError("商品品类名称不能超过 120 个字符", 400);
  const prisma = getPrisma();
  const existing = await prisma.productCategory.findUnique({ where: { normalizedName } });
  if (existing) {
    throw new ApiError(existing.status === "DISABLED" ? "该商品品类已停用，请直接恢复" : "该商品品类已经存在", 409);
  }
  return mapProductCategory(await prisma.productCategory.create({
    data: { name: normalizedName, normalizedName, source: "MANUAL" }
  }));
}

export async function setProductCategoryStatus(id: string, status: string): Promise<ProductCategoryRecord> {
  if (status !== "enabled" && status !== "disabled") throw new ApiError("商品品类状态无效", 400);
  const prisma = getPrisma();
  const existing = await prisma.productCategory.findUnique({ where: { id } });
  if (!existing) throw new ApiError("商品品类不存在", 404);
  return mapProductCategory(await prisma.productCategory.update({
    where: { id },
    data: { status: status === "enabled" ? "ENABLED" : "DISABLED" }
  }));
}

function mapProductCategory(category: {
  id: string;
  name: string;
  status: "ENABLED" | "DISABLED";
  source: "MANUAL" | "QINCE";
  createdAt: Date;
  updatedAt: Date;
}): ProductCategoryRecord {
  return {
    id: category.id,
    name: category.name,
    status: category.status === "ENABLED" ? "enabled" : "disabled",
    source: category.source === "QINCE" ? "qince" : "manual",
    createdAt: formatAppDateTime(category.createdAt),
    updatedAt: formatAppDateTime(category.updatedAt)
  };
}
