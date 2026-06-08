-- Add user-controlled display order for warehouse and goods master data.

ALTER TABLE goods
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE warehouses
ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

WITH ranked_goods AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY code ASC) AS row_no
  FROM goods
)
UPDATE goods
SET "sortOrder" = ranked_goods.row_no * 10
FROM ranked_goods
WHERE goods.id = ranked_goods.id;

WITH ranked_warehouses AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY code ASC) AS row_no
  FROM warehouses
)
UPDATE warehouses
SET "sortOrder" = ranked_warehouses.row_no * 10
FROM ranked_warehouses
WHERE warehouses.id = ranked_warehouses.id;

CREATE INDEX goods_sort_order_idx ON goods ("sortOrder");
CREATE INDEX warehouses_sort_order_idx ON warehouses ("sortOrder");
