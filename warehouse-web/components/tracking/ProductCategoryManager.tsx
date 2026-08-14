"use client";

import { Package, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { apiErrorMessage, getJson, patchJson, postJson } from "@/lib/client-api";
import type { ProductCategoryRecord, Toast } from "@/lib/types";

export function ProductCategoryManager({ canEdit, showToast }: {
  canEdit: boolean;
  showToast: (toast: Toast) => void;
}) {
  const [items, setItems] = useState<ProductCategoryRecord[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getJson<ProductCategoryRecord[]>("/api/product-categories"));
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取商品品类失败") });
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await postJson("/api/product-categories", { name });
      setName("");
      await load();
      showToast({ tone: "success", message: "商品品类已新增" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "新增商品品类失败") });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(item: ProductCategoryRecord) {
    const nextStatus = item.status === "enabled" ? "disabled" : "enabled";
    if (nextStatus === "disabled" && !window.confirm(`确认停用“${item.name}”吗？\n\n历史复核仍会显示该品类，勤策再次返回同名数据时不会自动恢复。`)) return;
    try {
      await patchJson(`/api/product-categories/${item.id}`, { status: nextStatus });
      await load();
      showToast({ tone: "success", message: nextStatus === "enabled" ? "商品品类已恢复" : "商品品类已停用" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "更新商品品类状态失败") });
    }
  }

  return <section className="panel overflow-hidden">
    <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 sm:flex-row sm:items-end sm:justify-between">
      <div><h2 className="text-sm font-semibold text-ink">商品品类目录</h2><p className="mt-1 text-xs text-muted">仅记录名称。勤策成功匹配的新商品会自动加入，库存流程不依赖本目录。</p></div>
      <div className="flex flex-wrap gap-2">{canEdit ? <><input className="field min-w-0 flex-1 sm:w-64 sm:flex-none" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} placeholder="输入商品品类名称" /><button className="primary-button" disabled={busy || !name.trim()} onClick={() => void create()}><Plus className="h-4 w-4" />新增</button></> : null}<button className="icon-button" title="刷新品类" onClick={() => void load()}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></button></div>
    </div>
    <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">商品名称</th><th className="px-4 py-3">来源</th><th className="px-4 py-3">状态</th><th className="px-4 py-3">最近更新</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-200">{items.map((item) => <tr key={item.id}><td className="px-4 py-3 font-semibold text-slate-700">{item.name}</td><td className="px-4 py-3 text-slate-600">{item.source === "qince" ? "勤策自动" : "手工新增"}</td><td className="px-4 py-3"><span className={`rounded-md border px-2 py-1 text-xs font-semibold ${item.status === "enabled" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{item.status === "enabled" ? "启用" : "停用"}</span></td><td className="px-4 py-3 text-slate-500">{item.updatedAt}</td><td className="px-4 py-3 text-right">{canEdit ? <button className="secondary-button ml-auto h-9 px-3" onClick={() => void toggle(item)}>{item.status === "enabled" ? "停用" : "恢复"}</button> : null}</td></tr>)}</tbody></table></div>
    {!loading && items.length === 0 ? <div className="p-5 text-center"><Package className="mx-auto h-6 w-6 text-slate-400" /><p className="mt-2 text-sm text-muted">尚无商品品类，勤策成功匹配后会自动建立。</p></div> : null}
  </section>;
}
