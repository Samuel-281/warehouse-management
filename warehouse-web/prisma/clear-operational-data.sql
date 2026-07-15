-- Clear all warehouse business and master data without writing demo seed data.
-- User accounts and roles are preserved so administrators can log in after reset.

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
  user_sessions
RESTART IDENTITY CASCADE;
