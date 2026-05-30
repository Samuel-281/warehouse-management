-- Clear all prototype data before re-seeding a clean demo database.
-- This is intended for local testing only.

TRUNCATE TABLE
  sales_return_order_items,
  sales_return_orders,
  outbound_order_items,
  outbound_orders,
  inbound_order_items,
  inbound_orders,
  stock_movements,
  inventory_items,
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
