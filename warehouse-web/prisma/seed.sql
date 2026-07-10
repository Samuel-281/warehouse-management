-- Warehouse management prototype seed data.
-- Run this after the Prisma migration has created the PostgreSQL schema.

INSERT INTO roles (id, code, name, description, status, "createdAt", "updatedAt")
VALUES
  ('10000000-0000-0000-0000-000000000001', 'SUPER_ADMIN', '超级管理员', '拥有全部系统权限，可执行高危维护操作', 'ENABLED', now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'WAREHOUSE_ADMIN', '仓库管理员', '维护基础资料，执行入库、出库、退回和库存查询', 'ENABLED', now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'INVENTORY_VIEWER', '只读查询人员', '仅可查看库存和条码流转', 'ENABLED', now(), now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO users (id, username, "displayName", "passwordHash", status, "createdAt", "updatedAt")
VALUES
  ('11000000-0000-0000-0000-000000000001', 'super_admin', '超级管理员', 'demo123456', 'ENABLED', now(), now()),
  ('11000000-0000-0000-0000-000000000002', 'warehouse_admin', '仓库管理员', 'demo123456', 'ENABLED', now(), now()),
  ('11000000-0000-0000-0000-000000000003', 'inventory_viewer', '库存查询员', 'demo123456', 'ENABLED', now(), now())
ON CONFLICT (username) DO NOTHING;

INSERT INTO user_roles (id, "userId", "roleId")
VALUES
  ('12000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('12000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002'),
  ('12000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003')
ON CONFLICT ("userId", "roleId") DO NOTHING;

INSERT INTO goods (id, code, name, category, unit, spec, status, "sortOrder", "createdAt", "updatedAt")
VALUES
  ('20000000-0000-0000-0000-000000000001', 'HJ-001', '鹿泉保健酒 500ml', 'HEALTH_WINE', '瓶', '500ml/瓶，12瓶/箱', 'ENABLED', 10, now(), now()),
  ('20000000-0000-0000-0000-000000000002', 'BJ-001', '青山白酒 52度', 'BAIJIU', '瓶', '500ml/瓶，6瓶/箱', 'ENABLED', 20, now(), now()),
  ('20000000-0000-0000-0000-000000000003', 'HJ-002', '参杞保健酒礼盒', 'HEALTH_WINE', '盒', '2瓶/盒', 'ENABLED', 30, now(), now())
ON CONFLICT (code)
DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();

INSERT INTO warehouses (id, code, name, manager, status, "sortOrder", "createdAt", "updatedAt")
VALUES
  ('30000000-0000-0000-0000-000000000001', 'CK-001', '市区仓库', '周主管', 'ENABLED', 10, now(), now()),
  ('30000000-0000-0000-0000-000000000002', 'CK-101', '东山县仓库', '刘库管', 'ENABLED', 20, now(), now()),
  ('30000000-0000-0000-0000-000000000003', 'CK-202', '南河镇仓库', '陈库管', 'ENABLED', 30, now(), now())
ON CONFLICT (code)
DO UPDATE SET "sortOrder" = EXCLUDED."sortOrder", "updatedAt" = now();

INSERT INTO storage_locations (id, "warehouseId", zone, code, name, status, "createdAt", "updatedAt")
VALUES
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '默认区', 'DEFAULT', '默认库位', 'ENABLED', now(), now()),
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000002', '默认区', 'DEFAULT', '默认库位', 'ENABLED', now(), now()),
  ('31000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000003', '默认区', 'DEFAULT', '默认库位', 'ENABLED', now(), now())
ON CONFLICT ("warehouseId", code) DO NOTHING;

INSERT INTO salespeople (id, code, name, phone, region, status, "createdAt", "updatedAt")
VALUES
  ('40000000-0000-0000-0000-000000000001', 'XS-001', '王明', '13800010001', '东山片区', 'ENABLED', now(), now()),
  ('40000000-0000-0000-0000-000000000002', 'XS-002', '李娜', '13800010002', '南河片区', 'ENABLED', now(), now()),
  ('40000000-0000-0000-0000-000000000003', 'XS-003', '赵强', '13800010003', '市区直营', 'ENABLED', now(), now())
ON CONFLICT (code) DO NOTHING;

INSERT INTO terminal_stores (id, name, contact, phone, address, status, "createdAt", "updatedAt")
VALUES
  ('50000000-0000-0000-0000-000000000001', '东山惠民烟酒店', '孙店长', '13700020001', '东山县人民路 18 号', 'ENABLED', now(), now()),
  ('50000000-0000-0000-0000-000000000002', '南河镇便民超市', '马经理', '13700020002', '南河镇中心街 6 号', 'ENABLED', now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO inventory_items (
  id, barcode, "goodsId", "ownerType", "warehouseId", "locationId", "salespersonId",
  status, "productionDate", "shelfLifeDate", "inboundSource", "lastMovedAt", "createdAt", "updatedAt"
)
VALUES
  (
    '60000000-0000-0000-0000-000000000001',
    'HJ202605290001',
    '20000000-0000-0000-0000-000000000001',
    'WAREHOUSE',
    '30000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    NULL,
    'IN_STOCK',
    NULL,
    NULL,
    'FACTORY',
    '2026-05-29 09:00:00',
    now(),
    now()
  ),
  (
    '60000000-0000-0000-0000-000000000002',
    'HJ202605290002',
    '20000000-0000-0000-0000-000000000001',
    'WAREHOUSE',
    '30000000-0000-0000-0000-000000000002',
    '31000000-0000-0000-0000-000000000003',
    NULL,
    'IN_STOCK',
    NULL,
    NULL,
    'FACTORY',
    '2026-05-29 09:30:00',
    now(),
    now()
  ),
  (
    '60000000-0000-0000-0000-000000000003',
    'BJ202605290001',
    '20000000-0000-0000-0000-000000000002',
    'WAREHOUSE',
    '30000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    NULL,
    'IN_STOCK',
    NULL,
    NULL,
    'FACTORY',
    '2026-05-29 10:00:00',
    now(),
    now()
  ),
  (
    '60000000-0000-0000-0000-000000000004',
    'TH202605290001',
    '20000000-0000-0000-0000-000000000003',
    'WAREHOUSE',
    '30000000-0000-0000-0000-000000000001',
    '31000000-0000-0000-0000-000000000001',
    NULL,
    'IN_STOCK',
    '2025-11-12',
    '2028-11-12',
    'TERMINAL_RETURN',
    '2026-05-29 10:20:00',
    now(),
    now()
  ),
  (
    '60000000-0000-0000-0000-000000000005',
    'XS202605290001',
    '20000000-0000-0000-0000-000000000002',
    'SALESPERSON',
    NULL,
    NULL,
    '40000000-0000-0000-0000-000000000001',
    'WITH_SALESPERSON',
    NULL,
    NULL,
    'FACTORY',
    '2026-05-29 11:00:00',
    now(),
    now()
  )
ON CONFLICT (barcode) DO NOTHING;

INSERT INTO warehouse_stocks ("warehouseId", "goodsId", quantity, "lastChangedAt", "createdAt", "updatedAt")
SELECT
  "warehouseId",
  "goodsId",
  COUNT(*)::INTEGER AS quantity,
  MAX("lastMovedAt") AS "lastChangedAt",
  now(),
  now()
FROM inventory_items
WHERE "ownerType" = 'WAREHOUSE'
  AND "warehouseId" IS NOT NULL
GROUP BY "warehouseId", "goodsId"
ON CONFLICT ("warehouseId", "goodsId")
DO UPDATE SET
  quantity = EXCLUDED.quantity,
  "lastChangedAt" = EXCLUDED."lastChangedAt",
  "updatedAt" = now();

INSERT INTO stock_movements (
  id, "itemId", barcode, "goodsId", type, "fromLabel", "toLabel", "operatorId", "operatorName", "occurredAt", note
)
VALUES
  (
    '70000000-0000-0000-0000-000000000001',
    '60000000-0000-0000-0000-000000000001',
    'HJ202605290001',
    '20000000-0000-0000-0000-000000000001',
    'FACTORY_INBOUND',
    '无库存',
    '市区仓库 / 默认库位',
    '11000000-0000-0000-0000-000000000001',
    '仓库操作员',
    '2026-05-29 09:00:00',
    '厂家到货入库'
  ),
  (
    '70000000-0000-0000-0000-000000000002',
    '60000000-0000-0000-0000-000000000002',
    'HJ202605290002',
    '20000000-0000-0000-0000-000000000001',
    'TRANSFER',
    '市区仓库',
    '东山县仓库 / 默认库位',
    '11000000-0000-0000-0000-000000000001',
    '仓库操作员',
    '2026-05-29 09:30:00',
    '仓库之间挪动'
  ),
  (
    '70000000-0000-0000-0000-000000000003',
    '60000000-0000-0000-0000-000000000003',
    'BJ202605290001',
    '20000000-0000-0000-0000-000000000002',
    'FACTORY_INBOUND',
    '无库存',
    '市区仓库 / 默认库位',
    '11000000-0000-0000-0000-000000000001',
    '仓库操作员',
    '2026-05-29 10:00:00',
    '厂家到货入库'
  ),
  (
    '70000000-0000-0000-0000-000000000004',
    '60000000-0000-0000-0000-000000000004',
    'TH202605290001',
    '20000000-0000-0000-0000-000000000003',
    'TERMINAL_RETURN_INBOUND',
    '东山惠民烟酒店',
    '市区仓库 / 默认库位',
    '11000000-0000-0000-0000-000000000001',
    '仓库操作员',
    '2026-05-29 10:20:00',
    '终端店铺退换货入库，生产日期 2025-11-12'
  ),
  (
    '70000000-0000-0000-0000-000000000005',
    '60000000-0000-0000-0000-000000000005',
    'XS202605290001',
    '20000000-0000-0000-0000-000000000002',
    'SALES_OUTBOUND',
    '市区仓库',
    '销售人员：王明',
    '11000000-0000-0000-0000-000000000001',
    '仓库操作员',
    '2026-05-29 11:00:00',
    '销售出库'
  )
ON CONFLICT (id) DO NOTHING;
