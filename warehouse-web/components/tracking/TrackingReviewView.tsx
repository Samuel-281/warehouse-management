"use client";

import { ClipboardCheck, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, PaginationBar } from "@/components/warehouse/CommonUi";
import { apiErrorMessage, getJson, postJson } from "@/lib/client-api";
import type {
  ProductCategoryRecord,
  Salesperson,
  Toast,
  TrackingOrderReview,
  TrackingReviewListResult,
  TrackingReviewTargetSummary,
  Warehouse
} from "@/lib/types";

export function TrackingReviewView({
  canReview,
  canRevise,
  warehouses,
  salespeople,
  showToast
}: {
  canReview: boolean;
  canRevise: boolean;
  warehouses: Warehouse[];
  salespeople: Salesperson[];
  showToast: (toast: Toast) => void;
}) {
  const [status, setStatus] = useState<"pending" | "reviewed" | "all">("pending");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TrackingReviewListResult>({ items: [], total: 0, page: 1, pageSize: 20, pendingCount: 0 });
  const [categories, setCategories] = useState<ProductCategoryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TrackingReviewTargetSummary | null>(null);

  const load = useCallback(async (nextPage = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ status, page: String(nextPage), pageSize: "20" });
      const [nextResult, nextCategories] = await Promise.all([
        getJson<TrackingReviewListResult>(`/api/tracking/reviews?${params}`),
        getJson<ProductCategoryRecord[]>("/api/product-categories")
      ]);
      setResult(nextResult);
      setCategories(nextCategories);
      setPage(nextResult.page);
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取出库复核列表失败") });
    } finally {
      setLoading(false);
    }
  }, [showToast, status]);

  useEffect(() => { void load(1); }, [load]);

  const warehouseNames = useMemo(() => new Map(warehouses.map((item) => [item.id, item.name])), [warehouses]);
  const salespersonNames = useMemo(() => new Map(salespeople.map((item) => [item.id, item.name])), [salespeople]);

  return <div className="space-y-4">
    <section className="panel p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">出库复核队列</h2>
          <p className="mt-1 text-sm text-muted">快速出库已经即时生效；这里仅补充仓库实际出货数量记录。</p>
        </div>
        <div className="flex items-end gap-2">
          <label><span className="label">复核状态</span><select className="field min-w-36" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="pending">待复核</option><option value="reviewed">已复核</option><option value="all">全部</option></select></label>
          <button className="icon-button mb-0.5" title="刷新复核列表" onClick={() => void load(page)}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
      </div>
      <div className="mt-4 grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-3">
        <Metric label="当前待复核" value={`${result.pendingCount} 张`} />
        <Metric label="当前筛选" value={`${result.total} 张`} />
        <Metric label="复核规则" value="数量记录，不阻断流转" />
      </div>
    </section>

    <section className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">主业务单据</th><th className="px-4 py-3">业务</th><th className="px-4 py-3">来源 / 去向</th><th className="px-4 py-3">扫码情况</th><th className="px-4 py-3">复核状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-slate-200">{result.items.map((item) => {
            const destination = item.type === "transfer"
              ? warehouseNames.get(item.targetWarehouseId ?? "") ?? "未知仓库"
              : `销售人员：${salespersonNames.get(item.salespersonId ?? "") ?? "未知"}`;
            const canOpen = item.reviewStatus === "pending" ? canReview : item.reviewStatus === "reviewed" ? canRevise : false;
            return <tr key={`${item.targetType}-${item.id}`}>
              <td className="px-4 py-3"><p className="font-mono font-semibold text-work">{item.orderNo}</p><p className="mt-1 text-xs text-muted">{item.createdAt}</p></td>
              <td className="px-4 py-3 font-medium text-slate-700">{item.type === "transfer" ? "挪仓" : "销售出库"}</td>
              <td className="px-4 py-3 text-slate-600">{warehouseNames.get(item.sourceWarehouseId) ?? "未知仓库"} → {destination}</td>
              <td className="px-4 py-3"><p className="font-semibold text-slate-700">有效 {item.activeBarcodeCount} / 共 {item.barcodeCount} 件</p>{item.voidedBarcodeCount ? <p className="mt-1 text-xs text-danger">已撤销 {item.voidedBarcodeCount} 件</p> : null}</td>
              <td className="px-4 py-3"><ReviewBadge status={item.reviewStatus} />{item.latestReview ? <p className="mt-1 text-xs text-muted">实际 {item.latestReview.actualTotalQuantity} 件 · v{item.latestReview.version}</p> : null}</td>
              <td className="px-4 py-3 text-right">{canOpen ? <button className="primary-button ml-auto" onClick={() => setSelected(item)}><ClipboardCheck className="h-4 w-4" />{item.reviewStatus === "reviewed" ? "修订" : "复核"}</button> : <span className="text-xs text-muted">无需操作</span>}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
      {loading ? <p className="border-t border-slate-200 px-4 py-3 text-sm text-muted">正在读取复核队列...</p> : null}
      {!loading && result.items.length === 0 ? <div className="p-4"><EmptyState icon={ClipboardCheck} title="当前没有待处理单据" detail="新的销售出库和挪仓单会自动进入待复核队列。" /></div> : null}
      <PaginationBar page={page} pageSize={result.pageSize} total={result.total} onPageChange={(nextPage) => void load(nextPage)} />
    </section>

    {selected ? <ReviewDialog
      target={selected}
      categories={categories}
      onClose={() => setSelected(null)}
      onSaved={async () => { setSelected(null); await load(page); showToast({ tone: "success", message: selected.reviewStatus === "reviewed" ? "复核修订已保存" : "出库复核已完成" }); }}
      showToast={showToast}
    /> : null}
  </div>;
}

function ReviewDialog({ target, categories, onClose, onSaved, showToast }: {
  target: TrackingReviewTargetSummary;
  categories: ProductCategoryRecord[];
  onClose: () => void;
  onSaved: () => Promise<void>;
  showToast: (toast: Toast) => void;
}) {
  const previous = target.latestReview;
  const [actualTotal, setActualTotal] = useState(previous ? String(previous.actualTotalQuantity) : "");
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(previous?.items.map((item) => [item.productCategoryId, String(item.quantity)]) ?? []));
  const [categoryToAdd, setCategoryToAdd] = useState("");
  const [saving, setSaving] = useState(false);
  const visibleCategories = useMemo(() => {
    const previousIds = new Set(previous?.items.map((item) => item.productCategoryId));
    return categories.filter((category) => category.status === "enabled" || previousIds.has(category.id));
  }, [categories, previous]);
  const selectedCategories = useMemo(() => {
    const categoryById = new Map(visibleCategories.map((category) => [category.id, category]));
    return Object.keys(quantities).flatMap((id) => {
      const category = categoryById.get(id);
      return category ? [category] : [];
    });
  }, [quantities, visibleCategories]);
  const availableCategories = useMemo(
    () => visibleCategories.filter((category) => !(category.id in quantities)),
    [quantities, visibleCategories]
  );
  const actualNumber = actualTotal === "" ? null : Number(actualTotal);
  const categoryTotal = Object.values(quantities).reduce((sum, value) => {
    const quantity = Number(value);
    return value !== "" && Number.isFinite(quantity) ? sum + quantity : sum;
  }, 0);
  const totalMismatch = actualNumber !== null && actualNumber !== target.activeBarcodeCount;
  const categoryMismatch = actualNumber !== null && selectedCategories.length > 0 && categoryTotal !== actualNumber;

  function addCategory() {
    if (!categoryToAdd || categoryToAdd in quantities) return;
    setQuantities((current) => ({ ...current, [categoryToAdd]: "" }));
    setCategoryToAdd("");
  }

  function removeCategory(productCategoryId: string) {
    setQuantities((current) => {
      const next = { ...current };
      delete next[productCategoryId];
      return next;
    });
  }

  async function save() {
    if (actualNumber === null || !Number.isSafeInteger(actualNumber) || actualNumber < 0) {
      showToast({ tone: "error", message: "实际总出货数量必须填写包括 0 在内的非负整数" });
      return;
    }
    if (Object.values(quantities).some((value) => value === "" || !Number.isSafeInteger(Number(value)) || Number(value) < 0)) {
      showToast({ tone: "error", message: "已添加商品的数量必须填写包括 0 在内的非负整数；不需要的商品请删除" });
      return;
    }
    setSaving(true);
    try {
      const items = Object.entries(quantities).map(([productCategoryId, value]) => ({ productCategoryId, quantity: Number(value) }));
      await postJson<TrackingOrderReview>(`/api/tracking/reviews/${target.targetType}/${target.id}`, { actualTotalQuantity: actualNumber, items });
      await onSaved();
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "保存出库复核失败") });
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-3">
    <section className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-md bg-white shadow-2xl" role="dialog" aria-modal="true">
      <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-4"><div><h2 className="font-mono text-lg font-semibold text-ink">{target.orderNo}</h2><p className="mt-1 text-sm text-muted">{previous ? `修订复核 · 当前版本 v${previous.version}` : "首次出库复核"}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭复核窗口"><X className="h-4 w-4" /></button></div>
      <div className="p-5">
        <div className="grid gap-3 sm:grid-cols-3"><Metric label="单据扫码数" value={`${target.barcodeCount} 件`} /><Metric label="有效扫码数" value={`${target.activeBarcodeCount} 件`} /><Metric label="已撤销条码" value={`${target.voidedBarcodeCount} 件`} /></div>
        <label className="mt-5 block"><span className="label">实际总出货数量（必填）</span><input className="field" min="0" step="1" type="number" value={actualTotal} onChange={(event) => setActualTotal(event.target.value)} placeholder="包括 0 在内的非负整数" /></label>
        {totalMismatch || categoryMismatch ? <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">{totalMismatch ? `实际总数与有效扫码数相差 ${Math.abs((actualNumber ?? 0) - target.activeBarcodeCount)} 件。` : ""}{totalMismatch && categoryMismatch ? " " : ""}{categoryMismatch ? `品类合计 ${categoryTotal} 件，与实际总数不一致。` : ""} 数量差异不会阻止提交。</div> : null}
        <div className="mt-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"><div><h3 className="text-sm font-semibold text-ink">各商品品类数量（选填）</h3><p className="mt-1 text-xs text-muted">只添加本单需要登记的商品，再填写对应数量。</p></div><span className="shrink-0 text-xs text-muted">已添加 {selectedCategories.length} 项 · 合计 {categoryTotal} 件</span></div>
          {visibleCategories.length > 0 ? <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <label className="min-w-0 flex-1"><span className="label">选择商品</span><select className="field" value={categoryToAdd} onChange={(event) => setCategoryToAdd(event.target.value)} disabled={availableCategories.length === 0}><option value="">{availableCategories.length === 0 ? "所有可选商品均已添加" : "请选择要添加的商品"}</option>{availableCategories.map((category) => <option value={category.id} key={category.id}>{category.name}{category.status === "disabled" ? "（已停用）" : ""}</option>)}</select></label>
            <button className="secondary-button shrink-0" type="button" disabled={!categoryToAdd} onClick={addCategory}><Plus className="h-4 w-4" />添加商品</button>
          </div> : null}
          {selectedCategories.length > 0 ? <div className="mt-3 divide-y divide-slate-200 overflow-hidden rounded-md border border-slate-200">{selectedCategories.map((category) => <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-end" key={category.id}>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-700">{category.name}</p>{category.status === "disabled" ? <p className="mt-1 text-xs text-slate-400">该历史品类已停用</p> : null}</div>
            <label className="sm:w-44"><span className="label">出货数量</span><input className="field" min="0" step="1" type="number" value={quantities[category.id] ?? ""} onChange={(event) => setQuantities((current) => ({ ...current, [category.id]: event.target.value }))} placeholder="请输入数量" /></label>
            <button className="icon-button" type="button" title={`删除 ${category.name}`} aria-label={`删除 ${category.name}`} onClick={() => removeCategory(category.id)}><Trash2 className="h-4 w-4" /></button>
          </div>)}</div> : null}
          {visibleCategories.length === 0 ? <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-muted">当前没有商品品类，可仅填写实际总出货数量完成复核。</p> : selectedCategories.length === 0 ? <p className="mt-3 rounded-md bg-slate-50 p-3 text-sm text-muted">尚未添加商品品类。品类数量为选填，可直接完成复核。</p> : null}
        </div>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-slate-200 bg-white px-5 py-4"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving} onClick={() => void save()}><ClipboardCheck className="h-4 w-4" />{saving ? "正在保存" : previous ? "保存修订" : "完成复核"}</button></div>
    </section>
  </div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="bg-white p-3"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-sm font-semibold text-slate-700">{value}</p></div>;
}

function ReviewBadge({ status }: { status: TrackingReviewTargetSummary["reviewStatus"] }) {
  const classes = status === "reviewed" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : status === "exempt" ? "border-slate-200 bg-slate-50 text-slate-500" : "border-amber-200 bg-amber-50 text-amber-700";
  return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${classes}`}>{status === "reviewed" ? "已复核" : status === "exempt" ? "历史免复核" : "待复核"}</span>;
}
