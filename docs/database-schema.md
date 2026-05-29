# 仓库货物管理软件数据库设计文档

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档名称 | 仓库货物管理软件数据库设计文档 |
| 当前版本 | v0.1 |
| 创建日期 | 2026-05-29 |
| 适用阶段 | 原型后正式落地阶段 |
| 文档状态 | 草稿，待开发验证 |

## 2. 设计原则

1. 以单件条码为库存核心，而不是只记录数量。
2. 每个库存操作都要能追溯到具体条码。
3. 库存当前状态和库存流水分开存储。
4. 库存流水只追加，不修改历史记录。
5. 基础资料支持停用，不直接删除。
6. 先满足两级仓库：总仓和分仓。

## 3. 核心实体

第一阶段建议包含以下实体：

1. 用户与角色。
2. 货物资料。
3. 仓库资料。
4. 库位资料。
5. 销售人员。
6. 终端店铺。
7. 单件条码库存。
8. 库存流水。
9. 入库单。
10. 出库单。
11. 销售退回单。

## 4. 枚举设计

| 枚举 | 可选值 | 说明 |
| --- | --- | --- |
| `GoodsCategory` | `HEALTH_WINE`, `BAIJIU` | 保健酒、白酒 |
| `WarehouseType` | `MAIN`, `BRANCH` | 总仓、分仓 |
| `RecordStatus` | `ENABLED`, `DISABLED` | 启用、停用 |
| `OwnerType` | `WAREHOUSE`, `SALESPERSON` | 当前归属类型 |
| `ItemStatus` | `IN_STOCK`, `WITH_SALESPERSON` | 单件库存状态 |
| `InboundSource` | `FACTORY`, `TERMINAL_RETURN` | 厂家到货、终端店铺退换货 |
| `OutboundType` | `TRANSFER`, `SALES` | 挪仓、销售出库 |
| `MovementType` | `FACTORY_INBOUND`, `TERMINAL_RETURN_INBOUND`, `TRANSFER`, `SALES_OUTBOUND`, `SALES_RETURN` | 库存流水类型 |

## 5. 表结构草案

### 5.1 `goods`

货物资料表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `code` | String, Unique | 货物编码 |
| `name` | String | 货物名称 |
| `category` | GoodsCategory | 货物大类 |
| `unit` | String | 单位 |
| `spec` | String | 规格 |
| `status` | RecordStatus | 状态 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

### 5.2 `warehouses`

仓库资料表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `code` | String, Unique | 仓库编码 |
| `name` | String | 仓库名称 |
| `type` | WarehouseType | 总仓或分仓 |
| `parentId` | UUID, Nullable | 分仓所属总仓 |
| `manager` | String | 负责人 |
| `status` | RecordStatus | 状态 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

规则：

1. 总仓 `parentId` 为空。
2. 分仓 `parentId` 指向总仓。
3. 第一阶段只允许一层分仓，不做多级递归。

### 5.3 `storage_locations`

库位资料表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `warehouseId` | UUID | 所属仓库 |
| `zone` | String | 库区 |
| `code` | String | 库位编码 |
| `name` | String | 库位名称 |
| `status` | RecordStatus | 状态 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

建议唯一约束：

1. `warehouseId + code` 唯一。

### 5.4 `salespeople`

销售人员表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `code` | String, Unique | 销售人员编码 |
| `name` | String | 姓名 |
| `phone` | String | 手机号 |
| `region` | String | 所属区域 |
| `status` | RecordStatus | 状态 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

### 5.5 `terminal_stores`

终端店铺表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `name` | String | 店铺名称 |
| `contact` | String | 联系人 |
| `phone` | String | 电话 |
| `address` | String | 地址 |
| `status` | RecordStatus | 状态 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

### 5.6 `inventory_items`

单件条码库存表，用于表示每件货物当前状态。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `barcode` | String, Unique | 单件条码 |
| `goodsId` | UUID | 货物 |
| `ownerType` | OwnerType | 当前归属类型 |
| `warehouseId` | UUID, Nullable | 当前所在仓库 |
| `locationId` | UUID, Nullable | 当前库位 |
| `salespersonId` | UUID, Nullable | 当前所属销售人员 |
| `status` | ItemStatus | 当前状态 |
| `productionDate` | Date, Nullable | 生产日期 |
| `shelfLifeDate` | Date, Nullable | 保质期截止日期 |
| `inboundSource` | InboundSource | 首次进入系统来源 |
| `lastMovedAt` | DateTime | 最近流转时间 |
| `createdAt` | DateTime | 创建时间 |
| `updatedAt` | DateTime | 更新时间 |

规则：

