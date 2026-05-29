import { getPrisma } from "@/lib/db";
import type {
  Goods,
  GoodsCategory,
  Salesperson,
  StorageLocation,
  TerminalStore,
  Warehouse,
  WarehouseState,
  WarehouseType
} from "@/lib/types";

type DbRecordStatus = "ENABLED" | "DISABLED";
type DbGoodsCategory = "HEALTH_WINE" | "BAIJIU";
type DbWarehouseType = "MAIN" | "BRANCH";

type DbGoods = {
  id: string;
  code: string;
  name: string;
  category: DbGoodsCategory;
  unit: string;
  spec: string;
  status: DbRecordStatus;
};

type DbWarehouse = {
  id: string;
  code: string;
  name: string;
  type: DbWarehouseType;
  parentId: string | null;
  manager: string;
  status: DbRecordStatus;
};

type DbStorageLocation = {
  id: string;
  warehouseId: string;
  zone: string;
  code: string;
  name: string;
  status: DbRecordStatus;
};

type DbSalesperson = {
  id: string;
  code: string;
  name: string;
  phone: string;
  region: string;
  status: DbRecordStatus;
};

type DbTerminalStore = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  address: string;
};

export type CreateGoodsInput = {
  code: string;
  name: string;
  category: GoodsCategory;
  unit: string;
  spec: string;
};

export type CreateWarehouseInput = {
  code: string;
  name: string;
  manager: string;
};

export type CreateSalespersonInput = {
  code: string;
  name: string;
  phone: string;
  region: string;
};

export type CreateTerminalStoreInput = {
  name: string;
  contact: string;
  phone: string;
  address: string;
};

export async function listMasterData(): Promise<
  Pick<WarehouseState, "goods" | "warehouses" | "locations" | "salespeople" | "terminalStores">
> {
  const prisma = getPrisma();
  const [goods, warehouses, locations, salespeople, terminalStores] = await Promise.all([
    prisma.goods.findMany({ orderBy: { code: "asc" } }),
    prisma.warehouse.findMany({ orderBy: [{ type: "asc" }, { code: "asc" }] }),
    prisma.storageLocation.findMany({ orderBy: [{ warehouseId: "asc" }, { code: "asc" }] }),
    prisma.salesperson.findMany({ orderBy: { code: "asc" } }),
    prisma.terminalStore.findMany({ orderBy: { name: "asc" } })
  ]);

  return {
    goods: goods.map(mapGoods),
    warehouses: warehouses.map(mapWarehouse),
    locations: locations.map(mapStorageLocation),
    salespeople: salespeople.map(mapSalesperson),
    terminalStores: terminalStores.map(mapTerminalStore)
  };
}

export async function createGoods(input: CreateGoodsInput) {
  assertRequired(input.code, "货物编码");
  assertRequired(input.name, "货物名称");
  assertRequired(input.unit, "单位");
  assertRequired(input.spec, "规格");

  const prisma = getPrisma();
  const created = await prisma.goods.create({
    data: {
      code: input.code.trim(),
      name: input.name.trim(),
      category: toDbGoodsCategory(input.category),
      unit: input.unit.trim(),
      spec: input.spec.trim(),
      status: "ENABLED"
    }
  });

  return mapGoods(created);
}

export async function createBranchWarehouse(input: CreateWarehouseInput) {
  assertRequired(input.code, "分仓编码");
  assertRequired(input.name, "分仓名称");
  assertRequired(input.manager, "负责人");

  const prisma = getPrisma();
  return prisma.$transaction(async (tx) => {
    const mainWarehouse = await tx.warehouse.findFirst({
      where: { type: "MAIN", status: "ENABLED" },
      orderBy: { code: "asc" }
    });

    if (!mainWarehouse) {
      throw new Error("请先创建启用状态的总仓");
    }

    const code = input.code.trim();
    const name = input.name.trim();
    const warehouse = await tx.warehouse.create({
      data: {
        code,
        name,
        type: "BRANCH",
        parentId: mainWarehouse.id,
        manager: input.manager.trim(),
        status: "ENABLED"
      }
    });

    const location = await tx.storageLocation.create({
      data: {
        warehouseId: warehouse.id,
        zone: "默认区",
        code: `${code}-01`,
        name: `${name}默认库位`,
        status: "ENABLED"
      }
    });

    return {
      warehouse: mapWarehouse(warehouse),
      location: mapStorageLocation(location)
    };
  });
}

export async function createSalesperson(input: CreateSalespersonInput) {
  assertRequired(input.code, "销售人员编码");
  assertRequired(input.name, "销售人员姓名");
  assertRequired(input.phone, "手机号");
  assertRequired(input.region, "区域");

  const prisma = getPrisma();
  const created = await prisma.salesperson.create({
    data: {
      code: input.code.trim(),
      name: input.name.trim(),
      phone: input.phone.trim(),
      region: input.region.trim(),
      status: "ENABLED"
    }
  });

  return mapSalesperson(created);
}

export async function createTerminalStore(input: CreateTerminalStoreInput) {
  assertRequired(input.name, "店铺名称");
  assertRequired(input.contact, "联系人");
  assertRequired(input.phone, "电话");
  assertRequired(input.address, "地址");

  const prisma = getPrisma();
  const created = await prisma.terminalStore.create({
    data: {
      name: input.name.trim(),
      contact: input.contact.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
      status: "ENABLED"
    }
  });

  return mapTerminalStore(created);
}

function assertRequired(value: string, label: string) {
  if (!value?.trim()) {
    throw new Error(`${label}不能为空`);
  }
}

function mapStatus(status: DbRecordStatus) {
  return status === "ENABLED" ? "enabled" : "disabled";
}

function mapGoodsCategory(category: DbGoodsCategory): GoodsCategory {
  return category === "HEALTH_WINE" ? "health_wine" : "baijiu";
}

function toDbGoodsCategory(category: GoodsCategory): DbGoodsCategory {
  return category === "health_wine" ? "HEALTH_WINE" : "BAIJIU";
}

function mapWarehouseType(type: DbWarehouseType): WarehouseType {
  return type === "MAIN" ? "main" : "branch";
}

function mapGoods(goods: DbGoods): Goods {
  return {
    id: goods.id,
    code: goods.code,
    name: goods.name,
    category: mapGoodsCategory(goods.category),
    unit: goods.unit,
    spec: goods.spec,
    status: mapStatus(goods.status)
  };
}

function mapWarehouse(warehouse: DbWarehouse): Warehouse {
  return {
    id: warehouse.id,
    code: warehouse.code,
    name: warehouse.name,
    type: mapWarehouseType(warehouse.type),
    parentId: warehouse.parentId ?? undefined,
    manager: warehouse.manager,
    status: mapStatus(warehouse.status)
  };
}

function mapStorageLocation(location: DbStorageLocation): StorageLocation {
  return {
    id: location.id,
    warehouseId: location.warehouseId,
    zone: location.zone,
    code: location.code,
    name: location.name,
    status: mapStatus(location.status)
  };
}

function mapSalesperson(salesperson: DbSalesperson): Salesperson {
  return {
    id: salesperson.id,
    code: salesperson.code,
    name: salesperson.name,
    phone: salesperson.phone,
    region: salesperson.region,
    status: mapStatus(salesperson.status)
  };
}

function mapTerminalStore(store: DbTerminalStore): TerminalStore {
  return {
    id: store.id,
    name: store.name,
    contact: store.contact,
    phone: store.phone,
    address: store.address
  };
}
