# AGENTS.md

## Project Background

This workspace is for a warehouse goods management software project. The product is currently in the requirements and documentation stage; no production application code has been started yet.

The software will help manage goods across a two-level warehouse structure:

1. A city-level main warehouse, called the `总仓`.
2. County/town branch warehouses, called `分仓`.

The system's core tracking model is one unique barcode per physical item. Each individual item has a single, non-repeatable `单件条形码编号`. All inbound, outbound, transfer, sales allocation, and return operations should be traceable by this barcode.

The first version should focus on practical warehouse operations for desktop web and PDA usage. The business values are fewer manual recording errors, clearer ownership of goods, real-time stock visibility, and full item-level movement history.

## Current Artifacts

Important project documents live in `docs/`:

1. `docs/warehouse-management-requirements.md` - requirements document, currently based on v0.5 business decisions.
2. `docs/warehouse-management-user-manual.md` - software user manual based on the requirements.
3. `docs/warehouse-management-user-manual.docx` - generated Word version of the user manual.
4. `docs/warehouse-management-user-manual.pdf` - generated PDF version of the user manual.

Generated presentation-related working files live under `outputs/`. Utility scripts live under `scripts/`.

## Confirmed Business Scope

The MVP scope includes:

1. Login and role-based access.
2. Goods master data.
3. Warehouse master data for `总仓` and `分仓`.
4. Inbound management.
5. Outbound management.
6. Stock query.
7. Item barcode movement query.
8. Sales return from salesperson custody back to warehouse.
9. PDA scanning for inbound, outbound, sales return, and stock query.
10. Operation logs.

The first version should prioritize these workflows:

1. `厂家到货入库`
2. `终端店铺退换货入库`
3. `挪仓`
4. `销售出库`
5. `销售退回`
6. `库存查询`
7. `库存流转查询`

## Warehouse Rules

Warehouses are only two levels:

1. `总仓`
2. `分仓`

Do not introduce city-county-town three-level warehouse logic unless the user explicitly changes the requirement.

`挪仓` means goods move from the main warehouse to a branch warehouse. Branch warehouse confirmation is not required. Once submitted, the item is immediately considered to be in the target branch warehouse.

## Barcode Rules

Each physical item has one unique barcode. The barcode must not be duplicated.

The system does not need to generate barcode numbers. It only needs to accept scanned or manually entered barcodes, validate uniqueness, and use them as the main traceability key.

Inventory logic should be item-level, not only quantity-level. Quantities can be summarized from item barcode records.

## Inbound Rules

There are two inbound sources:

1. `厂家到货`
2. `终端店铺退换货`

For `厂家到货`:

1. Goods may enter the main warehouse or a branch warehouse.
2. Production date is not mandatory.
3. Shelf life does not need to be calculated by default.
4. Every item still needs its unique barcode.

For `终端店铺退换货`:

1. This is an inbound business type.
2. It is different from `销售退回`.
3. Production date must be recorded.
4. Goods belong to one of two major categories: `保健酒` or `白酒`.
5. `保健酒` default shelf-life end date is three years after the production date.
6. `白酒` has no default shelf-life end date.
7. Terminal store information may be recorded as the return/exchange source.

## Outbound Rules

There are two outbound types:

1. `挪仓`
2. `销售出库`

For `挪仓`:

1. Source warehouse is the main warehouse.
2. Target warehouse is a branch warehouse.
3. The scanned barcodes must currently belong to the main warehouse.
4. No approval and no branch confirmation are required.

For `销售出库`:

1. Goods may be shipped out from the main warehouse or a branch warehouse.
2. Goods are assigned to a salesperson.
3. Goods are not assigned to a specific terminal store.
4. The scanned barcodes must currently belong to the selected warehouse.
5. After submission, item ownership changes from warehouse inventory to salesperson custody.

## Sales Return Rules

`销售退回` is only for unsold goods returning from salesperson custody back to a warehouse.

Keep this boundary strict:

1. `销售退回` is different from `终端店铺退换货`.
2. `销售退回` does not record a terminal store.
3. `销售退回` does not record production date.
4. `销售退回` does not recalculate shelf life.
5. The barcode simply flows back from salesperson custody to the selected warehouse.

When building or editing docs, avoid merging these two return concepts.

## Stock Query Expectations

Stock query should support, at minimum:

1. Query by warehouse.
2. Query by salesperson.
3. Query by goods information.
4. Query by single item barcode.
5. Show current item location or ownership.
6. Show item barcode status.
7. Show production date and shelf-life data where applicable.
8. Show full stock movement history.

Movement history should show the operation type, source ownership, target ownership, barcode, goods information, operator, and operation time.

## Non-Goals For The First Version

The following are intentionally outside the first release unless the user changes scope:

1. Approval workflows for inbound or outbound orders.
2. Inventory counting.
3. Expiration warning.
4. Safety stock warning.
5. Financial cost accounting.
6. ERP, finance, ecommerce, or logistics integration.
7. RFID.
8. Automatic replenishment.
9. Native mobile app.
10. Terminal-store-level sales allocation.

## Documentation Guidance

When updating requirements or manuals:

1. Keep project documents under `docs/`.
2. Preserve the distinction between requirements, user manual, and generated deliverables.
3. Use Chinese for business-facing documentation unless the user asks otherwise.
4. Keep terms consistent: `总仓`, `分仓`, `单件条形码编号`, `厂家到货`, `终端店铺退换货`, `挪仓`, `销售出库`, `销售退回`.
5. If a new business rule changes an existing rule, update both the requirements document and user manual when appropriate.

## Development Guidance For Future Agents

Before implementing application code, first confirm the intended technical stack if it has not already been selected. The current workspace mainly contains planning artifacts, not a working app.

When implementation begins, prefer a data model centered on item barcode records. A practical initial model should include:

1. Goods master data.
2. Warehouse master data.
3. Storage locations.
4. Salespersons.
5. Terminal stores.
6. Item barcode inventory records.
7. Inbound orders and inbound lines.
8. Outbound orders and outbound lines.
9. Sales return orders.
10. Stock movement ledger.
11. Users, roles, and operation logs.

Any business operation that changes item location or ownership should write an immutable movement ledger entry.
