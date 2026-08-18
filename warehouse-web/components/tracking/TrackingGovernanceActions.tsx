"use client";

import { Pencil, ShieldAlert, Trash2, X } from "lucide-react";
import { useState } from "react";

import { apiErrorMessage, deleteJson, postJson } from "@/lib/client-api";
import type { Salesperson, Toast, TrackingOrderGroupSummary, TrackingOrderSummary, Warehouse } from "@/lib/types";

export function TrackedBarcodeAdminActions({ barcode, onChanged, showToast }: {
  barcode: string;
  onChanged: () => Promise<void>;
  showToast: (toast: Toast) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");

  async function remove() {
    setBusy(true);
    try {
      await deleteJson<{ action: "deleted" }>(`/api/tracking/${encodeURIComponent(barcode)}`, { note });
      showToast({ tone: "success", message: "条码及其全部业务记录已删除，可重新扫码使用" });
      setConfirming(false);
      setNote("");
      await onChanged();
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "处理条码失败") });
    } finally {
      setBusy(false);
    }
  }
  return <>
    <button className="secondary-button text-danger" disabled={busy} onClick={() => setConfirming(true)}><Trash2 className="h-4 w-4" />删除条码记录</button>
    {confirming ? <HighRiskActionDialog
      title="删除条码全部记录"
      subject={barcode}
      description="将删除该条码的档案、本地流转履历和单据关联。已有勤策签收记录的有效条码禁止删除；删除后可以把相同条码作为新条码再次扫码使用，此操作不可撤销。"
      confirmLabel="确认删除全部记录"
      busy={busy}
      note={note}
      onNoteChange={setNote}
      onClose={() => { if (!busy) setConfirming(false); }}
      onConfirm={() => void remove()}
    /> : null}
  </>;
}

export function TrackingBusinessAdminActions({
  targetType,
  target,
  warehouses,
  salespeople,
  onChanged,
  showToast
}: {
  targetType: "order" | "group";
  target: TrackingOrderSummary | TrackingOrderGroupSummary;
  warehouses: Warehouse[];
  salespeople: Salesperson[];
  onChanged: () => Promise<void>;
  showToast: (toast: Toast) => void;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidNote, setVoidNote] = useState("");
  const number = "orderNo" in target ? target.orderNo : target.groupNo;
  const endpoint = targetType === "order" ? `/api/tracking/orders/${target.id}` : `/api/tracking/order-groups/${target.id}`;

  async function voidBusiness() {
    setBusy(true);
    try {
      await postJson(`${endpoint}/void`, { note: voidNote });
      showToast({ tone: "success", message: `${number} 已回滚并删除` });
      setVoiding(false);
      setVoidNote("");
      await onChanged();
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "删除业务单失败") });
    } finally {
      setBusy(false);
    }
  }

  if (target.type === "return" || target.status !== "active") return null;
  return <>
    <button className="secondary-button" disabled={busy} onClick={() => setCorrecting(true)}><Pencil className="h-4 w-4" />纠正出库信息</button>
    <button className="secondary-button text-danger" disabled={busy} onClick={() => setVoiding(true)}><ShieldAlert className="h-4 w-4" />删除业务单</button>
    {correcting ? <RouteCorrectionDialog target={target} endpoint={endpoint} number={number} warehouses={warehouses} salespeople={salespeople} onClose={() => setCorrecting(false)} onChanged={onChanged} showToast={showToast} /> : null}
    {voiding ? <HighRiskActionDialog
      title="回滚并删除业务单"
      subject={number}
      description="只有全部条码均无后续流转时才会成功。已有条码恢复到出库前状态；由该单首次创建的条码档案会删除；单据、复核与纠错记录也会一并删除。"
      confirmLabel="确认回滚并删除"
      busy={busy}
      note={voidNote}
      onNoteChange={setVoidNote}
      onClose={() => { if (!busy) setVoiding(false); }}
      onConfirm={() => void voidBusiness()}
    /> : null}
  </>;
}

