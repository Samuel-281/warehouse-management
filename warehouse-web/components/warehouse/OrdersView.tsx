"use client";

import { Barcode, ChevronRight, ClipboardList, Download, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { EmptyState, FieldSelect, PaginationBar, SectionHeader, StatusBadge } from "@/components/warehouse/CommonUi";
import { ReasonDialog } from "@/components/warehouse/FeedbackDialogs";
import { ClientApiError, apiErrorMessage, getJson, postJson, type ApiResponse } from "@/lib/client-api";
import type { OrderKind, OrderListResult, OrderStatus, OrderSummary, Toast } from "@/lib/types";

const pageSizeOptions = [20, 50, 100];

export function OrdersView({
  orders,
  result,
  loading,
  kindFilter,
  setKindFilter,
  barcodeFilter,
  setBarcodeFilter,
  refreshOrders,
  showToast,
  canDeleteOrders
}: {
  orders: OrderSummary[];
  result: OrderListResult;
  loading: boolean;
  kindFilter: OrderKind | "all";
  setKindFilter: (value: OrderKind | "all") => void;
  barcodeFilter: string;
  setBarcodeFilter: (value: string) => void;
  refreshOrders: (query: {
    kind: OrderKind | "all";
    status: OrderStatus | "all";
    barcode: string;
    page: number;
    pageSize: number;
  }) => Promise<void>;
  showToast: (toast: Toast) => void;
  canDeleteOrders: boolean;
}) {
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidingOrders, setVoidingOrders] = useState(false);
  const [detailOrder, setDetailOrder] = useState<OrderSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestRef = useRef(0);
  const inboundCount = result.counts.inbound;
  const outboundCount = result.counts.outbound;
  const returnCount = result.counts.salesReturn;
  const totalPages = Math.max(1, Math.ceil(result.total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageOrders = orders;
  const selectedOrders = orders.filter((order) => selectedOrderIds.includes(order.id));
  const pageSelectedOrders = pageOrders.filter((order) => selectedOrderIds.includes(order.id));
  const allVisibleSelected = pageOrders.length > 0 && pageSelectedOrders.length === pageOrders.length;

  useEffect(() => {
    setSelectedOrderIds((previous) => previous.filter((id) => orders.some((order) => order.id === id)));
  }, [orders]);

  useEffect(() => {
    setPage(1);
  }, [barcodeFilter, kindFilter, pageSize, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshOrders({ kind: kindFilter, status: statusFilter, barcode: barcodeFilter, page, pageSize });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [barcodeFilter, kindFilter, page, pageSize, refreshOrders, statusFilter]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  function toggleOrderSelection(orderId: string, checked: boolean) {
    setSelectedOrderIds((previous) =>
      checked ? [...new Set([...previous, orderId])] : previous.filter((id) => id !== orderId)
    );
  }

  function toggleAllVisibleOrders(checked: boolean) {
    const pageOrderIds = pageOrders.map((order) => order.id);
    setSelectedOrderIds((previous) =>
      checked
        ? [...new Set([...previous, ...pageOrderIds])]
        : previous.filter((orderId) => !pageOrderIds.includes(orderId))
    );
  }

  async function openOrderDetail(order: OrderSummary) {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setDetailOrder(order);
    setDetailLoading(true);
    try {
      const detail = await getJson<OrderSummary>(`/api/orders/${order.kind}/${order.id}`);
      if (requestId === detailRequestRef.current) setDetailOrder(detail);
    } catch (error) {
      if (requestId === detailRequestRef.current) {
        setDetailOrder(null);
        showToast({ tone: "error", message: apiErrorMessage(error, "读取单据详情失败") });
      }
    } finally {
      if (requestId === detailRequestRef.current) setDetailLoading(false);
    }
  }

  function closeOrderDetail() {
    detailRequestRef.current += 1;
    setDetailOrder(null);
    setDetailLoading(false);
  }

  async function exportSelectedOrders() {
    if (selectedOrders.length === 0) return;
    try {
      const response = await fetch("/api/orders/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ orders: selectedOrders.map((order) => ({ id: order.id, kind: order.kind })) })
      });
      if (!response.ok) {
        const payload = (await response.json()) as ApiResponse<never>;
        throw new ClientApiError("error" in payload ? payload.error : "导出单据失败", response.status);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `业务单据导出-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast({ tone: "success", message: `已导出 ${selectedOrders.length} 张单据` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "导出单据失败") });
    }
  }

  function deleteSelectedOrders() {
    if (!canDeleteOrders || selectedOrders.length === 0) return;
    const invalid = selectedOrders.find((order) => order.status === "voided" || !order.reversalSupported);
    if (invalid) {
      showToast({ tone: "error", message: `单据 ${invalid.orderNo} 已作废或不支持撤销` });
      return;
    }
    setVoidDialogOpen(true);
  }

  async function voidSelectedOrders(reason: string) {
    setVoidingOrders(true);
    try {
      const result = await postJson<{ voided: number }>("/api/orders/void", {
          orders: selectedOrders.map((order) => ({ id: order.id, kind: order.kind })),
          reason
      });
      setSelectedOrderIds([]);
      setVoidDialogOpen(false);
      await refreshOrders({ kind: kindFilter, status: statusFilter, barcode: barcodeFilter, page, pageSize });
      showToast({ tone: "success", message: `已撤销 ${result.voided} 张单据，库存影响已恢复` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "撤销单据失败") });
    } finally {
      setVoidingOrders(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="panel p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <SectionHeader icon={ClipboardList} title="业务单据历史" compact />
            <p className="mt-2 text-xs text-muted">
              当前筛选 {result.total} 张 · 入库 {inboundCount} 张 · 出库 {outboundCount} 张 · 销售退回 {returnCount} 张
            </p>
          </div>
          <div className="grid gap-2 md:grid-cols-2 md:items-end xl:grid-cols-[160px_150px_220px_120px_auto_auto_auto_auto]">
            <div>
              <FieldSelect
                label="业务类型"
                value={kindFilter}
                onChange={(value) => setKindFilter(value as OrderKind | "all")}
                options={[
                  { value: "all", label: "全部单据" },
                  { value: "inbound", label: "入库单" },
                  { value: "outbound", label: "出库单" },
                  { value: "sales_return", label: "销售退回单" }
                ]}
              />
            </div>
            <FieldSelect
              label="单据状态"
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as OrderStatus | "all")}
              options={[
                { value: "all", label: "全部状态" },
                { value: "active", label: "正常" },
                { value: "voided", label: "已作废" }
              ]}
            />
            <div>
              <label className="label" htmlFor="order-barcode-filter">
                条码
              </label>
              <input
                id="order-barcode-filter"
                className="field"
                placeholder="输入完整条码查单据"
                value={barcodeFilter}
                onChange={(event) => setBarcodeFilter(event.target.value)}
              />
            </div>
            <FieldSelect
              label="单页显示"
              value={String(pageSize)}
              onChange={(value) => setPageSize(Number(value))}
              options={pageSizeOptions.map((size) => ({ value: String(size), label: `${size} 张` }))}
            />
            <button
              className="secondary-button"
              onClick={() => void refreshOrders({ kind: kindFilter, status: statusFilter, barcode: barcodeFilter, page, pageSize })}
              disabled={loading}
            >
              <RotateCcw className="h-4 w-4" />
              {loading ? "刷新中" : "刷新单据"}
            </button>
            <button className="primary-button" onClick={exportSelectedOrders} disabled={selectedOrders.length === 0}>
              <Download className="h-4 w-4" />
              导出已选
            </button>
            {canDeleteOrders ? (
              <button className="secondary-button text-red-600 hover:border-red-200 hover:bg-red-50" onClick={deleteSelectedOrders} disabled={selectedOrders.length === 0}>
                <Trash2 className="h-4 w-4" />
                撤销已选
              </button>
            ) : null}
            <button
              className="secondary-button"
              onClick={() => setSelectedOrderIds([])}
              disabled={selectedOrders.length === 0}
            >
              <X className="h-4 w-4" />
              清空选择
            </button>
          </div>
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <SectionHeader icon={ClipboardList} title="单据列表" compact />
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <span>
              当前 {formatOrderFilterLabel(kindFilter)} · {result.total} 张 · 第 {currentPage} /{" "}
              {totalPages} 页
            </span>
            <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 font-semibold text-slate-700">
              已选 {selectedOrders.length} 张
            </span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1040px]">
            <thead className="table-head">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    aria-label="选择当前列表全部单据"
                    checked={allVisibleSelected}
                    className="h-4 w-4 rounded border-slate-300 text-work"
                    disabled={pageOrders.length === 0}
                    onChange={(event) => toggleAllVisibleOrders(event.target.checked)}
                    type="checkbox"
                  />
                </th>
                <th className="px-4 py-3">单据</th>
                <th className="px-4 py-3">业务</th>
                <th className="px-4 py-3">来源 / 去向</th>
                <th className="px-4 py-3">数量与条码</th>
                <th className="px-4 py-3">操作信息</th>
              </tr>
            </thead>
            <tbody>
              {pageOrders.map((order) => {
                const selected = selectedOrderIds.includes(order.id);
                return (
                  <tr
                    key={order.id}
                    className={`${selected ? "bg-emerald-50" : ""} cursor-pointer hover:bg-slate-50`}
                    onClick={() => void openOrderDetail(order)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void openOrderDetail(order);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="table-cell">
                      <input
                        aria-label={`选择单据 ${order.orderNo}`}
                        checked={selected}
                        className="h-4 w-4 rounded border-slate-300 text-work"
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => toggleOrderSelection(order.id, event.target.checked)}
                        type="checkbox"
                      />
                    </td>
                    <td className="table-cell">
                      <div className="font-mono text-sm font-semibold text-work">{order.orderNo}</div>
                      <div className="mt-1 text-xs text-slate-500">{order.createdAt}</div>
                      {order.status === "voided" ? <div className="mt-1 text-xs font-semibold text-red-600">已作废</div> : null}
                    </td>
                    <td className="table-cell">
                      <StatusBadge label={order.businessType} />
                      <div className="mt-2 text-xs text-slate-500">{formatOrderKind(order.kind)}</div>
                    </td>
                    <td className="table-cell">
                      <div className="font-medium text-ink">{order.primaryTarget}</div>
                      <div className="mt-1 text-xs text-slate-500">{order.counterparty ?? "-"}</div>
                    </td>
                    <td className="table-cell">
                      <div className="text-sm font-semibold text-ink">{order.itemCount} 件</div>
                      <div className="mt-1 text-xs text-slate-500">{order.goodsSummary || "-"}</div>
                      <div className="mt-2 font-mono text-xs text-slate-500">{order.barcodePreview || "-"}</div>
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-ink">{order.operator}</div>
                          <div className="mt-1 text-xs text-slate-500">已写入库存流水</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400" />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {pageOrders.length === 0 ? (
                <tr>
                  <td className="table-cell" colSpan={6}>
                    <EmptyState
                      icon={ClipboardList}
                      title={loading ? "正在读取单据" : "没有符合条件的单据"}
                      detail={loading ? "系统正在从数据库读取业务单据。" : "调整业务类型筛选或刷新后再查看。"}
                    />
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        {result.total > 0 ? (
          <PaginationBar
            page={currentPage}
            pageSize={pageSize}
            total={result.total}
            onPageChange={setPage}
          />
        ) : null}
      </section>
      <OrderDetailDialog order={detailOrder} loading={detailLoading} onClose={closeOrderDetail} />
      <ReasonDialog
        title="撤销业务单据"
        message={`将撤销已选 ${selectedOrders.length} 张单据，并按原业务快照恢复库存与条码归属。存在后续流转时系统会拒绝整批撤销。`}
        confirmLabel="确认撤销"
        open={voidDialogOpen}
        busy={voidingOrders}
        onCancel={() => setVoidDialogOpen(false)}
        onConfirm={(reason) => void voidSelectedOrders(reason)}
      />
    </div>
  );
}

function OrderDetailDialog({ order, loading, onClose }: { order: OrderSummary | null; loading: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!order) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, order]);

  if (!order) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onClick={onClose} role="presentation">
      <section
        aria-label={`单据详情 ${order.orderNo}`}
        aria-modal="true"
        className="flex h-[86vh] max-h-[760px] w-full max-w-4xl flex-col overflow-hidden rounded-md bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted">单据详情</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="break-all font-mono text-lg font-semibold text-work">{order.orderNo}</h2>
              <StatusBadge label={order.status === "voided" ? "已作废" : "正常"} />
            </div>
          </div>
          <button aria-label="关闭单据详情" className="icon-button" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {loading ? <div className="mb-4 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">正在读取完整单据明细...</div> : null}

          <div className="overflow-hidden rounded-md border border-slate-200">
            <div className="grid md:grid-cols-2 lg:grid-cols-3">
              <OrderDetailField label="业务类型" value={order.businessType} />
              <OrderDetailField label="单据类型" value={formatOrderKind(order.kind)} />
              <OrderDetailField label="货物数量" value={`${order.itemCount.toLocaleString("zh-CN")} 件`} />
              <OrderDetailField label="主要仓库" value={order.primaryTarget} />
              <OrderDetailField label="来源 / 去向" value={order.counterparty ?? "-"} />
              <OrderDetailField label="操作信息" value={order.operator} meta={order.createdAt} />
            </div>
          </div>

          <section className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-sm font-semibold text-ink">货物明细</p>
            <p className="mt-2 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-700">{order.goodsSummary || "暂无货物汇总"}</p>
          </section>

          {order.status === "voided" ? (
            <section className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-800">
              <p className="font-semibold">该单据已作废</p>
              <p className="mt-1">撤销人：{order.voidedBy ?? "-"} · 撤销时间：{order.voidedAt ?? "-"}</p>
              <p className="mt-1">撤销原因：{order.voidReason ?? "-"}</p>
            </section>
          ) : null}

          <section className="mt-4 border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Barcode className="h-4 w-4 text-work" />
                <p className="text-sm font-semibold text-ink">条码明细</p>
              </div>
              <span className="text-xs text-muted">{order.barcodes.length.toLocaleString("zh-CN")} 条</span>
            </div>
            {order.barcodes.length > 0 ? (
              <div className="mt-3 max-h-[300px] overflow-y-auto rounded-md border border-slate-200">
                <div className="grid sm:grid-cols-2 lg:grid-cols-3">
                  {order.barcodes.map((barcode) => (
                    <div key={barcode} className="border-b border-r border-slate-100 px-3 py-2 font-mono text-xs text-slate-700">
                      {barcode}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-muted">
                该单据按商品数量记录，不包含单件条码。
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}

function OrderDetailField({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="min-h-[82px] border-b border-r border-slate-200 px-4 py-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-2 font-semibold text-ink">{value}</p>
      {meta ? <p className="mt-1 text-xs text-slate-500">{meta}</p> : null}
    </div>
  );
}

function formatOrderKind(kind: OrderKind) {
  const labels: Record<OrderKind, string> = {
    inbound: "入库单",
    outbound: "出库单",
    sales_return: "销售退回单"
  };
  return labels[kind];
}

function formatOrderFilterLabel(kind: OrderKind | "all") {
  if (kind === "all") return "全部单据";
  return formatOrderKind(kind);
}
