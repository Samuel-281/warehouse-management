export type GoodsCategory = "health_wine" | "baijiu";
export type WarehouseType = "main" | "branch";
export type OwnerType = "warehouse" | "salesperson";
export type ItemStatus = "in_stock" | "with_salesperson";
export type InboundSource = "factory" | "terminal_return";
export type OutboundType = "transfer" | "sales";
export type MovementType =
  | "factory_inbound"
  | "terminal_return_inbound"
  | "transfer"
  | "sales_outbound"
  | "sales_return";

export type Goods = {
  id: string;
  code: string;
  name: string;
  category: GoodsCategory;
  unit: string;
  spec: string;
  status: "enabled" | "disabled";
};

export type Warehouse = {
  id: string;
  code: string;
  name: string;
  type: WarehouseType;
  parentId?: string;
  manager: string;
  status: "enabled" | "disabled";
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

export type WarehouseState = {
  goods: Goods[];
  warehouses: Warehouse[];
  locations: StorageLocation[];
  salespeople: Salesperson[];
  terminalStores: TerminalStore[];
  inventoryItems: InventoryItem[];
  movements: StockMovement[];
};

export type Toast = {
  tone: "success" | "error" | "info";
  message: string;
};