function HighRiskActionDialog({ title, subject, description, confirmLabel, busy, note, onNoteChange, onClose, onConfirm }: {
  title: string;
  subject: string;
  description: string;
  confirmLabel: string;
  busy: boolean;
  note: string;
  onNoteChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/50 p-3">
    <section className="w-full max-w-lg rounded-md bg-white shadow-2xl" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
        <div><h2 className="text-lg font-semibold text-ink">{title}</h2><p className="mt-1 break-all font-mono text-sm text-muted">{subject}</p></div>
        <button className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭确认窗口"><X className="h-4 w-4" /></button>
      </div>
      <div className="space-y-4 p-5">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm leading-6 text-red-900">{description}</div>
        <label className="block"><span className="label">操作备注（选填）</span><textarea className="field min-h-20 py-2" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="可直接留空" /></label>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
        <button className="secondary-button" disabled={busy} onClick={onClose}>取消</button>
        <button className="primary-button" disabled={busy} onClick={onConfirm}><ShieldAlert className="h-4 w-4" />{busy ? "正在处理" : confirmLabel}</button>
      </div>
    </section>
  </div>;
}

function RouteCorrectionDialog({ target, endpoint, number, warehouses, salespeople, onClose, onChanged, showToast }: {
  target: TrackingOrderSummary | TrackingOrderGroupSummary;
  endpoint: string;
  number: string;
  warehouses: Warehouse[];
  salespeople: Salesperson[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  showToast: (toast: Toast) => void;
}) {
  const enabledWarehouses = warehouses.filter((item) => item.status === "enabled");
  const enabledSalespeople = salespeople.filter((item) => item.status === "enabled");
  const [type, setType] = useState<"sales_outbound" | "transfer">(target.type === "transfer" ? "transfer" : "sales_outbound");
  const [sourceWarehouseId, setSourceWarehouseId] = useState(target.sourceWarehouseId ?? enabledWarehouses[0]?.id ?? "");
  const [targetWarehouseId, setTargetWarehouseId] = useState(target.targetWarehouseId ?? enabledWarehouses.find((item) => item.id !== target.sourceWarehouseId)?.id ?? "");
  const [salespersonId, setSalespersonId] = useState(target.salespersonId ?? enabledSalespeople[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const result = await postJson<{ correctionMode: "current_state" | "history_only" }>(`${endpoint}/correct`, { type, sourceWarehouseId, targetWarehouseId: type === "transfer" ? targetWarehouseId : undefined, salespersonId: type === "sales_outbound" ? salespersonId : undefined, note });
      showToast({
        tone: "success",
        message: result.correctionMode === "history_only"
          ? `${number} 的历史出库信息已纠正，条码当前归属和签收状态未改变`
          : `${number} 的出库信息及当前归属已纠正`
      });
      onClose();
      await onChanged();
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "纠正出库信息失败") });
    } finally {
      setSaving(false);
    }
  }

  return <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/50 p-3">
    <section className="w-full max-w-xl rounded-md bg-white shadow-2xl" role="dialog" aria-modal="true">
      <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="text-lg font-semibold text-ink">纠正出库信息</h2><p className="mt-1 font-mono text-sm text-muted">{number}</p></div><button className="icon-button" onClick={onClose} aria-label="关闭纠正窗口"><X className="h-4 w-4" /></button></div>
      <div className="space-y-4 p-5">
        <label className="block"><span className="label">出库类型</span><select className="field" value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="sales_outbound">销售出库</option><option value="transfer">挪仓</option></select></label>
        <label className="block"><span className="label">来源仓库</span><select className="field" value={sourceWarehouseId} onChange={(event) => setSourceWarehouseId(event.target.value)}>{enabledWarehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        {type === "transfer" ? <label className="block"><span className="label">目标仓库</span><select className="field" value={targetWarehouseId} onChange={(event) => setTargetWarehouseId(event.target.value)}>{enabledWarehouses.filter((item) => item.id !== sourceWarehouseId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <label className="block"><span className="label">销售人员</span><select className="field" value={salespersonId} onChange={(event) => setSalespersonId(event.target.value)}>{enabledSalespeople.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
        <label className="block"><span className="label">备注（选填）</span><textarea className="field min-h-20 py-2" value={note} onChange={(event) => setNote(event.target.value)} placeholder="不强制填写" /></label>
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">若条码已有后续签收、回库或再次出库，本次操作只纠正历史单据信息，不改变条码当前归属、签收状态和签收时间。</p>
      </div>
      <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4"><button className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={saving} onClick={() => void save()}><Pencil className="h-4 w-4" />{saving ? "正在保存" : "确认纠正"}</button></div>
    </section>
  </div>;
}
