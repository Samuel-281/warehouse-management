"use client";

import {
  ArrowRight,
  Barcode,
  Building2,
  ClipboardList,
  ClipboardCheck,
  Eye,
  Home,
  KeyRound,
  Layers3,
  LogOut,
  PackageCheck,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Truck,
  UserRound,
  Users,
  Warehouse,
  X
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

import { BarcodeCollector, type BarcodeReview } from "@/components/warehouse/BarcodeCollector";
import { EmptyState, PaginationBar, SectionHeader } from "@/components/warehouse/CommonUi";
import { ResultDialogBox, ToastBox, type ResultDialog } from "@/components/warehouse/FeedbackDialogs";
import { TerminalReceiptView } from "@/components/warehouse/TerminalReceiptView";
import { TrackingReviewView } from "@/components/tracking/TrackingReviewView";
import { TrackedBarcodeAdminActions, TrackingBusinessAdminActions } from "@/components/tracking/TrackingGovernanceActions";
import { ProductCategoryManager } from "@/components/tracking/ProductCategoryManager";
import {
  ClientApiError,
  apiErrorMessage,
  deleteJson,
  getJson,
  patchJson,
  postJson
} from "@/lib/client-api";
import { hasAnyRole } from "@/lib/role-utils";
import type {
  CurrentUser,
  Salesperson,
  Toast,
  TrackedBarcode,
  TrackingBarcodeDetail,
  TrackingBarcodeListResult,
  TrackingMovement,
  TrackingOrderBarcodeDetail,
  TrackingOrderDetail,
  TrackingOrderFeedResult,
  TrackingOrderGroupDetail,
  TrackingOrderGroupSummary,
  TrackingOrderSummary,
  TrackingOrderType,
  TrackingReceiptStatus,
  TrackingSummary,
  TerminalReceiptSyncRun,
  Warehouse as WarehouseRecord,
  WarehouseState
} from "@/lib/types";
import { apiContractVersion, webVersion } from "@/lib/version";
import { uniqueBarcodes } from "@/lib/warehouse-utils";

type ViewKey = "dashboard" | "outbound" | "return" | "review" | "query" | "masters" | "system";
type QueryTab = "barcodes" | "orders" | "receipts";
type DestinationType = "salesperson" | "warehouse";
type ValidationResult = {
  barcode: string;
  ok: boolean;
  label: string;
  detail: string;
  item?: TrackedBarcode;
};
type ReviewMap = Record<string, BarcodeReview>;

const emptyState: WarehouseState = {
  goods: [],
  warehouses: [],
  locations: [],
  salespeople: [],
  terminalStores: [],
  warehouseStocks: [],
  inventoryItems: [],
  movements: []
};

const emptySummary: TrackingSummary = {
  total: 0,
  pending: 0,
  signed: 0,
  exceptions: 0,
  inWarehouses: 0,
  withSalespeople: 0,
  atTerminalStores: 0,
  recentMovements: []
};

const navItems = [
  { key: "dashboard" as const, label: "首页", icon: Home },
  { key: "outbound" as const, label: "快速出库", icon: ScanLine },
  { key: "return" as const, label: "扫码回库", icon: RotateCcw },
  { key: "review" as const, label: "出库复核", icon: ClipboardCheck },
  { key: "query" as const, label: "条码查询", icon: Search },
  { key: "masters" as const, label: "基础资料", icon: Building2 },
  { key: "system" as const, label: "系统维护", icon: ShieldCheck }
];

export function TraceabilityWorkspace({
  currentUser,
  onLogout,
  renderSystemMaintenance
}: {
  currentUser: CurrentUser;
  onLogout: () => void | Promise<void>;
  renderSystemMaintenance: (showToast: (toast: Toast) => void) => ReactNode;
}) {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [masterData, setMasterData] = useState<WarehouseState>(emptyState);
  const [summary, setSummary] = useState<TrackingSummary>(emptySummary);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState<Toast | null>(null);
  const [resultDialog, setResultDialog] = useState<ResultDialog | null>(null);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const toastTimerRef = useRef<number | null>(null);

  const roleCodes = useMemo(() => currentUser.roles.map((role) => role.code), [currentUser.roles]);
  const canOperate = hasAnyRole(roleCodes, ["SUPER_ADMIN", "WAREHOUSE_ADMIN"]);
  const canMaintain = hasAnyRole(roleCodes, ["SUPER_ADMIN"]);
  const allowedNavItems = navItems.filter((item) => item.key !== "system" || canMaintain);

  const showToast = useCallback((nextToast: Toast) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(nextToast);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 4200);
  }, []);

  const showSystemToast = useCallback((nextToast: Toast) => {
    setToast(nextToast);
    window.setTimeout(() => {
      setToast((current) => current === nextToast ? null : current);
    }, 4200);
  }, []);

  const loadWorkspace = useCallback(async (notify = false) => {
    setLoading(true);
    setLoadError("");
    try {
      const [masters, nextSummary] = await Promise.all([
        getJson<WarehouseState>("/api/master-data"),
        getJson<TrackingSummary>("/api/tracking/summary")
      ]);
      setMasterData(masters);
      setSummary(nextSummary);
      if (notify) showToast({ tone: "success", message: "数据已刷新" });
    } catch (error) {
      setLoadError(apiErrorMessage(error, "读取条码追踪数据失败"));
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void loadWorkspace();
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, [loadWorkspace]);

  const pageTitle = navItems.find((item) => item.key === activeView)?.label ?? "首页";

  return (
    <main className="min-h-screen bg-[#f4f6f9] text-ink">
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-64 border-r border-slate-200 bg-white lg:block">
        <div className="px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-work text-white">
              <Barcode className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-ink">箱码流向追踪系统</p>
              <p className="text-xs text-slate-500">扫码流转 + 勤策签收</p>
            </div>
          </div>
        </div>

        <nav className="border-t border-slate-200 px-3 py-3">
          <p className="mb-1 px-3 text-xs font-semibold text-slate-500">业务工作台</p>
          <div className="space-y-1">
            {allowedNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  className={`flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition ${
                    active ? "bg-emerald-50 text-work" : "text-slate-600 hover:bg-slate-100 hover:text-ink"
                  }`}
                  onClick={() => setActiveView(item.key)}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </nav>

        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-200 p-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand text-sm font-bold text-white">
                {currentUser.displayName.slice(0, 1)}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{currentUser.displayName}</p>
                <p className="truncate text-xs text-slate-500">{currentUser.roles.map((role) => role.name).join("、")}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button className="secondary-button justify-center px-2" onClick={() => setChangePasswordOpen(true)}>
                <KeyRound className="h-4 w-4" />
                修改密码
              </button>
              <button className="secondary-button justify-center px-2" onClick={() => void onLogout()}>
                <LogOut className="h-4 w-4" />
                退出登录
              </button>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-400">Web v{webVersion} · API v{apiContractVersion}</p>
          </div>
        </div>
      </aside>

      <section className="lg:pl-64">
        <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:px-6">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-muted">条码流向工作台</p>
              <h1 className="mt-0.5 text-xl font-semibold text-ink">{pageTitle}</h1>
            </div>
            <button
              className="icon-button"
              onClick={() => void loadWorkspace(true)}
              disabled={loading}
              aria-label="刷新数据"
              title="刷新数据"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <nav className="mt-3 grid grid-cols-3 gap-2 lg:hidden">
            {allowedNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeView === item.key;
              return (
                <button
                  key={item.key}
                  className={`flex h-10 items-center justify-center gap-2 rounded-md border px-2 text-xs font-semibold ${
                    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-600"
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

          {loading && activeView === "dashboard" ? (
            <LoadingPanel />
          ) : loadError ? (
            <ErrorPanel message={loadError} retry={() => void loadWorkspace()} />
          ) : (
            <>
              {activeView === "dashboard" ? (
                <TrackingDashboard
                  summary={summary}
                  canSync={canOperate}
                  setActiveView={setActiveView}
                  showToast={showToast}
                  refresh={loadWorkspace}
                />
              ) : null}
              {activeView === "outbound" ? (
                <TrackingOutboundView
                  warehouses={masterData.warehouses}
                  salespeople={masterData.salespeople}
                  canOperate={canOperate}
                  showToast={showToast}
                  showResult={setResultDialog}
                  onCompleted={() => void loadWorkspace()}
                />
              ) : null}
              {activeView === "return" ? (
                <TrackingReturnView
                  warehouses={masterData.warehouses}
                  canOperate={canOperate}
                  showToast={showToast}
                  showResult={setResultDialog}
                  onCompleted={() => void loadWorkspace()}
                />
              ) : null}
              {activeView === "review" ? (
                <TrackingReviewView
                  canReview={canOperate}
                  canRevise={canMaintain}
                  warehouses={masterData.warehouses}
                  salespeople={masterData.salespeople}
                  showToast={showToast}
                />
              ) : null}
              {activeView === "query" ? (
                <TrackingQueryView
                  warehouses={masterData.warehouses}
                  salespeople={masterData.salespeople}
                  canImport={canOperate}
                  canMaintain={canMaintain}
                  showToast={showToast}
                />
              ) : null}
              {activeView === "masters" ? (
                <TrackingMastersView
                  state={masterData}
                  canEdit={canOperate}
                  canDelete={canMaintain}
                  showToast={showToast}
                  reload={() => loadWorkspace()}
                />
              ) : null}
              {activeView === "system" && canMaintain ? renderSystemMaintenance(showSystemToast) : null}
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function TrackingDashboard({
  summary,
  canSync,
  setActiveView,
  showToast,
  refresh
}: {
  summary: TrackingSummary;
  canSync: boolean;
  setActiveView: (view: ViewKey) => void;
  showToast: (toast: Toast) => void;
  refresh: () => Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);
  const syncRunning = summary.latestSync?.status === "running";
  const metrics = [
    { label: "追踪条码", value: summary.total, detail: "系统内全部有效箱码", tone: "text-ink" },
    { label: "待签收", value: summary.pending, detail: "已出库，等待勤策签收", tone: "text-amber-700" },
    { label: "已签收", value: summary.signed, detail: "勤策已反馈签收店铺", tone: "text-work" },
    { label: "签收异常", value: summary.exceptions, detail: "商品冲突或流向需核对", tone: "text-danger" }
  ];

  async function startReceiptSync() {
    setSyncing(true);
    try {
      const run = await postJson<TerminalReceiptSyncRun>("/api/terminal-receipts/sync", {});
      showToast({
        tone: "success",
        message: `同步任务已创建，将获取 ${run.exportStartDate} 至 ${run.exportEndDate} 的勤策签收记录`
      });
      await refresh();
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "启动签收同步失败") });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <div className="bg-white p-4" key={metric.label}>
            <p className="text-xs font-semibold text-slate-500">{metric.label}</p>
            <p className={`mt-2 text-3xl font-semibold ${metric.tone}`}>{metric.value}</p>
            <p className="mt-1 text-xs text-muted">{metric.detail}</p>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,0.6fr)]">
        <div className="panel overflow-hidden">
          <SectionHeader icon={ClipboardList} title="最近条码流转" />
          {summary.recentMovements.length === 0 ? (
            <div className="p-4"><EmptyState icon={Barcode} title="暂无流转记录" detail="完成扫码出库或扫码回库后，最近流转会显示在这里。" /></div>
          ) : (
            <div className="divide-y divide-slate-200">
              {summary.recentMovements.map((movement) => (
                <div className="grid gap-2 px-4 py-3 text-sm sm:grid-cols-[160px_1fr_auto] sm:items-center" key={movement.id}>
                  <div>
                    <p className="font-mono font-semibold text-slate-700">{movement.barcode}</p>
                    <p className="mt-0.5 text-xs text-muted">{movement.occurredAt}</p>
                  </div>
                  <p className="min-w-0 truncate text-slate-600">{movement.fromLabel} <ArrowRight className="mx-1 inline h-3.5 w-3.5" /> {movement.toLabel}</p>
                  <ReceiptBadge status={movement.type === "qince_receipt" ? "signed" : "pending"} />
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <section className="panel p-4">
            <h2 className="text-sm font-semibold text-ink">当前归属</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <SummaryRow label="仓库" value={summary.inWarehouses} />
              <SummaryRow label="销售人员" value={summary.withSalespeople} />
              <SummaryRow label="终端店铺" value={summary.atTerminalStores} />
            </dl>
          </section>
          <section className="panel p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-ink">勤策同步</h2>
              {syncRunning ? <span className="status-badge bg-sky-50 text-sky-700">等待连接器</span> : null}
            </div>
            {summary.latestSync ? (
              <div className="mt-3 text-sm text-slate-600">
                <p className="font-semibold text-slate-700">{syncStatusLabel(summary.latestSync.status)}</p>
                <p className="mt-1 text-xs text-muted">{summary.latestSync.startedAt}</p>
                <p className="mt-2 text-xs">已导入 {summary.latestSync.importedRows} 条，异常 {summary.latestSync.conflictRows} 条</p>
              </div>
            ) : <p className="mt-3 text-sm text-muted">尚无同步记录</p>}
            {canSync ? (
              <button
                className="primary-button mt-4 w-full justify-center"
                disabled={syncing || syncRunning}
                onClick={() => void startReceiptSync()}
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? "animate-spin" : ""}`} />
                {syncing ? "正在创建任务" : syncRunning ? "同步任务进行中" : "立即同步签收"}
              </button>
            ) : null}
          </section>
          <div className="grid grid-cols-2 gap-2">
            <button className="primary-button justify-center" onClick={() => setActiveView("outbound")}><ScanLine className="h-4 w-4" />快速出库</button>
            <button className="secondary-button justify-center" onClick={() => setActiveView("return")}><RotateCcw className="h-4 w-4" />扫码回库</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function TrackingOutboundView({
  warehouses,
  salespeople,
  canOperate,
  showToast,
  showResult,
  onCompleted
}: {
  warehouses: WarehouseRecord[];
  salespeople: Salesperson[];
  canOperate: boolean;
  showToast: (toast: Toast) => void;
  showResult: (dialog: ResultDialog) => void;
  onCompleted: () => void;
}) {
  const enabledWarehouses = warehouses.filter((item) => item.status === "enabled");
  const enabledSalespeople = salespeople.filter((item) => item.status === "enabled");
  const [sourceWarehouseId, setSourceWarehouseId] = useState(enabledWarehouses[0]?.id ?? "");
  const [destinationType, setDestinationType] = useState<DestinationType>("salesperson");
  const [salespersonId, setSalespersonId] = useState(enabledSalespeople[0]?.id ?? "");
  const [targetWarehouseId, setTargetWarehouseId] = useState("");
  const [input, setInput] = useState("");
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [reviews, setReviews] = useState<ReviewMap>({});
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const validationRequestRef = useRef(0);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabledWarehouses.some((item) => item.id === sourceWarehouseId)) setSourceWarehouseId(enabledWarehouses[0]?.id ?? "");
    if (!enabledSalespeople.some((item) => item.id === salespersonId)) setSalespersonId(enabledSalespeople[0]?.id ?? "");
  }, [enabledSalespeople, enabledWarehouses, salespersonId, sourceWarehouseId]);

  useEffect(() => {
    const nextTarget = enabledWarehouses.find((item) => item.id !== sourceWarehouseId);
    if (!targetWarehouseId || targetWarehouseId === sourceWarehouseId) setTargetWarehouseId(nextTarget?.id ?? "");
  }, [enabledWarehouses, sourceWarehouseId, targetWarehouseId]);

  const validate = useCallback(async (nextBarcodes: string[]) => {
    const requestNumber = validationRequestRef.current + 1;
    validationRequestRef.current = requestNumber;
    if (nextBarcodes.length === 0) {
      setReviews({});
      return;
    }
    setValidating(true);
    try {
      const results = await postJson<ValidationResult[]>("/api/tracking/validate", {
        mode: "outbound",
        sourceWarehouseId,
        barcodes: nextBarcodes
      });
      if (requestNumber === validationRequestRef.current) setReviews(toReviewMap(results));
    } catch (error) {
      if (requestNumber === validationRequestRef.current) {
        setReviews(Object.fromEntries(nextBarcodes.map((barcode) => [barcode, { tone: "error", label: "校验失败", detail: apiErrorMessage(error, "条码校验失败") }] as const)));
      }
    } finally {
      if (requestNumber === validationRequestRef.current) setValidating(false);
    }
  }, [sourceWarehouseId]);

  useEffect(() => {
    void validate(barcodes);
  }, [barcodes, validate]);

  function add(inputValue: string) {
    const candidates = parseBarcodeInput(inputValue);
    if (candidates.length === 0) return;
    const next = uniqueBarcodes([...barcodes, ...candidates]).slice(0, 500);
    if (next.length === barcodes.length) showToast({ tone: "info", message: "条码已在当前清单中" });
    if (barcodes.length + candidates.length > 500) showToast({ tone: "error", message: "单次最多处理 500 个条码" });
    setBarcodes(next);
    setInput("");
    requestIdRef.current = null;
  }

  const invalidCount = barcodes.filter((barcode) => reviews[barcode]?.tone === "error").length;
  const canSubmit = canOperate && barcodes.length > 0 && !validating && invalidCount === 0 && sourceWarehouseId &&
    (destinationType === "salesperson" ? salespersonId : targetWarehouseId);

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    requestIdRef.current ??= createClientRequestId();
    try {
      const result = await postJson<{ orderNo: string; quantity: number }>("/api/tracking/outbound", {
        sourceWarehouseId,
        destinationType,
        salespersonId: destinationType === "salesperson" ? salespersonId : undefined,
        targetWarehouseId: destinationType === "warehouse" ? targetWarehouseId : undefined,
        barcodes,
        clientRequestId: requestIdRef.current
      });
      requestIdRef.current = null;
      setBarcodes([]);
      setInput("");
      setReviews({});
      showResult({ tone: "success", title: "扫码出库成功", message: `单号 ${result.orderNo}\n共记录 ${result.quantity} 个箱码流向。商品名称将在勤策签收后自动补充。` });
      onCompleted();
    } catch (error) {
      if (!isUncertainSubmission(error)) requestIdRef.current = null;
      showResult({
        tone: "error",
        title: isUncertainSubmission(error) ? "出库结果待确认" : "扫码出库失败",
        message: isUncertainSubmission(error)
          ? `${apiErrorMessage(error, "暂时无法确认结果")}。请保留当前清单并重试，系统不会重复记账。`
          : apiErrorMessage(error, "扫码出库失败")
      });
      if (error instanceof ClientApiError && error.status === 409) void validate(barcodes);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OperationLayout
      stepTitle="出库参数"
      form={
        <div className="space-y-4">
          <label className="block"><span className="label">来源仓库</span><select className="field" value={sourceWarehouseId} onChange={(event) => { setSourceWarehouseId(event.target.value); requestIdRef.current = null; }}>{enabledWarehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div>
            <span className="label">去向类型</span>
            <div className="grid grid-cols-2 gap-2 rounded-md bg-slate-100 p-1">
              <button className={segmentClass(destinationType === "salesperson")} onClick={() => { setDestinationType("salesperson"); requestIdRef.current = null; }}><UserRound className="h-4 w-4" />销售人员</button>
              <button className={segmentClass(destinationType === "warehouse")} onClick={() => { setDestinationType("warehouse"); requestIdRef.current = null; }}><Warehouse className="h-4 w-4" />仓库</button>
            </div>
          </div>
          {destinationType === "salesperson" ? (
            <label className="block"><span className="label">销售人员</span><select className="field" value={salespersonId} onChange={(event) => { setSalespersonId(event.target.value); requestIdRef.current = null; }}>{enabledSalespeople.map((item) => <option key={item.id} value={item.id}>{item.name} / {item.region}</option>)}</select></label>
          ) : (
            <label className="block"><span className="label">目标仓库</span><select className="field" value={targetWarehouseId} onChange={(event) => { setTargetWarehouseId(event.target.value); requestIdRef.current = null; }}>{enabledWarehouses.filter((item) => item.id !== sourceWarehouseId).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          )}
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-xs leading-5 text-sky-800">
            可连续扫描不同商品的箱码。此处只登记流向，不选择商品、不扣减本系统库存。
          </div>
        </div>
      }
      collector={
        <BarcodeCollector
          title="出库箱码"
          description="支持扫码枪连续录入，最多 500 个"
          input={input}
          setInput={setInput}
          barcodes={barcodes}
          setBarcodes={(next) => { setBarcodes(next); requestIdRef.current = null; }}
          onAdd={add}
          placeholder="扫描或输入箱码，按回车加入"
          reviewBarcode={(barcode) => reviews[barcode] ?? { tone: "neutral", label: validating ? "校验中" : "待校验" }}
        />
      }
      action={
        <SubmitBand
          title={validating ? "正在校验条码" : invalidCount > 0 ? `有 ${invalidCount} 个条码需要处理` : `可提交 ${barcodes.length} 个箱码`}
          detail="提交后只记录条码来源和去向，商品信息由勤策签收补全。"
          disabled={!canSubmit || submitting}
          busy={submitting}
          label="提交出库"
          icon={Truck}
          onClick={() => void submit()}
        />
      }
    />
  );
}

function TrackingReturnView({
  warehouses,
  canOperate,
  showToast,
  showResult,
  onCompleted
}: {
  warehouses: WarehouseRecord[];
  canOperate: boolean;
  showToast: (toast: Toast) => void;
  showResult: (dialog: ResultDialog) => void;
  onCompleted: () => void;
}) {
  const enabledWarehouses = warehouses.filter((item) => item.status === "enabled");
  const [returnWarehouseId, setReturnWarehouseId] = useState(enabledWarehouses[0]?.id ?? "");
  const [input, setInput] = useState("");
  const [barcodes, setBarcodes] = useState<string[]>([]);
  const [reviews, setReviews] = useState<ReviewMap>({});
  const [validating, setValidating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const validationRequestRef = useRef(0);
  const requestIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!enabledWarehouses.some((item) => item.id === returnWarehouseId)) setReturnWarehouseId(enabledWarehouses[0]?.id ?? "");
  }, [enabledWarehouses, returnWarehouseId]);

  const validate = useCallback(async (nextBarcodes: string[]) => {
    const requestNumber = validationRequestRef.current + 1;
    validationRequestRef.current = requestNumber;
    if (nextBarcodes.length === 0) {
      setReviews({});
      return;
    }
    setValidating(true);
    try {
      const results = await postJson<ValidationResult[]>("/api/tracking/validate", {
        mode: "return",
        returnWarehouseId,
        barcodes: nextBarcodes
      });
      if (requestNumber === validationRequestRef.current) setReviews(toReviewMap(results));
    } catch (error) {
      if (requestNumber === validationRequestRef.current) setReviews(Object.fromEntries(nextBarcodes.map((barcode) => [barcode, { tone: "error", label: "校验失败", detail: apiErrorMessage(error, "条码校验失败") }] as const)));
    } finally {
      if (requestNumber === validationRequestRef.current) setValidating(false);
    }
  }, [returnWarehouseId]);

  useEffect(() => { void validate(barcodes); }, [barcodes, validate]);

  function add(inputValue: string) {
    const candidates = parseBarcodeInput(inputValue);
    if (candidates.length === 0) return;
    const next = uniqueBarcodes([...barcodes, ...candidates]).slice(0, 500);
    if (next.length === barcodes.length) showToast({ tone: "info", message: "条码已在当前清单中" });
    if (barcodes.length + candidates.length > 500) showToast({ tone: "error", message: "单次最多处理 500 个条码" });
    setBarcodes(next);
    setInput("");
    requestIdRef.current = null;
  }

  const invalidCount = barcodes.filter((barcode) => reviews[barcode]?.tone === "error").length;
  const canSubmit = canOperate && barcodes.length > 0 && !validating && invalidCount === 0 && returnWarehouseId;

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    requestIdRef.current ??= createClientRequestId();
    try {
      const result = await postJson<{ orderNo: string; quantity: number }>("/api/tracking/return", {
        returnWarehouseId,
        barcodes,
        clientRequestId: requestIdRef.current
      });
      requestIdRef.current = null;
      setBarcodes([]);
      setInput("");
      setReviews({});
      showResult({ tone: "success", title: "扫码回库成功", message: `单号 ${result.orderNo}\n共 ${result.quantity} 个箱码已回到所选仓库。` });
      onCompleted();
    } catch (error) {
      if (!isUncertainSubmission(error)) requestIdRef.current = null;
      showResult({ tone: "error", title: isUncertainSubmission(error) ? "回库结果待确认" : "扫码回库失败", message: isUncertainSubmission(error) ? `${apiErrorMessage(error, "暂时无法确认结果")}。请保留当前清单并重试，系统不会重复记账。` : apiErrorMessage(error, "扫码回库失败") });
      if (error instanceof ClientApiError && error.status === 409) void validate(barcodes);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <OperationLayout
      stepTitle="回库参数"
      form={
        <div className="space-y-4">
          <label className="block"><span className="label">回库仓库</span><select className="field" value={returnWarehouseId} onChange={(event) => { setReturnWarehouseId(event.target.value); requestIdRef.current = null; }}>{enabledWarehouses.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3 text-xs leading-5 text-sky-800">
            销售人员未售货物、终端店铺退货和外部回流统一从这里扫码。无需区分来源店铺，也无需填写商品或生产日期。
          </div>
        </div>
      }
      collector={
        <BarcodeCollector
          title="回库箱码"
          description="系统会按条码当前归属自动生成回库履历"
          input={input}
          setInput={setInput}
          barcodes={barcodes}
          setBarcodes={(next) => { setBarcodes(next); requestIdRef.current = null; }}
          onAdd={add}
          placeholder="扫描或输入回库箱码，按回车加入"
          reviewBarcode={(barcode) => reviews[barcode] ?? { tone: "neutral", label: validating ? "校验中" : "待校验" }}
        />
      }
      action={<SubmitBand title={validating ? "正在校验条码" : invalidCount > 0 ? `有 ${invalidCount} 个条码需要处理` : `可提交 ${barcodes.length} 个箱码`} detail="条码已在仓库时会拒绝重复回库。" disabled={!canSubmit || submitting} busy={submitting} label="提交回库" icon={PackageCheck} onClick={() => void submit()} />}
    />
  );
}

function TrackingQueryView({
  warehouses,
  salespeople,
  canImport,
  canMaintain,
  showToast
}: {
  warehouses: WarehouseRecord[];
  salespeople: Salesperson[];
  canImport: boolean;
  canMaintain: boolean;
  showToast: (toast: Toast) => void;
}) {
  const [tab, setTab] = useState<QueryTab>("barcodes");
  return (
    <div className="space-y-4">
      <section className="panel p-2">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1">
          <button className={segmentClass(tab === "barcodes")} onClick={() => setTab("barcodes")}>条码追踪</button>
          <button className={segmentClass(tab === "orders")} onClick={() => setTab("orders")}>流转单据</button>
          <button className={segmentClass(tab === "receipts")} onClick={() => setTab("receipts")}>勤策签收</button>
        </div>
      </section>
      {tab === "barcodes" ? <TrackedBarcodeTable warehouses={warehouses} salespeople={salespeople} canMaintain={canMaintain} showToast={showToast} /> : null}
      {tab === "orders" ? <TrackingOrdersTable warehouses={warehouses} salespeople={salespeople} canManageGroups={canImport} canMaintain={canMaintain} showToast={showToast} /> : null}
      {tab === "receipts" ? <TerminalReceiptView canImport={canImport} showToast={showToast} /> : null}
    </div>
  );
}

function TrackedBarcodeTable({ warehouses, salespeople, canMaintain, showToast }: { warehouses: WarehouseRecord[]; salespeople: Salesperson[]; canMaintain: boolean; showToast: (toast: Toast) => void }) {
  const [keyword, setKeyword] = useState("");
  const [trackingStatus, setTrackingStatus] = useState<"active" | "voided">("active");
  const [receiptStatus, setReceiptStatus] = useState<TrackingReceiptStatus | "all">("all");
  const [ownerType, setOwnerType] = useState<"all" | "warehouse" | "salesperson" | "terminal_store">("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TrackingBarcodeListResult>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<TrackingBarcodeDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async (nextPage: number) => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    try {
      const params = new URLSearchParams({ keyword: keyword.trim(), trackingStatus, receiptStatus, ownerType, page: String(nextPage), pageSize: "20" });
      const nextResult = await getJson<TrackingBarcodeListResult>(`/api/tracking?${params.toString()}`);
      if (requestId === requestRef.current) {
        setResult(nextResult);
        setPage(nextResult.page);
      }
    } catch (error) {
      if (requestId === requestRef.current) showToast({ tone: "error", message: apiErrorMessage(error, "读取条码列表失败") });
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [keyword, ownerType, receiptStatus, showToast, trackingStatus]);

  useEffect(() => { void load(1); }, [load]);

  async function openDetail(barcode: string) {
    setDetailLoading(true);
    try {
      setDetail(await getJson<TrackingBarcodeDetail>(`/api/tracking/${encodeURIComponent(barcode)}`));
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取条码详情失败") });
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4">
        <div className="grid gap-3 xl:grid-cols-[minmax(240px,1fr)_150px_160px_160px_auto] xl:items-end">
          <label><span className="label">条码、商品或签收店铺</span><input className="field" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="输入关键词" onKeyDown={(event) => { if (event.key === "Enter") void load(1); }} /></label>
          <label><span className="label">追踪状态</span><select className="field" value={trackingStatus} onChange={(event) => setTrackingStatus(event.target.value as typeof trackingStatus)}><option value="active">有效条码</option><option value="voided">已撤销条码</option></select></label>
          <label><span className="label">签收状态</span><select className="field" value={receiptStatus} onChange={(event) => setReceiptStatus(event.target.value as TrackingReceiptStatus | "all")}><option value="all">全部状态</option><option value="pending">待签收</option><option value="signed">已签收</option><option value="exception">签收异常</option></select></label>
          <label><span className="label">当前归属</span><select className="field" value={ownerType} onChange={(event) => setOwnerType(event.target.value as typeof ownerType)}><option value="all">全部归属</option><option value="warehouse">仓库</option><option value="salesperson">销售人员</option><option value="terminal_store">终端店铺</option></select></label>
          <button className="primary-button justify-center" onClick={() => void load(1)}><Search className="h-4 w-4" />查询</button>
        </div>
        <div className="mt-3 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
          <p className="rounded-md bg-amber-50 px-3 py-2"><strong className="text-amber-800">待签收：</strong>最近一次有效流转是销售出库，尚未收到之后的勤策签收。</p>
          <p className="rounded-md bg-emerald-50 px-3 py-2"><strong className="text-work">已签收：</strong>勤策签收时间能接上出库履历，商品信息也一致。</p>
          <p className="rounded-md bg-rose-50 px-3 py-2"><strong className="text-danger">签收异常：</strong>同一条码收到不同勤策商品，或签收时间无法接上业务流转。</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">条码</th><th className="px-4 py-3">勤策商品</th><th className="px-4 py-3">当前归属</th><th className="px-4 py-3">签收状态</th><th className="px-4 py-3">最近流转</th><th className="w-10 px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-slate-200">
            {result.items.map((item) => (
              <tr className="cursor-pointer hover:bg-slate-50" key={item.id} onClick={() => void openDetail(item.barcode)}>
                <td className="px-4 py-3 font-mono font-semibold text-slate-700">{item.barcode}</td>
                <td className="px-4 py-3"><p className="font-medium text-slate-700">{item.externalGoodsName ?? "待勤策补全"}</p>{item.goodsUnit ? <p className="mt-0.5 text-xs text-muted">单位：{item.goodsUnit}</p> : null}</td>
                <td className="px-4 py-3 text-slate-600">{ownerLabel(item, warehouses, salespeople)}</td>
                <td className="px-4 py-3"><ReceiptBadge status={item.receiptStatus} /></td>
                <td className="px-4 py-3 text-slate-500">{item.lastMovedAt}</td>
                <td className="px-4 py-3"><ArrowRight className="h-4 w-4 text-slate-400" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? <p className="border-t border-slate-200 px-4 py-3 text-sm text-muted">正在读取条码...</p> : null}
      {!loading && result.items.length === 0 ? <div className="p-4"><EmptyState icon={Barcode} title="没有符合条件的条码" detail={trackingStatus === "voided" ? "当前没有待清理的已撤销条码。" : "调整筛选条件或先完成扫码出库。"} /></div> : null}
      <PaginationBar page={page} pageSize={result.pageSize} total={result.total} onPageChange={(nextPage) => void load(nextPage)} />
      {detailLoading ? <DetailLoadingDialog /> : null}
      {detail ? <TrackingDetailDialog detail={detail} warehouses={warehouses} salespeople={salespeople} canMaintain={canMaintain} onRemoved={async () => { setDetail(null); await load(page); }} showToast={showToast} onClose={() => setDetail(null)} /> : null}
    </section>
  );
}

function TrackingOrdersTable({
  warehouses,
  salespeople,
  canManageGroups,
  canMaintain,
  showToast
}: {
  warehouses: WarehouseRecord[];
  salespeople: Salesperson[];
  canManageGroups: boolean;
  canMaintain: boolean;
  showToast: (toast: Toast) => void;
}) {
  const [type, setType] = useState<TrackingOrderType | "all">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<TrackingOrderFeedResult>({ items: [], total: 0, page: 1, pageSize: 20 });
  const [loading, setLoading] = useState(true);
  const [grouping, setGrouping] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<TrackingOrderDetail | null>(null);
  const [groupDetail, setGroupDetail] = useState<TrackingOrderGroupDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const load = useCallback(async (nextPage: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, page: String(nextPage), pageSize: "20" });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const nextResult = await getJson<TrackingOrderFeedResult>(`/api/tracking/order-feed?${params.toString()}`);
      setResult(nextResult);
      setPage(nextResult.page);
      setSelectedIds(new Set());
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取流转单据失败") });
    } finally {
      setLoading(false);
    }
  }, [endDate, showToast, startDate, type]);

  useEffect(() => {
    void load(1);
  }, [load]);

  async function openDetail(orderId: string) {
    setDetailLoading(true);
    try {
      setDetail(await getJson<TrackingOrderDetail>(`/api/tracking/orders/${orderId}`));
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取流转单据详情失败") });
    } finally {
      setDetailLoading(false);
    }
  }

  async function openGroupDetail(groupId: string) {
    setDetailLoading(true);
    try {
      setGroupDetail(await getJson<TrackingOrderGroupDetail>(`/api/tracking/order-groups/${groupId}`));
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "读取出库单详情失败") });
    } finally {
      setDetailLoading(false);
    }
  }

  function toggleSelection(order: TrackingOrderSummary) {
    if (!isGroupableOrder(order)) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(order.id)) next.delete(order.id);
      else next.add(order.id);
      return next;
    });
  }

  async function createGroup() {
    const selectedOrders = rootOrders.filter((order) => selectedIds.has(order.id));
    if (selectedOrders.length < 2) return;
    const barcodeCount = selectedOrders.reduce((total, order) => total + order.barcodeCount, 0);
    const orderLabel = selectedOrders[0]?.type === "transfer" ? "挪仓单" : "销售出库单";
    const dates = new Set(selectedOrders.map((order) => order.createdAt.slice(0, 10)));
    const reviewedCount = selectedOrders.filter((order) => order.reviewStatus === "reviewed").length;
    const reviewNotice = reviewedCount > 0
      ? `\n\n其中 ${reviewedCount} 张已复核。合并后的出库单将重新进入待复核，之前的复核记录仅保留在后台审计中。`
      : "\n\n合并后只显示一张新的出库单，之前的分批单不再单独显示。";
    if (!window.confirm(`确认将 ${selectedOrders.length} 张${orderLabel}（共 ${barcodeCount} 件）合并成一张新的出库单吗？${reviewNotice}`)) return;
    if (dates.size > 1 && !window.confirm("所选单据跨日期。合并后出库单时间将取最迟一笔出库时间，请再次确认是否继续。")) return;
    setGrouping(true);
    try {
      const group = await postJson<TrackingOrderGroupSummary>("/api/tracking/order-groups", { orderIds: selectedOrders.map((order) => order.id) });
      setSelectedIds(new Set());
      await load(1);
      showToast({ tone: "success", message: `已生成出库单 ${group.groupNo}，共 ${group.barcodeCount} 件` });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "合并出库单失败") });
    } finally {
      setGrouping(false);
    }
  }

  const warehouseNames = new Map(warehouses.map((item) => [item.id, item.name]));
  const salespersonNames = new Map(salespeople.map((item) => [item.id, item.name]));
  const rootOrders = result.items.flatMap((item) => item.kind === "order" ? [item.order] : []);
  const selectedOrders = rootOrders.filter((order) => selectedIds.has(order.id));
  const selectionAnchor = selectedOrders[0];
  const selectedBarcodeCount = selectedOrders.reduce((total, order) => total + order.barcodeCount, 0);
  function isGroupableOrder(order: TrackingOrderSummary) {
    if (!canManageGroups || order.type === "return" || order.status !== "active" || order.reviewStatus === "exempt" || order.groupId) return false;
    if (!selectionAnchor || selectedIds.has(order.id)) return true;
    if (order.type !== selectionAnchor.type || order.sourceWarehouseId !== selectionAnchor.sourceWarehouseId) return false;
    return order.type === "transfer"
      ? order.targetWarehouseId === selectionAnchor.targetWarehouseId
      : order.salespersonId === selectionAnchor.salespersonId;
  }

  function clearDateRange() {
    setStartDate("");
    setEndDate("");
  }

  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-end gap-3 border-b border-slate-200 p-4">
        <label className="w-full sm:w-48"><span className="label">业务类型</span><select className="field" value={type} onChange={(event) => setType(event.target.value as TrackingOrderType | "all")}><option value="all">全部流转</option><option value="sales_outbound">销售出库</option><option value="transfer">仓库流转</option><option value="return">扫码回库</option></select></label>
        <label className="w-full sm:w-44"><span className="label">开始日期</span><input className="field" type="date" value={startDate} max={endDate || undefined} onChange={(event) => setStartDate(event.target.value)} /></label>
        <label className="w-full sm:w-44"><span className="label">结束日期</span><input className="field" type="date" value={endDate} min={startDate || undefined} onChange={(event) => setEndDate(event.target.value)} /></label>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canManageGroups ? <button className="primary-button" disabled={selectedIds.size < 2 || grouping} onClick={() => void createGroup()}><Layers3 className="h-4 w-4" />{grouping ? "正在合单" : `合并所选${selectedIds.size ? ` (${selectedIds.size})` : ""}`}</button> : null}
          {startDate || endDate ? <button className="secondary-button" onClick={clearDateRange}><X className="h-4 w-4" />清除日期</button> : null}
          <button className="secondary-button" onClick={() => void load(1)}><RefreshCw className="h-4 w-4" />刷新</button>
        </div>
        {selectedIds.size > 0 ? <p className="w-full text-xs text-muted">已选 {selectedIds.size} 张，共 {selectedBarcodeCount} 件。{selectionAnchor?.type === "transfer" ? "只能继续选择来源仓库和目标仓库都相同的挪仓单。" : "只能继续选择来源仓库和销售人员都相同的销售出库单。"}</p> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1120px] table-fixed text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="w-14 px-4 py-3">{canManageGroups ? "选择" : ""}</th><th className="w-56 px-4 py-3">单号</th><th className="w-28 px-4 py-3">业务</th><th className="w-56 px-4 py-3">来源 / 去向</th><th className="px-4 py-3">箱码</th><th className="w-32 px-4 py-3">操作信息</th><th className="w-14 px-4 py-3"></th></tr></thead>
          <tbody className="divide-y divide-slate-200">
            {result.items.map((item) => {
              if (item.kind === "order") {
                const order = item.order;
                const selectable = isGroupableOrder(order);
                return <TrackingOrderFeedRow
                  canSelect={canManageGroups}
                  isSelected={selectedIds.has(order.id)}
                  key={order.id}
                  order={order}
                  salespersonNames={salespersonNames}
                  selectable={selectable}
                  warehouseNames={warehouseNames}
                  onOpen={() => void openDetail(order.id)}
                  onToggle={() => toggleSelection(order)}
                />;
              }

              const { group } = item;
              return (
                <tr
                  key={group.id}
                  className="cursor-pointer transition hover:bg-slate-50 focus-visible:bg-emerald-50 focus-visible:outline-none"
                  tabIndex={0}
                  onClick={() => void openGroupDetail(group.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      void openGroupDetail(group.id);
                    }
                  }}
                >
                  <td className="px-4 py-3"></td>
                  <td className="px-4 py-3"><p className="font-mono font-semibold text-work">{group.groupNo}</p><p className="mt-1 text-xs text-muted">{group.createdAt}</p><div className="mt-1 flex flex-wrap gap-1"><ReviewStatusBadge status={group.reviewStatus} />{group.status === "voided" ? <LifecycleBadge label="已作废" tone="danger" /> : null}</div></td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{trackingOrderLabel(group.type)}</td>
                  <td className="px-4 py-3 text-slate-600">{warehouseNames.get(group.sourceWarehouseId) ?? "仓库"} <ArrowRight className="mx-1 inline h-3.5 w-3.5" /> {group.type === "transfer" ? warehouseNames.get(group.targetWarehouseId ?? "") ?? "未知仓库" : `销售人员：${salespersonNames.get(group.salespersonId ?? "") ?? "未知"}`}</td>
                  <td className="px-4 py-3"><p className="font-semibold text-slate-700">{group.activeBarcodeCount} 件有效</p>{group.voidedBarcodeCount > 0 ? <p className="mt-0.5 text-xs font-semibold text-danger">{group.voidedBarcodeCount} 件已删除</p> : null}<p className="mt-1 max-w-md truncate font-mono text-xs text-muted">{group.barcodePreview.join("、")}</p></td>
                  <td className="break-words px-4 py-3 text-slate-600">{group.operator}</td>
                  <td className="px-4 py-3"><button aria-label={`查看单据 ${group.groupNo} 详情`} className="icon-button h-8 w-8" title="查看单据详情" type="button" onClick={(event) => { event.stopPropagation(); void openGroupDetail(group.id); }}><Eye className="h-4 w-4" /></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {loading ? <p className="border-t border-slate-200 px-4 py-3 text-sm text-muted">正在读取单据...</p> : null}
      {!loading && result.items.length === 0 ? <div className="p-4"><EmptyState icon={ClipboardList} title="暂无流转单据" detail="扫码出库和扫码回库提交后会生成流转单据。" /></div> : null}
      <PaginationBar page={page} pageSize={result.pageSize} total={result.total} onPageChange={(nextPage) => void load(nextPage)} />
      {detailLoading ? <OrderDetailLoadingDialog /> : null}
      {detail ? <TrackingOrderDetailDialog detail={detail} warehouses={warehouses} salespeople={salespeople} canMaintain={canMaintain} onChanged={async () => { setDetail(null); await load(page); }} showToast={showToast} onClose={() => setDetail(null)} /> : null}
      {groupDetail ? <TrackingOrderGroupDetailDialog detail={groupDetail} warehouses={warehouses} salespeople={salespeople} canMaintain={canMaintain} onChanged={async () => { setGroupDetail(null); await load(page); }} showToast={showToast} onClose={() => setGroupDetail(null)} /> : null}
    </section>
  );
}

function TrackingOrderFeedRow({
  order,
  warehouseNames,
  salespersonNames,
  canSelect,
  selectable,
  isSelected,
  onToggle,
  onOpen
}: {
  order: TrackingOrderSummary;
  warehouseNames: Map<string, string>;
  salespersonNames: Map<string, string>;
  canSelect: boolean;
  selectable: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  return <tr
    className="cursor-pointer transition hover:bg-slate-50 focus-visible:bg-emerald-50 focus-visible:outline-none"
    tabIndex={0}
    onClick={onOpen}
    onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onOpen();
      }
    }}
  >
    <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>{canSelect ? <input aria-label={`选择单据 ${order.orderNo}`} className="h-4 w-4 accent-emerald-700" type="checkbox" checked={isSelected} disabled={!selectable} onChange={onToggle} /> : null}</td>
    <td className="px-4 py-3"><p className="font-mono font-semibold text-work">{order.orderNo}</p><p className="mt-1 text-xs text-muted">{order.createdAt}</p><div className="mt-1 flex flex-wrap gap-1"><ReviewStatusBadge status={order.reviewStatus} />{order.status === "voided" ? <LifecycleBadge label="已作废" tone="danger" /> : null}</div></td>
    <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-700">{trackingOrderLabel(order.type)}</td>
    <td className="px-4 py-3 text-slate-600">{order.sourceWarehouseId ? warehouseNames.get(order.sourceWarehouseId) ?? "仓库" : "外部流入"} <ArrowRight className="mx-1 inline h-3.5 w-3.5" /> {order.salespersonId ? `销售人员：${salespersonNames.get(order.salespersonId) ?? "未知"}` : order.targetWarehouseId ? warehouseNames.get(order.targetWarehouseId) ?? "仓库" : "回库仓库"}</td>
    <td className="px-4 py-3"><p className="font-semibold text-slate-700">{order.activeBarcodeCount} 件有效</p>{order.voidedBarcodeCount > 0 ? <p className="mt-0.5 text-xs font-semibold text-danger">{order.voidedBarcodeCount} 件已撤销</p> : null}<p className="mt-1 max-w-md truncate font-mono text-xs text-muted">{order.barcodePreview.join("、")}</p></td>
    <td className="break-words px-4 py-3 text-slate-600">{order.operator}</td>
    <td className="px-4 py-3"><ArrowRight className="h-4 w-4 text-slate-400" /></td>
  </tr>;
}

