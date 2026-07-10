export type GoodsCategory = "health_wine" | "baijiu";
export type WarehouseType = "warehouse";
export type OwnerType = "warehouse" | "salesperson";
export type ItemStatus = "in_stock" | "with_salesperson" | "written_off" | "voided";
export type OrderStatus = "active" | "voided";
export type InboundSource = "factory" | "terminal_return";
export type OutboundType = "transfer" | "sales" | "direct";
export type MovementType =
  | "factory_inbound"
  | "terminal_return_inbound"
  | "transfer"
  | "sales_outbound"
  | "sales_return"
  | "order_reversal"
  | "barcode_correction"
  | "write_off"
  | "manual_adjustment";

export type UserRoleCode = "SUPER_ADMIN" | "WAREHOUSE_ADMIN" | "INVENTORY_VIEWER";

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string;
  roles: Array<{
    code: UserRoleCode;
    name: string;
  }>;
};

export type ManagedUser = CurrentUser & {
  status: "enabled" | "disabled";
  createdAt: string;
};

export type Goods = {
  id: string;
  code: string;
  name: string;
  category: GoodsCategory;
  unit: string;
  spec: string;
  status: "enabled" | "disabled";
  sortOrder: number;
};

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  type: WarehouseType;
  parentId?: string;
  manager: string;
  status: "enabled" | "disabled";
  sortOrder: number;
};

export type StorageLocation = {
  id: string;
  warehouseId: string;
  zone: string;
  code: string;
  name: string;
  status: "enabled" | "disabled";
};

export type Salesperson = {
  id: string;
  code: string;
  name: string;
  phone: string;
  region: string;
  status: "enabled" | "disabled";
};

export type TerminalStore = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  address: string;
  status: "enabled" | "disabled";
};

export type InventoryItem = {
  id: string;
  barcode: string;
  goodsId: string;
  ownerType: OwnerType;
  warehouseId?: string;
  locationId?: string;
  salespersonId?: string;
  status: ItemStatus;
  productionDate?: string;
  shelfLifeDate?: string;
  inboundSource: InboundSource;
  lastMovedAt: string;
};

export type StockMovement = {
  id: string;
  itemId: string;
  barcode: string;
  goodsId: string;
  type: MovementType;
  fromLabel: string;
  toLabel: string;
  operator: string;
  occurredAt: string;
  note: string;
};

export type WarehouseStock = {
  id: string;
  warehouseId: string;
  goodsId: string;
  quantity: number;
  lastChangedAt: string;
};

export type WarehouseStockMovement = {
  id: string;
  warehouseId: string;
  goodsId: string;
  type: MovementType;
  quantityChange: number;
  balanceAfter: number;
  orderKind?: string;
  orderId?: string;
  barcode?: string;
  counterparty?: string;
  operator: string;
  occurredAt: string;
  note: string;
};

export type InventorySummary = {
  totalItems: number;
  inStock: number;
  withSales: number;
  totalWarehouseQuantity: number;
  warehouseStocks: WarehouseStock[];
  recentStockMovements: WarehouseStockMovement[];
  warehouseCounts: Array<{
    warehouseId: string;
    count: number;
  }>;
  salespersonCounts: Array<{
    salespersonId: string;
    count: number;
  }>;
  recentMovements: StockMovement[];
};

export type InventoryListResult = {
  items: InventoryItem[];
  latestMovements: StockMovement[];
  total: number;
  warehouseResultCount: number;
  salesResultCount: number;
  page: number;
  pageSize: number;
};

export type InventoryDetailResult = {
  item: InventoryItem;
  movements: StockMovement[];
  corrections: BarcodeCorrection[];
};

export type BarcodeCorrection = {
  id: string;
  oldBarcode: string;
  newBarcode: string;
  reason: string;
  operator: string;
  occurredAt: string;
};

export type OperationLog = {
  id: string;
  username: string;
  action: string;
  targetType: string;
  targetId?: string;
  result: "SUCCESS" | "FAILURE";
  detail?: string;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
};

export type OrderKind = "inbound" | "outbound" | "sales_return";

export type OrderSummary = {
  id: string;
  orderNo: string;
  kind: OrderKind;
  businessType: string;
  primaryTarget: string;
  counterparty?: string;
  operator: string;
  createdAt: string;
  itemCount: number;
  goodsSummary: string;
  barcodePreview: string;
  barcodes: string[];
  status: OrderStatus;
  reversalSupported: boolean;
  voidedAt?: string;
  voidedBy?: string;
  voidReason?: string;
};

export type WarehouseState = {
  goods: Goods[];
  warehouses: Warehouse[];
  locations: StorageLocation[];
  salespeople: Salesperson[];
  terminalStores: TerminalStore[];
  warehouseStocks: WarehouseStock[];
  inventoryItems: InventoryItem[];
  movements: StockMovement[];
};

export type Toast = {
  tone: "success" | "error" | "info";
  message: string;
};
