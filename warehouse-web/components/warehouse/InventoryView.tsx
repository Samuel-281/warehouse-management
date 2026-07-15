"use client";

import { AlertCircle, Barcode, Boxes, ChevronRight, ClipboardList, Download, Info, Pencil, RotateCcw, Search, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, FieldSelect, PaginationBar, ReadOnlyField, StatusBadge } from "@/components/warehouse/CommonUi";
import { ConfirmDialog, ReasonDialog, type ConfirmDialogState } from "@/components/warehouse/FeedbackDialogs";
import { apiErrorMessage, deleteJson, getJson, patchJson, postJson } from "@/lib/client-api";
import type {
  InventoryDetailResult,
  InventoryItem,
  InventoryListResult,
  InventorySummary,
  InventoryStatusScope,
  StockMovement,
  TerminalReceiptRecord,
  Toast,
  WarehouseState
} from "@/lib/types";
import { formatCategory, formatMovementType, goodsLabel, ownerLabel } from "@/lib/warehouse-utils";

export type InventoryOwnerScope = "all" | "warehouse" | "salesperson" | "terminal_store";
export type InventoryFilters = {
  keyword: string;
  statusScope: InventoryStatusScope;
  ownerScope: InventoryOwnerScope;
  warehouseId: string;
  salespersonId: string;
  goodsId: string;
};

const pageSizeOptions = [20, 50, 100];

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function escapeCsvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

