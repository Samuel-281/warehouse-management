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
  PackageCheck,
  RotateCcw,
  Search,
  Truck,
  Undo2,
  Users,
  Warehouse
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { initialState } from "@/lib/demo-data";
import type {
  InboundSource,
  InventoryItem,
  OutboundType,
  StockMovement,
  Toast,
  WarehouseState
} from "@/lib/types";
import {
  addYears,
  cloneInitialState,
  enabledLocationsForWarehouse,
  formatCategory,
  formatMovementType,
  goodsLabel,
  makeId,
  nowText,
  ownerLabel,
  STORAGE_KEY,
  uniqueBarcodes,
  warehouseLabel
} from "@/lib/warehouse-utils";

type ViewKey = "dashboard" | "masters" | "inbound" | "outbound" | "return" | "inventory";

const navItems: Array<{ key: ViewKey; label: string; icon: typeof Home }> = [
  { key: "dashboard", label: "首页", icon: Home },
  { key: "masters", label: "基础资料", icon: Building2 },
  { key: "inbound", label: "入库", icon: Truck },
  { key: "outbound", label: "出库", icon: ArrowLeftRight },
  { key: "return", label: "销售退回", icon: Undo2 },
  { key: "inventory", label: "库存查询", icon: Search }
];

const operator = "仓库操作员";

