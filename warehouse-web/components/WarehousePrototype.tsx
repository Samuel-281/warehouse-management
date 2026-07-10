"use client";

import {
  AlertCircle,
  ArrowLeftRight,
  ArrowRight,
  Barcode,
  Boxes,
  Building2,
  Check,
  ClipboardList,
  GripVertical,
  Home,
  KeyRound,
  LogIn,
  LogOut,
  PackageCheck,
  Pencil,
  Power,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2,
  Truck,
  Undo2,
  Users,
  Warehouse,
  X
} from "lucide-react";
import { type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ClientApiError,
  apiErrorMessage,
  deleteJson,
  getJson,
  patchJson,
  postJson,
  requestJson
} from "@/lib/client-api";
import {
  ConfirmDialog,
  ResultDialogBox,
  ToastBox,
  type ResultDialog
} from "@/components/warehouse/FeedbackDialogs";
import {
  EmptyState,
  FieldSelect,
  ReadOnlyField,
  SectionHeader,
  StatusBadge
} from "@/components/warehouse/CommonUi";
import { OrdersView } from "@/components/warehouse/OrdersView";
import { InventoryView, type InventoryFilters } from "@/components/warehouse/InventoryView";
import { BarcodeCollector, type BarcodeReview } from "@/components/warehouse/BarcodeCollector";
import { hasAnyRole } from "@/lib/role-utils";
import type {
  CurrentUser,
  ConsistencyAuditResult,
  InboundSource,
  InventoryItem,
  InventorySummary,
  ManagedUser,
  OperationLog,
  OrderKind,
  OrderListResult,
  OrderStatus,
  OutboundType,
  StockMovement,
  Toast,
  UserRoleCode,
  Warehouse as WarehouseRecord,
  WarehouseState
} from "@/lib/types";
import {
  addYears,
  enabledLocationsForWarehouse,
  formatCategory,
  formatMovementType,
  uniqueBarcodes
} from "@/lib/warehouse-utils";

type ViewKey = "dashboard" | "masters" | "inbound" | "outbound" | "return" | "orders" | "inventory" | "system";
type DirectOutboundDestination = "transfer" | "sales";
type InboundBranch = InboundSource | "sales_return";
type ReturnBranch = "sales_return" | "terminal_return";

type MasterDataPayload = WarehouseState;
type MasterCreateKey = "goods" | "warehouse" | "salesperson" | "store";
type BarcodeReviewMap = Record<string, BarcodeReview>;
type OperationCheck = {
  label: string;
  passed: boolean;
  detail: string;
};

type BarcodeValidationResult = {
  barcode: string;
  ok: boolean;
  label: string;
  detail: string;
  item?: InventoryItem;
};
function parseBarcodeInput(input: string) {
  return uniqueBarcodes(input.split(/[\s,，;；]+/));
}

function countInvalidReviews(barcodes: string[], reviewBarcode?: (barcode: string) => BarcodeReview) {
  if (!reviewBarcode) return 0;
  return barcodes.filter((barcode) => reviewBarcode(barcode).tone === "error").length;
}

function masterSortOrder(record: { sortOrder?: number }) {
  return Number.isFinite(record.sortOrder) ? Number(record.sortOrder) : Number.MAX_SAFE_INTEGER;
}

function compareMasterRecords<T extends { sortOrder?: number; code: string; name: string }>(a: T, b: T) {
  const orderDiff = masterSortOrder(a) - masterSortOrder(b);
  if (orderDiff !== 0) return orderDiff;
  const codeDiff = a.code.localeCompare(b.code, "zh-CN");
  if (codeDiff !== 0) return codeDiff;
  return a.name.localeCompare(b.name, "zh-CN");
}

function validationResultToReview(result: BarcodeValidationResult): BarcodeReview {
  return {
    tone: result.ok ? "success" : "error",
    label: result.label,
    detail: result.detail
  };
}

function validationResultsToReviewMap(results: BarcodeValidationResult[]): BarcodeReviewMap {
  return Object.fromEntries(results.map((result) => [result.barcode, validationResultToReview(result)]));
}

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Home }> = [
  { key: "dashboard", label: "首页", icon: Home },
  { key: "masters", label: "基础资料", icon: Building2 },
  { key: "inbound", label: "到货入库", icon: Truck },
  { key: "outbound", label: "扫码出库", icon: ScanLine },
  { key: "return", label: "退回入库", icon: Undo2 },
  { key: "orders", label: "单据查询", icon: ClipboardList },
  { key: "inventory", label: "库存查询", icon: Search },
  { key: "system", label: "系统维护", icon: ShieldCheck }
];

const operator = "仓库操作员";
const resetConfirmationText = "确定重置";
const emptyInventorySummary: InventorySummary = {
  totalItems: 0,
  inStock: 0,
  withSales: 0,
  totalWarehouseQuantity: 0,
  warehouseStocks: [],
  recentStockMovements: [],
  warehouseCounts: [],
  salespersonCounts: [],
  recentMovements: []
};

const emptyWarehouseState: WarehouseState = {
  goods: [],
  warehouses: [],
  locations: [],
  salespeople: [],
  terminalStores: [],
  warehouseStocks: [],
  inventoryItems: [],
  movements: []
};

const roleLabels: Record<UserRoleCode, string> = {
  SUPER_ADMIN: "超级管理员",
  WAREHOUSE_ADMIN: "仓库管理员",
  INVENTORY_VIEWER: "只读查询人员"
};

function accessSummaryForRoles(roleCodes: UserRoleCode[]) {
  if (hasAnyRole(roleCodes, ["SUPER_ADMIN"])) return "全部入口与系统维护权限";
  if (hasAnyRole(roleCodes, ["WAREHOUSE_ADMIN"])) return "可操作仓库业务与基础资料";
  return "仅可查看首页、单据和库存";
}

