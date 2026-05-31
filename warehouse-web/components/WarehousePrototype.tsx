"use client";

import {
  ArrowLeftRight,
  Barcode,
  Boxes,
  Building2,
  Check,
  ClipboardList,
  Download,
  Home,
  Info,
  LogIn,
  LogOut,
  PackageCheck,
  Pencil,
  Power,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
  Undo2,
  Users,
  Warehouse,
  X
} from "lucide-react";
import { Fragment, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { initialState } from "@/lib/demo-data";
import { hasAnyRole } from "@/lib/role-utils";
import type {
  CurrentUser,
  InboundSource,
  InventoryItem,
  ManagedUser,
  OperationLog,
  OrderKind,
  OrderSummary,
  OutboundType,
  StockMovement,
  Toast,
  UserRoleCode,
  Warehouse as WarehouseRecord,
  WarehouseState
} from "@/lib/types";
import {
  addYears,
  cloneInitialState,
  enabledLocationsForWarehouse,
  formatCategory,
  formatMovementType,
  goodsLabel,
  ownerLabel,
  STORAGE_KEY,
  uniqueBarcodes
} from "@/lib/warehouse-utils";

type ViewKey = "dashboard" | "masters" | "inbound" | "outbound" | "return" | "orders" | "inventory" | "system";

type MasterDataPayload = WarehouseState;

type ApiResponse<T> = { data: T } | { error: string };

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(body)
  });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !("data" in payload)) {
    throw new Error("error" in payload ? payload.error : "操作失败");
  }

  return payload.data;
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin" });
  const payload = (await response.json()) as ApiResponse<T>;

  if (!response.ok || !("data" in payload)) {
    throw new Error("error" in payload ? payload.error : "读取数据失败");
  }

  return payload.data;
}

function mergeInventoryItems(currentItems: InventoryItem[], updatedItems: InventoryItem[]) {
  const updatedByBarcode = new Map(updatedItems.map((item) => [item.barcode, item]));
  const merged = currentItems.map((item) => updatedByBarcode.get(item.barcode) ?? item);
  const existingBarcodes = new Set(currentItems.map((item) => item.barcode));
  return [...updatedItems.filter((item) => !existingBarcodes.has(item.barcode)), ...merged];
}

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Home }> = [
  { key: "dashboard", label: "首页", icon: Home },
  { key: "masters", label: "基础资料", icon: Building2 },
  { key: "inbound", label: "入库", icon: Truck },
  { key: "outbound", label: "出库", icon: ArrowLeftRight },
  { key: "return", label: "销售退回", icon: Undo2 },
  { key: "orders", label: "单据查询", icon: ClipboardList },
  { key: "inventory", label: "库存查询", icon: Search },
  { key: "system", label: "系统维护", icon: ShieldCheck }
];

const operator = "仓库操作员";
const resetConfirmationText = "确定重置";

const roleLabels: Record<UserRoleCode, string> = {
  SUPER_ADMIN: "超级管理员",
  WAREHOUSE_ADMIN: "仓库管理员",
  INVENTORY_VIEWER: "只读查询人员"
};

