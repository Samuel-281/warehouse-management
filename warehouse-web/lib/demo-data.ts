import type {
  Goods,
  InventoryItem,
  Salesperson,
  StockMovement,
  StorageLocation,
  TerminalStore,
  Warehouse,
  WarehouseState
} from "./types";

export const goods: Goods[] = [
  {
    id: "goods-hj-001",
    code: "HJ-001",
    name: "鹿泉保健酒 500ml",
    category: "health_wine",
    unit: "瓶",
    spec: "500ml/瓶，12瓶/箱",
    status: "enabled"
  },
  {
    id: "goods-bj-001",
    code: "BJ-001",
    name: "青山白酒 52度",
    category: "baijiu",
    unit: "瓶",
    spec: "500ml/瓶，6瓶/箱",
    status: "enabled"
  },
  {
    id: "goods-hj-002",
    code: "HJ-002",
    name: "参杞保健酒礼盒",
    category: "health_wine",
    unit: "盒",
    spec: "2瓶/盒",
    status: "enabled"
  }
];

export const warehouses: Warehouse[] = [
  {
    id: "wh-main",
    code: "ZC-001",
    name: "市区总仓",
    type: "main",
    manager: "周主管",
    status: "enabled"
  },
  {
    id: "wh-county-a",
    code: "FC-101",
    name: "东山县分仓",
    type: "branch",
    parentId: "wh-main",
    manager: "刘库管",
    status: "enabled"
  },
  {
    id: "wh-town-b",
    code: "FC-202",
    name: "南河镇分仓",
    type: "branch",
    parentId: "wh-main",
    manager: "陈库管",
    status: "enabled"
  }
];

export const locations: StorageLocation[] = [
  {
    id: "loc-main-a1",
    warehouseId: "wh-main",
    zone: "A区",
    code: "A-01-01",
    name: "A区一排一层",
    status: "enabled"
  },
  {
    id: "loc-main-b2",
    warehouseId: "wh-main",
    zone: "B区",
    code: "B-02-01",
    name: "B区二排一层",
    status: "enabled"
  },
  {
    id: "loc-county-a1",
    warehouseId: "wh-county-a",
    zone: "常温区",
    code: "C-01",
    name: "东山常温一号位",
    status: "enabled"
  },
  {
    id: "loc-town-b1",
    warehouseId: "wh-town-b",
    zone: "暂存区",
    code: "T-01",
    name: "南河暂存一号位",
    status: "enabled"
  }
];

export const salespeople: Salesperson[] = [
  {
    id: "sp-001",
    code: "XS-001",
    name: "王明",
    phone: "13800010001",
    region: "东山片区",
    status: "enabled"
  },
  {
    id: "sp-002",
    code: "XS-002",
    name: "李娜",
    phone: "13800010002",
    region: "南河片区",
    status: "enabled"
  },
  {
    id: "sp-003",
    code: "XS-003",
    name: "赵强",
    phone: "13800010003",
    region: "市区直营",
    status: "enabled"
  }
];

export const terminalStores: TerminalStore[] = [
  {
    id: "store-001",
    name: "东山惠民烟酒店",
    contact: "孙店长",
    phone: "13700020001",
    address: "东山县人民路 18 号"
  },
  {
    id: "store-002",
    name: "南河镇便民超市",
    contact: "马经理",
    phone: "13700020002",
    address: "南河镇中心街 6 号"
  }
];

const now = "2026-05-29 09:00";

export const inventoryItems: InventoryItem[] = [
  {
    id: "item-001",
    barcode: "HJ202605290001",
    goodsId: "goods-hj-001",
    ownerType: "warehouse",
    warehouseId: "wh-main",
    locationId: "loc-main-a1",
    status: "in_stock",
    inboundSource: "factory",
    lastMovedAt: now
  },
  {
    id: "item-002",
    barcode: "HJ202605290002",
    goodsId: "goods-hj-001",
    ownerType: "warehouse",
    warehouseId: "wh-county-a",
    locationId: "loc-county-a1",
    status: "in_stock",
    inboundSource: "factory",
    lastMovedAt: "2026-05-29 09:30"
  },
  {
    id: "item-003",
    barcode: "BJ202605290001",
    goodsId: "goods-bj-001",
    ownerType: "warehouse",
    warehouseId: "wh-main",
    locationId: "loc-main-b2",
    status: "in_stock",
    inboundSource: "factory",
    lastMovedAt: "2026-05-29 10:00"
  },
  {
    id: "item-004",
    barcode: "TH202605290001",
    goodsId: "goods-hj-002",
    ownerType: "warehouse",
    warehouseId: "wh-main",
    locationId: "loc-main-a1",
    status: "in_stock",
    productionDate: "2025-11-12",
    shelfLifeDate: "2028-11-12",
    inboundSource: "terminal_return",
    lastMovedAt: "2026-05-29 10:20"
  },
  {
    id: "item-005",
    barcode: "XS202605290001",
    goodsId: "goods-bj-001",
    ownerType: "salesperson",
    salespersonId: "sp-001",
    status: "with_salesperson",
    inboundSource: "factory",
    lastMovedAt: "2026-05-29 11:00"
  }
];

export const movements: StockMovement[] = [
  {
    id: "mv-001",
    itemId: "item-001",
    barcode: "HJ202605290001",
    goodsId: "goods-hj-001",
    type: "factory_inbound",
    fromLabel: "无库存",
    toLabel: "市区总仓 / A区一排一层",
    operator: "仓库操作员",
    occurredAt: now,
    note: "厂家到货入库"
  },
  {
    id: "mv-002",
    itemId: "item-002",
    barcode: "HJ202605290002",
    goodsId: "goods-hj-001",
    type: "transfer",
    fromLabel: "市区总仓",
    toLabel: "东山县分仓 / 东山常温一号位",
    operator: "仓库操作员",
    occurredAt: "2026-05-29 09:30",
    note: "挪仓到分仓"
  },
  {
    id: "mv-003",
    itemId: "item-003",
    barcode: "BJ202605290001",
    goodsId: "goods-bj-001",
    type: "factory_inbound",
    fromLabel: "无库存",
    toLabel: "市区总仓 / B区二排一层",
    operator: "仓库操作员",
    occurredAt: "2026-05-29 10:00",
    note: "厂家到货入库"
  },
  {
    id: "mv-004",
    itemId: "item-004",
    barcode: "TH202605290001",
    goodsId: "goods-hj-002",
    type: "terminal_return_inbound",
    fromLabel: "东山惠民烟酒店",
    toLabel: "市区总仓 / A区一排一层",
    operator: "仓库操作员",
    occurredAt: "2026-05-29 10:20",
    note: "终端店铺退换货入库，生产日期 2025-11-12"
  },
  {
    id: "mv-005",
    itemId: "item-005",
    barcode: "XS202605290001",
    goodsId: "goods-bj-001",
    type: "sales_outbound",
    fromLabel: "市区总仓",
    toLabel: "销售人员：王明",
    operator: "仓库操作员",
    occurredAt: "2026-05-29 11:00",
    note: "销售出库"
  }
];

export const initialState: WarehouseState = {
  goods,
  warehouses,
  locations,
  salespeople,
  terminalStores,
  inventoryItems,
  movements
};
