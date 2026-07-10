"use client";

import { ClipboardList, Download, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { EmptyState, FieldSelect, PaginationBar, SectionHeader, StatusBadge } from "@/components/warehouse/CommonUi";
import { ReasonDialog } from "@/components/warehouse/FeedbackDialogs";
import { ClientApiError, apiErrorMessage, postJson, type ApiResponse } from "@/lib/client-api";
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
          <div className="grid gap-2 sm:grid-cols-[160px_150px_220px_120px_auto_auto_auto_auto] sm:items-end">
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
                  <tr key={order.id} className={`${selected ? "bg-emerald-50" : ""} hover:bg-slate-50`}>
                    <td className="table-cell">
                      <input
                        aria-label={`选择单据 ${order.orderNo}`}
                        checked={selected}
                        className="h-4 w-4 rounded border-slate-300 text-work"
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
                      <div className="font-medium text-ink">{order.operator}</div>
                      <div className="mt-1 text-xs text-slate-500">已写入库存流水</div>
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