export default function WarehousePrototype() {
  const [hydrated, setHydrated] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [state, setState] = useState<WarehouseState>(() => cloneInitialState(initialState));
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedBarcode, setSelectedBarcode] = useState("HJ202605290001");
  const [masterDataSource, setMasterDataSource] = useState<"local" | "database">("local");
  const [refreshing, setRefreshing] = useState(false);

  const [inboundSource, setInboundSource] = useState<InboundSource>("factory");
  const [inboundWarehouseId, setInboundWarehouseId] = useState("wh-main");
  const [inboundLocationId, setInboundLocationId] = useState("loc-main-a1");
  const [inboundGoodsId, setInboundGoodsId] = useState("goods-hj-001");
  const [inboundQty, setInboundQty] = useState("1");
  const [inboundBarcodeInput, setInboundBarcodeInput] = useState("");
  const [inboundBarcodes, setInboundBarcodes] = useState<string[]>([]);
  const [productionDate, setProductionDate] = useState("");
  const [terminalStoreId, setTerminalStoreId] = useState("store-001");

  const [outboundType, setOutboundType] = useState<OutboundType>("transfer");
  const [sourceWarehouseId, setSourceWarehouseId] = useState("wh-main");
  const [targetWarehouseId, setTargetWarehouseId] = useState("wh-county-a");
  const [targetLocationId, setTargetLocationId] = useState("loc-county-a1");
  const [salespersonId, setSalespersonId] = useState("sp-001");
  const [outboundBarcodeInput, setOutboundBarcodeInput] = useState("");
  const [outboundBarcodes, setOutboundBarcodes] = useState<string[]>([]);

  const [returnWarehouseId, setReturnWarehouseId] = useState("wh-main");
  const [returnLocationId, setReturnLocationId] = useState("loc-main-a1");
  const [returnBarcodeInput, setReturnBarcodeInput] = useState("");
  const [returnBarcodes, setReturnBarcodes] = useState<string[]>([]);

  const [inventoryFilters, setInventoryFilters] = useState({
    keyword: "",
    warehouseId: "all",
    salespersonId: "all",
    goodsId: "all"
  });
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [orderKindFilter, setOrderKindFilter] = useState<OrderKind | "all">("all");

  const currentRoleCodes = useMemo(() => currentUser?.roles.map((role) => role.code) ?? [], [currentUser]);
  const canManageMasterData = hasAnyRole(currentRoleCodes, ["SUPER_ADMIN", "WAREHOUSE_ADMIN"]);
  const canOperateWarehouse = hasAnyRole(currentRoleCodes, ["SUPER_ADMIN", "WAREHOUSE_ADMIN"]);
  const canMaintainSystem = hasAnyRole(currentRoleCodes, ["SUPER_ADMIN"]);
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
    setToast(nextToast);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const applyDatabaseState = useCallback((masterData: WarehouseState, options: { preserveSelection?: boolean } = {}) => {
    const mainWarehouse =
      masterData.warehouses.find((warehouse) => warehouse.type === "main" && warehouse.status === "enabled") ??
      masterData.warehouses[0];
    const branchWarehouse =
      masterData.warehouses.find((warehouse) => warehouse.type === "branch" && warehouse.status === "enabled") ??
      masterData.warehouses.find((warehouse) => warehouse.id !== mainWarehouse?.id);
    const mainLocation = masterData.locations.find(
      (location) => location.warehouseId === mainWarehouse?.id && location.status === "enabled"
    );
    const branchLocation = masterData.locations.find(
      (location) => location.warehouseId === branchWarehouse?.id && location.status === "enabled"
    );

    setState(masterData);
    setInboundGoodsId(masterData.goods[0]?.id ?? "");
    setInboundWarehouseId(mainWarehouse?.id ?? "");
    setInboundLocationId(mainLocation?.id ?? "");
    setTerminalStoreId(masterData.terminalStores[0]?.id ?? "");
    setSourceWarehouseId(mainWarehouse?.id ?? "");
    setTargetWarehouseId(branchWarehouse?.id ?? "");
    setTargetLocationId(branchLocation?.id ?? "");
    setSalespersonId(masterData.salespeople[0]?.id ?? "");
    setReturnWarehouseId(mainWarehouse?.id ?? "");
    setReturnLocationId(mainLocation?.id ?? "");
    setInventoryFilters({ keyword: "", warehouseId: "all", salespersonId: "all", goodsId: "all" });
    setSelectedBarcode((current) => {
      if (options.preserveSelection && masterData.inventoryItems.some((item) => item.barcode === current)) {
        return current;
      }
      return masterData.inventoryItems[0]?.barcode ?? "";
    });
    setMasterDataSource("database");
    window.localStorage.removeItem(STORAGE_KEY);
  }, []);

  const refreshWarehouseState = useCallback(
    async (options: { preserveSelection?: boolean; notify?: boolean } = {}) => {
      setRefreshing(true);
      try {
        const masterData = await getJson<WarehouseState>("/api/master-data");
        applyDatabaseState(masterData, { preserveSelection: options.preserveSelection ?? true });
        if (options.notify) {
          showToast({ tone: "success", message: "已从数据库刷新库存与流水" });
        }
        return masterData;
      } catch (error) {
        setMasterDataSource("local");
        if (options.notify) {
          showToast({ tone: "error", message: error instanceof Error ? error.message : "刷新数据失败" });
        } else {
          console.info(error instanceof Error ? error.message : "基础资料接口暂不可用");
        }
        return null;
      } finally {
        setRefreshing(false);
      }
    },
    [applyDatabaseState, showToast]
  );

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        setState(JSON.parse(stored) as WarehouseState);
      } catch {
        setState(cloneInitialState(initialState));
      }
    }
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

    getJson<MasterDataPayload>("/api/master-data")
      .then((masterData) => {
        if (cancelled) return;
        applyDatabaseState(masterData, { preserveSelection: true });
      })
      .catch((error) => {
        if (cancelled) return;
        setMasterDataSource("local");
        console.info(error instanceof Error ? error.message : "基础资料接口暂不可用");
      });

    return () => {
      cancelled = true;
    };
  }, [applyDatabaseState, hydrated, loggedIn]);

  useEffect(() => {
    if (hydrated && masterDataSource === "local") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [hydrated, masterDataSource, state]);

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
    if (outboundType !== "transfer" || targetWarehouseId !== sourceWarehouseId) return;
    const nextTarget = state.warehouses.find(
      (warehouse) => warehouse.status === "enabled" && warehouse.id !== sourceWarehouseId
    );
    setTargetWarehouseId(nextTarget?.id ?? "");
  }, [outboundType, sourceWarehouseId, state.warehouses, targetWarehouseId]);

  useEffect(() => {
    const firstLocation = enabledLocationsForWarehouse(returnWarehouseId, state.locations)[0];
    setReturnLocationId(firstLocation?.id ?? "");
  }, [returnWarehouseId, state.locations]);

  const selectedItem = useMemo(
    () => state.inventoryItems.find((item) => item.barcode === selectedBarcode),
    [selectedBarcode, state.inventoryItems]
  );

  const selectedMovements = useMemo(
    () =>
      state.movements
        .filter((movement) => movement.barcode === selectedBarcode)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt)),
    [selectedBarcode, state.movements]
  );

  const filteredInventory = useMemo(() => {
    return state.inventoryItems.filter((item) => {
      const goods = state.goods.find((entry) => entry.id === item.goodsId);
      const keyword = inventoryFilters.keyword.trim().toLowerCase();
      const keywordMatch =
        !keyword ||
        item.barcode.toLowerCase().includes(keyword) ||
        goods?.name.toLowerCase().includes(keyword) ||
        goods?.code.toLowerCase().includes(keyword);
      const warehouseMatch =
        inventoryFilters.warehouseId === "all" || item.warehouseId === inventoryFilters.warehouseId;
      const salespersonMatch =
        inventoryFilters.salespersonId === "all" ||
        item.salespersonId === inventoryFilters.salespersonId;
      const goodsMatch = inventoryFilters.goodsId === "all" || item.goodsId === inventoryFilters.goodsId;

      return keywordMatch && warehouseMatch && salespersonMatch && goodsMatch;
    });
  }, [inventoryFilters, state.goods, state.inventoryItems]);

  const filteredOrders = useMemo(() => {
    if (orderKindFilter === "all") return orders;
    return orders.filter((order) => order.kind === orderKindFilter);
  }, [orderKindFilter, orders]);

  const stats = useMemo(() => {
    const inStock = state.inventoryItems.filter((item) => item.ownerType === "warehouse");
    const withSales = state.inventoryItems.filter((item) => item.ownerType === "salesperson");
    const mainWarehouseIds = new Set(
      state.warehouses.filter((warehouse) => warehouse.type === "main").map((warehouse) => warehouse.id)
    );
    const mainCount = inStock.filter((item) => item.warehouseId && mainWarehouseIds.has(item.warehouseId)).length;
    const branchCount = inStock.filter((item) => item.warehouseId && !mainWarehouseIds.has(item.warehouseId)).length;
    return { inStock: inStock.length, withSales: withSales.length, mainCount, branchCount };
  }, [state.inventoryItems, state.warehouses]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    try {
      setOrders(await getJson<OrderSummary[]>("/api/orders"));
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "读取单据失败" });
    } finally {
      setOrdersLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (activeView === "orders" && loggedIn) {
      void loadOrders();
    }
  }, [activeView, loadOrders, loggedIn]);

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
    const barcode = input.trim();
    if (!barcode) return;
    if (currentList.includes(barcode)) {
      showToast({ tone: "error", message: "当前清单中已有该条码" });
      return;
    }
    if (options.mustBeNew && state.inventoryItems.some((item) => item.barcode === barcode)) {
      showToast({ tone: "error", message: "该条码已存在，单件条码不可重复" });
      return;
    }
    const nextList = [...currentList, barcode];
    setList(nextList);
    options.onAfterAdd?.(nextList);
    setInput("");
  }

  async function submitInbound() {
    const qty = Number(inboundQty);
    const barcodes = uniqueBarcodes(inboundBarcodes);
    const goods = state.goods.find((item) => item.id === inboundGoodsId);
    const warehouse = state.warehouses.find((item) => item.id === inboundWarehouseId);

    if (!goods || !warehouse) {
      showToast({ tone: "error", message: "请选择有效的货物和仓库" });
      return;
    }
    if (!inboundLocationId) {
      showToast({ tone: "error", message: "请选择有效的入库库位" });
      return;
    }
    if (!Number.isInteger(qty) || qty <= 0) {
      showToast({ tone: "error", message: "入库数量必须为正整数" });
      return;
    }
    if (barcodes.length !== qty) {
      showToast({ tone: "error", message: "入库数量必须与条码数量一致" });
      return;
    }
    if (inboundSource === "terminal_return" && !productionDate) {
      showToast({ tone: "error", message: "终端店铺退换货入库必须登记生产日期" });
      return;
    }
    const duplicated = barcodes.find((barcode) =>
      state.inventoryItems.some((item) => item.barcode === barcode)
    );
    if (inboundSource === "factory" && duplicated) {
      showToast({ tone: "error", message: `条码 ${duplicated} 已存在` });
      return;
    }
    if (inboundSource === "terminal_return") {
      const invalid = barcodes.find((barcode) => {
        const item = state.inventoryItems.find((entry) => entry.barcode === barcode);
        return item && item.ownerType !== "salesperson";
      });
      if (invalid) {
        showToast({ tone: "error", message: `条码 ${invalid} 已在仓库库存中，不能作为终端店铺退换货入库` });
        return;
      }
    }

    try {
      const result = await postJson<{ items: InventoryItem[]; movements: StockMovement[] }>("/api/inbound", {
        source: inboundSource,
        warehouseId: inboundWarehouseId,
        locationId: inboundLocationId,
        goodsId: inboundGoodsId,
        terminalStoreId: inboundSource === "terminal_return" ? terminalStoreId : undefined,
        productionDate: inboundSource === "terminal_return" ? productionDate : undefined,
        barcodes,
        operatorName: currentUser?.displayName ?? operator
      });

      setState((previous) => ({
        ...previous,
        inventoryItems: mergeInventoryItems(previous.inventoryItems, result.items),
        movements: [...result.movements, ...previous.movements]
      }));
      await refreshWarehouseState({ preserveSelection: true });
      setInboundBarcodes([]);
      setInboundQty("1");
      setProductionDate("");
      setSelectedBarcode(result.items[0]?.barcode ?? selectedBarcode);
      showToast({ tone: "success", message: "入库已写入数据库，库存已更新" });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "入库提交失败" });
    }
  }

  async function submitOutbound() {
    const barcodes = uniqueBarcodes(outboundBarcodes);
    if (barcodes.length === 0) {
      showToast({ tone: "error", message: "请先扫描或录入条码" });
      return;
    }

    const sourceWarehouse = state.warehouses.find((warehouse) => warehouse.id === sourceWarehouseId);
    const targetWarehouse = state.warehouses.find((warehouse) => warehouse.id === targetWarehouseId);
    const salesperson = state.salespeople.find((person) => person.id === salespersonId);

    if (!sourceWarehouse) {
      showToast({ tone: "error", message: "请选择有效的出库仓库" });
      return;
    }
    if (outboundType === "transfer") {
      if (!targetWarehouse) {
        showToast({ tone: "error", message: "请选择有效的目标仓库" });
        return;
      }
      if (targetWarehouse.id === sourceWarehouse.id) {
        showToast({ tone: "error", message: "目标仓库不能与出库仓库相同" });
        return;
      }
    }
    if (outboundType === "sales" && !salesperson) {
      showToast({ tone: "error", message: "销售出库必须选择销售人员" });
      return;
    }

    const movingItems = barcodes.map((barcode) =>
      state.inventoryItems.find((item) => item.barcode === barcode)
    );
    const missing = barcodes.find((_, index) => !movingItems[index]);
    if (missing) {
      showToast({ tone: "error", message: `条码 ${missing} 不存在` });
      return;
    }
    const invalid = movingItems.find(
      (item) => item?.ownerType !== "warehouse" || item.warehouseId !== sourceWarehouseId
    );
    if (invalid) {
      showToast({ tone: "error", message: `条码 ${invalid.barcode} 不在所选仓库库存中` });
      return;
    }

    try {
      const result = await postJson<{ items: InventoryItem[]; movements: StockMovement[] }>("/api/outbound", {
        type: outboundType,
        sourceWarehouseId,
        targetWarehouseId: outboundType === "transfer" ? targetWarehouseId : undefined,
        targetLocationId: outboundType === "transfer" ? targetLocationId : undefined,
        salespersonId: outboundType === "sales" ? salespersonId : undefined,
        barcodes,
        operatorName: currentUser?.displayName ?? operator
      });

      const updatedByBarcode = new Map(result.items.map((item) => [item.barcode, item]));
      setState((previous) => ({
        ...previous,
        inventoryItems: previous.inventoryItems.map((item) => updatedByBarcode.get(item.barcode) ?? item),
        movements: [...result.movements, ...previous.movements]
      }));
      await refreshWarehouseState({ preserveSelection: true });
      setOutboundBarcodes([]);
      setSelectedBarcode(result.items[0]?.barcode ?? selectedBarcode);
      showToast({ tone: "success", message: outboundType === "transfer" ? "挪仓已写入数据库" : "销售出库已写入数据库" });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "出库提交失败" });
    }
  }

  async function submitSalesReturn() {
    const barcodes = uniqueBarcodes(returnBarcodes);
    if (barcodes.length === 0) {
      showToast({ tone: "error", message: "请先扫描或录入销售人员名下条码" });
      return;
    }

    const movingItems = barcodes.map((barcode) =>
      state.inventoryItems.find((item) => item.barcode === barcode)
    );
    const missing = barcodes.find((_, index) => !movingItems[index]);
    if (missing) {
      showToast({ tone: "error", message: `条码 ${missing} 不存在` });
      return;
    }
    const invalid = movingItems.find((item) => item?.ownerType !== "salesperson");
    if (invalid) {
      showToast({ tone: "error", message: `条码 ${invalid.barcode} 当前不在销售人员名下` });
      return;
    }

    try {
      const result = await postJson<{ items: InventoryItem[]; movements: StockMovement[] }>("/api/sales-return", {
        returnWarehouseId,
        returnLocationId,
        barcodes,
        operatorName: currentUser?.displayName ?? operator
      });

      const updatedByBarcode = new Map(result.items.map((item) => [item.barcode, item]));
      setState((previous) => ({
        ...previous,
        inventoryItems: previous.inventoryItems.map((item) => updatedByBarcode.get(item.barcode) ?? item),
        movements: [...result.movements, ...previous.movements]
      }));
      await refreshWarehouseState({ preserveSelection: true });
      setReturnBarcodes([]);
      setSelectedBarcode(result.items[0]?.barcode ?? selectedBarcode);
      showToast({ tone: "success", message: "销售退回已写入数据库，未修改生产日期或保质期" });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "销售退回提交失败" });
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
    <main className="min-h-screen bg-canvas text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-72 border-r border-slate-200 bg-slate-950 text-white lg:block">
        <div className="px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-work text-white">
              <Warehouse className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold">仓库货物管理系统</p>
              <p className="text-xs text-slate-400">条码级库存运营平台</p>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 px-3 py-4">
          <p className="mb-2 px-3 text-xs font-semibold text-slate-400">业务导航</p>
          <nav className="space-y-1">
            {allowedNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition ${
                    active
                      ? "bg-white text-slate-950 shadow-sm"
                      : "text-slate-300 hover:bg-white/10 hover:text-white"
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

        <div className="absolute bottom-0 left-0 right-0 border-t border-white/10 p-5">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
                {(currentUser?.displayName ?? "仓").slice(0, 1)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{currentUser?.displayName ?? "仓库用户"}</p>
                <p className="truncate text-xs text-slate-400">
                  {currentUser?.roles.map((role) => roleLabels[role.code]).join("、") ?? "-"}
                </p>
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between text-xs text-slate-400">
              <span>数据源</span>
              <span className="rounded bg-white/10 px-2 py-1 text-slate-200">
                {masterDataSource === "database" ? "PostgreSQL" : "本地数据"}
              </span>
            </div>
          </div>
        </div>
      </aside>

      <section className="lg:pl-72">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xs font-semibold text-muted">仓库运营工作台</p>
              <h1 className="mt-1 text-2xl font-semibold text-ink">{titleForView(activeView)}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <div className="hidden rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600 md:block">
                {currentUser?.displayName ?? "仓库用户"} ·{" "}
                {currentUser?.roles.map((role) => roleLabels[role.code]).join("、") ?? "-"}
              </div>
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                {masterDataSource === "database" ? "PostgreSQL 数据库" : "本地演示数据"}
              </div>
              <button
                className="secondary-button"
                onClick={() => void refreshWarehouseState({ preserveSelection: true, notify: true })}
                disabled={refreshing}
              >
                <RotateCcw className="h-4 w-4" />
                {refreshing ? "刷新中" : "刷新数据"}
              </button>
              <button className="secondary-button" onClick={logout}>
                <LogOut className="h-4 w-4" />
                退出
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
          {activeView === "dashboard" ? (
            <DashboardView
              stats={stats}
              state={state}
              setActiveView={setActiveView}
              setSelectedBarcode={setSelectedBarcode}
              canOperateWarehouse={canOperateWarehouse}
            />
          ) : null}
          {activeView === "masters" ? (
            <MastersView
              state={state}
              setState={setState}
              showToast={showToast}
              masterDataSource={masterDataSource}
            />
          ) : null}
          {activeView === "inbound" ? (
            <InboundView
              state={state}
              inboundSource={inboundSource}
              setInboundSource={setInboundSource}
              inboundWarehouseId={inboundWarehouseId}
              setInboundWarehouseId={setInboundWarehouseId}
              inboundGoodsId={inboundGoodsId}
              setInboundGoodsId={setInboundGoodsId}
              inboundQty={inboundQty}
              setInboundQty={setInboundQty}
              inboundBarcodeInput={inboundBarcodeInput}
              setInboundBarcodeInput={setInboundBarcodeInput}
              inboundBarcodes={inboundBarcodes}
              setInboundBarcodes={setInboundBarcodes}
              productionDate={productionDate}
              setProductionDate={setProductionDate}
              terminalStoreId={terminalStoreId}
              setTerminalStoreId={setTerminalStoreId}
              addBarcode={(input) =>
                addBarcode(input, inboundBarcodes, setInboundBarcodeInput, setInboundBarcodes, {
                  mustBeNew: inboundSource === "factory",
                  onAfterAdd: (nextList) => {
                    const currentQty = Number(inboundQty);
                    if (!Number.isFinite(currentQty) || nextList.length > currentQty) {
                      setInboundQty(String(nextList.length));
                    }
                  }
                })
              }
              submitInbound={submitInbound}
            />
          ) : null}
          {activeView === "outbound" ? (
            <OutboundView
              state={state}
              outboundType={outboundType}
              setOutboundType={setOutboundType}
              sourceWarehouseId={sourceWarehouseId}
              setSourceWarehouseId={setSourceWarehouseId}
              targetWarehouseId={targetWarehouseId}
              setTargetWarehouseId={setTargetWarehouseId}
              salespersonId={salespersonId}
              setSalespersonId={setSalespersonId}
              outboundBarcodeInput={outboundBarcodeInput}
              setOutboundBarcodeInput={setOutboundBarcodeInput}
              outboundBarcodes={outboundBarcodes}
              setOutboundBarcodes={setOutboundBarcodes}
              addBarcode={(input) =>
                addBarcode(input, outboundBarcodes, setOutboundBarcodeInput, setOutboundBarcodes)
              }
              submitOutbound={submitOutbound}
            />
          ) : null}
          {activeView === "return" ? (
            <SalesReturnView
              state={state}
              returnWarehouseId={returnWarehouseId}
              setReturnWarehouseId={setReturnWarehouseId}
              returnBarcodeInput={returnBarcodeInput}
              setReturnBarcodeInput={setReturnBarcodeInput}
              returnBarcodes={returnBarcodes}
              setReturnBarcodes={setReturnBarcodes}
              addBarcode={(input) =>
                addBarcode(input, returnBarcodes, setReturnBarcodeInput, setReturnBarcodes)
              }
              submitSalesReturn={submitSalesReturn}
            />
          ) : null}
          {activeView === "orders" ? (
            <OrdersView
              orders={filteredOrders}
              loading={ordersLoading}
              kindFilter={orderKindFilter}
              setKindFilter={setOrderKindFilter}
              refreshOrders={loadOrders}
            />
          ) : null}
          {activeView === "inventory" ? (
            <InventoryView
              state={state}
              filters={inventoryFilters}
              setFilters={setInventoryFilters}
              inventoryItems={filteredInventory}
              selectedBarcode={selectedBarcode}
              setSelectedBarcode={setSelectedBarcode}
              selectedItem={selectedItem}
              selectedMovements={selectedMovements}
              refreshing={refreshing}
              refreshData={() => void refreshWarehouseState({ preserveSelection: true, notify: true })}
            />
          ) : null}
          {activeView === "system" && canMaintainSystem ? (
            <SystemMaintenanceView
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
    inbound: "入库管理",
    outbound: "出库管理",
    return: "销售退回",
    orders: "单据查询",
    inventory: "库存查询",
    system: "系统维护"
  };
  return titles[view];
}

function LoginScreen({ onLogin }: { onLogin: (user: CurrentUser) => void }) {
  const [username, setUsername] = useState("warehouse_admin");
  const [password, setPassword] = useState("demo123456");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submitLogin() {
    setSubmitting(true);
    setError("");
    try {
      const user = await postJson<CurrentUser>("/api/auth/login", { username, password });
      onLogin(user);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
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
            以单件条码为核心，管理总仓、分仓和销售人员名下货物的入库、出库、退回与库存流转。
          </p>
          <div className="mt-8 grid max-w-xl gap-3 text-sm text-slate-300">
            <div className="rounded-md border border-white/10 bg-white/5 p-3">条码唯一追踪，每件货物有完整流转记录</div>
            <div className="rounded-md border border-white/10 bg-white/5 p-3">总仓与分仓库存、销售人员名下货物统一查询</div>
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
            <p className="mt-2 text-sm text-slate-500">请使用分配的账号登录。当前版本保留演示账号用于测试。</p>
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
          <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            可测试账号：`super_admin`、`warehouse_admin`、`inventory_viewer`，密码均为 `demo123456`。
          </div>
          <button className="primary-button w-full" type="submit" disabled={submitting}>
            <LogIn className="h-4 w-4" />
            {submitting ? "登录中" : "登录"}
          </button>
        </form>
      </section>
    </main>
  );
}

function ToastBox({ toast }: { toast: Toast }) {
  const toneClass =
    toast.tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : toast.tone === "error"
        ? "border-red-200 bg-red-50 text-red-800"
        : "border-sky-200 bg-sky-50 text-sky-800";
  return (
    <div className={`mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm ${toneClass}`}>
      {toast.tone === "success" ? <Check className="h-4 w-4" /> : <Info className="h-4 w-4" />}
      {toast.message}
    </div>
  );
}

function DashboardView({
  stats,
  state,
  setActiveView,
  setSelectedBarcode,
  canOperateWarehouse
}: {
  stats: { inStock: number; withSales: number; mainCount: number; branchCount: number };
  state: WarehouseState;
  setActiveView: (view: ViewKey) => void;
  setSelectedBarcode: (barcode: string) => void;
  canOperateWarehouse: boolean;
}) {
  const recentMovements = state.movements.slice(0, 8);
  const totalItems = state.inventoryItems.length;
  const warehouseRows = state.warehouses.map((warehouse) => ({
    warehouse,
    count: state.inventoryItems.filter((item) => item.ownerType === "warehouse" && item.warehouseId === warehouse.id).length
  }));
  const salespersonRows = state.salespeople.map((person) => ({
    person,
    count: state.inventoryItems.filter((item) => item.ownerType === "salesperson" && item.salespersonId === person.id).length
  }));
  const distributionRows = [
    { label: "总仓库存", value: stats.mainCount },
    { label: "分仓库存", value: stats.branchCount },
    { label: "销售人员名下", value: stats.withSales }
  ];

  return (
    <div className="space-y-5">
      <section className="panel p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-xs font-semibold text-muted">库存运营总览</p>
            <h2 className="mt-1 text-xl font-semibold text-ink">单件条码库存状态</h2>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-muted">货物资料</p>
              <p className="mt-1 text-lg font-semibold text-ink">{state.goods.length}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-muted">仓库数量</p>
              <p className="mt-1 text-lg font-semibold text-ink">{state.warehouses.length}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-xs text-muted">销售人员</p>
              <p className="mt-1 text-lg font-semibold text-ink">{state.salespeople.length}</p>
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="全部条码" value={totalItems} detail="当前系统内可追踪货物" icon={Barcode} />
          <MetricCard label="仓库在库" value={stats.inStock} detail={`${formatPercent(stats.inStock, totalItems)}% 留存在仓库`} icon={Boxes} />
          <MetricCard label="分仓库存" value={stats.branchCount} detail={`${formatPercent(stats.branchCount, stats.inStock)}% 在库库存`} icon={Building2} />
          <MetricCard label="销售人员名下" value={stats.withSales} detail={`${formatPercent(stats.withSales, totalItems)}% 总条码`} icon={Users} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="panel p-5">
          <SectionHeader icon={PackageCheck} title="库存归属结构" compact />
          <div className="mt-4 space-y-4">
            {distributionRows.map((row) => (
              <div key={row.label}>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-semibold text-slate-700">{row.label}</span>
                  <span className="font-mono text-slate-500">
                    {row.value} 件 · {formatPercent(row.value, totalItems)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-work"
                    style={{ width: `${formatPercent(row.value, totalItems)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <MiniDistributionTable
              title="仓库库存分布"
              rows={warehouseRows.map(({ warehouse, count }) => ({
                label: warehouse.name,
                meta: warehouse.type === "main" ? "总仓" : "分仓",
                count
              }))}
            />
            <MiniDistributionTable
              title="销售人员持有"
              rows={salespersonRows.map(({ person, count }) => ({
                label: person.name,
                meta: person.region,
                count
              }))}
            />
          </div>
        </section>

        <section className="panel p-5">
          <SectionHeader icon={PackageCheck} title="常用业务" compact />
          <div className="mt-4 grid gap-3">
            {canOperateWarehouse ? (
              <>
                <DashboardAction
                  icon={Truck}
                  title="入库管理"
                  description="厂家到货、终端店铺退换货"
                  onClick={() => setActiveView("inbound")}
                />
                <DashboardAction
                  icon={ArrowLeftRight}
                  title="出库管理"
                  description="仓库挪动、销售人员分配"
                  onClick={() => setActiveView("outbound")}
                />
                <DashboardAction
                  icon={Undo2}
                  title="销售退回"
                  description="未售完货物回流仓库"
                  onClick={() => setActiveView("return")}
                />
              </>
            ) : null}
            <DashboardAction
              icon={Search}
              title="库存查询"
              description="按条码查看库存与流转"
              onClick={() => setActiveView("inventory")}
            />
          </div>
        </section>
      </div>

      <div className="grid gap-5">
        <section className="panel overflow-hidden">
          <SectionHeader icon={ClipboardList} title="最近库存流转" />
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
              <div className="border-t border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                暂无库存流转记录。
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function formatPercent(value: number, total: number) {
  if (!total) return 0;
  return Math.round((value / total) * 100);
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
    <section className="panel p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-work">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </section>
  );
}

function MiniDistributionTable({
  title,
  rows
}: {
  title: string;
  rows: Array<{ label: string; meta: string; count: number }>;
}) {
  return (
    <div className="rounded-lg border border-slate-200">
      <div className="border-b border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">{title}</div>
      <div className="divide-y divide-slate-200">
        {rows.map((row) => (
          <div className="flex items-center justify-between gap-3 px-3 py-2 text-sm" key={`${row.label}-${row.meta}`}>
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{row.label}</p>
              <p className="truncate text-xs text-muted">{row.meta}</p>
            </div>
            <span className="font-mono font-semibold text-slate-700">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
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
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left transition hover:border-work hover:bg-emerald-50"
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

function MastersView({
  state,
  setState,
  showToast,
  masterDataSource
}: {
  state: WarehouseState;
  setState: (updater: (previous: WarehouseState) => WarehouseState) => void;
  showToast: (toast: Toast) => void;
  masterDataSource: "local" | "database";
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

  async function requestApi<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body)
    });
    const payload = (await response.json()) as ApiResponse<T>;

    if (!response.ok || !("data" in payload)) {
      throw new Error("error" in payload ? payload.error : "操作失败");
    }

    return payload.data;
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

  async function addGoods() {
    const code = goodsDraft.code.trim();
    const name = goodsDraft.name.trim();
    const unit = goodsDraft.unit.trim();
    const spec = goodsDraft.spec.trim();
    if (!code || !name || !unit || !spec) {
      showToast({ tone: "error", message: "请完整填写货物资料" });
      return;
    }
    if (state.goods.some((goods) => goods.code === code)) {
      showToast({ tone: "error", message: "货物编码已存在" });
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
      showToast({ tone: "success", message: "货物资料已写入数据库" });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "新增货物失败" });
    }
  }

  async function addWarehouse() {
    const code = warehouseDraft.code.trim();
    const name = warehouseDraft.name.trim();
    const manager = warehouseDraft.manager.trim();
    if (!code || !name || !manager) {
      showToast({ tone: "error", message: "请完整填写分仓资料" });
      return;
    }
    if (state.warehouses.some((warehouse) => warehouse.code === code)) {
      showToast({ tone: "error", message: "仓库编码已存在" });
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
      showToast({ tone: "success", message: "分仓资料已写入数据库，并已生成默认库位" });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "新增分仓失败" });
    }
  }

  async function addSalesperson() {
    const code = salespersonDraft.code.trim();
    const name = salespersonDraft.name.trim();
    const phone = salespersonDraft.phone.trim();
    const region = salespersonDraft.region.trim();
    if (!code || !name || !phone || !region) {
      showToast({ tone: "error", message: "请完整填写销售人员资料" });
      return;
    }
    if (state.salespeople.some((person) => person.code === code)) {
      showToast({ tone: "error", message: "销售人员编码已存在" });
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
      showToast({ tone: "success", message: "销售人员已写入数据库" });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "新增销售人员失败" });
    }
  }

  async function addTerminalStore() {
    const name = storeDraft.name.trim();
    const contact = storeDraft.contact.trim();
    const phone = storeDraft.phone.trim();
    const address = storeDraft.address.trim();
    if (!name || !contact || !phone || !address) {
      showToast({ tone: "error", message: "请完整填写终端店铺资料" });
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
      showToast({ tone: "success", message: "终端店铺已写入数据库" });
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "新增终端店铺失败" });
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
      showToast({ tone: "error", message: error instanceof Error ? error.message : "更新货物失败" });
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
      showToast({ tone: "error", message: error instanceof Error ? error.message : "更新仓库失败" });
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
      showToast({ tone: "error", message: error instanceof Error ? error.message : "更新销售人员失败" });
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
      showToast({ tone: "error", message: error instanceof Error ? error.message : "更新终端店铺失败" });
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
      showToast({ tone: "error", message: error instanceof Error ? error.message : "状态更新失败" });
    }
  }

  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        基础资料来源：{masterDataSource === "database" ? "PostgreSQL 数据库" : "本地演示数据"}
      </div>
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
            <div>
              <label className="label">仓库类型</label>
              <div className="field bg-slate-50 text-slate-500">{editingWarehouse.type === "main" ? "总仓" : "分仓"}</div>
            </div>
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
      <div className="grid gap-5 xl:grid-cols-2">
        <section className="panel p-5">
          <SectionHeader icon={Boxes} title="新增货物" compact />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
          <button className="primary-button mt-5" onClick={addGoods}>
            <Check className="h-4 w-4" />
            新增货物
          </button>
        </section>

        <section className="panel p-5">
          <SectionHeader icon={Warehouse} title="新增分仓" compact />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <TextField
              label="分仓编码"
              value={warehouseDraft.code}
              onChange={(value) => setWarehouseDraft({ ...warehouseDraft, code: value })}
              placeholder="如 FC-303"
            />
            <TextField
              label="分仓名称"
              value={warehouseDraft.name}
              onChange={(value) => setWarehouseDraft({ ...warehouseDraft, name: value })}
              placeholder="如 西城区分仓"
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
          <button className="primary-button mt-5" onClick={addWarehouse}>
            <Check className="h-4 w-4" />
            新增分仓
          </button>
        </section>

        <section className="panel p-5">
          <SectionHeader icon={Users} title="新增销售人员" compact />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
          <button className="primary-button mt-5" onClick={addSalesperson}>
            <Check className="h-4 w-4" />
            新增销售人员
          </button>
        </section>

        <section className="panel p-5">
          <SectionHeader icon={Building2} title="新增终端店铺" compact />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
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
          <button className="primary-button mt-5" onClick={addTerminalStore}>
            <Check className="h-4 w-4" />
            新增店铺
          </button>
        </section>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
      <MasterTable
        title="货物资料"
        icon={Boxes}
        headers={["编码", "名称", "大类", "规格", "状态", "操作"]}
        rows={state.goods.map((item) => [
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
          />
        ])}
      />
      <MasterTable
        title="仓库资料"
        icon={Warehouse}
        headers={["编码", "名称", "类型", "负责人", "状态", "操作"]}
        rows={state.warehouses.map((item) => [
          item.code,
          item.name,
          item.type === "main" ? "总仓" : "分仓",
          item.manager,
          <StatusBadge key={`${item.id}-status`} label={item.status === "enabled" ? "启用" : "停用"} />,
          <MasterActions
            key={`${item.id}-actions`}
            status={item.status}
            onEdit={() => setEditingWarehouse(item)}
            onToggle={() => toggleMasterStatus("warehouses", "/api/warehouses", item)}
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
  rows
}: {
  title: string;
  icon: typeof Home;
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <section className="panel overflow-hidden">
      <SectionHeader icon={Icon} title={title} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px]">
          <thead className="table-head">
            <tr>
              {headers.map((header) => (
                <th className="px-4 py-3" key={header}>
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="hover:bg-slate-50">
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
  onToggle
}: {
  status: "enabled" | "disabled";
  onEdit: () => void;
  onToggle: () => void;
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
    </div>
  );
}

function MasterEditDialog({
  open,
  title,
  icon: Icon,
  children,
  onClose,
  onSave
}: {
  open: boolean;
  title: string;
  icon: typeof Home;
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
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <button className="secondary-button" onClick={onClose}>
            <X className="h-4 w-4" />
            取消
          </button>
          <button className="primary-button" onClick={onSave}>
            <Check className="h-4 w-4" />
            保存修改
          </button>
        </div>
      </section>
    </div>
  );
}

function InboundView(props: {
  state: WarehouseState;
  inboundSource: InboundSource;
  setInboundSource: (value: InboundSource) => void;
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
  productionDate: string;
  setProductionDate: (value: string) => void;
  terminalStoreId: string;
  setTerminalStoreId: (value: string) => void;
  addBarcode: (input: string) => void;
  submitInbound: () => void;
}) {
  const selectedGoods = props.state.goods.find((goods) => goods.id === props.inboundGoodsId);
  const enabledWarehouses = props.state.warehouses.filter((warehouse) => warehouse.status === "enabled");
  const enabledGoods = props.state.goods.filter((goods) => goods.status === "enabled");
  const enabledStores = props.state.terminalStores.filter((store) => store.status === "enabled");
  const shelfLifePreview =
    props.inboundSource === "terminal_return" &&
    selectedGoods?.category === "health_wine" &&
    props.productionDate
      ? addYears(props.productionDate, 3)
      : "无";

  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="panel p-5">
        <SectionHeader icon={Truck} title="创建入库单" compact />
        <SegmentedControl
          options={[
            { value: "factory", label: "厂家到货" },
            { value: "terminal_return", label: "终端店铺退换货" }
          ]}
          value={props.inboundSource}
          onChange={(value) => props.setInboundSource(value as InboundSource)}
        />

        <div className="mt-5 grid gap-4 md:grid-cols-2">
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
              min="1"
              value={props.inboundQty}
              onChange={(event) => props.setInboundQty(event.target.value)}
            />
          </div>
          {props.inboundSource === "terminal_return" ? (
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

        {props.inboundSource === "terminal_return" ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            当前货物大类：{selectedGoods ? formatCategory(selectedGoods.category) : "未选择"}；默认保质期：
            {shelfLifePreview}
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
            厂家到货入库不强制登记生产日期，也不默认计算保质期。
          </div>
        )}
      </section>

      <section className="panel p-5">
        <SectionHeader icon={Barcode} title="单件条码录入" compact />
        <BarcodeCollector
          input={props.inboundBarcodeInput}
          setInput={props.setInboundBarcodeInput}
          barcodes={props.inboundBarcodes}
          setBarcodes={props.setInboundBarcodes}
          onAdd={props.addBarcode}
          placeholder="扫描或输入新条码，如 HJ202605290099"
        />
        <button className="primary-button mt-5 w-full" onClick={props.submitInbound}>
          <Check className="h-4 w-4" />
          提交入库并更新库存
        </button>
      </section>
    </div>
  );
}

function OutboundView(props: {
  state: WarehouseState;
  outboundType: OutboundType;
  setOutboundType: (value: OutboundType) => void;
  sourceWarehouseId: string;
  setSourceWarehouseId: (value: string) => void;
  targetWarehouseId: string;
  setTargetWarehouseId: (value: string) => void;
  salespersonId: string;
  setSalespersonId: (value: string) => void;
  outboundBarcodeInput: string;
  setOutboundBarcodeInput: (value: string) => void;
  outboundBarcodes: string[];
  setOutboundBarcodes: (value: string[]) => void;
  addBarcode: (input: string) => void;
  submitOutbound: () => void;
}) {
  const enabledWarehouses = props.state.warehouses.filter((warehouse) => warehouse.status === "enabled");
  const transferTargetWarehouses = enabledWarehouses.filter((warehouse) => warehouse.id !== props.sourceWarehouseId);
  const enabledSalespeople = props.state.salespeople.filter((person) => person.status === "enabled");
  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="panel p-5">
        <SectionHeader icon={ArrowLeftRight} title="创建出库单" compact />
        <SegmentedControl
          options={[
            { value: "transfer", label: "挪仓" },
            { value: "sales", label: "销售出库" }
          ]}
          value={props.outboundType}
          onChange={(value) => props.setOutboundType(value as OutboundType)}
        />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <FieldSelect
            label="出库仓库"
            value={props.sourceWarehouseId}
            onChange={props.setSourceWarehouseId}
            options={enabledWarehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
          />
          {props.outboundType === "transfer" ? (
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
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {props.outboundType === "transfer"
            ? "挪仓规则：总仓和分仓可以互相挪动，提交后直接进入目标仓库库存。"
            : "销售出库规则：总仓和分仓都可以出库，只分配到销售人员名下。"}
        </div>
      </section>

      <section className="panel p-5">
        <SectionHeader icon={Barcode} title="出库条码清单" compact />
        <BarcodeCollector
          input={props.outboundBarcodeInput}
          setInput={props.setOutboundBarcodeInput}
          barcodes={props.outboundBarcodes}
          setBarcodes={props.setOutboundBarcodes}
          onAdd={props.addBarcode}
          placeholder="扫描或输入当前在库条码"
        />
        <button className="primary-button mt-5 w-full" onClick={props.submitOutbound}>
          <Check className="h-4 w-4" />
          提交出库并更新归属
        </button>
      </section>
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
  addBarcode: (input: string) => void;
  submitSalesReturn: () => void;
}) {
  const enabledWarehouses = props.state.warehouses.filter((warehouse) => warehouse.status === "enabled");
  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="panel p-5">
        <SectionHeader icon={Undo2} title="销售退回设置" compact />
        <div className="grid gap-4">
          <FieldSelect
            label="回流仓库"
            value={props.returnWarehouseId}
            onChange={props.setReturnWarehouseId}
            options={enabledWarehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
          />
        </div>
        <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          销售退回只把销售人员名下未售完条码回流到仓库，不记录终端店铺、生产日期，也不重新计算保质期。
        </div>
      </section>

      <section className="panel p-5">
        <SectionHeader icon={Barcode} title="退回条码清单" compact />
        <BarcodeCollector
          input={props.returnBarcodeInput}
          setInput={props.setReturnBarcodeInput}
          barcodes={props.returnBarcodes}
          setBarcodes={props.setReturnBarcodes}
          onAdd={props.addBarcode}
          placeholder="扫描或输入销售人员名下条码，如 XS202605290001"
        />
        <button className="primary-button mt-5 w-full" onClick={props.submitSalesReturn}>
          <Check className="h-4 w-4" />
          提交销售退回
        </button>
      </section>
    </div>
  );
}

function OrdersView({
  orders,
  loading,
  kindFilter,
  setKindFilter,
  refreshOrders
}: {
  orders: OrderSummary[];
  loading: boolean;
  kindFilter: OrderKind | "all";
  setKindFilter: (value: OrderKind | "all") => void;
  refreshOrders: () => void;
}) {
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <SectionHeader icon={ClipboardList} title="业务单据历史" compact />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={kindFilter}
            onChange={(value) => setKindFilter(value as OrderKind | "all")}
            options={[
              { value: "all", label: "全部" },
              { value: "inbound", label: "入库" },
              { value: "outbound", label: "出库" },
              { value: "sales_return", label: "销售退回" }
            ]}
          />
          <button className="secondary-button" onClick={refreshOrders} disabled={loading}>
            <RotateCcw className="h-4 w-4" />
            {loading ? "刷新中" : "刷新单据"}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1080px]">
          <thead className="table-head">
            <tr>
              <th className="px-4 py-3">单号</th>
              <th className="px-4 py-3">业务类型</th>
              <th className="px-4 py-3">来源/去向</th>
              <th className="px-4 py-3">货物汇总</th>
              <th className="px-4 py-3">条码预览</th>
              <th className="px-4 py-3">件数</th>
              <th className="px-4 py-3">操作人</th>
              <th className="px-4 py-3">时间</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-slate-50">
                <td className="table-cell font-mono text-xs">{order.orderNo}</td>
                <td className="table-cell">
                  <StatusBadge label={order.businessType} />
                </td>
                <td className="table-cell">
                  <div className="font-medium text-ink">{order.primaryTarget}</div>
                  <div className="mt-1 text-xs text-slate-500">{order.counterparty ?? "-"}</div>
                </td>
                <td className="table-cell">{order.goodsSummary || "-"}</td>
                <td className="table-cell font-mono text-xs">{order.barcodePreview || "-"}</td>
                <td className="table-cell">{order.itemCount}</td>
                <td className="table-cell">{order.operator}</td>
                <td className="table-cell">{order.createdAt}</td>
              </tr>
            ))}
            {orders.length === 0 ? (
              <tr>
                <td className="table-cell text-center text-slate-500" colSpan={8}>
                  {loading ? "正在读取单据..." : "暂无符合条件的单据"}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

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

function SystemMaintenanceView({
  onResetComplete,
  showToast
}: {
  onResetComplete: () => void;
  showToast: (toast: Toast) => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [logs, setLogs] = useState<OperationLog[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [userDraft, setUserDraft] = useState({
    username: "",
    displayName: "",
    password: "demo123456",
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
      setUserDraft({ username: "", displayName: "", password: "demo123456", roleCode: "WAREHOUSE_ADMIN" });
      showToast({ tone: "success", message: "账号已创建" });
      setLogs(await getJson<OperationLog[]>("/api/operation-logs"));
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "创建账号失败" });
    }
  }

  async function resetDemoDatabaseFromWeb() {
    if (confirmation.trim() !== resetConfirmationText) {
      showToast({ tone: "error", message: "请输入正确确认文字" });
      return;
    }

    setSubmitting(true);
    try {
      await postJson<{ reset: boolean }>("/api/system/reset-demo", { confirmation });
      showToast({ tone: "success", message: "演示数据库已重置，请重新登录" });
      onResetComplete();
    } catch (error) {
      showToast({ tone: "error", message: error instanceof Error ? error.message : "重置演示数据库失败" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-5">
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
            <table className="w-full min-w-[560px]">
              <thead className="table-head">
                <tr>
                  <th className="px-4 py-3">账号</th>
                  <th className="px-4 py-3">姓名</th>
                  <th className="px-4 py-3">角色</th>
                  <th className="px-4 py-3">状态</th>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel p-5">
          <SectionHeader icon={ShieldCheck} title="高危维护" compact />
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">
            该操作会清空本地演示数据库并重新写入初始演示数据。执行后当前登录会话会失效，需要重新登录。
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
          <button className="primary-button mt-4 w-full" disabled={submitting} onClick={resetDemoDatabaseFromWeb}>
            <RotateCcw className="h-4 w-4" />
            {submitting ? "正在重置" : "重置演示数据库"}
          </button>
        </section>
      </div>

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
            <div className="border-t border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              暂无操作日志。
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function InventoryView(props: {
  state: WarehouseState;
  filters: { keyword: string; warehouseId: string; salespersonId: string; goodsId: string };
  setFilters: (value: { keyword: string; warehouseId: string; salespersonId: string; goodsId: string }) => void;
  inventoryItems: InventoryItem[];
  selectedBarcode: string;
  setSelectedBarcode: (barcode: string) => void;
  selectedItem?: InventoryItem;
  selectedMovements: StockMovement[];
  refreshing: boolean;
  refreshData: () => void;
}) {
  function exportSelectedMovements() {
    const header = ["时间", "业务类型", "条码", "货物", "来源", "去向", "操作人", "说明"];
    const rows = props.selectedMovements.map((movement) => [
      movement.occurredAt,
      formatMovementType(movement.type),
      movement.barcode,
      goodsLabel(movement.goodsId, props.state.goods),
      movement.fromLabel,
      movement.toLabel,
      movement.operator,
      movement.note
    ]);
    downloadCsv(`${props.selectedBarcode || "库存"}-流水.csv`, [header, ...rows]);
  }

  function clearInventoryFilters() {
    props.setFilters({ keyword: "", warehouseId: "all", salespersonId: "all", goodsId: "all" });
  }

  return (
    <div className="grid gap-5">
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <SectionHeader icon={Search} title="库存查询" compact />
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="secondary-button"
                onClick={exportSelectedMovements}
                disabled={!props.selectedItem || props.selectedMovements.length === 0}
              >
                <Download className="h-4 w-4" />
                导出所选条码流水
              </button>
              <button className="secondary-button" onClick={props.refreshData} disabled={props.refreshing}>
                <RotateCcw className="h-4 w-4" />
                {props.refreshing ? "刷新中" : "刷新数据"}
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-5">
            <input
              className="field"
              placeholder="货物名称、编码或条码"
              value={props.filters.keyword}
              onChange={(event) => props.setFilters({ ...props.filters, keyword: event.target.value })}
            />
            <FieldSelect
              label=""
              value={props.filters.warehouseId}
              onChange={(value) => props.setFilters({ ...props.filters, warehouseId: value })}
              options={[
                { value: "all", label: "全部仓库" },
                ...props.state.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))
              ]}
            />
            <FieldSelect
              label=""
              value={props.filters.salespersonId}
              onChange={(value) => props.setFilters({ ...props.filters, salespersonId: value })}
              options={[
                { value: "all", label: "全部销售人员" },
                ...props.state.salespeople.map((person) => ({ value: person.id, label: person.name }))
              ]}
            />
            <FieldSelect
              label=""
              value={props.filters.goodsId}
              onChange={(value) => props.setFilters({ ...props.filters, goodsId: value })}
              options={[
                { value: "all", label: "全部货物" },
                ...props.state.goods.map((goods) => ({ value: goods.id, label: goods.name }))
              ]}
            />
            <button className="secondary-button" onClick={clearInventoryFilters}>
              <RotateCcw className="h-4 w-4" />
              清空筛选
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1060px]">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">条码</th>
                <th className="px-4 py-3">货物</th>
                <th className="px-4 py-3">大类</th>
                <th className="px-4 py-3">当前归属</th>
                <th className="px-4 py-3">生产日期</th>
                <th className="px-4 py-3">保质期</th>
                <th className="px-4 py-3">状态</th>
                <th className="px-4 py-3">最近流转</th>
              </tr>
            </thead>
            <tbody>
              {props.inventoryItems.map((item) => {
                const goods = props.state.goods.find((entry) => entry.id === item.goodsId);
                const itemMovements = props.state.movements
                  .filter((movement) => movement.barcode === item.barcode)
                  .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
                const latestMovement = itemMovements[0];
                const selected = props.selectedBarcode === item.barcode;
                return (
                  <Fragment key={item.id}>
                    <tr
                      className={`cursor-pointer hover:bg-slate-50 ${selected ? "bg-emerald-50" : ""}`}
                      onClick={() => props.setSelectedBarcode(item.barcode)}
                    >
                      <td className="table-cell font-mono text-work">{item.barcode}</td>
                      <td className="table-cell">{goods?.name ?? "未知货物"}</td>
                      <td className="table-cell">{goods ? formatCategory(goods.category) : "-"}</td>
                      <td className="table-cell text-slate-600">
                        {ownerLabel(item, props.state.warehouses, props.state.salespeople, props.state.locations)}
                      </td>
                      <td className="table-cell">{item.productionDate ?? "-"}</td>
                      <td className="table-cell">{item.shelfLifeDate ?? "无"}</td>
                      <td className="table-cell">
                        <StatusBadge label={item.ownerType === "warehouse" ? "在库" : "销售人员名下"} />
                      </td>
                      <td className="table-cell text-slate-600">
                        {latestMovement ? (
                          <span>
                            {formatMovementType(latestMovement.type)} / {latestMovement.occurredAt}
                          </span>
                        ) : (
                          "-"
                        )}
                      </td>
                    </tr>
                    {selected ? (
                      <tr
                        className="bg-emerald-50/60"
                      >
                        <td className="px-4 py-4" colSpan={8}>
                          <div className="rounded-lg border border-emerald-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="font-mono text-sm font-semibold text-work">{item.barcode}</p>
                                <p className="mt-1 text-sm text-slate-600">
                                  当前归属：
                                  {ownerLabel(item, props.state.warehouses, props.state.salespeople, props.state.locations)}
                                </p>
                              </div>
                              <StatusBadge label={`流转 ${itemMovements.length} 条`} />
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                              {itemMovements.map((movement) => (
                                <div key={movement.id} className="rounded-md border border-slate-200 p-3">
                                  <p className="text-sm font-semibold text-ink">{formatMovementType(movement.type)}</p>
                                  <p className="mt-1 text-xs text-slate-500">{movement.occurredAt}</p>
                                  <p className="mt-2 text-sm text-slate-700">
                                    {movement.fromLabel} → {movement.toLabel}
                                  </p>
                                  <p className="mt-2 text-xs text-slate-500">{movement.note}</p>
                                </div>
                              ))}
                            </div>
                            {itemMovements.length === 0 ? (
                              <p className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
                                暂无流转记录。
                              </p>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {props.inventoryItems.length === 0 ? (
            <div className="border-t border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
              没有匹配的库存记录。
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function BarcodeCollector({
  input,
  setInput,
  barcodes,
  setBarcodes,
  onAdd,
  placeholder
}: {
  input: string;
  setInput: (value: string) => void;
  barcodes: string[];
  setBarcodes: (value: string[]) => void;
  onAdd: (input: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <div className="flex gap-2">
        <input
          className="field font-mono"
          placeholder={placeholder}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAdd(input);
            }
          }}
        />
        <button className="secondary-button shrink-0" onClick={() => onAdd(input)}>
          <Barcode className="h-4 w-4" />
          加入
        </button>
      </div>
      <div className="mt-4 min-h-[220px] rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">已录入条码</p>
          <span className="rounded-md bg-white px-2 py-1 text-xs text-slate-500">{barcodes.length} 件</span>
        </div>
        {barcodes.length === 0 ? (
          <div className="flex h-36 items-center justify-center rounded-md border border-dashed border-slate-300 text-sm text-slate-400">
            等待扫码录入
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {barcodes.map((barcode) => (
              <div
                className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                key={barcode}
              >
                <span className="font-mono text-slate-700">{barcode}</span>
                <button
                  className="text-xs font-semibold text-danger"
                  onClick={() => setBarcodes(barcodes.filter((entry) => entry !== barcode))}
                >
                  移除
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function FieldSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div>
      {label ? <label className="label">{label}</label> : null}
      <select className="field" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
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

function SectionHeader({
  icon: Icon,
  title,
  compact = false
}: {
  icon: typeof Home;
  title: string;
  compact?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 ${compact ? "" : "border-b border-slate-200 px-4 py-3"}`}>
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-emerald-50 text-work">
        <Icon className="h-4 w-4" />
      </div>
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
    </div>
  );
}

function StatusBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">
      {label}
    </span>
  );
}