function TrackingMastersView({
  state,
  canEdit,
  canDelete,
  showToast,
  reload
}: {
  state: WarehouseState;
  canEdit: boolean;
  canDelete: boolean;
  showToast: (toast: Toast) => void;
  reload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"warehouses" | "salespeople" | "categories">("warehouses");
  const [warehouseDraft, setWarehouseDraft] = useState<Partial<WarehouseRecord> | null>(null);
  const [salespersonDraft, setSalespersonDraft] = useState<Partial<Salesperson> | null>(null);
  const [busy, setBusy] = useState(false);

  async function saveWarehouse() {
    if (!warehouseDraft?.code?.trim() || !warehouseDraft.name?.trim() || !warehouseDraft.manager?.trim()) {
      showToast({ tone: "error", message: "请填写仓库编码、名称和负责人" });
      return;
    }
    setBusy(true);
    try {
      if (warehouseDraft.id) await patchJson(`/api/warehouses/${warehouseDraft.id}`, warehouseDraft);
      else await postJson("/api/warehouses", warehouseDraft);
      setWarehouseDraft(null);
      await reload();
      showToast({ tone: "success", message: "仓库资料已保存" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "保存仓库失败") });
    } finally { setBusy(false); }
  }

  async function saveSalesperson() {
    if (!salespersonDraft?.code?.trim() || !salespersonDraft.name?.trim() || !salespersonDraft.phone?.trim() || !salespersonDraft.region?.trim()) {
      showToast({ tone: "error", message: "请填写销售人员编码、姓名、手机和区域" });
      return;
    }
    setBusy(true);
    try {
      if (salespersonDraft.id) await patchJson(`/api/salespeople/${salespersonDraft.id}`, salespersonDraft);
      else await postJson("/api/salespeople", salespersonDraft);
      setSalespersonDraft(null);
      await reload();
      showToast({ tone: "success", message: "销售人员资料已保存" });
    } catch (error) {
      showToast({ tone: "error", message: apiErrorMessage(error, "保存销售人员失败") });
    } finally { setBusy(false); }
  }

  async function toggleStatus(kind: "warehouse" | "salesperson", item: WarehouseRecord | Salesperson) {
    try {
      await patchJson(`/api/${kind === "warehouse" ? "warehouses" : "salespeople"}/${item.id}`, { status: item.status === "enabled" ? "disabled" : "enabled" });
      await reload();
      showToast({ tone: "success", message: item.status === "enabled" ? "已停用" : "已启用" });
    } catch (error) { showToast({ tone: "error", message: apiErrorMessage(error, "更新状态失败") }); }
  }

  async function remove(kind: "warehouse" | "salesperson", id: string) {
    if (!window.confirm("仅无业务引用的错误资料可以彻底删除。确定继续吗？")) return;
    try {
      await deleteJson(`/api/${kind === "warehouse" ? "warehouses" : "salespeople"}/${id}`);
      await reload();
      showToast({ tone: "success", message: "资料已删除" });
    } catch (error) { showToast({ tone: "error", message: apiErrorMessage(error, "删除失败") }); }
  }

  return (
    <div className="space-y-4">
      <section className="panel p-2">
        <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1"><button className={segmentClass(tab === "warehouses")} onClick={() => setTab("warehouses")}><Warehouse className="h-4 w-4" />仓库</button><button className={segmentClass(tab === "salespeople")} onClick={() => setTab("salespeople")}><Users className="h-4 w-4" />销售人员</button><button className={segmentClass(tab === "categories")} onClick={() => setTab("categories")}><PackageCheck className="h-4 w-4" />商品品类</button></div>
      </section>
      {tab === "categories" ? <ProductCategoryManager canEdit={canEdit} showToast={showToast} /> : null}
      {tab !== "categories" ? (
      <section className="panel overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3"><div><h2 className="text-sm font-semibold text-ink">{tab === "warehouses" ? "仓库资料" : "销售人员资料"}</h2><p className="mt-1 text-xs text-muted">商品资料和终端店铺不再由本系统维护。</p></div>{canEdit ? <button className="primary-button" onClick={() => tab === "warehouses" ? setWarehouseDraft({ code: "", name: "", manager: "" }) : setSalespersonDraft({ code: "", name: "", phone: "", region: "" })}><Plus className="h-4 w-4" />新增</button> : null}</div>
        <div className="overflow-x-auto">
          {tab === "warehouses" ? (
            <table className="w-full min-w-[680px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">编码</th><th className="px-4 py-3">仓库名称</th><th className="px-4 py-3">负责人</th><th className="px-4 py-3">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-200">{state.warehouses.map((item) => <tr key={item.id}><td className="px-4 py-3 font-mono text-slate-600">{item.code}</td><td className="px-4 py-3 font-semibold text-slate-700">{item.name}</td><td className="px-4 py-3 text-slate-600">{item.manager}</td><td className="px-4 py-3"><MasterStatus status={item.status} /></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{canEdit ? <><button className="icon-button" title="编辑仓库" onClick={() => setWarehouseDraft(item)}><Pencil className="h-4 w-4" /></button><button className="secondary-button h-9 px-3" onClick={() => void toggleStatus("warehouse", item)}>{item.status === "enabled" ? "停用" : "启用"}</button></> : null}{canDelete ? <button className="icon-button text-danger" title="删除仓库" onClick={() => void remove("warehouse", item.id)}><Trash2 className="h-4 w-4" /></button> : null}</div></td></tr>)}</tbody></table>
          ) : (
            <table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-4 py-3">编码</th><th className="px-4 py-3">姓名</th><th className="px-4 py-3">手机</th><th className="px-4 py-3">区域</th><th className="px-4 py-3">状态</th><th className="px-4 py-3 text-right">操作</th></tr></thead><tbody className="divide-y divide-slate-200">{state.salespeople.map((item) => <tr key={item.id}><td className="px-4 py-3 font-mono text-slate-600">{item.code}</td><td className="px-4 py-3 font-semibold text-slate-700">{item.name}</td><td className="px-4 py-3 text-slate-600">{item.phone}</td><td className="px-4 py-3 text-slate-600">{item.region}</td><td className="px-4 py-3"><MasterStatus status={item.status} /></td><td className="px-4 py-3"><div className="flex justify-end gap-2">{canEdit ? <><button className="icon-button" title="编辑销售人员" onClick={() => setSalespersonDraft(item)}><Pencil className="h-4 w-4" /></button><button className="secondary-button h-9 px-3" onClick={() => void toggleStatus("salesperson", item)}>{item.status === "enabled" ? "停用" : "启用"}</button></> : null}{canDelete ? <button className="icon-button text-danger" title="删除销售人员" onClick={() => void remove("salesperson", item.id)}><Trash2 className="h-4 w-4" /></button> : null}</div></td></tr>)}</tbody></table>
          )}
        </div>
      </section>
      ) : null}
      {warehouseDraft ? <WarehouseEditor draft={warehouseDraft} setDraft={setWarehouseDraft} busy={busy} save={() => void saveWarehouse()} /> : null}
      {salespersonDraft ? <SalespersonEditor draft={salespersonDraft} setDraft={setSalespersonDraft} busy={busy} save={() => void saveSalesperson()} /> : null}
    </div>
  );
}