export function InventoryView(props: {
  state: WarehouseState;
  summary: InventorySummary;
  filters: InventoryFilters;
  setFilters: (value: InventoryFilters) => void;
  selectedBarcode: string;
  setSelectedBarcode: (barcode: string) => void;
  showToast: (toast: Toast) => void;
  canDeleteInventory: boolean;
  onDataChanged: () => Promise<void>;
}) {
  const { filters, showToast } = props;
  const [detailBarcode, setDetailBarcode] = useState<string | null>(null);
  const [detailResult, setDetailResult] = useState<InventoryDetailResult | null>(null);
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const [activeTab, setActiveTab] = useState<"warehouse" | "tracking">("tracking");
  const [warehousePageSize, setWarehousePageSize] = useState(20);
  const [warehousePage, setWarehousePage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [maintenanceBusy, setMaintenanceBusy] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [writeOffOpen, setWriteOffOpen] = useState(false);
  const [deleteDialog, setDeleteDialog] = useState<ConfirmDialogState | null>(null);
  const [adjustmentStock, setAdjustmentStock] = useState<WarehouseState["warehouseStocks"][number] | null>(null);
  const inventoryRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const [inventoryResult, setInventoryResult] = useState<InventoryListResult>({
    items: [],
    latestMovements: [],
    total: 0,
    warehouseResultCount: 0,
    salesResultCount: 0,
    terminalResultCount: 0,
    page: 1,
    pageSize: 20
  });
  const latestMovementByBarcode = useMemo(
    () => new Map(inventoryResult.latestMovements.map((movement) => [movement.barcode, movement])),
    [inventoryResult.latestMovements]
  );

  const loadInventoryPage = useCallback(async () => {
    const requestId = inventoryRequestRef.current + 1;
    inventoryRequestRef.current = requestId;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        keyword: filters.keyword,
        statusScope: filters.statusScope,
        ownerScope: filters.ownerScope,
        warehouseId: filters.warehouseId,
        salespersonId: filters.salespersonId,
        goodsId: filters.goodsId,
        page: String(page),
        pageSize: String(pageSize)
      });
      const result = await getJson<InventoryListResult>(`/api/inventory?${params.toString()}`);
      if (requestId === inventoryRequestRef.current) setInventoryResult(result);
    } catch (error) {
      if (requestId === inventoryRequestRef.current) {
        showToast({ tone: "error", message: apiErrorMessage(error, "读取库存失败") });
      }
    } finally {
      if (requestId === inventoryRequestRef.current) setLoading(false);
    }
  }, [
    page,
    pageSize,
    filters.goodsId,
    filters.keyword,
    filters.ownerScope,
    filters.salespersonId,
    filters.statusScope,
    filters.warehouseId,
    showToast
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadInventoryPage();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadInventoryPage]);

  async function openDetail(barcode: string) {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    props.setSelectedBarcode(barcode);
    setDetailBarcode(barcode);
    setDetailResult(null);
    try {
      const result = await getJson<InventoryDetailResult>(`/api/inventory/${encodeURIComponent(barcode)}`);
      if (requestId === detailRequestRef.current) setDetailResult(result);
    } catch (error) {
      if (requestId === detailRequestRef.current) {
        setDetailBarcode(null);
        showToast({ tone: "error", message: apiErrorMessage(error, "读取条码详情失败") });
      }
    }
  }

  useEffect(() => {
    if (!detailBarcode) return;

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDetailBarcode(null);
        setDetailResult(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailBarcode]);

  function exportMovements(barcode: string, movements: StockMovement[], terminalReceipts: TerminalReceiptRecord[]) {
    if (!barcode || (movements.length === 0 && terminalReceipts.length === 0)) return;

    const header = ["时间", "业务类型", "条码", "货物", "来源", "去向", "操作人", "说明"];
    const rows = [
      ...movements.map((movement) => [
        movement.occurredAt,
        formatMovementType(movement.type),
        movement.barcode,
        goodsLabel(movement.goodsId, props.state.goods),
        movement.fromLabel,
        movement.toLabel,
        movement.operator,
        movement.note
      ]),
      ...terminalReceipts.map((receipt) => [
        receipt.scannedAt,
        "终端签收（外部系统）",
        receipt.barcode,
        receipt.externalGoodsName,
        "签收系统",
        receipt.receivingOrganizationName,
        receipt.scannerName,
        receipt.matchStatus === "conflict" ? "签收时间与仓库业务流转冲突，未改变当前归属" : "签收信息已参与条码外部归属判断，不改变仓库数量账"
      ])
    ].sort((a, b) => b[0].localeCompare(a[0]));
    downloadCsv(`${barcode}-流水.csv`, [header, ...rows]);
  }

  function clearInventoryFilters() {
    props.setFilters({
        keyword: "",
        statusScope: "active",
        ownerScope: "all",
        warehouseId: "all",
        salespersonId: "all",
      goodsId: "all"
    });
  }

  function clearWarehouseFilters() {
    props.setFilters({
      ...props.filters,
      keyword: "",
      warehouseId: "all",
      goodsId: "all"
    });
  }

  function deleteInventoryBarcode(barcode: string) {
    if (!props.canDeleteInventory) return;
    setDeleteDialog({
      title: "彻底删除错误档案",
      message: `只允许删除从未被单据、流水或条码更正引用的空白档案。\n确定尝试删除条码「${barcode}」吗？`,
      confirmLabel: "确认删除",
      destructive: true
    });
  }

  async function confirmInventoryDelete() {
    const barcode = detailResult?.item.barcode;
    if (!barcode) return;
    setMaintenanceBusy(true);
    try {
      await deleteJson<{ deleted: boolean }>(`/api/inventory/${encodeURIComponent(barcode)}`);
      setDetailBarcode(null);
      setDetailResult(null);
      setDeleteDialog(null);
      await loadInventoryPage();
      showToast({ tone: "success", message: `条码 ${barcode} 已删除` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "删除库存条码失败") });
    } finally {
      setMaintenanceBusy(false);
    }
  }

  async function correctInventoryBarcode(newBarcode: string, reason: string) {
    const barcode = detailResult?.item.barcode;
    if (!barcode) return;
    setMaintenanceBusy(true);
    try {
      const result = await patchJson<{ corrected: boolean; barcode: string }>(
        `/api/inventory/${encodeURIComponent(barcode)}/correct`,
        { newBarcode, reason }
      );
      setCorrectionOpen(false);
      await loadInventoryPage();
      await openDetail(result.barcode);
      showToast({ tone: "success", message: `条码已更正为 ${result.barcode}` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "条码更正失败") });
    } finally {
      setMaintenanceBusy(false);
    }
  }

  async function writeOffInventoryBarcode(reason: string) {
    const barcode = detailResult?.item.barcode;
    if (!barcode) return;
    setMaintenanceBusy(true);
    try {
      await postJson(`/api/inventory/${encodeURIComponent(barcode)}/write-off`, { reason });
      setWriteOffOpen(false);
      setDetailBarcode(null);
      setDetailResult(null);
      await Promise.all([loadInventoryPage(), props.onDataChanged()]);
      showToast({ tone: "success", message: `条码 ${barcode} 已核销并保留完整历史` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "货物核销失败") });
    } finally {
      setMaintenanceBusy(false);
    }
  }

  async function adjustWarehouseInventory(quantityChange: number, reason: string) {
    if (!adjustmentStock) return;
    setMaintenanceBusy(true);
    try {
      await postJson("/api/warehouse-stocks/adjust", {
        warehouseId: adjustmentStock.warehouseId,
        goodsId: adjustmentStock.goodsId,
        quantityChange,
        reason
      });
      setAdjustmentStock(null);
      await Promise.all([loadInventoryPage(), props.onDataChanged()]);
      showToast({ tone: "success", message: `库存已修正 ${quantityChange > 0 ? "+" : ""}${quantityChange} 件` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "库存修正失败") });
    } finally {
      setMaintenanceBusy(false);
    }
  }

  const warehouseResultCount = inventoryResult.warehouseResultCount;
  const salesResultCount = inventoryResult.salesResultCount;
  const terminalResultCount = inventoryResult.terminalResultCount;
  const activeFilterCount = [
    props.filters.keyword.trim(),
    props.filters.statusScope !== "active" ? props.filters.statusScope : "",
    props.filters.ownerScope !== "all" ? props.filters.ownerScope : "",
    props.filters.warehouseId !== "all" ? props.filters.warehouseId : "",
    props.filters.salespersonId !== "all" ? props.filters.salespersonId : "",
    props.filters.goodsId !== "all" ? props.filters.goodsId : ""
  ].filter(Boolean).length;
  const totalPages = Math.max(1, Math.ceil(inventoryResult.total / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pageItems = inventoryResult.items;
  const exactEndedItem = props.filters.keyword.trim()
    ? pageItems.find((item) => item.status === "written_off" || item.status === "voided")
    : undefined;
  const warehouseStockRows = props.state.warehouseStocks
    .map((stock) => ({
      stock,
      warehouse: props.state.warehouses.find((warehouse) => warehouse.id === stock.warehouseId),
      goods: props.state.goods.find((goods) => goods.id === stock.goodsId)
    }))
    .filter(({ stock, warehouse, goods }) => {
      if (!warehouse || !goods) return false;
      if (props.filters.warehouseId !== "all" && stock.warehouseId !== props.filters.warehouseId) return false;
      if (props.filters.goodsId !== "all" && stock.goodsId !== props.filters.goodsId) return false;
      const keyword = props.filters.keyword.trim().toLowerCase();
      if (!keyword) return true;
      return (
        warehouse.name.toLowerCase().includes(keyword) ||
        goods.name.toLowerCase().includes(keyword) ||
        goods.code.toLowerCase().includes(keyword)
      );
    })
    .sort((a, b) => {
      const warehouseSort = (a.warehouse?.name ?? "").localeCompare(b.warehouse?.name ?? "", "zh-CN");
      if (warehouseSort !== 0) return warehouseSort;
      return (a.goods?.code ?? "").localeCompare(b.goods?.code ?? "", "zh-CN");
    });
  const warehouseTotalPages = Math.max(1, Math.ceil(warehouseStockRows.length / warehousePageSize));
  const currentWarehousePage = Math.min(warehousePage, warehouseTotalPages);
  const warehousePageRows = warehouseStockRows.slice(
    (currentWarehousePage - 1) * warehousePageSize,
    currentWarehousePage * warehousePageSize
  );

  useEffect(() => {
    setPage(1);
  }, [props.filters, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  useEffect(() => {
    setWarehousePage(1);
  }, [props.filters.goodsId, props.filters.keyword, props.filters.warehouseId, warehousePageSize]);

  useEffect(() => {
    if (warehousePage > warehouseTotalPages) setWarehousePage(warehouseTotalPages);
  }, [warehousePage, warehouseTotalPages]);

  return (
    <div className="grid gap-4">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 flex-wrap items-center gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-muted">仓库库存总量</p>
              <p className="mt-1 text-xl font-semibold text-ink">{props.summary.totalWarehouseQuantity.toLocaleString("zh-CN")} 件</p>
            </div>
            <div className="border-l border-slate-200 pl-6">
              <p className="text-xs text-muted">可追踪条码</p>
              <p className="mt-1 text-xl font-semibold text-ink">{props.summary.totalItems.toLocaleString("zh-CN")} 件</p>
            </div>
            <div className="border-l border-slate-200 pl-6">
              <p className="text-xs text-muted">已核销</p>
              <p className="mt-1 text-xl font-semibold text-slate-600">{props.summary.writtenOff.toLocaleString("zh-CN")} 件</p>
            </div>
          </div>
          <button className="secondary-button self-start whitespace-nowrap lg:self-auto" onClick={() => void loadInventoryPage()} disabled={loading}>
            <RotateCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            {loading ? "刷新中" : "刷新条码"}
          </button>
        </div>

        <div className="flex border-b border-slate-200 px-4" role="tablist" aria-label="库存查询类型">
          <button
            className={`relative flex h-12 items-center gap-2 px-3 text-sm font-semibold ${activeTab === "warehouse" ? "text-work" : "text-slate-500 hover:text-ink"}`}
            onClick={() => setActiveTab("warehouse")}
            role="tab"
            aria-selected={activeTab === "warehouse"}
          >
            <Boxes className="h-4 w-4" />
            仓库数量库存
            {activeTab === "warehouse" ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-work" /> : null}
          </button>
          <button
            className={`relative flex h-12 items-center gap-2 px-3 text-sm font-semibold ${activeTab === "tracking" ? "text-work" : "text-slate-500 hover:text-ink"}`}
            onClick={() => setActiveTab("tracking")}
            role="tab"
            aria-selected={activeTab === "tracking"}
          >
            <Barcode className="h-4 w-4" />
            条码追踪
            {activeTab === "tracking" ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-work" /> : null}
          </button>
        </div>

        {activeTab === "warehouse" ? (
          <div role="tabpanel">
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1fr)_220px_220px_auto] xl:items-end">
              <div>
                <label className="label" htmlFor="warehouse-stock-keyword">关键字</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="warehouse-stock-keyword"
                    className="field pl-9"
                    placeholder="货物名称、编码或仓库"
                    value={props.filters.keyword}
                    onChange={(event) => props.setFilters({ ...props.filters, keyword: event.target.value })}
                  />
                </div>
              </div>
              <FieldSelect
                label="仓库"
                value={props.filters.warehouseId}
                onChange={(value) => props.setFilters({ ...props.filters, warehouseId: value })}
                options={[
                  { value: "all", label: "全部仓库" },
                  ...props.state.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))
                ]}
              />
              <FieldSelect
                label="货物"
                value={props.filters.goodsId}
                onChange={(value) => props.setFilters({ ...props.filters, goodsId: value })}
                options={[
                  { value: "all", label: "全部货物" },
                  ...props.state.goods.map((goods) => ({ value: goods.id, label: goods.name }))
                ]}
              />
              <button className="secondary-button" onClick={clearWarehouseFilters} title="重置仓库库存筛选">
                <X className="h-4 w-4" />
                重置
              </button>
            </div>

            <div className="flex items-start gap-2 border-b border-slate-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>仓库数量库存独立于条码追踪，厂家到货等无条码入库也会计入这里。</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <p className="text-sm font-semibold text-ink">库存明细 <span className="ml-2 font-normal text-muted">共 {warehouseStockRows.length} 条</span></p>
              <FieldSelect
                label="单页显示"
                value={String(warehousePageSize)}
                onChange={(value) => setWarehousePageSize(Number(value))}
                options={pageSizeOptions.map((size) => ({ value: String(size), label: `${size} 条` }))}
                inline
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead className="table-head">
                  <tr>
                    <th className="px-4 py-3">仓库</th>
                    <th className="px-4 py-3">货物</th>
                    <th className="px-4 py-3">当前库存</th>
                    <th className="px-4 py-3">最近变动</th>
                    {props.canDeleteInventory ? <th className="px-4 py-3 text-right">操作</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {warehousePageRows.map(({ stock, warehouse, goods }) => (
                    <tr key={stock.id} className="hover:bg-slate-50">
                      <td className="table-cell font-medium text-ink">{warehouse?.name}</td>
                      <td className="table-cell">
                        <p className="font-medium text-ink">{goods?.name}</p>
                        <p className="mt-0.5 text-xs text-muted">{goods?.code}</p>
                      </td>
                      <td className="table-cell font-semibold text-ink">{stock.quantity.toLocaleString("zh-CN")} {goods?.unit}</td>
                      <td className="table-cell font-mono text-xs text-slate-500">{stock.lastChangedAt}</td>
                      {props.canDeleteInventory ? (
                        <td className="table-cell text-right">
                          <button className="secondary-button ml-auto h-8 px-2 text-xs" onClick={() => setAdjustmentStock(stock)}>
                            <Pencil className="h-3.5 w-3.5" />
                            修正库存
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
              {warehouseStockRows.length === 0 ? (
                <div className="border-t border-slate-200 p-4">
                  <EmptyState icon={Boxes} title="没有匹配的仓库库存" detail="请调整仓库、货物或关键字后重新查询。" />
                </div>
              ) : null}
            </div>
            {warehouseStockRows.length > 0 ? (
              <PaginationBar page={currentWarehousePage} pageSize={warehousePageSize} total={warehouseStockRows.length} onPageChange={setWarehousePage} />
            ) : null}
          </div>
        ) : (
          <div role="tabpanel">
            <div className="grid gap-3 border-b border-slate-200 bg-slate-50/70 p-4 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.2fr)_150px_150px_190px_190px_auto] xl:items-end">
              <div>
                <label className="label" htmlFor="inventory-keyword">条码或货物</label>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="inventory-keyword"
                    className="field pl-9"
                    placeholder="输入完整条码精确查询，或输入货物名称"
                    value={props.filters.keyword}
                    onChange={(event) => props.setFilters({ ...props.filters, keyword: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") void loadInventoryPage();
                    }}
                  />
                </div>
              </div>
              <FieldSelect
                label="条码状态"
                value={props.filters.statusScope}
                onChange={(value) => props.setFilters({ ...props.filters, statusScope: value as InventoryStatusScope })}
                options={[
                  { value: "active", label: "正常流转" },
                  { value: "written_off", label: "已核销" },
                  { value: "voided", label: "已撤销追踪" },
                  { value: "all", label: "全部状态" }
                ]}
              />
              <FieldSelect
                label="当前归属"
                value={props.filters.ownerScope}
                onChange={(value) => props.setFilters({ ...props.filters, ownerScope: value as InventoryOwnerScope, warehouseId: "all", salespersonId: "all" })}
                options={[
                  { value: "all", label: "全部归属" },
                  { value: "warehouse", label: "仓库" },
                  { value: "salesperson", label: "待签收" },
                  { value: "terminal_store", label: "终端店铺" }
                ]}
              />
              {props.filters.ownerScope === "warehouse" ? (
                <FieldSelect
                  label="具体仓库"
                  value={props.filters.warehouseId}
                  onChange={(value) => props.setFilters({ ...props.filters, warehouseId: value })}
                  options={[{ value: "all", label: "全部仓库" }, ...props.state.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))]}
                />
              ) : props.filters.ownerScope === "salesperson" ? (
                <FieldSelect
                  label="出库销售人员"
                  value={props.filters.salespersonId}
                  onChange={(value) => props.setFilters({ ...props.filters, salespersonId: value })}
                  options={[{ value: "all", label: "全部销售人员" }, ...props.state.salespeople.map((person) => ({ value: person.id, label: person.name }))]}
                />
              ) : (
                <ReadOnlyField
                  label="具体范围"
                  value={props.filters.ownerScope === "terminal_store" ? "以勤策收货单位为准" : "全部仓库、待签收与已签收条码"}
                />
              )}
              <FieldSelect
                label="货物"
                value={props.filters.goodsId}
                onChange={(value) => props.setFilters({ ...props.filters, goodsId: value })}
                options={[{ value: "all", label: "全部货物" }, ...props.state.goods.map((goods) => ({ value: goods.id, label: goods.name }))]}
              />
              <div className="flex gap-2">
                <button className="primary-button" onClick={() => void loadInventoryPage()} disabled={loading}>
                  <Search className="h-4 w-4" />
                  查询
                </button>
                <button className="icon-button" onClick={clearInventoryFilters} title="重置条码筛选" aria-label="重置条码筛选">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex items-start gap-2 border-b border-slate-200 bg-sky-50 px-4 py-2.5 text-xs text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>{exactEndedItem ? `已找到结束追踪条码，当前状态：${formatItemStatus(exactEndedItem)}。` : "完整条码将进行全库精确查询；列表仅按页读取，不会加载全部条码。"}</p>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-ink">条码列表 <span className="ml-2 font-normal text-muted">共 {inventoryResult.total} 件</span></p>
                <p className="mt-1 text-xs text-muted">
                  {props.filters.statusScope === "active"
                    ? `在库 ${warehouseResultCount} 件 · 待签收 ${salesResultCount} 件 · 已签收 ${terminalResultCount} 件 · 已用筛选 ${activeFilterCount} 项`
                    : `状态范围：${formatStatusScope(props.filters.statusScope)} · 已用筛选 ${activeFilterCount} 项`}
                </p>
              </div>
              <FieldSelect
                label="单页显示"
                value={String(pageSize)}
                onChange={(value) => setPageSize(Number(value))}
                options={pageSizeOptions.map((size) => ({ value: String(size), label: `${size} 件` }))}
                inline
              />
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1000px]">
                <thead className="table-head">
                  <tr>
                    <th className="px-4 py-3">条码 / 货物</th>
                    <th className="px-4 py-3">当前归属</th>
                    <th className="px-4 py-3">生产 / 保质期</th>
                    <th className="px-4 py-3">最近流转</th>
                    <th className="px-4 py-3">状态</th>
                    <th className="w-10 px-3 py-3"><span className="sr-only">查看详情</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map((item) => {
                    const goods = props.state.goods.find((entry) => entry.id === item.goodsId);
                    const selected = props.selectedBarcode === item.barcode;
                    const latestMovement = latestMovementByBarcode.get(item.barcode);
                    return (
                      <tr
                        key={item.id}
                        className={`cursor-pointer hover:bg-slate-50 ${selected ? "bg-emerald-50" : ""}`}
                        onClick={() => void openDetail(item.barcode)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void openDetail(item.barcode);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td className={`table-cell ${selected ? "border-l-2 border-l-work" : ""}`}>
                          <div className="font-mono text-sm font-semibold text-work">{item.barcode}</div>
                          <div className="mt-1 font-medium text-ink">{goods?.name ?? "未知货物"}</div>
                          <div className="mt-0.5 text-xs text-slate-500">{goods?.code ?? "-"} · {goods ? formatCategory(goods.category) : "-"}</div>
                        </td>
                        <td className="table-cell text-slate-600">{ownerLabel(item, props.state.warehouses, props.state.salespeople, props.state.locations)}</td>
                        <td className="table-cell text-slate-600">
                          <div>{item.productionDate ?? "-"}</div>
                          <div className="mt-1 text-xs text-slate-500">{item.shelfLifeDate ?? "无保质期"}</div>
                        </td>
                        <td className="table-cell text-slate-600">
                          <div>{item.ownerType === "terminal_store" ? "终端签收" : latestMovement ? formatMovementType(latestMovement.type) : "-"}</div>
                          <div className="mt-1 font-mono text-xs text-slate-500">{item.ownerType === "terminal_store" ? item.signedAt ?? "-" : latestMovement?.occurredAt ?? "-"}</div>
                        </td>
                        <td className="table-cell"><StatusBadge label={formatItemStatus(item)} /></td>
                        <td className="table-cell px-3 text-slate-400"><ChevronRight className="h-4 w-4" /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {inventoryResult.total === 0 ? (
                <div className="border-t border-slate-200 p-4">
                  <EmptyState
                    icon={Search}
                    title={loading ? "正在读取条码" : "没有匹配的条码记录"}
                    detail={loading ? "系统正在按当前筛选读取条码。" : "请调整状态、归属、货物或关键字后重新查询。"}
                  />
                </div>
              ) : null}
            </div>
            {inventoryResult.total > 0 ? (
              <PaginationBar page={currentPage} pageSize={pageSize} total={inventoryResult.total} onPageChange={setPage} />
            ) : null}
          </div>
        )}
      </section>

      <InventoryDetailModal
        item={detailResult?.item}
        movements={detailResult?.movements ?? []}
        corrections={detailResult?.corrections ?? []}
        terminalReceipts={detailResult?.terminalReceipts ?? []}
        state={props.state}
        onClose={() => {
          setDetailBarcode(null);
          setDetailResult(null);
        }}
        onExport={() => exportMovements(
          detailBarcode ?? "",
          detailResult?.movements ?? [],
          detailResult?.terminalReceipts ?? []
        )}
        canMaintain={props.canDeleteInventory}
        onCorrect={() => setCorrectionOpen(true)}
        onWriteOff={() => setWriteOffOpen(true)}
        onDelete={() => {
          if (detailResult?.item) deleteInventoryBarcode(detailResult.item.barcode);
        }}
      />
      <BarcodeCorrectionDialog
        item={correctionOpen ? detailResult?.item : undefined}
        busy={maintenanceBusy}
        onCancel={() => setCorrectionOpen(false)}
        onConfirm={(newBarcode, reason) => void correctInventoryBarcode(newBarcode, reason)}
      />
      <ReasonDialog
        title="货物核销"
        message="核销后条码及全部历史仍会保留，且不能再参与出库、退回或挪仓；若货物当前在仓库，仓库数量将同时减少 1 件。核销属于后续流转，相关原业务单据将无法撤销。"
        confirmLabel="确认核销"
        open={writeOffOpen}
        busy={maintenanceBusy}
        onCancel={() => setWriteOffOpen(false)}
        onConfirm={(reason) => void writeOffInventoryBarcode(reason)}
      />
      <ConfirmDialog
        dialog={deleteDialog}
        busy={maintenanceBusy}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={() => void confirmInventoryDelete()}
      />
      <StockAdjustmentDialog
        stock={adjustmentStock}
        state={props.state}
        busy={maintenanceBusy}
        onCancel={() => setAdjustmentStock(null)}
        onConfirm={(quantityChange, reason) => void adjustWarehouseInventory(quantityChange, reason)}
      />
    </div>
  );
}

function InventoryDetailModal({
  item,
  movements,
  corrections,
  terminalReceipts,
  state,
  onClose,
  onExport,
  canMaintain,
  onCorrect,
  onWriteOff,
  onDelete
}: {
  item?: InventoryItem;
  movements: StockMovement[];
  corrections: InventoryDetailResult["corrections"];
  terminalReceipts: InventoryDetailResult["terminalReceipts"];
  state: WarehouseState;
  onClose: () => void;
  onExport: () => void;
  canMaintain: boolean;
  onCorrect: () => void;
  onWriteOff: () => void;
  onDelete: () => void;
}) {
  const goods = item ? state.goods.find((entry) => entry.id === item.goodsId) : undefined;

  if (!item) {
    return null;
  }

  const historyEntries = [
    ...movements.map((movement) => ({ kind: "movement" as const, occurredAt: movement.occurredAt, movement })),
    ...terminalReceipts.map((receipt) => ({ kind: "receipt" as const, occurredAt: receipt.scannedAt, receipt }))
  ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

  return (
    <div
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4"
      onClick={onClose}
      role="dialog"
    >
      <section
        className="flex h-[88vh] max-h-[760px] w-full max-w-5xl flex-col overflow-hidden rounded-md bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted">条码详情</p>
              <p className="mt-1 break-all font-mono text-lg font-semibold text-work">{item.barcode}</p>
            </div>
	            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
	              <StatusBadge label={formatItemStatus(item)} />
              {canMaintain && ["in_stock", "with_salesperson", "signed", "receipt_exception"].includes(item.status) ? (
                <>
                  <button className="secondary-button h-9 px-3" onClick={onCorrect}>
                    <Pencil className="h-4 w-4" />
                    更正条码
                  </button>
                  <button className="secondary-button h-9 px-3 text-red-600 hover:border-red-200 hover:bg-red-50" onClick={onWriteOff}>
                    <AlertCircle className="h-4 w-4" />
                    货物核销
                  </button>
                  <button className="secondary-button h-9 px-3 text-red-600 hover:border-red-200 hover:bg-red-50" onClick={onDelete}>
                    <Trash2 className="h-4 w-4" />
                    删除错误档案
                  </button>
                </>
              ) : null}
	              <button className="icon-button" onClick={onClose} aria-label="关闭条码详情">
	                <X className="h-4 w-4" />
	              </button>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-4">
          <div className="shrink-0 overflow-hidden rounded-md border border-slate-200">
            <div className="grid md:grid-cols-2 lg:grid-cols-5">
              <DetailRow label="货物" value={goods?.name ?? "未知货物"} meta={goods?.code ?? "-"} />
              <DetailRow label="大类" value={goods ? formatCategory(goods.category) : "-"} />
              <DetailRow
                label="当前归属"
                value={ownerLabel(item, state.warehouses, state.salespeople, state.locations)}
              />
              <DetailRow label="生产日期" value={item.productionDate ?? "-"} />
              <DetailRow label="保质期" value={item.shelfLifeDate ?? "无"} />
            </div>
          </div>

          {corrections.length > 0 ? (
            <div className="mt-3 shrink-0 rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
              <span className="font-semibold">条码更正 {corrections.length} 次：</span>{" "}
              最近由 {corrections[0].oldBarcode} 更正为 {corrections[0].newBarcode}，原因：{corrections[0].reason}
            </div>
          ) : null}

          {terminalReceipts.length > 0 ? (
            <div className="mt-3 shrink-0 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-950">
              <span className="font-semibold">已关联终端签收：</span>{" "}
              最近由 {terminalReceipts[0].scannerName} 于 {terminalReceipts[0].scannedAt} 扫码签收至
              「{terminalReceipts[0].receivingOrganizationName}」。有效签收会更新条码外部归属，但不会改变仓库数量账。
            </div>
          ) : null}

          <div className="mt-4 flex min-h-0 flex-1 flex-col border-t border-slate-200 pt-4">
            <div className="flex shrink-0 items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-ink">条码履历</p>
                <p className="mt-1 text-xs text-muted">库存流转 {movements.length} 条 · 终端签收 {terminalReceipts.length} 条</p>
              </div>
              <button className="secondary-button h-9 px-3" onClick={onExport} disabled={historyEntries.length === 0}>
                <Download className="h-4 w-4" />
                导出
              </button>
            </div>

            <div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
              {historyEntries.map((entry, index) => (
                <div key={`${entry.kind}-${entry.kind === "movement" ? entry.movement.id : entry.receipt.id}`} className="relative pl-5">
                  <span className={`absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full ${entry.kind === "receipt" ? "bg-sky-500" : "bg-work"}`} />
                  {index < historyEntries.length - 1 ? (
                    <span className="absolute bottom-[-18px] left-[4px] top-5 w-px bg-slate-200" />
                  ) : null}
                  {entry.kind === "movement" ? (
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink">{formatMovementType(entry.movement.type)}</p>
                        <span className="font-mono text-xs text-slate-500">{entry.movement.occurredAt}</span>
                      </div>
                      <p className="mt-2 text-sm text-slate-700">
                        {entry.movement.fromLabel} → {entry.movement.toLabel}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">{entry.movement.note}</p>
                    </div>
                  ) : (
                    <div className="rounded-md border border-sky-200 bg-sky-50 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-sky-950">终端签收（外部系统）</p>
                          <StatusBadge label={entry.receipt.matchStatus === "conflict" ? "签收异常" : entry.receipt.matchStatus === "matched" ? "已关联" : "未匹配"} />
                        </div>
                        <span className="font-mono text-xs text-sky-700">{entry.receipt.scannedAt}</span>
                      </div>
                      <p className="mt-2 text-sm text-sky-950">签收至：{entry.receipt.receivingOrganizationName}</p>
                      <p className="mt-2 text-xs text-sky-800">
                        扫码人：{entry.receipt.scannerName} · 外部商品：{entry.receipt.externalGoodsName} · 单位：{entry.receipt.goodsUnit}
                      </p>
                      <p className="mt-1 text-xs text-sky-700">
                        {entry.receipt.matchStatus === "conflict"
                          ? "签收时间与仓库业务流转冲突，保留记录但不覆盖当前归属"
                          : "有效签收参与当前终端店铺归属判断，不改变仓库数量账"}
                      </p>
                    </div>
                  )}
                </div>
              ))}
              {historyEntries.length === 0 ? (
                <EmptyState
                  icon={ClipboardList}
                  title="暂无流转记录"
                  detail="该条码发生入库、出库、挪仓或退回后，会显示完整流转时间线。"
                />
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function formatItemStatus(item: InventoryItem) {
  if (item.status === "written_off") return "已核销";
  if (item.status === "voided") return "已撤销追踪";
  if (item.status === "receipt_exception") return "签收异常";
  if (item.ownerType === "terminal_store" || item.status === "signed") return "已签收";
  if (item.ownerType === "salesperson") return "待签收";
  return "在库";
}

function formatStatusScope(statusScope: InventoryStatusScope) {
  if (statusScope === "written_off") return "已核销";
  if (statusScope === "voided") return "已撤销追踪";
  if (statusScope === "all") return "全部状态";
  return "正常流转";
}

function BarcodeCorrectionDialog({
  item,
  busy,
  onCancel,
  onConfirm
}: {
  item?: InventoryItem;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (newBarcode: string, reason: string) => void;
}) {
  const [newBarcode, setNewBarcode] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (item) {
      setNewBarcode("");
      setReason("");
    }
  }, [item]);

  if (!item) return null;
  const valid = newBarcode.trim().length > 0 && newBarcode.trim() !== item.barcode && reason.trim().length >= 2;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-lg rounded-md bg-white p-5 shadow-2xl" role="dialog" aria-modal="true">
        <h2 className="text-base font-semibold text-ink">更正单件条码</h2>
        <p className="mt-2 text-sm text-slate-600">货物身份和库存不变，原条码仍可查询到新条码及完整历史。</p>
        <label className="label mt-4">原条码</label>
        <input className="field font-mono" value={item.barcode} readOnly />
        <label className="label mt-4" htmlFor="corrected-barcode">新条码</label>
        <input
          id="corrected-barcode"
          className="field font-mono"
          maxLength={128}
          autoFocus
          value={newBarcode}
          onChange={(event) => setNewBarcode(event.target.value)}
        />
        <label className="label mt-4" htmlFor="correction-reason">更正原因</label>
        <textarea
          id="correction-reason"
          className="field min-h-20 resize-y"
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
          <button className="primary-button" onClick={() => onConfirm(newBarcode.trim(), reason.trim())} disabled={busy || !valid}>
            {busy ? "处理中" : "确认更正"}
          </button>
        </div>
      </section>
    </div>
  );
}

function StockAdjustmentDialog({
  stock,
  state,
  busy,
  onCancel,
  onConfirm
}: {
  stock: WarehouseState["warehouseStocks"][number] | null;
  state: WarehouseState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (quantityChange: number, reason: string) => void;
}) {
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (stock) {
      setQuantity("");
      setReason("");
    }
  }, [stock]);

  if (!stock) return null;
  const warehouse = state.warehouses.find((item) => item.id === stock.warehouseId);
  const goods = state.goods.find((item) => item.id === stock.goodsId);
  const quantityChange = Number(quantity);
  const valid = Number.isInteger(quantityChange) && quantityChange !== 0 && reason.trim().length >= 2;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4">
      <section className="w-full max-w-lg rounded-md bg-white p-5 shadow-2xl" role="dialog" aria-modal="true">
        <h2 className="text-base font-semibold text-ink">人工库存修正</h2>
        <p className="mt-2 text-sm text-slate-600">
          {warehouse?.name ?? "未知仓库"} · {goods?.name ?? "未知货物"}，当前 {stock.quantity} 件。
        </p>
        <label className="label mt-4" htmlFor="stock-quantity-change">增减数量</label>
        <input
          id="stock-quantity-change"
          className="field"
          type="number"
          step="1"
          placeholder="增加填正数，减少填负数"
          autoFocus
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
        <label className="label mt-4" htmlFor="stock-adjustment-reason">修正原因</label>
        <textarea
          id="stock-adjustment-reason"
          className="field min-h-20 resize-y"
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onCancel} disabled={busy}>取消</button>
          <button className="danger-button" onClick={() => onConfirm(quantityChange, reason.trim())} disabled={busy || !valid}>
            {busy ? "处理中" : "确认修正"}
          </button>
        </div>
      </section>
    </div>
  );
}

function DetailRow({ label, value, meta }: { label: string; value: string; meta?: string }) {
  return (
    <div className="border-b border-slate-200 px-3 py-2.5 md:border-b-0 md:border-r md:last:border-r-0">
      <p className="text-xs text-muted">{label}</p>
      <div>
        <p className="break-words text-sm font-semibold text-ink">{value}</p>
        {meta ? <p className="mt-1 break-words text-xs text-slate-500">{meta}</p> : null}
      </div>
    </div>
  );
}