export default function WarehousePrototype() {
  const [hydrated, setHydrated] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [state, setState] = useState<WarehouseState>(() => cloneInitialState(initialState));
  const [toast, setToast] = useState<Toast | null>(null);
  const [selectedBarcode, setSelectedBarcode] = useState("HJ202605290001");

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
    if (hydrated) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [hydrated, state]);

  useEffect(() => {
    if (!hydrated) return;

    const params = new URLSearchParams(window.location.search);
    const targetBranchId = params.get("bulkMoveMainToBranch");
    if (!targetBranchId) return;

    const targetWarehouse = state.warehouses.find(
      (warehouse) => warehouse.id === targetBranchId && warehouse.type === "branch"
    );
    const targetLocation = state.locations.find(
      (location) => location.warehouseId === targetBranchId && location.status === "enabled"
    );

    if (!targetWarehouse || !targetLocation) {
      showToast({ tone: "error", message: "批量挪仓失败：目标分仓或库位无效" });
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    const itemsToMove = state.inventoryItems.filter(
      (item) => item.ownerType === "warehouse" && item.warehouseId === "wh-main"
    );

    if (itemsToMove.length === 0) {
      setActiveView("inventory");
      showToast({ tone: "info", message: "总仓当前没有可挪仓的在库货物" });
      window.history.replaceState(null, "", window.location.pathname);
      return;
    }

    const time = nowText();
    const targetLabel = warehouseLabel(targetBranchId, state.warehouses, targetLocation.id, state.locations);
    const movedBarcodes = new Set(itemsToMove.map((item) => item.barcode));

    const nextItems: InventoryItem[] = state.inventoryItems.map((item) => {
      if (!movedBarcodes.has(item.barcode)) return item;
      return {
        ...item,
        ownerType: "warehouse",
        warehouseId: targetBranchId,
        locationId: targetLocation.id,
        salespersonId: undefined,
        status: "in_stock",
        lastMovedAt: time
      };
    });

    const nextMovements: StockMovement[] = itemsToMove.map((item) => ({
      id: makeId("mv"),
      itemId: item.id,
      barcode: item.barcode,
      goodsId: item.goodsId,
      type: "transfer",
      fromLabel: warehouseLabel(item.warehouseId, state.warehouses, item.locationId, state.locations),
      toLabel: targetLabel,
      operator,
      occurredAt: time,
      note: "批量挪仓到分仓"
    }));

    setState((previous) => ({
      ...previous,
      inventoryItems: nextItems,
      movements: [...nextMovements, ...previous.movements]
    }));
    setActiveView("inventory");
    setInventoryFilters({ keyword: "", warehouseId: targetBranchId, salespersonId: "all", goodsId: "all" });
    setSelectedBarcode(itemsToMove[0].barcode);
    showToast({ tone: "success", message: `已将总仓 ${itemsToMove.length} 件货物批量挪到${targetWarehouse.name}` });
    window.history.replaceState(null, "", window.location.pathname);
  }, [hydrated, state.inventoryItems, state.locations, state.warehouses]);

  useEffect(() => {
    const firstLocation = enabledLocationsForWarehouse(inboundWarehouseId, state.locations)[0];
    if (firstLocation) setInboundLocationId(firstLocation.id);
  }, [inboundWarehouseId, state.locations]);

  useEffect(() => {
    const firstLocation = enabledLocationsForWarehouse(targetWarehouseId, state.locations)[0];
    if (firstLocation) setTargetLocationId(firstLocation.id);
  }, [targetWarehouseId, state.locations]);

  useEffect(() => {
    const firstLocation = enabledLocationsForWarehouse(returnWarehouseId, state.locations)[0];
    if (firstLocation) setReturnLocationId(firstLocation.id);
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
    const mainCount = inStock.filter((item) => item.warehouseId === "wh-main").length;
    const branchCount = inStock.filter((item) => item.warehouseId && item.warehouseId !== "wh-main").length;
    return { inStock: inStock.length, withSales: withSales.length, mainCount, branchCount };
  }, [state.inventoryItems]);

  function showToast(nextToast: Toast) {
    setToast(nextToast);
    window.setTimeout(() => setToast(null), 3200);
  }

  function resetDemoData() {
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

  function submitInbound() {
    const qty = Number(inboundQty);
    const barcodes = uniqueBarcodes(inboundBarcodes);
    const goods = state.goods.find((item) => item.id === inboundGoodsId);
    const warehouse = state.warehouses.find((item) => item.id === inboundWarehouseId);

    if (!goods || !warehouse) {
      showToast({ tone: "error", message: "请选择有效的货物和仓库" });
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

    const time = nowText();
    const shelfLifeDate =
      inboundSource === "terminal_return" && goods.category === "health_wine"
        ? addYears(productionDate, 3)
        : undefined;
    const fromLabel =
      inboundSource === "terminal_return"
        ? state.terminalStores.find((store) => store.id === terminalStoreId)?.name ?? "终端店铺"
        : "无库存";
    const toLabel = warehouseLabel(inboundWarehouseId, state.warehouses, inboundLocationId, state.locations);

    const newItems: InventoryItem[] = barcodes.map((barcode) => {
      const itemId = makeId("item");
      return {
        id: itemId,
        barcode,
        goodsId: goods.id,
        ownerType: "warehouse",
        warehouseId: inboundWarehouseId,
        locationId: inboundLocationId,
        status: "in_stock",
        productionDate: inboundSource === "terminal_return" ? productionDate : undefined,
        shelfLifeDate,
        inboundSource,
        lastMovedAt: time
      };
    });

    const newMovements: StockMovement[] = newItems.map((item) => ({
      id: makeId("mv"),
      itemId: item.id,
      barcode: item.barcode,
      goodsId: goods.id,
      type: inboundSource === "factory" ? "factory_inbound" : "terminal_return_inbound",
      fromLabel,
      toLabel,
      operator,
      occurredAt: time,
      note:
        inboundSource === "factory"
          ? "厂家到货入库"
          : `终端店铺退换货入库，生产日期 ${productionDate}`
    }));

    setState((previous) => ({
      ...previous,
      inventoryItems: [...previous.inventoryItems, ...newItems],
      movements: [...newMovements, ...previous.movements]
    }));
    setInboundBarcodes([]);
    setInboundQty("1");
    setProductionDate("");
    setSelectedBarcode(newItems[0]?.barcode ?? selectedBarcode);
    showToast({ tone: "success", message: "入库已模拟提交，库存已更新" });
  }

  function submitOutbound() {
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

    const time = nowText();
    const nextMovements: StockMovement[] = [];
    const nextItems: InventoryItem[] = state.inventoryItems.map((item) => {
      if (!barcodes.includes(item.barcode)) return item;

      const fromLabel = warehouseLabel(item.warehouseId, state.warehouses, item.locationId, state.locations);
      const nextItem: InventoryItem =
        outboundType === "transfer"
          ? {
              ...item,
              warehouseId: targetWarehouseId,
              locationId: targetLocationId,
              salespersonId: undefined,
              ownerType: "warehouse",
              status: "in_stock",
              lastMovedAt: time
            }
          : {
              ...item,
              warehouseId: undefined,
              locationId: undefined,
              salespersonId,
              ownerType: "salesperson",
              status: "with_salesperson",
              lastMovedAt: time
            };
      const toLabel =
        outboundType === "transfer"
          ? warehouseLabel(targetWarehouseId, state.warehouses, targetLocationId, state.locations)
          : `销售人员：${salesperson?.name ?? "未知"}`;

      nextMovements.push({
        id: makeId("mv"),
        itemId: item.id,
        barcode: item.barcode,
        goodsId: item.goodsId,
        type: outboundType === "transfer" ? "transfer" : "sales_outbound",
        fromLabel,
        toLabel,
        operator,
        occurredAt: time,
        note: outboundType === "transfer" ? "挪仓到分仓" : "销售出库"
      });

      return nextItem;
    });

    setState((previous) => ({
      ...previous,
      inventoryItems: nextItems,
      movements: [...nextMovements, ...previous.movements]
    }));
    setOutboundBarcodes([]);
    setSelectedBarcode(barcodes[0] ?? selectedBarcode);
    showToast({ tone: "success", message: outboundType === "transfer" ? "挪仓已模拟提交" : "销售出库已模拟提交" });
  }

  function submitSalesReturn() {
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

    const time = nowText();
    const nextMovements: StockMovement[] = [];
    const nextItems: InventoryItem[] = state.inventoryItems.map((item) => {
      if (!barcodes.includes(item.barcode)) return item;
      const fromLabel = ownerLabel(item, state.warehouses, state.salespeople, state.locations);
      const toLabel = warehouseLabel(returnWarehouseId, state.warehouses, returnLocationId, state.locations);

      nextMovements.push({
        id: makeId("mv"),
        itemId: item.id,
        barcode: item.barcode,
        goodsId: item.goodsId,
        type: "sales_return",
        fromLabel,
        toLabel,
        operator,
        occurredAt: time,
        note: "销售退回，仅将条码回流仓库"
      });

      return {
        ...item,
        ownerType: "warehouse",
        warehouseId: returnWarehouseId,
        locationId: returnLocationId,
        salespersonId: undefined,
        status: "in_stock",
        lastMovedAt: time
      };
    });

    setState((previous) => ({
      ...previous,
      inventoryItems: nextItems,
      movements: [...nextMovements, ...previous.movements]
    }));
    setReturnBarcodes([]);
    setSelectedBarcode(barcodes[0] ?? selectedBarcode);
    showToast({ tone: "success", message: "销售退回已模拟提交，未修改生产日期或保质期" });
  }

  if (!hydrated) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-100 text-slate-600">
        正在加载仓库原型...
      </main>
    );
  }

  if (!loggedIn) {
    return <LoginScreen onLogin={() => setLoggedIn(true)} />;
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
          {navItems.map((item) => {
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
            重置演示数据
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
                当前用户：仓库操作员
              </span>
              <button className="secondary-button" onClick={resetDemoData}>
                <RotateCcw className="h-4 w-4" />
                重置
              </button>
            </div>
          </div>
          <nav className="mt-4 grid grid-cols-3 gap-2 lg:hidden">
            {navItems.map((item) => {
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
            />
          ) : null}
          {activeView === "masters" ? <MastersView state={state} /> : null}
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
    inventory: "库存查询"
  };
  return titles[view];
}

function LoginScreen({ onLogin }: { onLogin: () => void }) {
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
          onSubmit={(event) => {
            event.preventDefault();
            onLogin();
          }}
        >
          <div className="mb-6">
            <p className="text-xs font-semibold text-work">页面原型登录</p>
            <h2 className="mt-1 text-2xl font-semibold text-ink">进入演示系统</h2>
          </div>
          <label className="label" htmlFor="username">
            账号
          </label>
          <input className="field mb-4" id="username" defaultValue="warehouse_operator" />
          <label className="label" htmlFor="password">
            密码
          </label>
          <input className="field mb-6" id="password" type="password" defaultValue="demo123456" />
          <button className="primary-button w-full" type="submit">
            <LogIn className="h-4 w-4" />
            登录
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
  setSelectedBarcode
}: {
  stats: { inStock: number; withSales: number; mainCount: number; branchCount: number };
  state: WarehouseState;
  setActiveView: (view: ViewKey) => void;
  setSelectedBarcode: (barcode: string) => void;
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

function MastersView({ state }: { state: WarehouseState }) {
  return (
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

function InventoryView(props: {
  state: WarehouseState;
  filters: { keyword: string; warehouseId: string; salespersonId: string; goodsId: string };
  setFilters: (value: { keyword: string; warehouseId: string; salespersonId: string; goodsId: string }) => void;
  inventoryItems: InventoryItem[];
  selectedBarcode: string;
  setSelectedBarcode: (barcode: string) => void;
  selectedItem?: InventoryItem;
  selectedMovements: StockMovement[];
}) {
  return (
    <div className="grid gap-5 2xl:grid-cols-[1.4fr_0.6fr]">
      <section className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-4">
          <SectionHeader icon={Search} title="库存查询" compact />
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