function OperationLayout({ stepTitle, form, collector, action }: { stepTitle: string; form: ReactNode; collector: ReactNode; action: ReactNode }) {
  return <div className="space-y-4"><section className="grid gap-0 overflow-hidden rounded-md border border-slate-200 bg-white xl:grid-cols-[320px_minmax(0,1fr)]"><div className="border-b border-slate-200 p-4 xl:border-b-0 xl:border-r"><div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">1</span><h2 className="text-base font-semibold text-ink">{stepTitle}</h2></div>{form}</div><div className="p-4"><div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-semibold text-white">2</span><h2 className="text-base font-semibold text-ink">条码录入与提交</h2></div>{collector}</div></section>{action}</div>;
}

function SubmitBand({ title, detail, disabled, busy, label, icon: Icon, onClick }: { title: string; detail: string; disabled: boolean; busy: boolean; label: string; icon: typeof Truck; onClick: () => void }) {
  return <section className="panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-ink">{title}</p><p className="mt-1 text-xs text-muted">{detail}</p></div><button className="primary-button min-w-36 justify-center" disabled={disabled} onClick={onClick}><Icon className="h-4 w-4" />{busy ? "正在提交" : label}</button></section>;
}

function TrackingDetailDialog({ detail, warehouses, salespeople, canMaintain, onRemoved, showToast, onClose }: { detail: TrackingBarcodeDetail; warehouses: WarehouseRecord[]; salespeople: Salesperson[]; canMaintain: boolean; onRemoved: () => Promise<void>; showToast: (toast: Toast) => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4"><section className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-md bg-white shadow-2xl" role="dialog" aria-modal="true"><div className="sticky top-0 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4"><div><p className="font-mono text-lg font-semibold text-ink">{detail.item.barcode}</p><p className="mt-1 text-sm text-muted">{detail.item.externalGoodsName ?? "商品名称待勤策补全"}</p></div><div className="flex items-center gap-2">{canMaintain ? <TrackedBarcodeAdminActions barcode={detail.item.barcode} onChanged={onRemoved} showToast={showToast} /> : null}<button className="icon-button" onClick={onClose} aria-label="关闭详情"><X className="h-4 w-4" /></button></div></div><div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-3"><DetailMetric label="当前归属" value={ownerLabel(detail.item, warehouses, salespeople)} /><DetailMetric label="签收状态" value={receiptStatusLabel(detail.item.receiptStatus)} /><DetailMetric label="最近流转" value={detail.item.lastMovedAt} /></div><div className="p-5"><h3 className="text-sm font-semibold text-ink">完整流转履历</h3><div className="mt-3 space-y-3">{detail.movements.map((movement) => <MovementEntry movement={movement} key={movement.id} />)}{detail.movements.length === 0 ? <p className="text-sm text-muted">暂无流转记录</p> : null}</div>{detail.terminalReceipts.length > 0 ? <><h3 className="mt-6 text-sm font-semibold text-ink">勤策签收记录</h3><div className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200">{detail.terminalReceipts.map((receipt) => <div className="p-3 text-sm" key={receipt.id}><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-700">{receipt.receivingOrganizationName}</p><span className="text-xs text-muted">{receipt.scannedAt}</span></div><p className="mt-1 text-slate-600">{receipt.externalGoodsName} · 扫码人 {receipt.scannerName}</p></div>)}</div></> : null}</div></section></div>;
}

function TrackingOrderDetailDialog({
  detail,
  warehouses,
  salespeople,
  canMaintain,
  onChanged,
  showToast,
  onClose
}: {
  detail: TrackingOrderDetail;
  warehouses: WarehouseRecord[];
  salespeople: Salesperson[];
  canMaintain: boolean;
  onChanged: () => Promise<void>;
  showToast: (toast: Toast) => void;
  onClose: () => void;
}) {
  const { order, receiptSummary } = detail;
  const warehouseNames = new Map(warehouses.map((item) => [item.id, item.name]));
  const salespersonNames = new Map(salespeople.map((item) => [item.id, item.name]));
  const source = order.sourceWarehouseId ? warehouseNames.get(order.sourceWarehouseId) ?? "未知仓库" : "外部流入";
  const destination = order.salespersonId
    ? `销售人员：${salespersonNames.get(order.salespersonId) ?? "未知"}`
    : order.targetWarehouseId
      ? `仓库：${warehouseNames.get(order.targetWarehouseId) ?? "未知"}`
      : "回库仓库";
  const receiptCycleDescription = order.type === "transfer"
    ? "签收状态只计算本次挪仓至下一次业务流转之间的勤策记录。"
    : "签收状态只计算本次销售出库至下一次业务流转之间的勤策记录。";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-2 sm:p-4">
      <section className="max-h-[94vh] w-full max-w-5xl overflow-y-auto rounded-md bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="tracking-order-detail-title">
        <div className="sticky top-0 z-10 flex flex-col items-stretch gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-mono text-lg font-semibold text-ink" id="tracking-order-detail-title">{order.orderNo}</h2>
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{trackingOrderLabel(order.type)}</span>
              <ReviewStatusBadge status={order.reviewStatus} />
              {order.status === "merged" ? <LifecycleBadge label="已合并" tone="neutral" /> : null}
              {order.status === "voided" ? <span className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-semibold text-danger">已作废</span> : null}
            </div>
            <p className="mt-1 text-sm text-muted">单据详情与本次流转后的勤策签收进度</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">{canMaintain ? <TrackingBusinessAdminActions targetType="order" target={order} warehouses={warehouses} salespeople={salespeople} onChanged={onChanged} showToast={showToast} /> : null}<button className="icon-button" onClick={onClose} aria-label="关闭单据详情"><X className="h-4 w-4" /></button></div>
        </div>

        <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-5">
          <DetailMetric label="来源 / 去向" value={`${source} → ${destination}`} />
          <DetailMetric label="有效箱码" value={`${order.activeBarcodeCount} 件`} />
          <DetailMetric label="已撤销箱码" value={`${order.voidedBarcodeCount} 件`} />
          <DetailMetric label="操作人" value={order.operator} />
          <DetailMetric label="操作时间" value={order.createdAt} />
        </div>

        <TrackingLifecycleHistory
          correctedAfterReview={order.correctedAfterReview}
          corrections={detail.corrections}
          reviews={detail.reviews}
          reviewStatus={order.reviewStatus}
          salespersonNames={salespersonNames}
          warehouseNames={warehouseNames}
        />

        {receiptSummary ? <TrackingReceiptAnalytics receiptSummary={receiptSummary} goodsReceiptSummaries={detail.goodsReceiptSummaries} /> : null}

        <div className="p-4 sm:p-5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">单据箱码明细</h3>
              <p className="mt-1 text-xs text-muted">{receiptSummary ? receiptCycleDescription : "当前归属为实时状态，便于继续追查箱码去向。"}</p>
            </div>
            <span className="text-xs text-muted">{detail.items.length} 件</span>
          </div>
          <div className="mt-3 max-h-[420px] overflow-auto rounded-md border border-slate-200">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_0_#e2e8f0]"><tr><th className="px-3 py-2.5">箱码</th><th className="px-3 py-2.5">勤策商品</th><th className="px-3 py-2.5">本单签收状态</th><th className="px-3 py-2.5">签收店铺 / 时间</th><th className="px-3 py-2.5">当前归属（实时）</th></tr></thead>
              <tbody className="divide-y divide-slate-200">
                {detail.items.map((item) => (
                  <tr className={item.trackingStatus === "voided" ? "bg-slate-50 text-slate-500" : ""} key={item.barcode}>
                    <td className="px-3 py-3"><p className="font-mono font-semibold text-slate-700">{item.barcode}</p>{item.trackingStatus === "voided" ? <span className="mt-1 inline-flex rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500">已撤销追踪</span> : null}</td>
                    <td className="px-3 py-3"><p className="font-medium text-slate-700">{item.externalGoodsName ?? "待勤策补全"}</p>{item.goodsUnit ? <p className="mt-0.5 text-xs text-muted">单位：{item.goodsUnit}</p> : null}</td>
                    <td className="px-3 py-3">{item.receiptStatus ? <ReceiptBadge status={item.receiptStatus} /> : <span className="text-xs text-muted">不适用</span>}</td>
                    <td className="px-3 py-3"><p className="text-slate-700">{item.receivingOrganizationName ?? "-"}</p>{item.signedAt ? <p className="mt-0.5 text-xs text-muted">{item.signedAt}</p> : null}</td>
                    <td className="px-3 py-3 text-slate-600">{trackingOrderItemOwnerLabel(item, warehouseNames, salespersonNames)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function TrackingOrderGroupDetailDialog({
  detail,
  warehouses,
  salespeople,
  canMaintain,
  onChanged,
  showToast,
  onClose
}: {
  detail: TrackingOrderGroupDetail;
  warehouses: WarehouseRecord[];
  salespeople: Salesperson[];
  canMaintain: boolean;
  onChanged: () => Promise<void>;
  showToast: (toast: Toast) => void;
  onClose: () => void;
}) {
  const warehouseNames = new Map(warehouses.map((item) => [item.id, item.name]));
  const salespersonNames = new Map(salespeople.map((item) => [item.id, item.name]));
  const source = warehouseNames.get(detail.group.sourceWarehouseId) ?? "未知仓库";
  const destination = detail.group.type === "transfer"
    ? warehouseNames.get(detail.group.targetWarehouseId ?? "") ?? "未知仓库"
    : `销售人员：${salespersonNames.get(detail.group.salespersonId ?? "") ?? "未知"}`;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-2 sm:p-4">
      <section className="max-h-[94vh] w-full max-w-6xl overflow-y-auto rounded-md bg-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="tracking-order-group-detail-title">
        <div className="sticky top-0 z-10 flex flex-col items-stretch gap-3 border-b border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-mono text-lg font-semibold text-ink" id="tracking-order-group-detail-title">{detail.group.groupNo}</h2>
              <span className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">{detail.group.type === "transfer" ? "仓库流转单" : "销售出库单"}</span>
              <ReviewStatusBadge status={detail.group.reviewStatus} />
              {detail.group.status === "voided" ? <LifecycleBadge label="已作废" tone="danger" /> : null}
            </div>
            <p className="mt-1 text-sm text-muted">本单的签收、复核与纠错均统一处理。</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:shrink-0">
            {canMaintain ? <TrackingBusinessAdminActions targetType="group" target={detail.group} warehouses={warehouses} salespeople={salespeople} onChanged={onChanged} showToast={showToast} /> : null}
            <button className="icon-button" onClick={onClose} aria-label="关闭单据详情"><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="grid gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          <DetailMetric label="来源 / 去向" value={`${source} → ${destination}`} />
          <DetailMetric label="有效箱码" value={`${detail.group.activeBarcodeCount} 件`} />
          <DetailMetric label="已删除箱码" value={`${detail.group.voidedBarcodeCount} 件`} />
          <DetailMetric label="操作信息" value={`${detail.group.operator} · ${detail.group.createdAt}`} />
        </div>

        <TrackingLifecycleHistory
          correctedAfterReview={detail.group.correctedAfterReview}
          corrections={detail.corrections}
          reviews={detail.reviews}
          reviewStatus={detail.group.reviewStatus}
          salespersonNames={salespersonNames}
          warehouseNames={warehouseNames}
        />

        <TrackingReceiptProgress
          receiptSummary={detail.receiptSummary}
          goodsReceiptSummaries={detail.goodsReceiptSummaries}
          items={detail.items}
          warehouseNames={warehouseNames}
          salespersonNames={salespersonNames}
        />
      </section>
    </div>
  );
}

function TrackingReceiptProgress({
  receiptSummary,
  goodsReceiptSummaries,
  items,
  warehouseNames,
  salespersonNames
}: {
  receiptSummary: NonNullable<TrackingOrderDetail["receiptSummary"]>;
  goodsReceiptSummaries: TrackingOrderDetail["goodsReceiptSummaries"];
  items: TrackingOrderBarcodeDetail[];
  warehouseNames: Map<string, string>;
  salespersonNames: Map<string, string>;
}) {
  return <>
    <TrackingReceiptAnalytics receiptSummary={receiptSummary} goodsReceiptSummaries={goodsReceiptSummaries} />

    <div className="p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-sm font-semibold text-ink">单据箱码明细</h3><p className="mt-1 text-xs text-muted">签收状态按本次出库流转周期计算。</p></div><span className="text-xs text-muted">{items.length} 件</span></div>
      <div className="mt-3 max-h-[420px] overflow-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_0_#e2e8f0]"><tr><th className="px-3 py-2.5">箱码</th><th className="px-3 py-2.5">勤策商品</th><th className="px-3 py-2.5">本单签收状态</th><th className="px-3 py-2.5">签收店铺 / 时间</th><th className="px-3 py-2.5">当前归属（实时）</th></tr></thead>
          <tbody className="divide-y divide-slate-200">{items.map((item) => <tr className={item.trackingStatus === "voided" ? "bg-slate-50 text-slate-500" : ""} key={item.barcode}><td className="px-3 py-3"><p className="font-mono font-semibold text-slate-700">{item.barcode}</p>{item.trackingStatus === "voided" ? <span className="mt-1 inline-flex rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-xs font-semibold text-slate-500">已删除</span> : null}</td><td className="px-3 py-3"><p className="font-medium text-slate-700">{item.externalGoodsName ?? "待勤策补全"}</p>{item.goodsUnit ? <p className="mt-0.5 text-xs text-muted">单位：{item.goodsUnit}</p> : null}</td><td className="px-3 py-3">{item.receiptStatus ? <ReceiptBadge status={item.receiptStatus} /> : <span className="text-xs text-muted">不适用</span>}</td><td className="px-3 py-3"><p className="text-slate-700">{item.receivingOrganizationName ?? "-"}</p>{item.signedAt ? <p className="mt-0.5 text-xs text-muted">{item.signedAt}</p> : null}</td><td className="px-3 py-3 text-slate-600">{trackingOrderItemOwnerLabel(item, warehouseNames, salespersonNames)}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  </>;
}

function TrackingReceiptAnalytics({
  receiptSummary,
  goodsReceiptSummaries
}: {
  receiptSummary: NonNullable<TrackingOrderDetail["receiptSummary"]>;
  goodsReceiptSummaries: TrackingOrderDetail["goodsReceiptSummaries"];
}) {
  const usesReview = receiptSummary.basis === "review";
  const missingReviewQuantities = goodsReceiptSummaries.filter((summary) => summary.needsReviewQuantity).length;
  const hasWarnings = receiptSummary.excessQuantity > 0 || receiptSummary.unallocatedCategoryQuantity > 0 || receiptSummary.categoryExcessQuantity > 0 || missingReviewQuantities > 0;
  const progressWidth = Math.min(100, Math.max(0, receiptSummary.signedRate ?? 0));

  return <>
    <div className="border-b border-slate-200 p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-slate-500">整单签收率</p>
            <span className={`rounded-md border px-1.5 py-0.5 text-xs font-semibold ${usesReview ? "border-emerald-200 bg-emerald-50 text-work" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
              {usesReview ? `复核口径 v${receiptSummary.reviewVersion}` : "条码口径"}
            </span>
          </div>
          <p className={`mt-1 text-3xl font-semibold ${receiptSummary.excessQuantity > 0 ? "text-danger" : "text-ink"}`}>{formatReceiptRate(receiptSummary.signedRate)}</p>
          <p className="mt-1 text-xs text-muted">
            {usesReview ? "已签收箱码 ÷ 最新复核实际总出货数量；签收异常单独列出。" : "已签收箱码 ÷ 本单有效追踪箱码；已删除条码不参与计算，签收异常单独列出。"}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-slate-200 bg-slate-200 text-center sm:min-w-[420px]">
          <ReceiptCount label="已签收" value={receiptSummary.signed} tone="signed" />
          <ReceiptCount label="待签收" value={receiptSummary.pending} tone="pending" />
          <ReceiptCount label="签收异常" value={receiptSummary.exceptions} tone="exception" />
        </dl>
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100" aria-label={`整单签收率 ${formatReceiptRate(receiptSummary.signedRate)}`}>
        <div className={`h-full rounded-full transition-all ${receiptSummary.excessQuantity > 0 ? "bg-danger" : "bg-work"}`} style={{ width: `${progressWidth}%` }} />
      </div>
      {hasWarnings ? <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <div className="flex items-start gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /><div className="space-y-1">
          {receiptSummary.excessQuantity > 0 ? <p>已签收与异常数量合计超过复核总数 {receiptSummary.excessQuantity} 件，请核对复核记录。</p> : null}
          {receiptSummary.unallocatedCategoryQuantity > 0 ? <p>复核总数中仍有 {receiptSummary.unallocatedCategoryQuantity} 件未分配商品品类。</p> : null}
          {receiptSummary.categoryExcessQuantity > 0 ? <p>复核品类合计超过实际总数 {receiptSummary.categoryExcessQuantity} 件。</p> : null}
          {missingReviewQuantities > 0 ? <p>勤策识别出 {missingReviewQuantities} 个未填写复核数量的商品，需修订复核后才能计算对应签收率。</p> : null}
        </div></div>
      </div> : null}
    </div>

    {goodsReceiptSummaries.length > 0 ? <div className="border-b border-slate-200 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-ink">各项货物签收率</h3>
          <p className="mt-1 text-xs text-muted">{usesReview ? "复核品类数量作为分母；勤策未识别的签收继续等待补全。" : "商品名称和单位以勤策签收数据为准；未返回商品的箱码归入“待勤策补全”。"}</p>
        </div>
        <span className="text-xs text-muted">共 {goodsReceiptSummaries.length} 项</span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="px-3 py-2.5">商品品类</th><th className="px-3 py-2.5 text-right">{usesReview ? "复核数量" : "总数"}</th><th className="px-3 py-2.5 text-right">已签收</th><th className="px-3 py-2.5 text-right">待签收</th><th className="px-3 py-2.5 text-right">异常</th><th className="px-3 py-2.5 text-right">签收率</th></tr></thead>
          <tbody className="divide-y divide-slate-200">{goodsReceiptSummaries.map((summary) => <tr className={summary.excessQuantity > 0 ? "bg-red-50/60" : summary.needsReviewQuantity ? "bg-amber-50/60" : ""} key={`${summary.productCategoryId ?? summary.goodsName}-${summary.goodsUnit ?? ""}`}>
            <td className="px-3 py-3"><div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-slate-700">{summary.goodsName}</p>{summary.needsReviewQuantity ? <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">待补充复核数量</span> : null}</div>{summary.goodsUnit ? <p className="mt-0.5 text-xs text-muted">单位：{summary.goodsUnit}</p> : null}{summary.excessQuantity > 0 ? <p className="mt-1 text-xs font-semibold text-danger">签收与异常合计超出复核数量 {summary.excessQuantity} 件</p> : null}</td>
            <td className="px-3 py-3 text-right font-semibold text-slate-700">{summary.total ?? "待补充"}</td>
            <td className="px-3 py-3 text-right text-work">{summary.signed}</td>
            <td className="px-3 py-3 text-right text-amber-700">{summary.pending ?? "-"}</td>
            <td className="px-3 py-3 text-right text-danger">{summary.exceptions}</td>
            <td className={`px-3 py-3 text-right font-semibold ${summary.excessQuantity > 0 ? "text-danger" : "text-slate-700"}`}>{summary.needsReviewQuantity ? "待补充" : formatReceiptRate(summary.signedRate)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </div> : null}
  </>;
}

function TrackingLifecycleHistory({
  reviewStatus,
  correctedAfterReview,
  reviews,
  corrections,
  warehouseNames,
  salespersonNames
}: {
  reviewStatus: TrackingOrderSummary["reviewStatus"];
  correctedAfterReview: boolean;
  reviews: TrackingOrderDetail["reviews"];
  corrections: TrackingOrderDetail["corrections"];
  warehouseNames: Map<string, string>;
  salespersonNames: Map<string, string>;
}) {
  return <div className="border-b border-slate-200 p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-ink">复核与纠错记录</h3>
        <p className="mt-1 text-xs text-muted">复核版本和路线纠正均永久保留，后续修订不会覆盖历史。</p>
      </div>
      <ReviewStatusBadge status={reviewStatus} />
    </div>
    {correctedAfterReview ? <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800">复核完成后发生过单据纠错或条码删除，请结合下方版本记录核对。</p> : null}
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <section className="flex max-h-[22rem] min-h-0 flex-col overflow-hidden rounded-md border border-slate-200">
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2.5"><h4 className="text-sm font-semibold text-slate-700">出库复核版本</h4></div>
        {reviews.length > 0 ? <div className="min-h-0 overflow-y-auto divide-y divide-slate-200">{reviews.map((review) => {
          const categoryTotal = review.items.reduce((total, item) => total + item.quantity, 0);
          const mismatched = review.actualTotalQuantity !== review.activeBarcodeCount || (review.items.length > 0 && categoryTotal !== review.actualTotalQuantity);
          return <div className="p-3 text-sm" key={review.id}>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-700">第 {review.version} 版 · 实际 {review.actualTotalQuantity} 件</p><span className="text-xs text-muted">{review.createdAt}</span></div>
            <p className="mt-1 text-xs text-muted">有效扫码 {review.activeBarcodeCount} 件 · 复核人 {review.operator}</p>
            {review.items.length > 0 ? <p className="mt-2 text-xs text-slate-600">{review.items.map((item) => `${item.categoryName} ${item.quantity} 件`).join("；")}</p> : <p className="mt-2 text-xs text-muted">未填写品类数量</p>}
            {mismatched ? <p className="mt-2 text-xs font-semibold text-amber-700">数量存在差异，系统按实际填写结果保留。</p> : null}
          </div>;
        })}</div> : <p className="px-3 py-4 text-sm text-muted">{reviewStatus === "exempt" ? "历史业务免于补做复核。" : "尚未完成出库复核。"}</p>}
      </section>
      <section className="flex max-h-[22rem] min-h-0 flex-col overflow-hidden rounded-md border border-slate-200">
        <div className="shrink-0 border-b border-slate-200 bg-slate-50 px-3 py-2.5"><h4 className="text-sm font-semibold text-slate-700">路线纠正历史</h4></div>
        {corrections.length > 0 ? <div className="min-h-0 overflow-y-auto divide-y divide-slate-200">{corrections.map((correction) => <div className="p-3 text-sm" key={correction.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-slate-700">{trackingRouteLabel(correction.beforeType, correction.beforeSourceWarehouseId, correction.beforeTargetWarehouseId, correction.beforeSalespersonId, warehouseNames, salespersonNames)}</p><span className="text-xs text-muted">{correction.createdAt}</span></div>
          <p className="mt-2 text-slate-500"><ArrowRight className="mr-1 inline h-3.5 w-3.5" />{trackingRouteLabel(correction.afterType, correction.afterSourceWarehouseId, correction.afterTargetWarehouseId, correction.afterSalespersonId, warehouseNames, salespersonNames)}</p>
          <p className="mt-1 text-xs text-muted">纠正人 {correction.operator}{correction.note ? ` · ${correction.note}` : ""}</p>
        </div>)}</div> : <p className="px-3 py-4 text-sm text-muted">没有路线纠正记录。</p>}
      </section>
    </div>
  </div>;
}

function trackingRouteLabel(
  type: Exclude<TrackingOrderType, "return">,
  sourceWarehouseId: string,
  targetWarehouseId: string | undefined,
  salespersonId: string | undefined,
  warehouseNames: Map<string, string>,
  salespersonNames: Map<string, string>
) {
  const source = warehouseNames.get(sourceWarehouseId) ?? "未知仓库";
  const destination = type === "transfer"
    ? warehouseNames.get(targetWarehouseId ?? "") ?? "未知仓库"
    : `销售人员：${salespersonNames.get(salespersonId ?? "") ?? "未知"}`;
  return `${trackingOrderLabel(type)} · ${source} → ${destination}`;
}

function ReceiptCount({ label, value, tone }: { label: string; value: number; tone: TrackingReceiptStatus }) {
  const classes = tone === "signed" ? "text-work" : tone === "exception" ? "text-danger" : "text-amber-700";
  return <div className="bg-white px-3 py-3"><dt className="text-xs text-muted">{label}</dt><dd className={`mt-1 text-xl font-semibold ${classes}`}>{value} 件</dd></div>;
}

function MovementEntry({ movement }: { movement: TrackingMovement }) {
  const displayedOrderNo = movement.groupNo ?? movement.orderNo;
  return <div className="rounded-md border border-slate-200 bg-slate-50 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-slate-700">{movementTypeLabel(movement.type)}</p>{movement.routeCorrected ? <span className="text-xs font-semibold text-amber-700">路线已纠正</span> : null}</div><span className="text-xs text-muted">{movement.occurredAt}</span></div><p className="mt-2 text-sm text-slate-600">{movement.fromLabel} <ArrowRight className="mx-1 inline h-3.5 w-3.5" /> {movement.toLabel}</p><p className="mt-1 text-xs text-muted">操作：{movement.operator}{displayedOrderNo ? ` · 单号 ${displayedOrderNo}` : ""}</p>{movement.note ? <p className="mt-1 text-xs text-muted">{movement.note}</p> : null}</div>;
}

function WarehouseEditor({ draft, setDraft, busy, save }: { draft: Partial<WarehouseRecord>; setDraft: (value: Partial<WarehouseRecord> | null) => void; busy: boolean; save: () => void }) {
  return <EditorDialog title={draft.id ? "编辑仓库" : "新增仓库"} busy={busy} save={save} close={() => setDraft(null)}><label><span className="label">仓库编码</span><input className="field" value={draft.code ?? ""} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label><label><span className="label">仓库名称</span><input className="field" value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span className="label">负责人</span><input className="field" value={draft.manager ?? ""} onChange={(event) => setDraft({ ...draft, manager: event.target.value })} /></label></EditorDialog>;
}

function SalespersonEditor({ draft, setDraft, busy, save }: { draft: Partial<Salesperson>; setDraft: (value: Partial<Salesperson> | null) => void; busy: boolean; save: () => void }) {
  return <EditorDialog title={draft.id ? "编辑销售人员" : "新增销售人员"} busy={busy} save={save} close={() => setDraft(null)}><label><span className="label">人员编码</span><input className="field" value={draft.code ?? ""} onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label><label><span className="label">姓名</span><input className="field" value={draft.name ?? ""} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span className="label">手机号</span><input className="field" value={draft.phone ?? ""} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label><label><span className="label">区域</span><input className="field" value={draft.region ?? ""} onChange={(event) => setDraft({ ...draft, region: event.target.value })} /></label></EditorDialog>;
}

function EditorDialog({ title, busy, save, close, children }: { title: string; busy: boolean; save: () => void; close: () => void; children: ReactNode }) {
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/40 p-4"><section className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="text-base font-semibold text-ink">{title}</h2><button className="icon-button" onClick={close}><X className="h-4 w-4" /></button></div><div className="mt-4 space-y-4">{children}</div><div className="mt-5 flex justify-end gap-2"><button className="secondary-button" onClick={close} disabled={busy}>取消</button><button className="primary-button" onClick={save} disabled={busy}>{busy ? "正在保存" : "保存"}</button></div></section></div>;
}

function ChangePasswordDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit() {
    setError("");
    if (newPassword.length < 8) { setError("新密码至少需要 8 个字符"); return; }
    if (newPassword !== confirmation) { setError("两次输入的新密码不一致"); return; }
    setBusy(true);
    try { await postJson("/api/auth/change-password", { currentPassword, newPassword }); onSuccess(); }
    catch (nextError) { setError(apiErrorMessage(nextError, "修改密码失败")); }
    finally { setBusy(false); }
  }
  return <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/45 p-4"><section className="w-full max-w-md rounded-md bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-ink">修改登录密码</h2><p className="mt-1 text-xs text-muted">新密码至少 8 个字符。</p></div><button className="icon-button" onClick={onClose}><X className="h-4 w-4" /></button></div><div className="mt-5 space-y-4"><label><span className="label">当前密码</span><input className="field" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label><span className="label">新密码</span><input className="field" type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label><span className="label">再次输入新密码</span><input className="field" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label></div>{error ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}<div className="mt-5 flex justify-end gap-2"><button className="secondary-button" onClick={onClose} disabled={busy}>取消</button><button className="primary-button" onClick={() => void submit()} disabled={busy || !currentPassword || !newPassword || !confirmation}><KeyRound className="h-4 w-4" />{busy ? "正在修改" : "确认修改"}</button></div></section></div>;
}

function LoadingPanel() { return <section className="panel flex min-h-56 items-center justify-center text-sm text-muted"><RefreshCw className="mr-2 h-4 w-4 animate-spin" />正在读取条码追踪数据...</section>; }
function ErrorPanel({ message, retry }: { message: string; retry: () => void }) { return <section className="panel flex min-h-56 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm font-semibold text-danger">数据连接异常</p><p className="max-w-lg text-sm text-muted">{message}</p><button className="secondary-button" onClick={retry}><RefreshCw className="h-4 w-4" />重新连接</button></section>; }
function DetailLoadingDialog() { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30"><div className="rounded-md bg-white px-5 py-4 text-sm text-muted shadow-xl"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />正在读取条码履历</div></div>; }
function OrderDetailLoadingDialog() { return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/30"><div className="rounded-md bg-white px-5 py-4 text-sm text-muted shadow-xl"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin" />正在计算单据签收进度</div></div>; }
function SummaryRow({ label, value }: { label: string; value: number }) { return <div className="flex items-center justify-between border-b border-slate-100 pb-2 last:border-0 last:pb-0"><dt className="text-slate-500">{label}</dt><dd className="font-semibold text-slate-700">{value} 件</dd></div>; }
function DetailMetric({ label, value }: { label: string; value: string }) { return <div className="bg-white p-4"><p className="text-xs text-muted">{label}</p><p className="mt-1 text-sm font-semibold text-slate-700">{value}</p></div>; }
function ReviewStatusBadge({ status }: { status: TrackingOrderSummary["reviewStatus"] }) { const classes = status === "reviewed" ? "border-emerald-200 bg-emerald-50 text-work" : status === "exempt" ? "border-slate-200 bg-slate-50 text-slate-500" : "border-amber-200 bg-amber-50 text-amber-700"; return <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-xs font-semibold ${classes}`}>{status === "reviewed" ? "已复核" : status === "exempt" ? "历史免复核" : "待复核"}</span>; }
function LifecycleBadge({ label, tone }: { label: string; tone: "danger" | "neutral" }) { return <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-xs font-semibold ${tone === "danger" ? "border-red-200 bg-red-50 text-danger" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{label}</span>; }
function MasterStatus({ status }: { status: "enabled" | "disabled" }) { return <span className={`rounded-md border px-2 py-1 text-xs font-semibold ${status === "enabled" ? "border-emerald-200 bg-emerald-50 text-work" : "border-slate-200 bg-slate-50 text-slate-500"}`}>{status === "enabled" ? "启用" : "停用"}</span>; }
function ReceiptBadge({ status }: { status: TrackingReceiptStatus }) { const classes = status === "signed" ? "border-emerald-200 bg-emerald-50 text-work" : status === "exception" ? "border-red-200 bg-red-50 text-danger" : "border-amber-200 bg-amber-50 text-amber-700"; return <span className={`inline-flex rounded-md border px-2 py-1 text-xs font-semibold ${classes}`}>{receiptStatusLabel(status)}</span>; }
function segmentClass(active: boolean) { return `flex h-10 items-center justify-center gap-2 rounded-md px-3 text-sm font-semibold transition ${active ? "bg-white text-work shadow-sm" : "text-slate-500 hover:text-slate-700"}`; }
function parseBarcodeInput(value: string) { return uniqueBarcodes(value.split(/[\s,，;；]+/).map((item) => item.trim()).filter(Boolean)); }
function toReviewMap(results: ValidationResult[]): ReviewMap { return Object.fromEntries(results.map((result) => [result.barcode, { tone: result.ok ? "success" : "error", label: result.label, detail: result.detail }])); }
function createClientRequestId() { return globalThis.crypto?.randomUUID?.() ?? `web-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; }
function isUncertainSubmission(error: unknown) { return !(error instanceof ClientApiError) || error.status >= 500; }
function receiptStatusLabel(status: TrackingReceiptStatus) { return status === "signed" ? "已签收" : status === "exception" ? "签收异常" : "待签收"; }
function syncStatusLabel(status: "running" | "success" | "failure") { return status === "success" ? "最近同步成功" : status === "failure" ? "最近同步失败" : "正在同步"; }
function trackingOrderLabel(type: TrackingOrderType) { return type === "sales_outbound" ? "销售出库" : type === "transfer" ? "仓库流转" : "扫码回库"; }
function formatReceiptRate(rate: number | null) { return rate === null ? "—" : `${rate.toLocaleString("zh-CN", { maximumFractionDigits: 1 })}%`; }
function movementTypeLabel(type: TrackingMovement["type"]) { const labels: Record<TrackingMovement["type"], string> = { legacy_inbound: "历史入库", sales_outbound: "销售出库", transfer: "仓库流转", return: "扫码回库", qince_receipt: "勤策签收", order_reversal: "单据撤销", barcode_correction: "条码更正", order_correction: "出库纠正", tracking_void: "撤销追踪", write_off: "货物核销" }; return labels[type]; }
function ownerLabel(item: TrackedBarcode, warehouses: WarehouseRecord[], salespeople: Salesperson[]) { if (item.currentOwnerType === "terminal_store") return `终端店铺：${item.terminalStoreName ?? "未知"}`; if (item.currentOwnerType === "salesperson") return `销售人员：${salespeople.find((person) => person.id === item.salespersonId)?.name ?? "未知"}`; return `仓库：${warehouses.find((warehouse) => warehouse.id === item.warehouseId)?.name ?? "未知"}`; }
function trackingOrderItemOwnerLabel(item: TrackingOrderBarcodeDetail, warehouseNames: Map<string, string>, salespersonNames: Map<string, string>) { if (item.currentOwnerType === "terminal_store") return `终端店铺：${item.terminalStoreName ?? "未知"}`; if (item.currentOwnerType === "salesperson") return `销售人员：${salespersonNames.get(item.salespersonId ?? "") ?? "未知"}`; return `仓库：${warehouseNames.get(item.warehouseId ?? "") ?? "未知"}`; }
