-- Clear all prototype data before re-seeding a clean demo database.
-- This is intended for local testing only.

TRUNCATE TABLE
  business_requests,
  tracking_movements,
  tracking_order_barcodes,
  tracking_orders,
  terminal_receipt_sync_runs,
  terminal_receipt_records,
  terminal_receipt_imports,
  tracked_barcodes,
  sales_return_order_items,
  sales_return_orders,
  outbound_order_items,
  outbound_orders,
  inbound_order_items,
  inbound_orders,
  operation_logs,
  barcode_corrections,
  stock_movements,
  warehouse_stock_movements,
  inventory_items,
  warehouse_stocks,
  terminal_stores,
  salespeople,
  storage_locations,
  warehouses,
  goods,
  user_roles,
  user_sessions,
  users,
  roles
RESTART IDENTITY CASCADE;