1. `barcode` 必须唯一。
2. `ownerType = WAREHOUSE` 时，`warehouseId` 必填，`salespersonId` 为空。
3. `ownerType = SALESPERSON` 时，`salespersonId` 必填，`warehouseId` 和 `locationId` 为空。

### 5.7 `stock_movements`

库存流水表，用于记录每次单件货物流转。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `itemId` | UUID | 单件库存 |
| `barcode` | String | 冗余条码，方便查询 |
| `goodsId` | UUID | 货物 |
| `type` | MovementType | 流水类型 |
| `fromLabel` | String | 来源描述 |
| `toLabel` | String | 去向描述 |
| `operatorId` | UUID, Nullable | 操作人 |
| `operatorName` | String | 操作人名称 |
| `occurredAt` | DateTime | 发生时间 |
| `note` | String | 备注 |

规则：

1. 流水只追加，不编辑。
2. 库存当前状态以 `inventory_items` 为准，历史过程以 `stock_movements` 为准。

### 5.8 `inbound_orders`

入库单主表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `orderNo` | String, Unique | 入库单号 |
| `source` | InboundSource | 入库来源 |
| `warehouseId` | UUID | 入库仓库 |
| `locationId` | UUID | 入库库位 |
| `terminalStoreId` | UUID, Nullable | 终端店铺来源 |
| `operatorId` | UUID, Nullable | 操作人 |
| `operatorName` | String | 操作人名称 |
| `createdAt` | DateTime | 创建时间 |

### 5.9 `inbound_order_items`

入库单明细表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `orderId` | UUID | 入库单 |
| `inventoryItemId` | UUID | 单件库存 |
| `barcode` | String | 条码 |
| `goodsId` | UUID | 货物 |
| `productionDate` | Date, Nullable | 生产日期 |
| `shelfLifeDate` | Date, Nullable | 保质期 |

### 5.10 `outbound_orders`

出库单主表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `orderNo` | String, Unique | 出库单号 |
| `type` | OutboundType | 挪仓或销售出库 |
| `sourceWarehouseId` | UUID | 出库仓库 |
| `targetWarehouseId` | UUID, Nullable | 挪仓目标分仓 |
| `targetLocationId` | UUID, Nullable | 挪仓目标库位 |
| `salespersonId` | UUID, Nullable | 销售人员 |
| `operatorId` | UUID, Nullable | 操作人 |
| `operatorName` | String | 操作人名称 |
| `createdAt` | DateTime | 创建时间 |

### 5.11 `outbound_order_items`

出库单明细表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `orderId` | UUID | 出库单 |
| `inventoryItemId` | UUID | 单件库存 |
| `barcode` | String | 条码 |
| `goodsId` | UUID | 货物 |

### 5.12 `sales_return_orders`

销售退回单主表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `orderNo` | String, Unique | 销售退回单号 |
| `returnWarehouseId` | UUID | 回流仓库 |
| `returnLocationId` | UUID | 回流库位 |
| `operatorId` | UUID, Nullable | 操作人 |
| `operatorName` | String | 操作人名称 |
| `createdAt` | DateTime | 创建时间 |

### 5.13 `sales_return_order_items`

销售退回单明细表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | UUID | 主键 |
| `orderId` | UUID | 销售退回单 |
| `inventoryItemId` | UUID | 单件库存 |
| `barcode` | String | 条码 |
| `goodsId` | UUID | 货物 |
| `fromSalespersonId` | UUID | 原所属销售人员 |

## 6. 关键索引建议

| 表 | 索引 |
| --- | --- |
| `inventory_items` | `barcode` 唯一索引 |
| `inventory_items` | `goodsId` |
| `inventory_items` | `warehouseId` |
| `inventory_items` | `salespersonId` |
| `stock_movements` | `barcode` |
| `stock_movements` | `itemId` |
| `stock_movements` | `occurredAt` |
| `goods` | `code` 唯一索引 |
| `warehouses` | `code` 唯一索引 |
| `salespeople` | `code` 唯一索引 |

## 7. 第一版 Prisma 落地顺序

1. 先建立基础资料表和单件库存/流水表。
2. 加入种子数据，保持与当前原型演示数据一致。
3. 接入基础资料 API。
4. 再加入入库、出库、销售退回单据表。
5. 将业务操作改为数据库事务。

## 8. 事务要求

以下操作必须使用数据库事务：

1. 厂家到货入库。
2. 终端店铺退换货入库。
3. 挪仓。
4. 销售出库。
5. 销售退回。

事务内需要同时完成：

1. 校验当前条码状态。
2. 新增或更新 `inventory_items`。
3. 新增对应业务单据。
4. 新增 `stock_movements`。

如果任一步失败，整次操作回滚。
