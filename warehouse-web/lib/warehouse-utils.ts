import type {
  Goods,
  GoodsCategory,
  InventoryItem,
  MovementType,
  Salesperson,
  StorageLocation,
  Warehouse
} from "./types";

export function formatCategory(category: GoodsCategory) {
  return category === "health_wine" ? "保健酒" : "白酒";
}

export function formatMovementType(type: MovementType) {
  const labels: Record<MovementType, string> = {
    factory_inbound: "厂家到货入库",
    terminal_return_inbound: "终端退换货入库",
    transfer: "挪仓",
    sales_outbound: "销售出库",
    sales_return: "销售退回",
    order_reversal: "单据撤销",
    barcode_correction: "条码更正",
    write_off: "货物核销",
    manual_adjustment: "人工库存修正"
  };

  return labels[type];
}

export function addYears(dateString: string, years: number) {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

export function nowText() {
  const date = new Date();
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export function formatAppDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const valueOf = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${valueOf("year")}-${valueOf("month")}-${valueOf("day")} ${valueOf("hour")}:${valueOf("minute")}`;
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function warehouseLabel(
  warehouseId: string | undefined,
  warehouses: Warehouse[],
  locationId?: string,
  locations?: StorageLocation[]
) {
  const warehouse = warehouses.find((item) => item.id === warehouseId);
  const location = locations?.find((item) => item.id === locationId);
  if (!warehouse) return "未知仓库";
  return location ? `${warehouse.name} / ${location.name}` : warehouse.name;
}

export function ownerLabel(
  item: InventoryItem,
  warehouses: Warehouse[],
  salespeople: Salesperson[],
  locations: StorageLocation[]
) {
  if (item.ownerType === "salesperson") {
    const salesperson = salespeople.find((entry) => entry.id === item.salespersonId);
    return `销售人员：${salesperson?.name ?? "未知"}`;
  }
  if (item.ownerType === "terminal_store") {
    return `终端店铺：${item.terminalStoreName ?? "未知"}`;
  }

  return warehouseLabel(item.warehouseId, warehouses, item.locationId, locations);
}

export function goodsLabel(goodsId: string, goods: Goods[]) {
  const found = goods.find((item) => item.id === goodsId);
  return found ? `${found.name} (${found.code})` : "未知货物";
}

export function enabledLocationsForWarehouse(
  warehouseId: string,
  locations: StorageLocation[]
) {
  return locations.filter(
    (location) => location.warehouseId === warehouseId && location.status === "enabled"
  );
}

export function uniqueBarcodes(input: string[]) {
  return Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)));
}