export default function WarehousePrototype() {
  const [hydrated, setHydrated] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [state, setState] = useState<WarehouseState>(emptyWarehouseState);
  const [toast, setToast] = useState<Toast | null>(null);
  const [resultDialog, setResultDialog] = useState<ResultDialog | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [selectedBarcode, setSelectedBarcode] = useState("");
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [dataError, setDataError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState<InventorySummary>(emptyInventorySummary);
  const toastTimerRef = useRef<number | null>(null);
  const resultDialogTimerRef = useRef<number | null>(null);
  const orderRequestRef = useRef(0);
  const inboundSubmitRequestRef = useRef<string | null>(null);
  const outboundSubmitRequestRef = useRef<string | null>(null);
  const salesReturnSubmitRequestRef = useRef<string | null>(null);

  const [returnBranch, setReturnBranch] = useState<ReturnBranch>("sales_return");
  const [inboundWarehouseId, setInboundWarehouseId] = useState("wh-main");
  const [inboundLocationId, setInboundLocationId] = useState("loc-main-a1");
  const [inboundGoodsId, setInboundGoodsId] = useState("goods-hj-001");
  const [inboundQty, setInboundQty] = useState("1");
  const [inboundBarcodeInput, setInboundBarcodeInput] = useState("");
  const [inboundBarcodes, setInboundBarcodes] = useState<string[]>([]);
  const [inboundBarcodeReviews, setInboundBarcodeReviews] = useState<BarcodeReviewMap>({});
  const [productionDate, setProductionDate] = useState("");
  const [terminalStoreId, setTerminalStoreId] = useState("store-001");

  const [outboundType, setOutboundType] = useState<OutboundType>("direct");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("wh-main");
  const [targetWarehouseId, setTargetWarehouseId] = useState("wh-county-a");
  const [targetLocationId, setTargetLocationId] = useState("loc-county-a1");
  const [salespersonId, setSalespersonId] = useState("sp-001");
  const [directOutboundDestination, setDirectOutboundDestination] = useState<DirectOutboundDestination>("sales");
  const [directOutboundGoodsId, setDirectOutboundGoodsId] = useState("goods-hj-001");
  const [outboundBarcodeInput, setOutboundBarcodeInput] = useState("");
  const [outboundBarcodes, setOutboundBarcodes] = useState<string[]>([]);
  const [outboundBarcodeReviews, setOutboundBarcodeReviews] = useState<BarcodeReviewMap>({});

  const [returnWarehouseId, setReturnWarehouseId] = useState("wh-main");
  const [returnLocationId, setReturnLocationId] = useState("loc-main-a1");
  const [returnBarcodeInput, setReturnBarcodeInput] = useState("");
  const [returnBarcodes, setReturnBarcodes] = useState<string[]>([]);
  const [returnBarcodeReviews, setReturnBarcodeReviews] = useState<BarcodeReviewMap>({});

  const [inventoryFilters, setInventoryFilters] = useState<InventoryFilters>({
    keyword: "",
    ownerScope: "all",
    warehouseId: "all",
    salespersonId: "all",
    goodsId: "all"
  });
  const [orderResult, setOrderResult] = useState<OrderListResult>({
    items: [],
    total: 0,
    counts: { inbound: 0, outbound: 0, salesReturn: 0 },
    page: 1,
    pageSize: 20
  });
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderKindFilter, setOrderKindFilter] = useState<OrderKind | "all">("all");
  const [orderBarcodeFilter, setOrderBarcodeFilter] = useState("");

  const currentRoleCodes = useMemo(() => currentUser?.roles.map((role) => role.code) ?? [], [currentUser]);
  const effectiveInboundSource: InboundSource =
    activeView === "return" && returnBranch === "terminal_return" ? "terminal_return" : "factory";
  const canManageMasterData = hasAnyRole(currentRoleCodes, ["SUPER_ADMIN", "WAREHOUSE_ADMIN"]);
  const canOperateWarehouse = hasAnyRole(currentRoleCodes, ["SUPER_ADMIN", "WAREHOUSE_ADMIN"]);
  const canMaintainSystem = hasAnyRole(currentRoleCodes, ["SUPER_ADMIN"]);
  const currentAccessSummary = useMemo(() => accessSummaryForRoles(currentRoleCodes), [currentRoleCodes]);
  const allowedNavItems = useMemo(
    () =>
      navItems.filter((item) => {
        if (item.key === "masters") return canManageMasterData;
        if (item.key === "system") return canMaintainSystem;
        if (item.key === "inbound" || item.key === "outbound" || item.key === "return") {
          return canOperateWarehouse;
        }
        return true;
      }),
    [canMaintainSystem, canManageMasterData, canOperateWarehouse]
  );

  const showToast = useCallback((nextToast: Toast) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(nextToast);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  const showResultDialog = useCallback((nextDialog: ResultDialog) => {
    if (resultDialogTimerRef.current !== null) window.clearTimeout(resultDialogTimerRef.current);
    setResultDialog(nextDialog);
    resultDialogTimerRef.current = window.setTimeout(() => {
      setResultDialog(null);
      resultDialogTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
      if (resultDialogTimerRef.current !== null) window.clearTimeout(resultDialogTimerRef.current);
    };
  }, []);

  const handleRequestError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ClientApiError && error.status === 401) {
      setCurrentUser(null);
      setLoggedIn(false);
      setActiveView("dashboard");
      return "登录状态已过期，请重新登录";
    }

    return apiErrorMessage(error, fallback);
  }, []);

  function submissionRequestId(ref: { current: string | null }) {
    ref.current ??= crypto.randomUUID();
    return ref.current;
  }

  function submissionOutcomeIsUncertain(error: unknown) {
    return !(error instanceof ClientApiError) || error.status === 409 || error.status >= 500;
  }

  const applyDatabaseState = useCallback((masterData: WarehouseState, options: { preserveSelection?: boolean } = {}) => {
    const enabledWarehouses = masterData.warehouses.filter((warehouse) => warehouse.status === "enabled");
    const firstWarehouse = enabledWarehouses[0] ?? masterData.warehouses[0];
    const secondWarehouse = enabledWarehouses.find((warehouse) => warehouse.id !== firstWarehouse?.id);
    const firstLocation = masterData.locations.find(
      (location) => location.warehouseId === firstWarehouse?.id && location.status === "enabled"
    );
    const secondLocation = masterData.locations.find(
      (location) => location.warehouseId === secondWarehouse?.id && location.status === "enabled"
    );

    setState(masterData);
    setInboundGoodsId(masterData.goods[0]?.id ?? "");
    setDirectOutboundGoodsId(masterData.goods[0]?.id ?? "");
    setInboundWarehouseId(firstWarehouse?.id ?? "");
    setInboundLocationId(firstLocation?.id ?? "");
    setTerminalStoreId(masterData.terminalStores[0]?.id ?? "");
    setSourceWarehouseId(firstWarehouse?.id ?? "");
    setTargetWarehouseId(secondWarehouse?.id ?? "");
    setTargetLocationId(secondLocation?.id ?? "");
    setSalespersonId(masterData.salespeople[0]?.id ?? "");
    setReturnWarehouseId(firstWarehouse?.id ?? "");
    setReturnLocationId(firstLocation?.id ?? "");
    setInventoryFilters({ keyword: "", ownerScope: "all", warehouseId: "all", salespersonId: "all", goodsId: "all" });
    setSelectedBarcode((current) => {
      if (options.preserveSelection && current) {
        return current;
      }
      return "";
    });
    setDataStatus("ready");
    setDataError("");
  }, []);

  const loadDashboardSummary = useCallback(async () => {
    try {
      const summary = await getJson<InventorySummary>("/api/inventory/summary");
      setDashboardSummary(summary);
      setState((previous) => ({ ...previous, warehouseStocks: summary.warehouseStocks, movements: summary.recentMovements }));
      return summary;
    } catch (error) {
      const message = apiErrorMessage(error, "库存统计接口暂不可用");
      console.info(message);
      return null;
    }
  }, []);

  const refreshWarehouseState = useCallback(
    async (options: { preserveSelection?: boolean; notify?: boolean } = {}) => {
      setRefreshing(true);
      try {
        const [masterData, summary] = await Promise.all([
          getJson<WarehouseState>("/api/master-data"),
          getJson<InventorySummary>("/api/inventory/summary")
        ]);
        applyDatabaseState(masterData, { preserveSelection: options.preserveSelection ?? true });
        setDashboardSummary(summary);
        setState((previous) => ({ ...previous, warehouseStocks: summary.warehouseStocks, movements: summary.recentMovements }));
        if (options.notify) {
          showToast({ tone: "success", message: "已从数据库刷新基础资料与库存统计" });
        }
        return masterData;
      } catch (error) {
        const message = handleRequestError(error, "数据库连接失败，请检查数据库和服务状态");
        setDataStatus("error");
        setDataError(message);
        setState(emptyWarehouseState);
        setDashboardSummary(emptyInventorySummary);
        if (options.notify) {
          showToast({ tone: "error", message });
        } else {
          console.info(message);
        }
        return null;
      } finally {
        setRefreshing(false);
      }
    },
    [applyDatabaseState, handleRequestError, showToast]
  );

  useEffect(() => {
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || loggedIn) return;

    getJson<CurrentUser>("/api/auth/me")
      .then((user) => {
        setCurrentUser(user);
        setLoggedIn(true);
      })
      .catch(() => undefined);
  }, [hydrated, loggedIn]);

  useEffect(() => {
    if (!hydrated || !loggedIn) return;

    let cancelled = false;

    Promise.all([getJson<MasterDataPayload>("/api/master-data"), getJson<InventorySummary>("/api/inventory/summary")])
      .then(([masterData, summary]) => {
        if (cancelled) return;
        applyDatabaseState(masterData, { preserveSelection: true });
        setDashboardSummary(summary);
        setState((previous) => ({ ...previous, warehouseStocks: summary.warehouseStocks, movements: summary.recentMovements }));
      })
      .catch((error) => {
        if (cancelled) return;
        const message = handleRequestError(error, "数据库连接失败，请检查数据库和服务状态");
        setDataStatus("error");
        setDataError(message);
        setState(emptyWarehouseState);
        setDashboardSummary(emptyInventorySummary);
      });

    return () => {
      cancelled = true;
    };
  }, [applyDatabaseState, handleRequestError, hydrated, loggedIn]);

  useEffect(() => {
    if (!allowedNavItems.some((item) => item.key === activeView)) {
      setActiveView("dashboard");
    }
  }, [activeView, allowedNavItems]);

  useEffect(() => {
    const firstLocation = enabledLocationsForWarehouse(inboundWarehouseId, state.locations)[0];
    setInboundLocationId(firstLocation?.id ?? "");
  }, [inboundWarehouseId, state.locations]);

  useEffect(() => {
    const firstLocation = enabledLocationsForWarehouse(targetWarehouseId, state.locations)[0];
    setTargetLocationId(firstLocation?.id ?? "");
  }, [targetWarehouseId, state.locations]);

  useEffect(() => {
    if (directOutboundDestination !== "transfer") return;
    if (targetWarehouseId !== sourceWarehouseId) return;
    const nextTarget = state.warehouses.find(
      (warehouse) => warehouse.status === "enabled" && warehouse.id !== sourceWarehouseId
    );
    setTargetWarehouseId(nextTarget?.id ?? "");
  }, [directOutboundDestination, sourceWarehouseId, state.warehouses, targetWarehouseId]);

  useEffect(() => {
    const firstLocation = enabledLocationsForWarehouse(returnWarehouseId, state.locations)[0];
    setReturnLocationId(firstLocation?.id ?? "");
  }, [returnWarehouseId, state.locations]);

  useEffect(() => {
    const firstEnabledGoods = state.goods.find((goods) => goods.status === "enabled");
    if (!firstEnabledGoods) {
      if (directOutboundGoodsId) setDirectOutboundGoodsId("");
      return;
    }
    const selectedGoodsIsEnabled = state.goods.some(
      (goods) => goods.id === directOutboundGoodsId && goods.status === "enabled"
    );
    if (!selectedGoodsIsEnabled) {
      setDirectOutboundGoodsId(firstEnabledGoods.id);
    }
  }, [directOutboundGoodsId, state.goods]);

  const loadOrders = useCallback(async (query: {
    kind: OrderKind | "all";
    status: OrderStatus | "all";
    barcode: string;
    page: number;
    pageSize: number;
  }) => {
    const requestId = orderRequestRef.current + 1;
    orderRequestRef.current = requestId;
    setOrdersLoading(true);
    try {
      const params = new URLSearchParams({
        kind: query.kind,
        status: query.status,
        barcode: query.barcode.trim(),
        page: String(query.page),
        pageSize: String(query.pageSize)
      });
      const result = await getJson<OrderListResult>(`/api/orders?${params.toString()}`);
      if (requestId === orderRequestRef.current) setOrderResult(result);
    } catch (error) {
      if (requestId === orderRequestRef.current) {
        showToast({ tone: "error", message: handleRequestError(error, "读取单据失败") });
      }
    } finally {
      if (requestId === orderRequestRef.current) setOrdersLoading(false);
    }
  }, [handleRequestError, showToast]);

  async function logout() {
    try {
      await postJson<{ loggedOut: boolean }>("/api/auth/logout", {});
    } catch {
      // Local state still needs to be cleared if the session has already expired.
    }
    setCurrentUser(null);
    setLoggedIn(false);
    setActiveView("dashboard");
    showToast({ tone: "info", message: "已退出登录" });
  }

  function addBarcode(
    input: string,
    currentList: string[],
    setInput: (value: string) => void,
    setList: (value: string[]) => void,
    options: { mustBeNew?: boolean; onAfterAdd?: (nextList: string[]) => void } = {}
  ) {
    const candidates = parseBarcodeInput(input);
    if (candidates.length === 0) return;

    const availableSlots = Math.max(0, 500 - currentList.length);
    const accepted = candidates.filter((barcode) => {
      if (currentList.includes(barcode)) return false;
      return true;
    }).slice(0, availableSlots);

    if (accepted.length === 0) {
      showToast({
        tone: "error",
        message:
          availableSlots === 0
            ? "单次最多处理 500 条条码，请先提交当前清单"
            : candidates.length === 1
              ? "当前清单中已有该条码或条码已存在"
              : "没有可加入的条码"
      });
      return;
    }

    const nextList = [...currentList, ...accepted];
    setList(nextList);
    options.onAfterAdd?.(nextList);
    setInput("");

    const skippedCount = candidates.length - accepted.length;
    if (skippedCount > 0) {
      showToast({ tone: "info", message: `已加入 ${accepted.length} 条，跳过 ${skippedCount} 条重复或不可用条码` });
    }
  }

  async function refreshBarcodeReviews(
    input: {
      mode: "factory_inbound" | "terminal_return_inbound" | "warehouse_outbound" | "sales_return";
      barcodes: string[];
      goodsId?: string;
      warehouseId?: string;
    },
    setReviews: (reviews: BarcodeReviewMap) => void
  ) {
    if (input.barcodes.length === 0) {
      setReviews({});
      return;
    }

    try {
      const results = await postJson<BarcodeValidationResult[]>("/api/barcodes/validate", input);
      setReviews(validationResultsToReviewMap(results));
    } catch {
      setReviews(
        Object.fromEntries(
          input.barcodes.map((barcode) => [
            barcode,
            { tone: "warning", label: "未校验", detail: "暂时无法连接数据库校验，提交前会再次确认" }
          ])
        )
      );
    }
  }

  useEffect(() => {
    const barcodes = uniqueBarcodes(inboundBarcodes);
    if (barcodes.length === 0) {
      setInboundBarcodeReviews({});
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshBarcodeReviews(
        {
          mode: effectiveInboundSource === "factory" ? "factory_inbound" : "terminal_return_inbound",
          barcodes,
          goodsId: inboundGoodsId
        },
        setInboundBarcodeReviews
      );
    }, 250);

    return () => window.clearTimeout(timer);
  }, [effectiveInboundSource, inboundBarcodes, inboundGoodsId]);

  useEffect(() => {
    const barcodes = uniqueBarcodes(outboundBarcodes);
    if (barcodes.length === 0) {
      setOutboundBarcodeReviews({});
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshBarcodeReviews(
        {
          mode: "warehouse_outbound",
          barcodes,
          goodsId: directOutboundGoodsId,
          warehouseId: sourceWarehouseId
        },
        setOutboundBarcodeReviews
      );
    }, 250);

    return () => window.clearTimeout(timer);
  }, [directOutboundGoodsId, outboundBarcodes, sourceWarehouseId]);

  useEffect(() => {
    const barcodes = uniqueBarcodes(returnBarcodes);
    if (barcodes.length === 0) {
      setReturnBarcodeReviews({});
      return;
    }

    const timer = window.setTimeout(() => {
      void refreshBarcodeReviews(
        {
          mode: "sales_return",
          barcodes
        },
        setReturnBarcodeReviews
      );
    }, 250);

    return () => window.clearTimeout(timer);
  }, [returnBarcodes]);

  async function validateBarcodeList(
    input: {
      mode: "factory_inbound" | "terminal_return_inbound" | "warehouse_outbound" | "sales_return";
      barcodes: string[];
      goodsId?: string;
      warehouseId?: string;
    },
    fallback: string,
    setReviews?: (reviews: BarcodeReviewMap) => void
  ) {
    const results = await postJson<BarcodeValidationResult[]>("/api/barcodes/validate", input);
    setReviews?.(validationResultsToReviewMap(results));
    const invalid = results.find((result) => !result.ok);
    if (invalid) {
      throw new Error("条码清单中存在异常，请先处理标红条码");
    }
    if (results.length !== input.barcodes.length) {
      throw new Error("条码清单中存在无效或空白条码，请重新检查");
    }
    if (results.length === 0) {
      throw new Error(fallback);
    }
    return results;
  }

  async function submitInbound() {
    const qty = Number(inboundQty);
    const barcodes = uniqueBarcodes(inboundBarcodes);
    const source = effectiveInboundSource;
    const goods = state.goods.find((item) => item.id === inboundGoodsId);
    const warehouse = state.warehouses.find((item) => item.id === inboundWarehouseId);

    if (!goods || !warehouse) {
      showResultDialog({ tone: "error", title: "入库未提交", message: "请选择有效的货物和仓库" });
      return;
    }
    if (!inboundLocationId) {
      showResultDialog({ tone: "error", title: "入库未提交", message: "请选择有效的入库库位" });
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      showResultDialog({ tone: "error", title: "入库未提交", message: "入库数量必须为正整数" });
      return;
    }
    if (source === "terminal_return" && barcodes.length !== qty) {
      showResultDialog({ tone: "error", title: "入库未提交", message: "入库数量必须与条码数量一致" });
      return;
    }
    if (source === "terminal_return" && !productionDate) {
      showResultDialog({ tone: "error", title: "入库未提交", message: "终端店铺退换货入库必须登记生产日期" });
      return;
    }
    try {
      if (source === "terminal_return") {
        await validateBarcodeList(
          {
            mode: "terminal_return_inbound",
            barcodes,
            goodsId: inboundGoodsId
          },
          "请先扫描或录入条码",
          setInboundBarcodeReviews
        );
      }
      const result = await postJson<{ quantity: number; items: InventoryItem[]; movements: StockMovement[] }>("/api/inbound", {
        clientRequestId: submissionRequestId(inboundSubmitRequestRef),
        source,
        warehouseId: inboundWarehouseId,
        locationId: inboundLocationId,
        goodsId: inboundGoodsId,
        quantity: qty,
        terminalStoreId: source === "terminal_return" ? terminalStoreId : undefined,
        productionDate: source === "terminal_return" ? productionDate : undefined,
        barcodes,
        operatorName: currentUser?.displayName ?? operator
      });

      setState((previous) => ({
        ...previous,
        movements: [...result.movements, ...previous.movements].slice(0, 8)
      }));
      await loadDashboardSummary();
      setInboundBarcodes([]);
      setInboundBarcodeReviews({});
      setInboundQty("1");
      setProductionDate("");
      setSelectedBarcode(result.items[0]?.barcode ?? selectedBarcode);
      inboundSubmitRequestRef.current = null;
      showResultDialog({ tone: "success", title: "入库成功", message: `已写入 ${result.quantity ?? result.items.length} 件货物，库存已更新` });
    } catch (error) {
      const uncertain = submissionOutcomeIsUncertain(error);
      if (!uncertain) inboundSubmitRequestRef.current = null;
      showResultDialog({
        tone: "error",
        title: uncertain ? "入库结果待确认" : "入库失败",
        message: uncertain
          ? `${handleRequestError(error, "暂时无法确认入库结果")}。请保持当前表单并再次点击提交，系统不会重复记账。`
          : handleRequestError(error, "入库提交失败")
      });
    }
  }

  async function submitOutbound() {
    const barcodes = uniqueBarcodes(outboundBarcodes);
    if (barcodes.length === 0) {
      showResultDialog({ tone: "error", title: "出库未提交", message: "请先扫描或录入条码" });
      return;
    }

    const sourceWarehouse = state.warehouses.find((warehouse) => warehouse.id === sourceWarehouseId);
    const targetWarehouse = state.warehouses.find((warehouse) => warehouse.id === targetWarehouseId);
    const salesperson = state.salespeople.find((person) => person.id === salespersonId);
    const outboundGoods = state.goods.find((goods) => goods.id === directOutboundGoodsId);
    const sourceStock =
      dashboardSummary.warehouseStocks.find(
        (stock) => stock.warehouseId === sourceWarehouseId && stock.goodsId === directOutboundGoodsId
      )?.quantity ?? 0;

    if (!sourceWarehouse) {
      showResultDialog({ tone: "error", title: "出库未提交", message: "请选择有效的出库仓库" });
      return;
    }
    if (!outboundGoods) {
      showResultDialog({ tone: "error", title: "出库未提交", message: "请选择需要出库的货物" });
      return;
    }
    if (barcodes.length > sourceStock) {
      showResultDialog({ tone: "error", title: "出库未提交", message: `当前仓库该货物库存不足，可用 ${sourceStock} 件` });
      return;
    }
    if (directOutboundDestination === "transfer") {
      if (!targetWarehouse) {
        showResultDialog({ tone: "error", title: "出库未提交", message: "请选择有效的目标仓库" });
        return;
      }
      if (targetWarehouse.id === sourceWarehouse.id) {
        showResultDialog({ tone: "error", title: "出库未提交", message: "目标仓库不能与出库仓库相同" });
        return;
      }
    }
    if (directOutboundDestination === "sales" && !salesperson) {
      showResultDialog({ tone: "error", title: "出库未提交", message: "请选择销售人员" });
      return;
    }

    try {
      await validateBarcodeList(
        {
          mode: "warehouse_outbound",
          barcodes,
          goodsId: directOutboundGoodsId,
          warehouseId: sourceWarehouseId
        },
        "请先扫描或录入条码",
        setOutboundBarcodeReviews
      );
      const result = await postJson<{ items: InventoryItem[]; movements: StockMovement[] }>("/api/outbound", {
        clientRequestId: submissionRequestId(outboundSubmitRequestRef),
        type: "direct",
        sourceWarehouseId,
        goodsId: directOutboundGoodsId,
        targetWarehouseId: directOutboundDestination === "transfer" ? targetWarehouseId : undefined,
        targetLocationId: directOutboundDestination === "transfer" ? targetLocationId : undefined,
        salespersonId: directOutboundDestination === "sales" ? salespersonId : undefined,
        barcodes,
        operatorName: currentUser?.displayName ?? operator
      });

      setState((previous) => ({
        ...previous,
        movements: [...result.movements, ...previous.movements].slice(0, 8)
      }));
      await loadDashboardSummary();
      setOutboundBarcodes([]);
      setOutboundBarcodeReviews({});
      setSelectedBarcode(result.items[0]?.barcode ?? selectedBarcode);
      outboundSubmitRequestRef.current = null;
      showResultDialog({
        tone: "success",
        title: "扫码出库成功",
        message: `已处理 ${result.items.length} 件货物，库存和条码追踪已更新`
      });
    } catch (error) {
      const uncertain = submissionOutcomeIsUncertain(error);
      if (!uncertain) outboundSubmitRequestRef.current = null;
      showResultDialog({
        tone: "error",
        title: uncertain ? "出库结果待确认" : "出库失败",
        message: uncertain
          ? `${handleRequestError(error, "暂时无法确认出库结果")}。请保持当前表单并再次点击提交，系统不会重复记账。`
          : handleRequestError(error, "出库提交失败")
      });
    }
  }

  async function submitSalesReturn() {
    const barcodes = uniqueBarcodes(returnBarcodes);
    if (barcodes.length === 0) {
      showResultDialog({ tone: "error", title: "销售退回未提交", message: "请先扫描或录入销售人员名下条码" });
      return;
    }

    try {
      await validateBarcodeList(
        {
          mode: "sales_return",
          barcodes
        },
        "请先扫描或录入销售人员名下条码",
        setReturnBarcodeReviews
      );
      const result = await postJson<{ items: InventoryItem[]; movements: StockMovement[] }>("/api/sales-return", {
        clientRequestId: submissionRequestId(salesReturnSubmitRequestRef),
        returnWarehouseId,
        returnLocationId,
        barcodes,
        operatorName: currentUser?.displayName ?? operator
      });

      setState((previous) => ({
        ...previous,
        movements: [...result.movements, ...previous.movements].slice(0, 8)
      }));
      await loadDashboardSummary();
      setReturnBarcodes([]);
      setReturnBarcodeReviews({});
      setSelectedBarcode(result.items[0]?.barcode ?? selectedBarcode);
      salesReturnSubmitRequestRef.current = null;
      showResultDialog({
        tone: "success",
        title: "销售退回成功",
        message: `已退回 ${result.items.length} 件货物，未修改生产日期或保质期`
      });
    } catch (error) {
      const uncertain = submissionOutcomeIsUncertain(error);
      if (!uncertain) salesReturnSubmitRequestRef.current = null;
      showResultDialog({
        tone: "error",
        title: uncertain ? "销售退回结果待确认" : "销售退回失败",
        message: uncertain
          ? `${handleRequestError(error, "暂时无法确认销售退回结果")}。请保持当前表单并再次点击提交，系统不会重复记账。`
          : handleRequestError(error, "销售退回提交失败")
      });
    }
  }

  if (!hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        正在加载仓库系统...
      </main>
    );
  }

  if (!loggedIn) {
    return (
      <LoginScreen
        onLogin={(user) => {
          setCurrentUser(user);
          setLoggedIn(true);
          setActiveView("dashboard");
        }}
      />
    );
  }

  return (
    <main className="min-h-screen bg-[#f4f6f9] text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-work text-white">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">仓库货物管理系统</p>
              <p className="text-xs text-slate-500">数量库存 + 条码追踪</p>
            </div>
          </div>
        </div>

        <div className="border-t border-slate-200 px-3 py-4">
          <p className="mb-2 px-3 text-xs font-semibold text-slate-500">业务导航</p>
          <nav className="space-y-1">
            {allowedNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition ${
                    active
                      ? "bg-emerald-50 text-work"
                      : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                  }`}
                  onClick={() => setActiveView(item.key)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200 p-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
                {(currentUser?.displayName ?? "仓").slice(0, 1)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{currentUser?.displayName ?? "仓库用户"}</p>
                <p className="truncate text-xs text-slate-500">
                  {currentUser?.roles.map((role) => roleLabels[role.code]).join("、") ?? "-"}
                </p>
                <p className="mt-1 truncate text-xs text-slate-500">{currentAccessSummary}</p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
              <span>数据源</span>
              <span className="rounded border border-slate-200 bg-white px-2 py-1 text-slate-700">
                {dataStatus === "ready" ? "PostgreSQL" : dataStatus === "error" ? "连接异常" : "连接中"}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="secondary-button justify-center px-2" onClick={() => setChangePasswordOpen(true)}>
                <KeyRound className="h-4 w-4" />
                修改密码
              </button>
              <button className="secondary-button justify-center px-2" onClick={logout}>
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
          </div>
        </div>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-semibold text-muted">仓库运营工作台</p>
              <h1 className="mt-0.5 text-xl font-semibold text-ink">{titleForView(activeView)}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button
                className="icon-button"
                onClick={() => void refreshWarehouseState({ preserveSelection: true, notify: true })}
                disabled={refreshing}
                aria-label={refreshing ? "刷新中" : "刷新数据"}
                title={refreshing ? "刷新中" : "刷新数据"}
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
          <nav className="mt-3 grid grid-cols-3 gap-2 lg:hidden">
            {allowedNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  className={`flex h-10 items-center justify-center gap-2 rounded-md border px-2 text-xs font-semibold transition ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                  onClick={() => setActiveView(item.key)}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </header>

        <div className="p-4 md:p-6">
          {toast ? <ToastBox toast={toast} /> : null}
          {resultDialog ? <ResultDialogBox dialog={resultDialog} onClose={() => setResultDialog(null)} /> : null}
          {changePasswordOpen ? (
            <ChangePasswordDialog
              onClose={() => setChangePasswordOpen(false)}
              onSuccess={() => {
                setChangePasswordOpen(false);
                showToast({ tone: "success", message: "密码已修改，其他设备的登录会话已失效" });
              }}
            />
          ) : null}
          {dataStatus !== "ready" ? (
            <DataUnavailablePanel
              loading={dataStatus === "loading"}
              message={dataError}
              retry={() => void refreshWarehouseState({ preserveSelection: true })}
            />
          ) : null}
          {dataStatus === "ready" && activeView === "dashboard" ? (
            <DashboardView
              summary={dashboardSummary}
              state={state}
              setActiveView={setActiveView}
              setSelectedBarcode={setSelectedBarcode}
              canOperateWarehouse={canOperateWarehouse}
            />
          ) : null}
          {dataStatus === "ready" && activeView === "masters" ? (
            <MastersView
              state={state}
              setState={setState}
              showToast={showToast}
              canDeleteMasterData={canMaintainSystem}
            />
          ) : null}
          {dataStatus === "ready" && activeView === "inbound" ? (
            <InboundView
              state={state}
              inboundBranch="factory"
              setInboundBranch={() => undefined}
              showBranchSelector={false}
              inboundWarehouseId={inboundWarehouseId}
              setInboundWarehouseId={setInboundWarehouseId}
              inboundGoodsId={inboundGoodsId}
              setInboundGoodsId={setInboundGoodsId}
              inboundQty={inboundQty}
              setInboundQty={setInboundQty}
              inboundBarcodeInput={inboundBarcodeInput}
              setInboundBarcodeInput={setInboundBarcodeInput}
              inboundBarcodes={inboundBarcodes}
              setInboundBarcodes={(nextBarcodes) => {
                setInboundBarcodes(nextBarcodes);
                if (nextBarcodes.length === 0) setInboundBarcodeReviews({});
              }}
              inboundBarcodeReviews={inboundBarcodeReviews}
              productionDate={productionDate}
              setProductionDate={setProductionDate}
              terminalStoreId={terminalStoreId}
              setTerminalStoreId={setTerminalStoreId}
              addBarcode={(input) =>
                addBarcode(input, inboundBarcodes, setInboundBarcodeInput, setInboundBarcodes, {
                  mustBeNew: true,
                  onAfterAdd: (nextList) => {
                    const currentQty = Number(inboundQty);
                    if (!Number.isFinite(currentQty) || nextList.length > currentQty) {
                      setInboundQty(String(nextList.length));
                    }
                  }
                })
              }
              submitInbound={submitInbound}
              returnWarehouseId={returnWarehouseId}
              setReturnWarehouseId={setReturnWarehouseId}
              returnBarcodeInput={returnBarcodeInput}
              setReturnBarcodeInput={setReturnBarcodeInput}
              returnBarcodes={returnBarcodes}
              setReturnBarcodes={(nextBarcodes) => {
                setReturnBarcodes(nextBarcodes);
                if (nextBarcodes.length === 0) setReturnBarcodeReviews({});
              }}
              returnBarcodeReviews={returnBarcodeReviews}
              addReturnBarcode={(input) =>
                addBarcode(input, returnBarcodes, setReturnBarcodeInput, setReturnBarcodes)
              }
              submitSalesReturn={submitSalesReturn}
            />
          ) : null}
          {dataStatus === "ready" && activeView === "outbound" ? (
            <OutboundView
              state={state}
              inventorySummary={dashboardSummary}
              outboundType={outboundType}
              setOutboundType={setOutboundType}
              sourceWarehouseId={sourceWarehouseId}
              setSourceWarehouseId={setSourceWarehouseId}
              targetWarehouseId={targetWarehouseId}
              setTargetWarehouseId={setTargetWarehouseId}
              salespersonId={salespersonId}
              setSalespersonId={setSalespersonId}
              directOutboundDestination={directOutboundDestination}
              setDirectOutboundDestination={setDirectOutboundDestination}
              directOutboundGoodsId={directOutboundGoodsId}
              setDirectOutboundGoodsId={setDirectOutboundGoodsId}
              outboundBarcodeInput={outboundBarcodeInput}
              setOutboundBarcodeInput={setOutboundBarcodeInput}
              outboundBarcodes={outboundBarcodes}
              setOutboundBarcodes={(nextBarcodes) => {
                setOutboundBarcodes(nextBarcodes);
                if (nextBarcodes.length === 0) setOutboundBarcodeReviews({});
              }}
              outboundBarcodeReviews={outboundBarcodeReviews}
              addBarcode={(input) =>
                addBarcode(input, outboundBarcodes, setOutboundBarcodeInput, setOutboundBarcodes)
              }
              submitOutbound={submitOutbound}
            />
          ) : null}
          {dataStatus === "ready" && activeView === "return" ? (
            returnBranch === "sales_return" ? (
              <SalesReturnView
                state={state}
                returnWarehouseId={returnWarehouseId}
                setReturnWarehouseId={setReturnWarehouseId}
                returnBarcodeInput={returnBarcodeInput}
                setReturnBarcodeInput={setReturnBarcodeInput}
                returnBarcodes={returnBarcodes}
                setReturnBarcodes={(nextBarcodes) => {
                  setReturnBarcodes(nextBarcodes);
                  if (nextBarcodes.length === 0) setReturnBarcodeReviews({});
                }}
                returnBarcodeReviews={returnBarcodeReviews}
                addBarcode={(input) => addBarcode(input, returnBarcodes, setReturnBarcodeInput, setReturnBarcodes)}
                submitSalesReturn={submitSalesReturn}
                branchSelector={
                  <SegmentedControl
                    options={[
                      { value: "sales_return", label: "销售退回" },
                      { value: "terminal_return", label: "终端店铺退换货" }
                    ]}
                    value={returnBranch}
                    onChange={(value) => setReturnBranch(value as ReturnBranch)}
                  />
                }
              />
            ) : (
              <InboundView
                state={state}
                inboundBranch="terminal_return"
                setInboundBranch={() => undefined}
                showBranchSelector={false}
                branchSelector={
                  <SegmentedControl
                    options={[
                      { value: "sales_return", label: "销售退回" },
                      { value: "terminal_return", label: "终端店铺退换货" }
                    ]}
                    value={returnBranch}
                    onChange={(value) => setReturnBranch(value as ReturnBranch)}
                  />
                }
                inboundWarehouseId={inboundWarehouseId}
                setInboundWarehouseId={setInboundWarehouseId}
                inboundGoodsId={inboundGoodsId}
                setInboundGoodsId={setInboundGoodsId}
                inboundQty={inboundQty}
                setInboundQty={setInboundQty}
                inboundBarcodeInput={inboundBarcodeInput}
                setInboundBarcodeInput={setInboundBarcodeInput}
                inboundBarcodes={inboundBarcodes}
                setInboundBarcodes={(nextBarcodes) => {
                  setInboundBarcodes(nextBarcodes);
                  if (nextBarcodes.length === 0) setInboundBarcodeReviews({});
                }}
                inboundBarcodeReviews={inboundBarcodeReviews}
                productionDate={productionDate}
                setProductionDate={setProductionDate}
                terminalStoreId={terminalStoreId}
                setTerminalStoreId={setTerminalStoreId}
                addBarcode={(input) =>
                  addBarcode(input, inboundBarcodes, setInboundBarcodeInput, setInboundBarcodes, {
                    onAfterAdd: (nextList) => {
                      const currentQty = Number(inboundQty);
                      if (!Number.isFinite(currentQty) || nextList.length > currentQty) {
                        setInboundQty(String(nextList.length));
                      }
                    }
                  })
                }
                submitInbound={submitInbound}
                returnWarehouseId={returnWarehouseId}
                setReturnWarehouseId={setReturnWarehouseId}
                returnBarcodeInput={returnBarcodeInput}
                setReturnBarcodeInput={setReturnBarcodeInput}
                returnBarcodes={returnBarcodes}
                setReturnBarcodes={setReturnBarcodes}
                returnBarcodeReviews={returnBarcodeReviews}
                addReturnBarcode={(input) => addBarcode(input, returnBarcodes, setReturnBarcodeInput, setReturnBarcodes)}
                submitSalesReturn={submitSalesReturn}
              />
            )
          ) : null}
          {dataStatus === "ready" && activeView === "orders" ? (
            <OrdersView
              orders={orderResult.items}
              result={orderResult}
              loading={ordersLoading}
              kindFilter={orderKindFilter}
              setKindFilter={setOrderKindFilter}
              barcodeFilter={orderBarcodeFilter}
              setBarcodeFilter={setOrderBarcodeFilter}
              refreshOrders={loadOrders}
              showToast={showToast}
              canDeleteOrders={canMaintainSystem}
            />
          ) : null}
          {dataStatus === "ready" && activeView === "inventory" ? (
            <InventoryView
              state={state}
              filters={inventoryFilters}
              setFilters={setInventoryFilters}
              selectedBarcode={selectedBarcode}
              setSelectedBarcode={setSelectedBarcode}
              showToast={showToast}
              canDeleteInventory={canMaintainSystem}
              onDataChanged={async () => {
                await refreshWarehouseState({ preserveSelection: true });
              }}
            />
          ) : null}
          {dataStatus === "ready" && activeView === "system" && canMaintainSystem ? (
            <SystemMaintenanceView
              currentUserId={currentUser?.id ?? ""}
              onCurrentUserUpdated={(user) => {
                setCurrentUser((previous) => previous ? { ...previous, displayName: user.displayName, roles: user.roles } : previous);
              }}
              onResetComplete={() => {
                setCurrentUser(null);
                setLoggedIn(false);
                setActiveView("dashboard");
              }}
              showToast={showToast}
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function titleForView(view: ViewKey) {
  const titles: Record<ViewKey, string> = {
    dashboard: "业务首页",
    masters: "基础资料",
    inbound: "到货入库",
    outbound: "扫码出库",
    return: "退回入库",
    orders: "单据查询",
    inventory: "库存查询",
    system: "系统维护"
  };
  return titles[view];
}

function LoginScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin() {
    setSubmitting(true);
    setError("");
    try {
      const user = await postJson<CurrentUser>("/api/auth/login", { username, password });
      onLogin(user);
    } catch (loginError) {
      setError(apiErrorMessage(loginError, "登录失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen grid-cols-1 bg-canvas lg:grid-cols-[1fr_440px]">
      <section className="hidden items-center justify-center bg-slate-950 p-10 text-white lg:flex">
        <div className="max-w-2xl">
          <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-md bg-work">
            <Warehouse className="h-7 w-7" />
          </div>
          <h1 className="text-4xl font-semibold">仓库货物管理系统</h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-slate-300">
            仓库库存按数量管理，扫码业务保留单件条码追踪，适配日常到货、出库和退回流程。
          </p>
          <div className="mt-8 grid max-w-xl gap-3 text-sm text-slate-300">
            <div className="rounded-md border border-white/10 bg-white/5 p-3">厂家到货按商品数量入库</div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">扫码出库自动建立条码追踪</div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">按角色控制业务操作、基础资料和系统维护权限</div>
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center p-6">
        <form
          className="panel w-full max-w-md p-6"
          onSubmit={async (event) => {
            event.preventDefault();
            await submitLogin();
          }}
        >
          <div className="mb-6">
            <p className="text-xs font-semibold text-work">账号登录</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">进入仓库管理系统</h2>
            <p className="mt-2 text-sm text-slate-500">请使用管理员分配的账号和密码登录。</p>
          </div>
          <label className="label" htmlFor="username">
            账号
          </label>
          <input className="field mb-4" id="username" value={username} onChange={(event) => setUsername(event.target.value)} />
          <label className="label" htmlFor="password">
            密码
          </label>
          <input className="field mb-4" id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          {error ? <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          <button className="primary-button w-full" type="submit" disabled={submitting}>
            <LogIn className="h-4 w-4" />
            {submitting ? "登录中" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function DataUnavailablePanel({ loading, message, retry }: { loading: boolean; message: string; retry: () => void }) {
  return (
    <section className="panel mx-auto max-w-2xl p-6">
      <div className="flex items-start gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${loading ? "bg-sky-50 text-sky-700" : "bg-red-50 text-danger"}`}>
          {loading ? <RotateCcw className="h-5 w-5 animate-spin" /> : <AlertCircle className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-ink">{loading ? "正在连接数据库" : "暂时无法读取业务数据"}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            {loading ? "系统正在读取基础资料和库存统计。" : message || "请检查 PostgreSQL 和应用服务状态后重试。"}
          </p>
          {!loading ? (
            <button className="secondary-button mt-4" onClick={retry}>
              <RotateCcw className="h-4 w-4" />
              重新连接
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function DashboardView({
  summary,
  state,
  setActiveView,
  setSelectedBarcode,
  canOperateWarehouse
}: {
  summary: InventorySummary;
  state: WarehouseState;
  setActiveView: (view: ViewKey) => void;
  setSelectedBarcode: (barcode: string) => void;
  canOperateWarehouse: boolean;
}) {
  const recentMovements = summary.recentMovements;
  const salespersonCountById = new Map(summary.salespersonCounts.map((row) => [row.salespersonId, row.count]));
  const sortedStockRows = summary.warehouseStocks
    .map((stock) => ({
      stock,
      warehouse: state.warehouses.find((warehouse) => warehouse.id === stock.warehouseId),
      goods: state.goods.find((goods) => goods.id === stock.goodsId)
    }))
    .filter((row) => row.warehouse && row.goods)
    .sort((a, b) => {
      const warehouseSort = compareMasterRecords(a.warehouse!, b.warehouse!);
      if (warehouseSort !== 0) return warehouseSort;
      return compareMasterRecords(a.goods!, b.goods!);
    });
  const stockRows = sortedStockRows.slice(0, 10);
  const salespersonRows = state.salespeople
    .map((person) => ({ person, count: salespersonCountById.get(person.id) ?? 0 }))
    .filter((row) => row.count > 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="仓库当前库存" value={summary.totalWarehouseQuantity} detail="各仓库商品数量合计" icon={Boxes} />
        <MetricCard label="可追踪条码" value={summary.totalItems} detail="系统中已建档条码" icon={Barcode} />
        <MetricCard label="销售人员名下" value={summary.withSales} detail="已销售出库待回流条码" icon={Users} />
        <MetricCard label="货物资料" value={state.goods.length} detail={`${state.warehouses.length} 个仓库可用`} icon={Building2} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="panel p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <SectionHeader icon={PackageCheck} title="各仓库货物储备" compact />
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-500">
                首页显示 {stockRows.length} / {sortedStockRows.length} 条
              </span>
              {canOperateWarehouse ? (
                <button className="primary-button" onClick={() => setActiveView("inbound")}>
                  <Truck className="h-4 w-4" />
                  到货入库
                </button>
              ) : null}
            </div>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3">仓库</th>
                  <th className="px-4 py-3">货物</th>
                  <th className="px-4 py-3">当前库存</th>
                  <th className="px-4 py-3">最近变动</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map(({ stock, warehouse, goods }) => (
                  <tr key={stock.id} className="hover:bg-slate-50">
                    <td className="table-cell font-medium text-ink">{warehouse?.name}</td>
                    <td className="table-cell">
                      <p className="font-medium text-ink">{goods?.name}</p>
                      <p className="text-xs text-muted">{goods?.code}</p>
                    </td>
                    <td className="table-cell text-lg font-semibold text-ink">
                      {stock.quantity.toLocaleString("zh-CN")} {goods?.unit}
                    </td>
                    <td className="table-cell text-slate-600">{stock.lastChangedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stockRows.length === 0 ? (
              <div className="border-t border-slate-200 p-4">
                <EmptyState icon={Boxes} title="暂无仓库库存" detail="完成厂家到货入库或退回入库后，这里会显示各仓库的货物数量。" />
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel p-4">
          <SectionHeader icon={ClipboardList} title="可追踪条码" compact />
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs text-muted">当前系统已建档</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{summary.totalItems.toLocaleString("zh-CN")} 条</p>
            </div>
            <div className="rounded-md border border-slate-200 p-3">
              <p className="text-xs text-muted">销售人员名下</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{summary.withSales.toLocaleString("zh-CN")} 条</p>
            </div>
          </div>
          {salespersonRows.length > 0 ? (
            <div className="mt-4 rounded-md border border-slate-200">
              <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2">
                <span className="text-sm font-semibold text-slate-700">销售人员持有</span>
                <span className="text-xs text-muted">最多显示 6 条高度，可滚动</span>
              </div>
              <div className="max-h-[324px] divide-y divide-slate-200 overflow-y-auto">
                {salespersonRows.map(({ person, count }) => (
                  <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={person.id}>
                    <div>
                      <p className="font-medium text-ink">{person.name}</p>
                      <p className="text-xs text-muted">{person.region}</p>
                    </div>
                    <span className="font-mono font-semibold text-ink">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-4 grid gap-3">
            {canOperateWarehouse ? (
              <>
                <DashboardAction
                  icon={Truck}
                  title="扫码出库"
                  description="选择销售人员或目标仓库，扫码建立追踪"
                  onClick={() => setActiveView("outbound")}
                />
                <DashboardAction icon={Undo2} title="退回入库" description="销售退回、终端店铺退换货" onClick={() => setActiveView("return")} />
              </>
            ) : null}
            <DashboardAction
              icon={Search}
              title="条码查询"
              description="按条码查看当前归属与完整流转"
              onClick={() => setActiveView("inventory")}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-4">
        <section className="panel overflow-hidden">
          <SectionHeader icon={ClipboardList} title="最近条码流转" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3">类型</th>
                  <th className="px-4 py-3">条码</th>
                  <th className="px-4 py-3">变动</th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((movement) => (
                  <tr key={movement.id} className="hover:bg-slate-50">
                    <td className="table-cell text-slate-600">{movement.occurredAt}</td>
                    <td className="table-cell">
                      <StatusBadge label={formatMovementType(movement.type)} />
                    </td>
                    <td className="table-cell">
                      <button
                        className="font-mono text-work"
                        onClick={() => {
                          setSelectedBarcode(movement.barcode);
                          setActiveView("inventory");
                        }}
                      >
                        {movement.barcode}
                      </button>
                    </td>
                    <td className="table-cell text-slate-600">
                      {movement.fromLabel} → {movement.toLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {recentMovements.length === 0 ? (
              <div className="border-t border-slate-200 p-4">
                <EmptyState
                  icon={ClipboardList}
                  title="暂无条码流转"
                  detail="完成扫码出库或退回入库后，最近条码流转会显示在这里。"
                />
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon
}: {
  label: string;
  value: number;
  detail: string;
  icon: typeof Home;
}) {
  return (
    <section className="panel p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-work">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-2xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </section>
  );
}

function DashboardAction({
  icon: Icon,
  title,
  description,
  onClick
}: {
  icon: typeof Home;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-3 rounded-md border border-slate-200 bg-white p-3 text-left transition hover:border-work hover:bg-emerald-50"
      onClick={onClick}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-work">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{description}</p>
      </div>
    </button>
  );
}

function OperationPageHeader({
  icon: Icon,
  eyebrow,
  title,
  summary
}: {
  icon: typeof Home;
  eyebrow: string;
  title: string;
  summary: Array<{ label: string; value: string }>;
}) {
  return (
    <section className="panel p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-work">
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted">{eyebrow}</p>
            <h2 className="mt-1 text-lg font-semibold text-ink">{title}</h2>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {summary.map((item) => (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5" key={item.label}>
              <p className="text-xs text-muted">{item.label}</p>
              <p className="mt-1 truncate text-sm font-semibold text-ink">{item.value}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function OperationPanel({
  step,
  icon: Icon,
  title,
  children
}: {
  step: string;
  icon: typeof Home;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-xs font-semibold text-white">
          {step}
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-work shadow-sm">
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

function OperationSubmitBar({
  checks,
  itemCount,
  invalidCount,
  submitLabel,
  disabled,
  onSubmit
}: {
  checks: OperationCheck[];
  itemCount: number;
  invalidCount: number;
  submitLabel: string;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const allPassed = checks.every((check) => check.passed);

  return (
    <div className="mt-4 overflow-hidden rounded-md border border-slate-200 bg-white">
      <div className="grid gap-2 bg-slate-50 p-3 lg:grid-cols-3">
        {checks.map((check) => (
          <div
            className={`flex min-w-0 items-start gap-2 rounded-md border bg-white p-2.5 ${
              check.passed ? "border-emerald-200" : "border-red-200"
            }`}
            key={check.label}
          >
            <div
              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                check.passed ? "bg-emerald-50 text-work" : "bg-red-50 text-danger"
              }`}
            >
              {check.passed ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-ink">{check.label}</p>
              <p className="mt-0.5 truncate text-xs text-muted">{check.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3 border-t border-slate-200 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-ink">{allPassed ? "可以提交" : "提交前仍需处理"}</p>
          <p className="mt-1 text-xs text-muted">
            已录入 {itemCount} 件条码
            {invalidCount > 0
              ? `，${invalidCount} 件需处理`
              : allPassed
                ? "，提交后会写入库存流水"
                : "，请完成上方检查项"}
          </p>
        </div>
        <button className="primary-button sm:min-w-[160px]" disabled={disabled} onClick={onSubmit}>
          <Check className="h-4 w-4" />
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

function BusinessRuleStrip({
  tone,
  title,
  detail
}: {
  tone: "neutral" | "warning";
  title: string;
  detail: string;
}) {
  const isWarning = tone === "warning";
  return (
    <div
      className={`mt-4 flex gap-3 rounded-md border p-3 text-sm ${
        isWarning ? "border-amber-200 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-600"
      }`}
    >
      <AlertCircle className={`mt-0.5 h-4 w-4 shrink-0 ${isWarning ? "text-amber-600" : "text-work"}`} />
      <div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1">{detail}</p>
      </div>
    </div>
  );
}

function RoutePreview({
  from,
  fromMeta,
  to,
  toMeta
}: {
  from: string;
  fromMeta: string;
  to: string;
  toMeta: string;
}) {
  return (
    <div className="mt-4 grid items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_auto_1fr]">
      <div>
        <p className="text-xs text-muted">{fromMeta}</p>
        <p className="mt-1 truncate text-sm font-semibold text-ink">{from}</p>
      </div>
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-work shadow-sm">
        <ArrowRight className="h-4 w-4" />
      </div>
      <div>
        <p className="text-xs text-muted">{toMeta}</p>
        <p className="mt-1 truncate text-sm font-semibold text-ink">{to}</p>
      </div>
    </div>
  );
}

function MastersView({
  state,
  setState,
  showToast,
  canDeleteMasterData
}: {
  state: WarehouseState;
  setState: (updater: (previous: WarehouseState) => WarehouseState) => void;
  showToast: (toast: Toast) => void;
  canDeleteMasterData: boolean;
}) {
  const [goodsDraft, setGoodsDraft] = useState({
    code: "",
    name: "",
    category: "health_wine",
    unit: "瓶",
    spec: ""
  });
  const [warehouseDraft, setWarehouseDraft] = useState({ code: "", name: "", manager: "" });
  const [salespersonDraft, setSalespersonDraft] = useState({
    code: "",
    name: "",
    phone: "",
    region: ""
  });
  const [storeDraft, setStoreDraft] = useState({ name: "", contact: "", phone: "", address: "" });
  const [editingGoods, setEditingGoods] = useState<WarehouseState["goods"][number] | null>(null);
  const [editingWarehouse, setEditingWarehouse] = useState<WarehouseState["warehouses"][number] | null>(null);
  const [editingSalesperson, setEditingSalesperson] = useState<WarehouseState["salespeople"][number] | null>(null);
  const [editingStore, setEditingStore] = useState<WarehouseState["terminalStores"][number] | null>(null);
  const [creatingMaster, setCreatingMaster] = useState<MasterCreateKey | null>(null);
  const [masterDialogError, setMasterDialogError] = useState("");
  const [pendingMasterDelete, setPendingMasterDelete] = useState<{
    key: "goods" | "warehouses" | "salespeople" | "terminalStores";
    apiPath: string;
    id: string;
    label: string;
  } | null>(null);
  const [deletingMaster, setDeletingMaster] = useState(false);
  const sortedGoods = [...state.goods].sort(compareMasterRecords);
  const sortedWarehouses = [...state.warehouses].sort(compareMasterRecords);

  async function requestApi<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    return requestJson<T>(path, { method, body });
  }

  function replaceRecord<K extends "goods" | "warehouses" | "salespeople" | "terminalStores">(
    key: K,
    record: WarehouseState[K][number]
  ) {
    setState((previous) => ({
      ...previous,
      [key]: previous[key].map((item) => (item.id === record.id ? record : item))
    }));
  }

  function removeRecord<K extends "goods" | "warehouses" | "salespeople" | "terminalStores">(key: K, id: string) {
    setState((previous) => ({
      ...previous,
      [key]: previous[key].filter((item) => item.id !== id)
    }));
  }

  async function reorderMasterData(target: "goods" | "warehouses", draggedId: string, targetId: string) {
    if (draggedId === targetId) return;

    if (target === "goods") {
      const fromIndex = sortedGoods.findIndex((item) => item.id === draggedId);
      const toIndex = sortedGoods.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return;
      const previousGoods = state.goods;
      const nextGoods = [...sortedGoods];
      const [moved] = nextGoods.splice(fromIndex, 1);
      nextGoods.splice(toIndex, 0, moved);
      const optimisticGoods = nextGoods.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));
      setState((previous) => ({ ...previous, goods: optimisticGoods }));

      try {
        const result = await requestApi<{ target: "goods"; goods: WarehouseState["goods"] }>("/api/master-data/sort", {
          target,
          orderedIds: optimisticGoods.map((item) => item.id)
        }, "PATCH");
        setState((previous) => ({ ...previous, goods: result.goods }));
        showToast({ tone: "success", message: "货物排序已保存" });
      } catch (error) {
        setState((previous) => ({ ...previous, goods: previousGoods }));
        showToast({ tone: "error", message: apiErrorMessage(error, "货物排序保存失败") });
      }
      return;
    }

    const fromIndex = sortedWarehouses.findIndex((item) => item.id === draggedId);
    const toIndex = sortedWarehouses.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || toIndex < 0) return;
    const previousWarehouses = state.warehouses;
    const nextWarehouses = [...sortedWarehouses];
    const [moved] = nextWarehouses.splice(fromIndex, 1);
    nextWarehouses.splice(toIndex, 0, moved);
    const optimisticWarehouses = nextWarehouses.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));
    setState((previous) => ({ ...previous, warehouses: optimisticWarehouses }));

    try {
      const result = await requestApi<{ target: "warehouses"; warehouses: WarehouseState["warehouses"] }>("/api/master-data/sort", {
        target,
        orderedIds: optimisticWarehouses.map((item) => item.id)
      }, "PATCH");
      setState((previous) => ({ ...previous, warehouses: result.warehouses }));
      showToast({ tone: "success", message: "仓库排序已保存" });
    } catch (error) {
      setState((previous) => ({ ...previous, warehouses: previousWarehouses }));
      showToast({ tone: "error", message: apiErrorMessage(error, "仓库排序保存失败") });
    }
  }

  async function addGoods() {
    setMasterDialogError("");
    const code = goodsDraft.code.trim();
    const name = goodsDraft.name.trim();
    const unit = goodsDraft.unit.trim();
    const spec = goodsDraft.spec.trim();
    if (!code || !name || !unit || !spec) {
      setMasterDialogError("请完整填写货物资料");
      return;
    }
    if (state.goods.some((goods) => goods.code === code)) {
      setMasterDialogError("货物编码已存在");
      return;
    }

    try {
      const created = await requestApi<WarehouseState["goods"][number]>("/api/goods", {
        code,
        name,
        category: goodsDraft.category,
        unit,
        spec
      });
      setState((previous) => ({
        ...previous,
        goods: [...previous.goods, created]
      }));
      setGoodsDraft({ code: "", name: "", category: goodsDraft.category, unit: "瓶", spec: "" });
      setCreatingMaster(null);
      showToast({ tone: "success", message: "货物资料已写入数据库" });
    } catch (error) {
      setMasterDialogError(apiErrorMessage(error, "新增货物失败"));
    }
  }

  async function addWarehouse() {
    setMasterDialogError("");
    const code = warehouseDraft.code.trim();
    const name = warehouseDraft.name.trim();
    const manager = warehouseDraft.manager.trim();
    if (!code || !name || !manager) {
      setMasterDialogError("请完整填写仓库资料");
      return;
    }
    if (state.warehouses.some((warehouse) => warehouse.code === code)) {
      setMasterDialogError("仓库编码已存在");
      return;
    }

    try {
      const created = await requestApi<{
        warehouse: WarehouseRecord;
        location: WarehouseState["locations"][number];
      }>("/api/warehouses", { code, name, manager });
      setState((previous) => ({
        ...previous,
        warehouses: [...previous.warehouses, created.warehouse],
        locations: [...previous.locations, created.location]
      }));
      setWarehouseDraft({ code: "", name: "", manager: "" });
      setCreatingMaster(null);
      showToast({ tone: "success", message: "仓库资料已写入数据库，并已生成默认库位" });
    } catch (error) {
      setMasterDialogError(apiErrorMessage(error, "新增仓库失败"));
    }
  }

  async function addSalesperson() {
    setMasterDialogError("");
    const code = salespersonDraft.code.trim();
    const name = salespersonDraft.name.trim();
    const phone = salespersonDraft.phone.trim();
    const region = salespersonDraft.region.trim();
    if (!code || !name || !phone || !region) {
      setMasterDialogError("请完整填写销售人员资料");
      return;
    }
    if (state.salespeople.some((person) => person.code === code)) {
      setMasterDialogError("销售人员编码已存在");
      return;
    }

    try {
      const created = await requestApi<WarehouseState["salespeople"][number]>("/api/salespeople", {
        code,
        name,
        phone,
        region
      });
      setState((previous) => ({
        ...previous,
        salespeople: [...previous.salespeople, created]
      }));
      setSalespersonDraft({ code: "", name: "", phone: "", region: "" });
      setCreatingMaster(null);
      showToast({ tone: "success", message: "销售人员已写入数据库" });
    } catch (error) {
      setMasterDialogError(apiErrorMessage(error, "新增销售人员失败"));
    }
  }

  async function addTerminalStore() {
    setMasterDialogError("");
    const name = storeDraft.name.trim();
    const contact = storeDraft.contact.trim();
    const phone = storeDraft.phone.trim();
    const address = storeDraft.address.trim();
    if (!name || !contact || !phone || !address) {
      setMasterDialogError("请完整填写终端店铺资料");
      return;
    }

    try {
      const created = await requestApi<WarehouseState["terminalStores"][number]>("/api/terminal-stores", {
        name,
        contact,
        phone,
        address
      });
      setState((previous) => ({
        ...previous,
        terminalStores: [...previous.terminalStores, created]
      }));
      setStoreDraft({ name: "", contact: "", phone: "", address: "" });
      setCreatingMaster(null);
      showToast({ tone: "success", message: "终端店铺已写入数据库" });
    } catch (error) {
      setMasterDialogError(apiErrorMessage(error, "新增终端店铺失败"));
    }
  }

  async function saveGoods() {
    if (!editingGoods) return;
    try {
      const updated = await requestApi<WarehouseState["goods"][number]>(
        `/api/goods/${editingGoods.id}`,
        editingGoods,
        "PATCH"
      );
      replaceRecord("goods", updated);
      setEditingGoods(null);
      showToast({ tone: "success", message: "货物资料已更新" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "更新货物失败") });
    }
  }

  async function saveWarehouse() {
    if (!editingWarehouse) return;
    try {
      const updated = await requestApi<WarehouseState["warehouses"][number]>(
        `/api/warehouses/${editingWarehouse.id}`,
        editingWarehouse,
        "PATCH"
      );
      replaceRecord("warehouses", updated);
      setEditingWarehouse(null);
      showToast({ tone: "success", message: "仓库资料已更新" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "更新仓库失败") });
    }
  }

  async function saveSalesperson() {
    if (!editingSalesperson) return;
    try {
      const updated = await requestApi<WarehouseState["salespeople"][number]>(
        `/api/salespeople/${editingSalesperson.id}`,
        editingSalesperson,
        "PATCH"
      );
      replaceRecord("salespeople", updated);
      setEditingSalesperson(null);
      showToast({ tone: "success", message: "销售人员资料已更新" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "更新销售人员失败") });
    }
  }

  async function saveStore() {
    if (!editingStore) return;
    try {
      const updated = await requestApi<WarehouseState["terminalStores"][number]>(
        `/api/terminal-stores/${editingStore.id}`,
        editingStore,
        "PATCH"
      );
      replaceRecord("terminalStores", updated);
      setEditingStore(null);
      showToast({ tone: "success", message: "终端店铺资料已更新" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "更新终端店铺失败") });
    }
  }

  async function toggleMasterStatus<
    K extends "goods" | "warehouses" | "salespeople" | "terminalStores",
    T extends WarehouseState[K][number] & { status: "enabled" | "disabled" }
  >(key: K, apiPath: string, item: T) {
    const status = item.status === "enabled" ? "disabled" : "enabled";
    try {
      const updated = await requestApi<T>(`${apiPath}/${item.id}`, { status }, "PATCH");
      replaceRecord(key, updated);
      showToast({ tone: "success", message: status === "enabled" ? "资料已启用" : "资料已停用" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "状态更新失败") });
    }
  }

  function deleteMasterRecord<K extends "goods" | "warehouses" | "salespeople" | "terminalStores">(
    key: K,
    apiPath: string,
    id: string,
    label: string
  ) {
    if (!canDeleteMasterData) {
      showToast({ tone: "error", message: "只有超级管理员可以删除基础资料" });
      return;
    }
    setPendingMasterDelete({ key, apiPath, id, label });
  }

  async function confirmMasterDelete() {
    if (!pendingMasterDelete) return;
    setDeletingMaster(true);
    try {
      await deleteJson<{ deleted: boolean }>(`${pendingMasterDelete.apiPath}/${pendingMasterDelete.id}`);
      removeRecord(pendingMasterDelete.key, pendingMasterDelete.id);
      setPendingMasterDelete(null);
      showToast({ tone: "success", message: "基础资料已删除" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "删除基础资料失败") });
    } finally {
      setDeletingMaster(false);
    }
  }

  return (
    <div className="grid gap-4">
      <section className="panel p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <SectionHeader icon={Building2} title="基础资料维护" compact />
            <p className="mt-2 text-xs text-muted">数据来源：PostgreSQL 数据库</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              className="secondary-button"
              onClick={() => {
                setMasterDialogError("");
                setCreatingMaster("goods");
              }}
            >
              <Boxes className="h-4 w-4" />
              新增货物
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setMasterDialogError("");
                setCreatingMaster("warehouse");
              }}
            >
              <Warehouse className="h-4 w-4" />
              新增仓库
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setMasterDialogError("");
                setCreatingMaster("salesperson");
              }}
            >
              <Users className="h-4 w-4" />
              新增销售人员
            </button>
            <button
              className="secondary-button"
              onClick={() => {
                setMasterDialogError("");
                setCreatingMaster("store");
              }}
            >
              <Building2 className="h-4 w-4" />
              新增终端店铺
            </button>
          </div>
        </div>
      </section>

      <MasterEditDialog
        open={Boolean(editingGoods)}
        title="编辑货物资料"
        icon={Boxes}
        onClose={() => setEditingGoods(null)}
        onSave={saveGoods}
      >
        {editingGoods ? (
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="货物编码" value={editingGoods.code} onChange={(code) => setEditingGoods({ ...editingGoods, code })} />
            <TextField label="货物名称" value={editingGoods.name} onChange={(name) => setEditingGoods({ ...editingGoods, name })} />
            <FieldSelect
              label="货物大类"
              value={editingGoods.category}
              onChange={(category) => setEditingGoods({ ...editingGoods, category: category as WarehouseState["goods"][number]["category"] })}
              options={[
                { value: "health_wine", label: "保健酒" },
                { value: "baijiu", label: "白酒" }
              ]}
            />
            <TextField label="单位" value={editingGoods.unit} onChange={(unit) => setEditingGoods({ ...editingGoods, unit })} />
            <TextField label="规格" value={editingGoods.spec} onChange={(spec) => setEditingGoods({ ...editingGoods, spec })} />
          </div>
        ) : null}
      </MasterEditDialog>
      <MasterEditDialog
        open={Boolean(editingWarehouse)}
        title="编辑仓库资料"
        icon={Warehouse}
        onClose={() => setEditingWarehouse(null)}
        onSave={saveWarehouse}
      >
        {editingWarehouse ? (
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="仓库编码" value={editingWarehouse.code} onChange={(code) => setEditingWarehouse({ ...editingWarehouse, code })} />
            <TextField label="仓库名称" value={editingWarehouse.name} onChange={(name) => setEditingWarehouse({ ...editingWarehouse, name })} />
            <TextField label="负责人" value={editingWarehouse.manager} onChange={(manager) => setEditingWarehouse({ ...editingWarehouse, manager })} />
          </div>
        ) : null}
      </MasterEditDialog>
      <MasterEditDialog
        open={Boolean(editingSalesperson)}
        title="编辑销售人员"
        icon={Users}
        onClose={() => setEditingSalesperson(null)}
        onSave={saveSalesperson}
      >
        {editingSalesperson ? (
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="人员编码" value={editingSalesperson.code} onChange={(code) => setEditingSalesperson({ ...editingSalesperson, code })} />
            <TextField label="姓名" value={editingSalesperson.name} onChange={(name) => setEditingSalesperson({ ...editingSalesperson, name })} />
            <TextField label="手机号" value={editingSalesperson.phone} onChange={(phone) => setEditingSalesperson({ ...editingSalesperson, phone })} />
            <TextField label="区域" value={editingSalesperson.region} onChange={(region) => setEditingSalesperson({ ...editingSalesperson, region })} />
          </div>
        ) : null}
      </MasterEditDialog>
      <MasterEditDialog
        open={Boolean(editingStore)}
        title="编辑终端店铺"
        icon={Building2}
        onClose={() => setEditingStore(null)}
        onSave={saveStore}
      >
        {editingStore ? (
          <div className="grid gap-4 md:grid-cols-2">
            <TextField label="店铺名称" value={editingStore.name} onChange={(name) => setEditingStore({ ...editingStore, name })} />
            <TextField label="联系人" value={editingStore.contact} onChange={(contact) => setEditingStore({ ...editingStore, contact })} />
            <TextField label="电话" value={editingStore.phone} onChange={(phone) => setEditingStore({ ...editingStore, phone })} />
            <TextField label="地址" value={editingStore.address} onChange={(address) => setEditingStore({ ...editingStore, address })} />
          </div>
        ) : null}
      </MasterEditDialog>
      <MasterEditDialog
        open={creatingMaster === "goods"}
        title="新增货物资料"
        icon={Boxes}
        error={masterDialogError}
        onClose={() => {
          setMasterDialogError("");
          setCreatingMaster(null);
        }}
        onSave={addGoods}
        saveLabel="新增货物"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="货物编码"
            value={goodsDraft.code}
            onChange={(value) => setGoodsDraft({ ...goodsDraft, code: value })}
            placeholder="如 HJ-003"
          />
          <TextField
            label="货物名称"
            value={goodsDraft.name}
            onChange={(value) => setGoodsDraft({ ...goodsDraft, name: value })}
            placeholder="如 山参保健酒"
          />
          <FieldSelect
            label="货物大类"
            value={goodsDraft.category}
            onChange={(value) => setGoodsDraft({ ...goodsDraft, category: value })}
            options={[
              { value: "health_wine", label: "保健酒" },
              { value: "baijiu", label: "白酒" }
            ]}
          />
          <TextField
            label="单位"
            value={goodsDraft.unit}
            onChange={(value) => setGoodsDraft({ ...goodsDraft, unit: value })}
            placeholder="瓶"
          />
          <div className="md:col-span-2">
            <TextField
              label="规格"
              value={goodsDraft.spec}
              onChange={(value) => setGoodsDraft({ ...goodsDraft, spec: value })}
              placeholder="如 500ml/瓶，12瓶/箱"
            />
          </div>
        </div>
      </MasterEditDialog>
      <MasterEditDialog
        open={creatingMaster === "warehouse"}
        title="新增仓库资料"
        icon={Warehouse}
        error={masterDialogError}
        onClose={() => {
          setMasterDialogError("");
          setCreatingMaster(null);
        }}
        onSave={addWarehouse}
        saveLabel="新增仓库"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="仓库编码"
            value={warehouseDraft.code}
            onChange={(value) => setWarehouseDraft({ ...warehouseDraft, code: value })}
            placeholder="如 CK-001"
          />
          <TextField
            label="仓库名称"
            value={warehouseDraft.name}
            onChange={(value) => setWarehouseDraft({ ...warehouseDraft, name: value })}
            placeholder="如 一号仓库"
          />
          <div className="md:col-span-2">
            <TextField
              label="负责人"
              value={warehouseDraft.manager}
              onChange={(value) => setWarehouseDraft({ ...warehouseDraft, manager: value })}
              placeholder="如 张库管"
            />
          </div>
        </div>
      </MasterEditDialog>
      <MasterEditDialog
        open={creatingMaster === "salesperson"}
        title="新增销售人员"
        icon={Users}
        error={masterDialogError}
        onClose={() => {
          setMasterDialogError("");
          setCreatingMaster(null);
        }}
        onSave={addSalesperson}
        saveLabel="新增销售人员"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="人员编码"
            value={salespersonDraft.code}
            onChange={(value) => setSalespersonDraft({ ...salespersonDraft, code: value })}
            placeholder="如 XS-004"
          />
          <TextField
            label="姓名"
            value={salespersonDraft.name}
            onChange={(value) => setSalespersonDraft({ ...salespersonDraft, name: value })}
            placeholder="如 陈阳"
          />
          <TextField
            label="手机号"
            value={salespersonDraft.phone}
            onChange={(value) => setSalespersonDraft({ ...salespersonDraft, phone: value })}
            placeholder="如 13800010004"
          />
          <TextField
            label="区域"
            value={salespersonDraft.region}
            onChange={(value) => setSalespersonDraft({ ...salespersonDraft, region: value })}
            placeholder="如 西城片区"
          />
        </div>
      </MasterEditDialog>
      <MasterEditDialog
        open={creatingMaster === "store"}
        title="新增终端店铺"
        icon={Building2}
        error={masterDialogError}
        onClose={() => {
          setMasterDialogError("");
          setCreatingMaster(null);
        }}
        onSave={addTerminalStore}
        saveLabel="新增店铺"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="店铺名称"
            value={storeDraft.name}
            onChange={(value) => setStoreDraft({ ...storeDraft, name: value })}
            placeholder="如 西城便利烟酒店"
          />
          <TextField
            label="联系人"
            value={storeDraft.contact}
            onChange={(value) => setStoreDraft({ ...storeDraft, contact: value })}
            placeholder="如 何店长"
          />
          <TextField
            label="电话"
            value={storeDraft.phone}
            onChange={(value) => setStoreDraft({ ...storeDraft, phone: value })}
            placeholder="如 13700020003"
          />
          <TextField
            label="地址"
            value={storeDraft.address}
            onChange={(value) => setStoreDraft({ ...storeDraft, address: value })}
            placeholder="如 西城区建设路 28 号"
          />
        </div>
      </MasterEditDialog>
      <ConfirmDialog
        dialog={
          pendingMasterDelete
            ? {
                title: "删除基础资料",
                message: `确定直接删除「${pendingMasterDelete.label}」吗？\n已被库存或单据引用的资料会被系统拒绝删除。`,
                confirmLabel: "确认删除",
                destructive: true
              }
            : null
        }
        busy={deletingMaster}
        onCancel={() => setPendingMasterDelete(null)}
        onConfirm={() => void confirmMasterDelete()}
      />
      <div className="grid gap-4 xl:grid-cols-2">
        <MasterTable
          title="货物资料"
          icon={Boxes}
          headers={["编码", "名称", "大类", "规格", "状态", "操作"]}
          rowIds={sortedGoods.map((item) => item.id)}
          onReorder={(draggedId, targetId) => reorderMasterData("goods", draggedId, targetId)}
          rows={sortedGoods.map((item) => [
            item.code,
            item.name,
            formatCategory(item.category),
            item.spec,
            <StatusBadge key={`${item.id}-status`} label={item.status === "enabled" ? "启用" : "停用"} />,
            <MasterActions
              key={`${item.id}-actions`}
              status={item.status}
              onEdit={() => setEditingGoods(item)}
              onToggle={() => toggleMasterStatus("goods", "/api/goods", item)}
              onDelete={
                canDeleteMasterData
                  ? () => deleteMasterRecord("goods", "/api/goods", item.id, `${item.code} / ${item.name}`)
                  : undefined
              }
            />
          ])}
        />
        <MasterTable
          title="仓库资料"
          icon={Warehouse}
          headers={["编码", "名称", "负责人", "状态", "操作"]}
          rowIds={sortedWarehouses.map((item) => item.id)}
          onReorder={(draggedId, targetId) => reorderMasterData("warehouses", draggedId, targetId)}
          rows={sortedWarehouses.map((item) => [
            item.code,
            item.name,
            item.manager,
            <StatusBadge key={`${item.id}-status`} label={item.status === "enabled" ? "启用" : "停用"} />,
            <MasterActions
              key={`${item.id}-actions`}
              status={item.status}
              onEdit={() => setEditingWarehouse(item)}
              onToggle={() => toggleMasterStatus("warehouses", "/api/warehouses", item)}
              onDelete={
                canDeleteMasterData
                  ? () => deleteMasterRecord("warehouses", "/api/warehouses", item.id, `${item.code} / ${item.name}`)
                  : undefined
              }
            />
          ])}
        />
        <MasterTable
          title="销售人员"
          icon={Users}
          headers={["编码", "姓名", "手机号", "区域", "状态", "操作"]}
          rows={state.salespeople.map((item) => [
            item.code,
            item.name,
            item.phone,
            item.region,
            <StatusBadge key={`${item.id}-status`} label={item.status === "enabled" ? "启用" : "停用"} />,
            <MasterActions
              key={`${item.id}-actions`}
              status={item.status}
              onEdit={() => setEditingSalesperson(item)}
              onToggle={() => toggleMasterStatus("salespeople", "/api/salespeople", item)}
              onDelete={
                canDeleteMasterData
                  ? () =>
                      deleteMasterRecord("salespeople", "/api/salespeople", item.id, `${item.code} / ${item.name}`)
                  : undefined
              }
            />
          ])}
        />
        <MasterTable
          title="终端店铺"
          icon={Building2}
          headers={["店铺", "联系人", "电话", "地址", "状态", "操作"]}
          rows={state.terminalStores.map((item) => [
            item.name,
            item.contact,
            item.phone,
            item.address,
            <StatusBadge key={`${item.id}-status`} label={item.status === "enabled" ? "启用" : "停用"} />,
            <MasterActions
              key={`${item.id}-actions`}
              status={item.status}
              onEdit={() => setEditingStore(item)}
              onToggle={() => toggleMasterStatus("terminalStores", "/api/terminal-stores", item)}
              onDelete={
                canDeleteMasterData
                  ? () => deleteMasterRecord("terminalStores", "/api/terminal-stores", item.id, item.name)
                  : undefined
              }
            />
          ])}
        />
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        className="field"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}

function MasterTable({
  title,
  icon: Icon,
  headers,
  rows,
  rowIds,
  onReorder
}: {
  title: string;
  icon: typeof Home;
  headers: string[];
  rows: ReactNode[][];
  rowIds?: string[];
  onReorder?: (draggedId: string, targetId: string) => void;
}) {
  const sortable = Boolean(rowIds && onReorder);

  function handleDragStart(event: DragEvent, id: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function handleDrop(event: DragEvent, targetId?: string) {
    if (!targetId || !onReorder) return;
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("text/plain");
    if (draggedId) onReorder(draggedId, targetId);
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 p-4">
        <div>
          <SectionHeader icon={Icon} title={title} compact />
          {sortable ? <p className="mt-1 text-xs text-muted">拖动左侧手柄可调整首页展示权重</p> : null}
        </div>
        <span className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-500">{rows.length} 条</span>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full min-w-[620px]">
          <thead className="table-head sticky top-0 z-[1]">
            <tr>
              {sortable ? <th className="w-10 px-4 py-3">排序</th> : null}
              {headers.map((header) => (
                <th className="px-4 py-3" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr
                key={rowIds?.[rowIndex] ?? rowIndex}
                className="hover:bg-slate-50"
                onDragOver={sortable ? (event) => event.preventDefault() : undefined}
                onDrop={sortable ? (event) => handleDrop(event, rowIds?.[rowIndex]) : undefined}
              >
                {sortable ? (
                  <td className="table-cell w-10">
                    <button
                      aria-label="拖动排序"
                      className="flex h-8 w-8 cursor-grab items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 active:cursor-grabbing"
                      draggable
                      onDragStart={(event) => handleDragStart(event, rowIds?.[rowIndex] ?? "")}
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                  </td>
                ) : null}
                {row.map((cell, index) => (
                  <td className="table-cell" key={`${rowIndex}-${index}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function MasterActions({
  status,
  onEdit,
  onToggle,
  onDelete
}: {
  status: "enabled" | "disabled";
  onEdit: () => void;
  onToggle: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <button className="secondary-button px-3 py-2 text-xs" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
        编辑
      </button>
      <button className="secondary-button px-3 py-2 text-xs" onClick={onToggle}>
        <Power className="h-3.5 w-3.5" />
        {status === "enabled" ? "停用" : "启用"}
      </button>
      {onDelete ? (
        <button className="secondary-button px-3 py-2 text-xs text-red-600 hover:border-red-200 hover:bg-red-50" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          删除
        </button>
      ) : null}
    </div>
  );
}

function MasterEditDialog({
  open,
  title,
  icon: Icon,
  saveLabel = "保存修改",
  error,
  children,
  onClose,
  onSave
}: {
  open: boolean;
  title: string;
  icon: typeof Home;
  saveLabel?: string;
  error?: string;
  children: ReactNode;
  onClose: () => void;
  onSave: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <section
        className="panel max-h-[90vh] w-full max-w-3xl overflow-y-auto p-5 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-work">
              <Icon className="h-4 w-4" />
            </div>
            <h2 className="text-base font-semibold text-ink">{title}</h2>
          </div>
          <button className="secondary-button px-3 py-2" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </button>
        </div>
        <div className="mt-5">{children}</div>
        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button className="secondary-button" onClick={onClose}>
            <X className="h-4 w-4" />
            取消
          </button>
          <button className="primary-button" onClick={onSave}>
            <Check className="h-4 w-4" />
            {saveLabel}
          </button>
        </div>
      </section>
    </div>
  );
}

function InboundView(props: {
  state: WarehouseState;
  inboundBranch: InboundBranch;
  setInboundBranch: (value: InboundBranch) => void;
  showBranchSelector?: boolean;
  branchSelector?: ReactNode;
  inboundWarehouseId: string;
  setInboundWarehouseId: (value: string) => void;
  inboundGoodsId: string;
  setInboundGoodsId: (value: string) => void;
  inboundQty: string;
  setInboundQty: (value: string) => void;
  inboundBarcodeInput: string;
  setInboundBarcodeInput: (value: string) => void;
  inboundBarcodes: string[];
  setInboundBarcodes: (value: string[]) => void;
  inboundBarcodeReviews: BarcodeReviewMap;
  productionDate: string;
  setProductionDate: (value: string) => void;
  terminalStoreId: string;
  setTerminalStoreId: (value: string) => void;
  addBarcode: (input: string) => void;
  submitInbound: () => void;
  returnWarehouseId: string;
  setReturnWarehouseId: (value: string) => void;
  returnBarcodeInput: string;
  setReturnBarcodeInput: (value: string) => void;
  returnBarcodes: string[];
  setReturnBarcodes: (value: string[]) => void;
  returnBarcodeReviews: BarcodeReviewMap;
  addReturnBarcode: (input: string) => void;
  submitSalesReturn: () => void;
}) {
  const branchOptions = [
    { value: "factory", label: "厂家到货" },
    { value: "terminal_return", label: "终端店铺退换货" }
  ];
  if (props.inboundBranch === "sales_return") {
    return (
      <SalesReturnView
        state={props.state}
        returnWarehouseId={props.returnWarehouseId}
        setReturnWarehouseId={props.setReturnWarehouseId}
        returnBarcodeInput={props.returnBarcodeInput}
        setReturnBarcodeInput={props.setReturnBarcodeInput}
        returnBarcodes={props.returnBarcodes}
        setReturnBarcodes={props.setReturnBarcodes}
        returnBarcodeReviews={props.returnBarcodeReviews}
        addBarcode={props.addReturnBarcode}
        submitSalesReturn={props.submitSalesReturn}
        branchSelector={
          <SegmentedControl
            options={branchOptions}
            value={props.inboundBranch}
            onChange={(value) => props.setInboundBranch(value as InboundBranch)}
          />
        }
      />
    );
  }

  const selectedGoods = props.state.goods.find((goods) => goods.id === props.inboundGoodsId);
  const enabledWarehouses = props.state.warehouses.filter((warehouse) => warehouse.status === "enabled");
  const enabledGoods = props.state.goods.filter((goods) => goods.status === "enabled");
  const enabledStores = props.state.terminalStores.filter((store) => store.status === "enabled");
  const selectedWarehouse = enabledWarehouses.find((warehouse) => warehouse.id === props.inboundWarehouseId);
  const requiresBarcodes = props.inboundBranch === "terminal_return";
  const plannedQty = Number(props.inboundQty);
  const validPlannedQty = Number.isInteger(plannedQty) && plannedQty > 0 ? plannedQty : 0;
  const barcodeCount = props.inboundBarcodes.length;
  const quantityStatus =
    validPlannedQty === 0
      ? "待确认"
      : !requiresBarcodes
        ? `${validPlannedQty} 件`
      : barcodeCount === validPlannedQty
        ? "数量匹配"
        : barcodeCount > validPlannedQty
          ? "条码超量"
          : `还差 ${validPlannedQty - barcodeCount} 件`;
  const shelfLifePreview =
    props.inboundBranch === "terminal_return" &&
    selectedGoods?.category === "health_wine" &&
    props.productionDate
      ? addYears(props.productionDate, 3)
      : "无";
  const reviewInboundBarcode = (barcode: string): BarcodeReview => {
    const review = props.inboundBarcodeReviews[barcode];
    if (review) return review;

    return { tone: "neutral", label: "校验中", detail: "正在确认条码归属与货物是否匹配" };
  };
  const invalidBarcodeCount = countInvalidReviews(props.inboundBarcodes, reviewInboundBarcode);
  const submitDisabled =
    validPlannedQty === 0 ||
    (requiresBarcodes && (barcodeCount === 0 || invalidBarcodeCount > 0 || barcodeCount !== validPlannedQty)) ||
    (props.inboundBranch === "terminal_return" && !props.productionDate);
  const inboundChecks: OperationCheck[] = [
    {
      label: "业务参数",
      passed: Boolean(selectedWarehouse && selectedGoods),
      detail: `${selectedWarehouse?.name ?? "未选仓库"} / ${selectedGoods?.name ?? "未选货物"}`
    },
    {
      label: "数量匹配",
      passed: requiresBarcodes ? barcodeCount > 0 && validPlannedQty > 0 && barcodeCount === validPlannedQty : validPlannedQty > 0,
      detail: quantityStatus
    },
    ...(requiresBarcodes
      ? [
          {
            label: "条码校验",
            passed: barcodeCount > 0 && invalidBarcodeCount === 0,
            detail: invalidBarcodeCount > 0 ? `${invalidBarcodeCount} 件需处理` : `${barcodeCount} 件可入库`
          }
        ]
      : []),
    ...(props.inboundBranch === "terminal_return"
      ? [
          {
            label: "生产日期",
            passed: Boolean(props.productionDate),
            detail: props.productionDate ? `保质期：${shelfLifePreview}` : "终端店铺退换货必须登记"
          }
        ]
      : [])
  ];

  return (
    <div className="space-y-4">
      <OperationPageHeader
        icon={Truck}
        eyebrow={props.inboundBranch === "factory" ? "到货入库" : "退回入库"}
        title={props.inboundBranch === "factory" ? "厂家到货入库" : "终端店铺退换货入库"}
        summary={[
          { label: "入库仓库", value: selectedWarehouse?.name ?? "未选择" },
          { label: "货物", value: selectedGoods?.name ?? "未选择" },
          { label: requiresBarcodes ? "条码数量" : "到货数量", value: requiresBarcodes ? `${barcodeCount} / ${validPlannedQty || "-"} 件` : `${validPlannedQty || "-"} 件` }
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <OperationPanel step="1" icon={ClipboardList} title="入库参数">
          {props.branchSelector ? <div className="mb-4">{props.branchSelector}</div> : null}
          {props.showBranchSelector !== false ? (
            <SegmentedControl
              options={branchOptions}
              value={props.inboundBranch}
              onChange={(value) => props.setInboundBranch(value as InboundBranch)}
            />
          ) : null}

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FieldSelect
              label="入库仓库"
              value={props.inboundWarehouseId}
              onChange={props.setInboundWarehouseId}
              options={enabledWarehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
            />
            <FieldSelect
              label="货物"
              value={props.inboundGoodsId}
              onChange={props.setInboundGoodsId}
              options={enabledGoods.map((goods) => ({
                value: goods.id,
                label: `${goods.name} / ${formatCategory(goods.category)}`
              }))}
            />
            <div>
              <label className="label" htmlFor="inboundQty">
                入库数量
              </label>
              <input
                id="inboundQty"
                className="field"
                type="number"
                min={Math.max(1, barcodeCount)}
                value={props.inboundQty}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  const nextQty = Number(nextValue);
                  if (nextValue && Number.isFinite(nextQty) && nextQty < barcodeCount) {
                    props.setInboundQty(String(barcodeCount));
                    return;
                  }
                  props.setInboundQty(nextValue);
                }}
              />
            </div>
            <ReadOnlyField label="数量状态" value={quantityStatus} />
            {props.inboundBranch === "terminal_return" ? (
              <>
                <FieldSelect
                  label="终端店铺"
                  value={props.terminalStoreId}
                  onChange={props.setTerminalStoreId}
                  options={enabledStores.map((store) => ({ value: store.id, label: store.name }))}
                />
                <div>
                  <label className="label" htmlFor="productionDate">
                    生产日期
                  </label>
                  <input
                    id="productionDate"
                    className="field"
                    type="date"
                    value={props.productionDate}
                    onChange={(event) => props.setProductionDate(event.target.value)}
                  />
                </div>
              </>
            ) : null}
          </div>

          <BusinessRuleStrip
            tone={props.inboundBranch === "terminal_return" ? "warning" : "neutral"}
            title={props.inboundBranch === "terminal_return" ? "退换货入库规则" : "厂家到货规则"}
            detail={
              props.inboundBranch === "terminal_return"
                ? `货物大类：${selectedGoods ? formatCategory(selectedGoods.category) : "未选择"}；默认保质期：${shelfLifePreview}`
                : "厂家到货只登记每种商品数量，不扫描单件条码。"
            }
          />
        </OperationPanel>

        <OperationPanel step="2" icon={requiresBarcodes ? ScanLine : PackageCheck} title={requiresBarcodes ? "条码录入与提交" : "提交到货数量"}>
          {requiresBarcodes ? (
            <BarcodeCollector
              title="退换货条码"
              description="终端店铺退换货仍按单件条码追踪"
              input={props.inboundBarcodeInput}
              setInput={props.setInboundBarcodeInput}
              barcodes={props.inboundBarcodes}
              setBarcodes={props.setInboundBarcodes}
              onAdd={props.addBarcode}
              placeholder="扫描或输入退换货条码"
              reviewBarcode={reviewInboundBarcode}
            />
          ) : (
            <BusinessRuleStrip
              tone="neutral"
              title="无需扫码"
              detail="厂家到货只增加仓库商品库存数量，不会新增右侧可追踪条码。"
            />
          )}
          <OperationSubmitBar
            checks={inboundChecks}
            itemCount={requiresBarcodes ? barcodeCount : validPlannedQty}
            invalidCount={requiresBarcodes ? invalidBarcodeCount : 0}
            submitLabel="提交入库"
            disabled={submitDisabled}
            onSubmit={props.submitInbound}
          />
        </OperationPanel>
      </div>
    </div>
  );
}

function OutboundView(props: {
  state: WarehouseState;
  inventorySummary: InventorySummary;
  outboundType: OutboundType;
  setOutboundType: (value: OutboundType) => void;
  sourceWarehouseId: string;
  setSourceWarehouseId: (value: string) => void;
  targetWarehouseId: string;
  setTargetWarehouseId: (value: string) => void;
  salespersonId: string;
  setSalespersonId: (value: string) => void;
  directOutboundDestination: DirectOutboundDestination;
  setDirectOutboundDestination: (value: DirectOutboundDestination) => void;
  directOutboundGoodsId: string;
  setDirectOutboundGoodsId: (value: string) => void;
  outboundBarcodeInput: string;
  setOutboundBarcodeInput: (value: string) => void;
  outboundBarcodes: string[];
  setOutboundBarcodes: (value: string[]) => void;
  outboundBarcodeReviews: BarcodeReviewMap;
  addBarcode: (input: string) => void;
  submitOutbound: () => void;
}) {
  const enabledWarehouses = props.state.warehouses.filter((warehouse) => warehouse.status === "enabled");
  const transferTargetWarehouses = enabledWarehouses.filter((warehouse) => warehouse.id !== props.sourceWarehouseId);
  const enabledSalespeople = props.state.salespeople.filter((person) => person.status === "enabled");
  const sourceWarehouse = enabledWarehouses.find((warehouse) => warehouse.id === props.sourceWarehouseId);
  const targetWarehouse = enabledWarehouses.find((warehouse) => warehouse.id === props.targetWarehouseId);
  const salesperson = enabledSalespeople.find((person) => person.id === props.salespersonId);
  const enabledGoods = props.state.goods.filter((goods) => goods.status === "enabled");
  const directGoods = enabledGoods.find((goods) => goods.id === props.directOutboundGoodsId);
  const directGoodsLabel = directGoods ? `${directGoods.code} / ${directGoods.name}` : "未选择";
  const isTransferDestination = props.directOutboundDestination === "transfer";
  const sourceWarehouseAvailableCount =
    props.inventorySummary.warehouseStocks.find(
      (row) => row.warehouseId === props.sourceWarehouseId && row.goodsId === props.directOutboundGoodsId
    )?.quantity ?? 0;
  const validBarcodeCount = props.outboundBarcodes.length;
  const targetLabel = isTransferDestination ? targetWarehouse?.name ?? "未选择" : salesperson?.name ?? "未选择";
  const reviewOutboundBarcode = (barcode: string): BarcodeReview => {
    const review = props.outboundBarcodeReviews[barcode];
    if (review) return review;

    return {
      tone: "neutral",
      label: "校验中",
      detail: "正在确认条码与当前出库货物是否匹配"
    };
  };
  const invalidBarcodeCount = countInvalidReviews(props.outboundBarcodes, reviewOutboundBarcode);
  const destinationReady = isTransferDestination
    ? Boolean(targetWarehouse && sourceWarehouse && targetWarehouse.id !== sourceWarehouse.id)
    : Boolean(salesperson);
  const submitDisabled =
    props.outboundBarcodes.length === 0 ||
    invalidBarcodeCount > 0 ||
    !sourceWarehouse ||
    !destinationReady ||
    !directGoods ||
    props.outboundBarcodes.length > sourceWarehouseAvailableCount;
  const outboundTitle = "扫码出库";
  const destinationLabel = isTransferDestination ? "目标仓库" : "销售人员";
  const barcodeValidationText = `${validBarcodeCount} 件待提交校验`;
  const outboundChecks: OperationCheck[] = [
    {
      label: "出库仓库",
      passed: Boolean(sourceWarehouse),
      detail: sourceWarehouse?.name ?? "未选择"
    },
    {
      label: "货物",
      passed: Boolean(directGoods),
      detail: directGoodsLabel
    },
    {
      label: "可用库存",
      passed: props.outboundBarcodes.length <= sourceWarehouseAvailableCount,
      detail: `${sourceWarehouseAvailableCount} 件`
    },
    {
      label: destinationLabel,
      passed: destinationReady,
      detail: targetLabel
    },
    {
      label: "条码校验",
      passed: props.outboundBarcodes.length > 0 && invalidBarcodeCount === 0,
      detail:
        invalidBarcodeCount > 0
          ? `${invalidBarcodeCount} 件需处理`
          : `${validBarcodeCount} / ${props.outboundBarcodes.length} 可出库`
    }
  ];

  return (
    <div className="space-y-4">
      <OperationPageHeader
        icon={ArrowLeftRight}
        eyebrow="出库管理"
        title={outboundTitle}
        summary={[
          { label: "出库仓库", value: sourceWarehouse?.name ?? "未选择" },
          { label: "货物", value: directGoods?.name ?? "未选择" },
          { label: destinationLabel, value: targetLabel },
          { label: "条码数量", value: `${props.outboundBarcodes.length} 件` }
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <OperationPanel step="1" icon={ClipboardList} title="出库参数">
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <FieldSelect
              label="出库仓库"
              value={props.sourceWarehouseId}
              onChange={props.setSourceWarehouseId}
              options={enabledWarehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
            />
            <FieldSelect
              label="出库货物"
              value={props.directOutboundGoodsId}
              onChange={props.setDirectOutboundGoodsId}
              options={enabledGoods.map((goods) => ({ value: goods.id, label: `${goods.code} / ${goods.name}` }))}
            />
            <div className="md:col-span-2">
              <p className="mb-2 text-xs font-semibold text-muted">出库去向</p>
              <SegmentedControl
                options={[
                  { value: "sales", label: "分配销售人员" },
                  { value: "transfer", label: "发往仓库" }
                ]}
                value={props.directOutboundDestination}
                onChange={(value) => props.setDirectOutboundDestination(value as DirectOutboundDestination)}
              />
            </div>
            {isTransferDestination ? (
              <FieldSelect
                label="目标仓库"
                value={props.targetWarehouseId}
                onChange={props.setTargetWarehouseId}
                options={transferTargetWarehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
              />
            ) : (
              <FieldSelect
                label="销售人员"
                value={props.salespersonId}
                onChange={props.setSalespersonId}
                options={enabledSalespeople.map((person) => ({
                  value: person.id,
                  label: `${person.name} / ${person.region}`
                }))}
              />
            )}
            <ReadOnlyField
              label="仓库可用库存"
              value={sourceWarehouse ? `${sourceWarehouseAvailableCount.toLocaleString("zh-CN")} 件` : "未选择仓库"}
            />
            <ReadOnlyField label="条码校验" value={barcodeValidationText} />
          </div>

          <RoutePreview
            from={sourceWarehouse?.name ?? "未选择"}
            fromMeta="出库仓库"
            to={targetLabel}
            toMeta={isTransferDestination ? "目标仓库" : salesperson?.region ?? "销售人员"}
          />

          <BusinessRuleStrip
            tone="neutral"
            title="扫码出库规则"
            detail={
              isTransferDestination
                ? "来源仓库库存扣减，目标仓库库存增加；条码当前归属变为目标仓库。"
                : "来源仓库库存扣减；条码当前归属变为所选销售人员。"
            }
          />
        </OperationPanel>

        <OperationPanel step="2" icon={ScanLine} title="条码录入与提交">
	          <BarcodeCollector
	            title="出库条码"
	            description="新条码会在出库时建档，已有条码会按当前归属校验"
            input={props.outboundBarcodeInput}
            setInput={props.setOutboundBarcodeInput}
            barcodes={props.outboundBarcodes}
            setBarcodes={props.setOutboundBarcodes}
            onAdd={props.addBarcode}
            placeholder="扫描或输入出库条码"
            reviewBarcode={reviewOutboundBarcode}
          />
          <OperationSubmitBar
            checks={outboundChecks}
	            itemCount={props.outboundBarcodes.length}
	            invalidCount={invalidBarcodeCount}
	            submitLabel="提交扫码出库"
            disabled={submitDisabled}
            onSubmit={props.submitOutbound}
          />
        </OperationPanel>
      </div>
    </div>
  );
}

function SalesReturnView(props: {
  state: WarehouseState;
  returnWarehouseId: string;
  setReturnWarehouseId: (value: string) => void;
  returnBarcodeInput: string;
  setReturnBarcodeInput: (value: string) => void;
  returnBarcodes: string[];
  setReturnBarcodes: (value: string[]) => void;
  returnBarcodeReviews: BarcodeReviewMap;
  addBarcode: (input: string) => void;
  submitSalesReturn: () => void;
  branchSelector?: ReactNode;
}) {
  const enabledWarehouses = props.state.warehouses.filter((warehouse) => warehouse.status === "enabled");
  const returnWarehouse = enabledWarehouses.find((warehouse) => warehouse.id === props.returnWarehouseId);
  const validReturnCount = props.returnBarcodes.length;
  const reviewReturnBarcode = (barcode: string): BarcodeReview => {
    const review = props.returnBarcodeReviews[barcode];
    if (review) return review;

    return {
      tone: "neutral",
      label: "校验中",
      detail: "正在确认条码是否在销售人员名下"
    };
  };
  const invalidBarcodeCount = countInvalidReviews(props.returnBarcodes, reviewReturnBarcode);
  const submitDisabled = props.returnBarcodes.length === 0 || invalidBarcodeCount > 0 || !returnWarehouse;
  const returnChecks: OperationCheck[] = [
    {
      label: "回流仓库",
      passed: Boolean(returnWarehouse),
      detail: returnWarehouse?.name ?? "未选择"
    },
    {
      label: "条码校验",
      passed: props.returnBarcodes.length > 0 && invalidBarcodeCount === 0,
      detail:
        invalidBarcodeCount > 0
          ? `${invalidBarcodeCount} 件需处理`
          : `${validReturnCount} / ${props.returnBarcodes.length} 可退回`
    }
  ];

  return (
    <div className="space-y-4">
      <OperationPageHeader
        icon={Undo2}
        eyebrow={props.branchSelector ? "入库管理" : "销售退回"}
        title={props.branchSelector ? "销售退回入库" : "未售完货物回流仓库"}
        summary={[
          { label: "回流仓库", value: returnWarehouse?.name ?? "未选择" },
          { label: "销售人员名下", value: "按库存查询查看" },
          { label: "待退回条码", value: `${props.returnBarcodes.length} 件` }
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[0.82fr_1.18fr]">
        <OperationPanel step="1" icon={ClipboardList} title="退回设置">
          {props.branchSelector ? <div className="mb-4">{props.branchSelector}</div> : null}
          <div className="grid gap-4 md:grid-cols-2">
            <FieldSelect
              label="回流仓库"
              value={props.returnWarehouseId}
              onChange={props.setReturnWarehouseId}
              options={enabledWarehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
            />
            <ReadOnlyField label="条码校验" value={`${validReturnCount} / ${props.returnBarcodes.length} 可退回`} />
          </div>

          <RoutePreview
            from="销售人员名下"
            fromMeta="当前归属"
            to={returnWarehouse?.name ?? "未选择"}
            toMeta="回流仓库"
          />

          <BusinessRuleStrip
            tone="neutral"
            title="销售退回规则"
            detail="销售退回作为入库分支展示，但业务规则独立：仅把销售人员名下未售完条码回流到仓库，不记录终端店铺、生产日期，也不重新计算保质期。"
          />
        </OperationPanel>

        <OperationPanel step="2" icon={ScanLine} title="条码录入与提交">
          <BarcodeCollector
            title="退回条码"
            description="条码归属将从销售人员名下回到仓库"
            input={props.returnBarcodeInput}
            setInput={props.setReturnBarcodeInput}
            barcodes={props.returnBarcodes}
            setBarcodes={props.setReturnBarcodes}
            onAdd={props.addBarcode}
            placeholder="扫描或输入销售人员名下条码，如 XS202605290001"
            reviewBarcode={reviewReturnBarcode}
          />
          <OperationSubmitBar
            checks={returnChecks}
            itemCount={props.returnBarcodes.length}
            invalidCount={invalidBarcodeCount}
            submitLabel="提交退回"
            disabled={submitDisabled}
            onSubmit={props.submitSalesReturn}
          />
        </OperationPanel>
      </div>
    </div>
  );
}
function AuditSummary({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone: "success" | "error" | "warning" | "neutral";
}) {
  const toneClass = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-800",
    error: "border-red-200 bg-red-50 text-red-800",
    warning: "border-amber-200 bg-amber-50 text-amber-800",
    neutral: "border-slate-200 bg-slate-50 text-slate-700"
  }[tone];
  return (
    <div className={`rounded-md border px-3 py-3 ${toneClass}`}>
      <p className="text-xs">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function AuditSeverity({ severity }: { severity: "error" | "warning" | "info" }) {
  const styles = {
    error: "border-red-200 bg-red-50 text-red-700",
    warning: "border-amber-200 bg-amber-50 text-amber-700",
    info: "border-slate-200 bg-slate-50 text-slate-600"
  };
  const labels = { error: "错误", warning: "警告", info: "提示" };
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-semibold ${styles[severity]}`}>{labels[severity]}</span>;
}

function ChangePasswordDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError("");
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 个字符");
      return;
    }
    if (newPassword !== confirmation) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    try {
      await postJson<{ changed: boolean }>("/api/auth/change-password", { currentPassword, newPassword });
      onSuccess();
    } catch (nextError) {
      setError(apiErrorMessage(nextError, "修改密码失败"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <section className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">修改登录密码</h2>
            <p className="mt-1 text-xs text-muted">修改后当前设备保持登录，其他设备需要重新登录。</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭修改密码窗口">
            <X className="h-4 w-4" />
          </button>
        </div>
        <label className="label mt-5" htmlFor="current-password">当前密码</label>
        <input
          id="current-password"
          className="field"
          type="password"
          autoFocus
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
        <label className="label mt-4" htmlFor="new-password">新密码</label>
        <input
          id="new-password"
          className="field"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
        <label className="label mt-4" htmlFor="confirm-password">再次输入新密码</label>
        <input
          id="confirm-password"
          className="field"
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
        />
        {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button className="primary-button" onClick={() => void submit()} disabled={busy || !currentPassword || !newPassword || !confirmation}>
            <KeyRound className="h-4 w-4" />
            {busy ? "正在修改" : "确认修改"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SystemMaintenanceView({
  currentUserId,
  onCurrentUserUpdated,
  onResetComplete,
  showToast
}: {
  currentUserId: string;
  onCurrentUserUpdated: (user: ManagedUser) => void;
  onResetComplete: () => void;
  showToast: (toast: Toast) => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [audit, setAudit] = useState<ConsistencyAuditResult | null>(null);
  const [auditBusy, setAuditBusy] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [resettingPasswordFor, setResettingPasswordFor] = useState<ManagedUser | null>(null);
  const [userDraft, setUserDraft] = useState({
    username: "",
    displayName: "",
    password: "",
    roleCode: "WAREHOUSE_ADMIN" as UserRoleCode
  });

  useEffect(() => {
    getJson<OperationLog[]>("/api/operation-logs")
      .then(setLogs)
      .catch(() => undefined);
    getJson<ManagedUser[]>("/api/users")
      .then(setUsers)
      .catch(() => undefined);
  }, []);

  async function createManagedUser() {
    const username = userDraft.username.trim();
    const displayName = userDraft.displayName.trim();
    const password = userDraft.password.trim();
    if (!username || !displayName || !password) {
      showToast({ tone: "error", message: "请完整填写账号、姓名和密码" });
      return;
    }

    try {
      const created = await postJson<ManagedUser>("/api/users", {
        username,
        displayName,
        password,
        roleCode: userDraft.roleCode
      });
      setUsers((previous) => [created, ...previous]);
      setUserDraft({ username: "", displayName: "", password: "", roleCode: "WAREHOUSE_ADMIN" });
      showToast({ tone: "success", message: "账号已创建" });
      setLogs(await getJson<OperationLog[]>("/api/operation-logs"));
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "创建账号失败") });
    }
  }

  async function updateManagedUser(input: { displayName: string; roleCode: UserRoleCode; status: "enabled" | "disabled" }) {
    if (!editingUser) return;
    try {
      const updated = await patchJson<ManagedUser>(`/api/users/${editingUser.id}`, input);
      setUsers((previous) => previous.map((user) => user.id === updated.id ? updated : user));
      if (updated.id === currentUserId) onCurrentUserUpdated(updated);
      setEditingUser(null);
      showToast({ tone: "success", message: "账号资料已更新" });
      setLogs(await getJson<OperationLog[]>("/api/operation-logs"));
    } catch (error) {
      throw new Error(apiErrorMessage(error, "更新账号失败"));
    }
  }

  async function resetManagedPassword(password: string) {
    if (!resettingPasswordFor) return;
    try {
      await postJson<{ reset: boolean }>(`/api/users/${resettingPasswordFor.id}/reset-password`, { password });
      setResettingPasswordFor(null);
      showToast({ tone: "success", message: "密码已重置，该账号需要重新登录" });
      setLogs(await getJson<OperationLog[]>("/api/operation-logs"));
    } catch (error) {
      throw new Error(apiErrorMessage(error, "重置密码失败"));
    }
  }

  async function runAudit() {
    setAuditBusy(true);
    try {
      const result = await getJson<ConsistencyAuditResult>("/api/system/consistency-audit");
      setAudit(result);
      showToast({
        tone: result.healthy ? "success" : "error",
        message: result.healthy
          ? `一致性检查完成，没有发现错误${result.severityCounts.info ? `，有 ${result.severityCounts.info} 条历史提示` : ""}`
          : `一致性检查发现 ${result.severityCounts.error} 条错误，请查看检查结果`
      });
      setLogs(await getJson<OperationLog[]>("/api/operation-logs"));
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "一致性检查失败") });
    } finally {
      setAuditBusy(false);
    }
  }

  async function clearOperationalDataFromWeb() {
    if (confirmation.trim() !== resetConfirmationText) {
      showToast({ tone: "error", message: "请输入正确确认文字" });
      return;
    }

    setSubmitting(true);
    try {
      await postJson<{ reset: boolean }>("/api/system/reset-demo", { confirmation });
      showToast({ tone: "success", message: "业务数据已清空，请重新登录" });
      onResetComplete();
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "清空业务数据失败") });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-5">
      {editingUser ? (
        <AccountEditDialog
          user={editingUser}
          currentUserId={currentUserId}
          onClose={() => setEditingUser(null)}
          onConfirm={updateManagedUser}
        />
      ) : null}
      {resettingPasswordFor ? (
        <PasswordResetDialog
          user={resettingPasswordFor}
          onClose={() => setResettingPasswordFor(null)}
          onConfirm={resetManagedPassword}
        />
      ) : null}
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel p-5">
          <SectionHeader icon={Users} title="账号管理" compact />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <TextField
              label="登录账号"
              value={userDraft.username}
              onChange={(value) => setUserDraft({ ...userDraft, username: value })}
              placeholder="如 zhangsan"
            />
            <TextField
              label="显示姓名"
              value={userDraft.displayName}
              onChange={(value) => setUserDraft({ ...userDraft, displayName: value })}
              placeholder="如 张三"
            />
            <TextField
              label="初始密码"
              value={userDraft.password}
              onChange={(value) => setUserDraft({ ...userDraft, password: value })}
              placeholder="初始密码"
            />
            <FieldSelect
              label="角色"
              value={userDraft.roleCode}
              onChange={(value) => setUserDraft({ ...userDraft, roleCode: value as UserRoleCode })}
              options={[
                { value: "WAREHOUSE_ADMIN", label: roleLabels.WAREHOUSE_ADMIN },
                { value: "INVENTORY_VIEWER", label: roleLabels.INVENTORY_VIEWER },
                { value: "SUPER_ADMIN", label: roleLabels.SUPER_ADMIN }
              ]}
            />
          </div>
          <button className="primary-button mt-4 w-full" onClick={createManagedUser}>
            <Check className="h-4 w-4" />
            新增账号
          </button>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3">账号</th>
                  <th className="px-4 py-3">姓名</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td className="table-cell font-mono text-work">{user.username}</td>
                    <td className="table-cell">{user.displayName}</td>
                    <td className="table-cell">{user.roles.map((role) => roleLabels[role.code]).join("、")}</td>
                    <td className="table-cell">
                      <StatusBadge label={user.status === "enabled" ? "启用" : "停用"} />
                    </td>
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        <button className="secondary-button h-8 px-2 text-xs" onClick={() => setEditingUser(user)}>
                          <Pencil className="h-3.5 w-3.5" />
                          编辑
                        </button>
                        {user.id !== currentUserId ? (
                          <button className="secondary-button h-8 px-2 text-xs" onClick={() => setResettingPasswordFor(user)}>
                            <KeyRound className="h-3.5 w-3.5" />
                            重置密码
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel p-5">
          <SectionHeader icon={ShieldCheck} title="高危维护" compact />
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
            该入口已常设开放，仅超级管理员可执行。操作会清空库存、单据、流水和基础资料，不会写入测试数据；用户账号和角色会保留，执行后当前登录会话会失效，需要重新登录。
          </div>
          <label className="label mt-5" htmlFor="reset-confirmation">
            输入确认文字
          </label>
          <input
            className="field"
            id="reset-confirmation"
            placeholder={resetConfirmationText}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
          <button className="primary-button mt-4 w-full" disabled={submitting} onClick={clearOperationalDataFromWeb}>
            <RotateCcw className="h-4 w-4" />
            {submitting ? "正在清空" : "清空业务数据"}
          </button>
        </section>
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-4">
          <div>
            <SectionHeader icon={ShieldCheck} title="数据一致性检查" compact />
            <p className="mt-1 text-xs text-muted">只读检查数量账、条码归属、流水和作废单据，不会自动修改数据。</p>
          </div>
          <button className="secondary-button" onClick={() => void runAudit()} disabled={auditBusy}>
            <RotateCcw className={`h-4 w-4 ${auditBusy ? "animate-spin" : ""}`} />
            {auditBusy ? "正在检查" : "开始检查"}
          </button>
        </div>
        {audit ? (
          <div>
            <div className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-4">
              <AuditSummary label="检查结论" value={audit.healthy ? "账目正常" : "发现异常"} tone={audit.healthy ? "success" : "error"} />
              <AuditSummary label="错误" value={`${audit.severityCounts.error} 条`} tone={audit.severityCounts.error ? "error" : "neutral"} />
              <AuditSummary label="警告" value={`${audit.severityCounts.warning} 条`} tone={audit.severityCounts.warning ? "warning" : "neutral"} />
              <AuditSummary label="历史提示" value={`${audit.severityCounts.info} 条`} tone="neutral" />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-xs text-muted">
              <span>检查时间：{new Date(audit.generatedAt).toLocaleString("zh-CN", { hour12: false })}</span>
              <span>{audit.truncated ? "问题较多，仅展示前 500 条" : `共 ${audit.total} 条检查结果`}</span>
            </div>
            {audit.issues.length > 0 ? (
              <div className="max-h-[460px] overflow-auto border-t border-slate-200">
                <table className="w-full min-w-[900px]">
                  <thead className="table-head sticky top-0 z-[1]">
                    <tr>
                      <th className="px-4 py-3">级别</th>
                      <th className="px-4 py-3">问题</th>
                      <th className="px-4 py-3">对象</th>
                      <th className="px-4 py-3">处理建议</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.issues.map((issue, index) => (
                      <tr key={`${issue.code}-${issue.entityType}-${issue.entityId}-${index}`}>
                        <td className="table-cell"><AuditSeverity severity={issue.severity} /></td>
                        <td className="table-cell">
                          <p className="font-semibold text-ink">{issue.summary}</p>
                          <p className="mt-1 font-mono text-xs text-muted">{issue.code}</p>
                        </td>
                        <td className="table-cell font-mono text-xs text-slate-600">{issue.entityType}<br />{issue.entityId}</td>
                        <td className="table-cell text-slate-600">{issue.suggestion}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-4"><EmptyState icon={ShieldCheck} title="没有发现一致性问题" detail="当前数量余额、条码归属、流水和作废单据相互一致。" /></div>
            )}
          </div>
        ) : (
          <div className="p-4 text-sm text-muted">尚未执行检查。正式更新或恢复数据库后建议运行一次。</div>
        )}
      </section>

      <section className="panel overflow-hidden">
        <SectionHeader icon={ClipboardList} title="最近操作日志" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">时间</th>
                <th className="px-4 py-3">用户</th>
                <th className="px-4 py-3">动作</th>
                <th className="px-4 py-3">结果</th>
                <th className="px-4 py-3">说明</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="table-cell text-slate-600">{log.createdAt}</td>
                  <td className="table-cell">{log.username}</td>
                  <td className="table-cell font-semibold">{log.action}</td>
                  <td className="table-cell">
                    <StatusBadge label={log.result === "SUCCESS" ? "成功" : "失败"} />
                  </td>
                  <td className="table-cell text-slate-600">{log.detail ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {logs.length === 0 ? (
            <div className="border-t border-slate-200 p-4">
              <EmptyState
                icon={ClipboardList}
                title="暂无操作日志"
                detail="账号、基础资料和库存业务发生操作后，会在这里留下记录。"
              />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}



function AccountEditDialog({
  user,
  currentUserId,
  onClose,
  onConfirm
}: {
  user: ManagedUser;
  currentUserId: string;
  onClose: () => void;
  onConfirm: (input: { displayName: string; roleCode: UserRoleCode; status: "enabled" | "disabled" }) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(user.displayName);
  const [roleCode, setRoleCode] = useState<UserRoleCode>(user.roles[0]?.code ?? "WAREHOUSE_ADMIN");
  const [status, setStatus] = useState<"enabled" | "disabled">(user.status);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const isCurrentUser = user.id === currentUserId;

  async function submit() {
    if (!displayName.trim()) {
      setError("显示姓名不能为空");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm({ displayName, roleCode, status });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "更新账号失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <section className="w-full max-w-lg rounded-md bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">编辑账号</h2>
            <p className="mt-1 font-mono text-xs text-muted">{user.username}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭编辑账号窗口"><X className="h-4 w-4" /></button>
        </div>
        <div className="mt-5">
          <TextField label="显示姓名" value={displayName} onChange={setDisplayName} />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FieldSelect
            label="角色"
            value={roleCode}
            onChange={(value) => setRoleCode(value as UserRoleCode)}
            options={[
              { value: "WAREHOUSE_ADMIN", label: roleLabels.WAREHOUSE_ADMIN },
              { value: "INVENTORY_VIEWER", label: roleLabels.INVENTORY_VIEWER },
              { value: "SUPER_ADMIN", label: roleLabels.SUPER_ADMIN }
            ]}
            disabled={isCurrentUser}
          />
          <FieldSelect
            label="账号状态"
            value={status}
            onChange={(value) => setStatus(value as "enabled" | "disabled")}
            options={[
              { value: "enabled", label: "启用" },
              { value: "disabled", label: "停用" }
            ]}
            disabled={isCurrentUser}
          />
        </div>
        {isCurrentUser ? <p className="mt-3 text-xs text-muted">当前账号只能修改显示姓名，不能停用或调整自己的角色。</p> : null}
        {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button className="primary-button" onClick={() => void submit()} disabled={busy}>
            <Check className="h-4 w-4" />
            {busy ? "正在保存" : "保存账号"}
          </button>
        </div>
      </section>
    </div>
  );
}

function PasswordResetDialog({
  user,
  onClose,
  onConfirm
}: {
  user: ManagedUser;
  onClose: () => void;
  onConfirm: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (password.length < 8) {
      setError("新密码至少需要 8 个字符");
      return;
    }
    if (password !== confirmation) {
      setError("两次输入的新密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onConfirm(password);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "重置密码失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true">
      <section className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-ink">重置账号密码</h2>
            <p className="mt-1 text-xs text-muted">{user.displayName} · {user.username}</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="关闭重置密码窗口"><X className="h-4 w-4" /></button>
        </div>
        <label className="label mt-5" htmlFor="reset-user-password">新密码</label>
        <input id="reset-user-password" className="field" type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
        <label className="label mt-4" htmlFor="reset-user-password-confirmation">再次输入新密码</label>
        <input id="reset-user-password-confirmation" className="field" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
        {error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button className="secondary-button" onClick={onClose} disabled={busy}>取消</button>
          <button className="primary-button" onClick={() => void submit()} disabled={busy}>
            <KeyRound className="h-4 w-4" />
            {busy ? "正在重置" : "确认重置"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SegmentedControl({
  options,
  value,
  onChange
}: {
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-100 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          className={`h-10 rounded-md text-sm font-semibold transition ${
            value === option.value ? "bg-white text-work shadow-sm" : "text-slate-500 hover:text-ink"
          }`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
