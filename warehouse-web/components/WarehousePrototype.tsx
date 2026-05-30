"use client";

import {
  ArrowLeftRight,
  Barcode,
  Boxes,
  Building2,
  Check,
  ClipboardList,
  Home,
  Info,
  LogIn,
  LogOut,
  PackageCheck,
  RotateCcw,
  Search,
  ShieldCheck,
  Truck,
  Undo2,
  Users,
  Warehouse
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { initialState } from "@/lib/demo-data";
import { hasAnyRole } from "@/lib/role-utils";
import type {
  CurrentUser,
  InboundSource,
  InventoryItem,
  OperationLog,
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

type ViewKey = "dashboard" | "masters" | "inbound" | "outbound" | "return" | "inventory" | "system";

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

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Home }> = [
  { key: "dashboard", label: "首页", icon: Home },
  { key: "masters", label: "基础资料", icon: Building2 },
  { key: "inbound", label: "入库", icon: Truck },
  { key: "outbound", label: "出库", icon: ArrowLeftRight },
  { key: "return", label: "销售退回", icon: Undo2 },
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
    [applyDatabaseState]
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

  function showToast(nextToast: Toast) {
    setToast(nextToast);
    window.setTimeout(() => setToast(null), 3200);
  }

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

  async function resetDemoData() {
    const confirmation = window.prompt(
      masterDataSource === "database"
        ? `当前操作会清空页面临时状态，并从 PostgreSQL 重新加载演示数据。不会清空数据库。\n\n如确认继续，请输入「${resetConfirmationText}」。`
        : `当前操作会重置本地浏览器里的演示数据。\n\n如确认继续，请输入「${resetConfirmationText}」。`
    );

    if (confirmation?.trim() !== resetConfirmationText) {
      showToast({ tone: "info", message: "未输入正确确认文字，已取消重置" });
      return;
    }

    if (masterDataSource === "database") {
      window.localStorage.removeItem(STORAGE_KEY);
      await refreshWarehouseState({ preserveSelection: false, notify: true });
      setActiveView("dashboard");
      setInboundSource("factory");
      setInboundQty("1");
      setInboundBarcodeInput("");
      setInboundBarcodes([]);
      setProductionDate("");
      setOutboundType("transfer");
      setOutboundBarcodeInput("");
      setOutboundBarcodes([]);
      setReturnBarcodeInput("");
      setReturnBarcodes([]);
      return;
    }

    const resetState = cloneInitialState(initialState);
    setState(resetState);
    setActiveView("dashboard");
    setInboundSource("factory");
    setInboundWarehouseId("wh-main");
    setInboundLocationId("loc-main-a1");
    setInboundGoodsId("goods-hj-001");
    setInboundQty("1");
    setInboundBarcodeInput("");
    setInboundBarcodes([]);
    setProductionDate("");
    setTerminalStoreId("store-001");
    setOutboundType("transfer");
    setSourceWarehouseId("wh-main");
    setTargetWarehouseId("wh-county-a");
    setTargetLocationId("loc-county-a1");
    setSalespersonId("sp-001");
    setOutboundBarcodeInput("");
    setOutboundBarcodes([]);
    setReturnWarehouseId("wh-main");
    setReturnLocationId("loc-main-a1");
    setReturnBarcodeInput("");
    setReturnBarcodes([]);
    setInventoryFilters({ keyword: "", warehouseId: "all", salespersonId: "all", goodsId: "all" });
    setSelectedBarcode("HJ202605290001");
    showToast({ tone: "info", message: "演示数据已重置" });
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
    if (duplicated) {
      showToast({ tone: "error", message: `条码 ${duplicated} 已存在` });
      return;
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
        inventoryItems: [...result.items, ...previous.inventoryItems],
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
      if (sourceWarehouse.type !== "main") {
        showToast({ tone: "error", message: "挪仓只能从总仓发起" });
        return;
      }
      if (!targetWarehouse || targetWarehouse.type !== "branch") {
        showToast({ tone: "error", message: "挪仓目标必须是分仓" });
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
        正在加载仓库原型...
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
    <main className="min-h-screen bg-slate-100">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <div className="mb-7 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-work text-white">
            <Warehouse className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">仓库货物管理</p>
            <p className="text-xs text-slate-500">页面原型</p>
          </div>
        </div>

        <nav className="space-y-1">
          {allowedNavItems.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.key;
            return (
              <button
                key={item.key}
                className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition ${
                  active ? "bg-emerald-50 text-work" : "text-slate-600 hover:bg-slate-50 hover:text-ink"
                }`}
                onClick={() => setActiveView(item.key)}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="absolute bottom-5 left-4 right-4 space-y-2">
          <Link href="/pda" className="secondary-button w-full">
            <Barcode className="h-4 w-4" />
            PDA 草图
          </Link>
          <button className="secondary-button w-full" onClick={resetDemoData}>
            <RotateCcw className="h-4 w-4" />
            重置页面数据
          </button>
        </div>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-5 py-4 backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold text-work">局域网仓库系统原型</p>
              <h1 className="text-2xl font-semibold text-ink">{titleForView(activeView)}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                当前用户：{currentUser?.displayName ?? "仓库操作员"}
              </span>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                角色：{currentUser?.roles.map((role) => roleLabels[role.code]).join("、") ?? "-"}
              </span>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-slate-600">
                数据来源：{masterDataSource === "database" ? "PostgreSQL" : "本地原型"}
              </span>
              <button
                className="secondary-button"
                onClick={() => void refreshWarehouseState({ preserveSelection: true, notify: true })}
                disabled={refreshing}
              >
                <RotateCcw className="h-4 w-4" />
                {refreshing ? "刷新中" : "刷新数据"}
              </button>
              <button className="secondary-button" onClick={resetDemoData}>
                <RotateCcw className="h-4 w-4" />
                重置页面
              </button>
              <button className="secondary-button" onClick={logout}>
                <LogOut className="h-4 w-4" />
                退出
              </button>
            </div>
          </div>
          <nav className="mt-4 grid grid-cols-3 gap-2 lg:hidden">
            {allowedNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  className={`flex h-10 items-center justify-center gap-2 rounded-md border px-2 text-xs font-semibold transition ${
                    active
                      ? "border-emerald-200 bg-emerald-50 text-work"
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

        <div className="p-5">
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
              inboundLocationId={inboundLocationId}
              setInboundLocationId={setInboundLocationId}
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
              targetLocationId={targetLocationId}
              setTargetLocationId={setTargetLocationId}
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
              returnLocationId={returnLocationId}
              setReturnLocationId={setReturnLocationId}
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
    <main className="grid min-h-screen grid-cols-1 bg-slate-100 lg:grid-cols-[1fr_440px]">
      <section className="hidden items-center justify-center bg-slate-900 p-10 text-white lg:flex">
        <div className="max-w-2xl">
          <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-lg bg-emerald-500">
            <Warehouse className="h-8 w-8" />
          </div>
          <h1 className="text-4xl font-semibold">仓库货物管理软件</h1>
          <p className="mt-4 max-w-xl text-lg leading-8 text-slate-300">
            以单件条码为核心，模拟总仓、分仓和销售人员名下货物的入库、出库、退回与库存流转。
          </p>
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
            <p className="text-xs font-semibold text-work">页面原型登录</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">进入演示系统</h2>
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
  const recentMovements = state.movements.slice(0, 6);
  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="仓库在库条码" value={stats.inStock} icon={Boxes} />
        <MetricCard label="总仓库存" value={stats.mainCount} icon={Warehouse} />
        <MetricCard label="分仓库存" value={stats.branchCount} icon={Building2} />
        <MetricCard label="销售人员名下" value={stats.withSales} icon={Users} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.3fr_0.7fr]">
        <section className="panel overflow-hidden">
          <SectionHeader icon={ClipboardList} title="最近库存流转" />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
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
                    <td className="table-cell font-semibold">{formatMovementType(movement.type)}</td>
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
          </div>
        </section>

        <section className="panel p-4">
          <SectionHeader icon={PackageCheck} title="常用操作" compact />
          <div className="grid gap-3">
            {canOperateWarehouse ? (
              <>
                <button className="secondary-button justify-start" onClick={() => setActiveView("inbound")}>
                  <Truck className="h-4 w-4" />
                  厂家到货或终端退换货入库
                </button>
                <button className="secondary-button justify-start" onClick={() => setActiveView("outbound")}>
                  <ArrowLeftRight className="h-4 w-4" />
                  挪仓或销售出库
                </button>
                <button className="secondary-button justify-start" onClick={() => setActiveView("return")}>
                  <Undo2 className="h-4 w-4" />
                  销售人员未售完退回
                </button>
              </>
            ) : null}
            <button className="secondary-button justify-start" onClick={() => setActiveView("inventory")}>
              <Search className="h-4 w-4" />
              查询库存与条码流转
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function MetricCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Home }) {
  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-600">{label}</p>
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-100 text-work">
          <Icon className="h-5 w-5" />
        </div>
      </div>
      <p className="mt-4 text-3xl font-semibold text-ink">{value}</p>
    </section>
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

  async function requestApi<T>(path: string, body: unknown): Promise<T> {
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

  return (
    <div className="grid gap-5">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
        基础资料来源：{masterDataSource === "database" ? "PostgreSQL 数据库" : "本地原型数据"}
      </div>
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
        headers={["编码", "名称", "大类", "规格", "状态"]}
        rows={state.goods.map((item) => [
          item.code,
          item.name,
          formatCategory(item.category),
          item.spec,
          item.status === "enabled" ? "启用" : "停用"
        ])}
      />
      <MasterTable
        title="仓库资料"
        icon={Warehouse}
        headers={["编码", "名称", "类型", "负责人", "状态"]}
        rows={state.warehouses.map((item) => [
          item.code,
          item.name,
          item.type === "main" ? "总仓" : "分仓",
          item.manager,
          item.status === "enabled" ? "启用" : "停用"
        ])}
      />
      <MasterTable
        title="销售人员"
        icon={Users}
        headers={["编码", "姓名", "手机号", "区域", "状态"]}
        rows={state.salespeople.map((item) => [
          item.code,
          item.name,
          item.phone,
          item.region,
          item.status === "enabled" ? "启用" : "停用"
        ])}
      />
      <MasterTable
        title="终端店铺"
        icon={Building2}
        headers={["店铺", "联系人", "电话", "地址"]}
        rows={state.terminalStores.map((item) => [item.name, item.contact, item.phone, item.address])}
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
  rows: string[][];
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
            {rows.map((row) => (
              <tr key={row.join("-")} className="hover:bg-slate-50">
                {row.map((cell, index) => (
                  <td className="table-cell" key={`${row[0]}-${cell}-${index}`}>
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

function InboundView(props: {
  state: WarehouseState;
  inboundSource: InboundSource;
  setInboundSource: (value: InboundSource) => void;
  inboundWarehouseId: string;
  setInboundWarehouseId: (value: string) => void;
  inboundLocationId: string;
  setInboundLocationId: (value: string) => void;
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
  const inboundLocations = enabledLocationsForWarehouse(props.inboundWarehouseId, props.state.locations);
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
            options={props.state.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
          />
          <FieldSelect
            label="库位"
            value={props.inboundLocationId}
            onChange={props.setInboundLocationId}
            options={inboundLocations.map((location) => ({ value: location.id, label: location.name }))}
          />
          <FieldSelect
            label="货物"
            value={props.inboundGoodsId}
            onChange={props.setInboundGoodsId}
            options={props.state.goods.map((goods) => ({
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
                options={props.state.terminalStores.map((store) => ({ value: store.id, label: store.name }))}
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
  targetLocationId: string;
  setTargetLocationId: (value: string) => void;
  salespersonId: string;
  setSalespersonId: (value: string) => void;
  outboundBarcodeInput: string;
  setOutboundBarcodeInput: (value: string) => void;
  outboundBarcodes: string[];
  setOutboundBarcodes: (value: string[]) => void;
  addBarcode: (input: string) => void;
  submitOutbound: () => void;
}) {
  const branchWarehouses = props.state.warehouses.filter((warehouse) => warehouse.type === "branch");
  const targetLocations = enabledLocationsForWarehouse(props.targetWarehouseId, props.state.locations);
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
            options={props.state.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
          />
          {props.outboundType === "transfer" ? (
            <>
              <FieldSelect
                label="目标分仓"
                value={props.targetWarehouseId}
                onChange={props.setTargetWarehouseId}
                options={branchWarehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
              />
              <FieldSelect
                label="目标库位"
                value={props.targetLocationId}
                onChange={props.setTargetLocationId}
                options={targetLocations.map((location) => ({ value: location.id, label: location.name }))}
              />
            </>
          ) : (
            <FieldSelect
              label="销售人员"
              value={props.salespersonId}
              onChange={props.setSalespersonId}
              options={props.state.salespeople.map((person) => ({
                value: person.id,
                label: `${person.name} / ${person.region}`
              }))}
            />
          )}
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          {props.outboundType === "transfer"
            ? "挪仓规则：只能从总仓转移到分仓，提交后直接进入目标分仓库存。"
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
  returnLocationId: string;
  setReturnLocationId: (value: string) => void;
  returnBarcodeInput: string;
  setReturnBarcodeInput: (value: string) => void;
  returnBarcodes: string[];
  setReturnBarcodes: (value: string[]) => void;
  addBarcode: (input: string) => void;
  submitSalesReturn: () => void;
}) {
  const returnLocations = enabledLocationsForWarehouse(props.returnWarehouseId, props.state.locations);
  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <section className="panel p-5">
        <SectionHeader icon={Undo2} title="销售退回设置" compact />
        <div className="grid gap-4 md:grid-cols-2">
          <FieldSelect
            label="回流仓库"
            value={props.returnWarehouseId}
            onChange={props.setReturnWarehouseId}
            options={props.state.warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
          />
          <FieldSelect
            label="回流库位"
            value={props.returnLocationId}
            onChange={props.setReturnLocationId}
            options={returnLocations.map((location) => ({ value: location.id, label: location.name }))}
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

  useEffect(() => {
    getJson<OperationLog[]>("/api/operation-logs")
      .then(setLogs)
      .catch(() => undefined);
  }, []);

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
    <div className="grid gap-5 xl:grid-cols-[0.8fr_1.2fr]">
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
  return (
    <div className="grid gap-5 2xl:grid-cols-[1.4fr_0.6fr]">
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <SectionHeader icon={Search} title="库存查询" compact />
            <button className="secondary-button" onClick={props.refreshData} disabled={props.refreshing}>
              <RotateCcw className="h-4 w-4" />
              {props.refreshing ? "刷新中" : "刷新数据库库存"}
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
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
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead className="table-head">
              <tr>
                <th className="px-4 py-3">条码</th>
                <th className="px-4 py-3">货物</th>
                <th className="px-4 py-3">大类</th>
                <th className="px-4 py-3">当前归属</th>
                <th className="px-4 py-3">生产日期</th>
                <th className="px-4 py-3">保质期</th>
                <th className="px-4 py-3">状态</th>
              </tr>
            </thead>
            <tbody>
              {props.inventoryItems.map((item) => {
                const goods = props.state.goods.find((entry) => entry.id === item.goodsId);
                return (
                  <tr
                    key={item.id}
                    className={`cursor-pointer hover:bg-slate-50 ${
                      props.selectedBarcode === item.barcode ? "bg-emerald-50" : ""
                    }`}
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
                  </tr>
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

      <section className="panel p-4">
        <SectionHeader icon={ClipboardList} title="条码流转详情" compact />
        {props.selectedItem ? (
          <div className="mt-3 space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="font-mono font-semibold text-work">{props.selectedItem.barcode}</p>
              <p className="mt-2 text-slate-700">
                {goodsLabel(props.selectedItem.goodsId, props.state.goods)}
              </p>
              <p className="mt-1 text-slate-600">
                当前归属：
                {ownerLabel(
                  props.selectedItem,
                  props.state.warehouses,
                  props.state.salespeople,
                  props.state.locations
                )}
              </p>
            </div>
            <div className="space-y-3">
              {props.selectedMovements.map((movement) => (
                <div key={movement.id} className="border-l-2 border-work pl-3">
                  <p className="text-sm font-semibold text-ink">{formatMovementType(movement.type)}</p>
                  <p className="text-xs text-slate-500">{movement.occurredAt}</p>
                  <p className="mt-1 text-sm text-slate-700">
                    {movement.fromLabel} → {movement.toLabel}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{movement.note}</p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
            从左侧库存表选择一个条码查看流转。
          </p>
        )}
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
