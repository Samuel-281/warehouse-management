# AGENTS.md

## Project Background

This workspace is for a warehouse goods management software project. The product has completed the initial requirements, documentation, desktop web implementation, deployment preparation, and first production-hardening passes. The desktop web app is usable enough for the current stage, and the next major workstream is mobile/PDA-oriented development.

The software will help manage goods across a two-level warehouse structure:

1. A city-level main warehouse, called the `总仓`.
2. County/town branch warehouses, called `分仓`.

The system's core tracking model is one unique barcode per physical item. Each individual item has a single, non-repeatable `单件条形码编号`. All inbound, outbound, transfer, sales allocation, and return operations should be traceable by this barcode.

Version 1.0 focuses on practical desktop web warehouse operations. The desktop work can now be treated as the baseline product. Future changes should avoid broad desktop rewrites unless the user explicitly reopens desktop UI or workflow work.

Mobile work is now starting. The original `/pda` page is only a low-fidelity sketch and should not be treated as the final mobile implementation. New mobile work should be driven by warehouse scanning workflows, small-screen ergonomics, and the separate mobile frontend requirements.

## Current Stage Snapshot

The current product state is:

1. Desktop web development is mostly complete for the current business scope.
2. The app has moved from local mock state to PostgreSQL + Prisma persisted data.
3. The app is intended to run on an Aliyun ECS server with website, API, and PostgreSQL on the same machine.
4. The user expects updates to be pushed through GitHub and then pulled on the ECS server.
5. The high-risk web maintenance reset entry should remain available to super administrators.
6. The web maintenance reset must clear operational/business data without re-seeding demo or test data.
7. User accounts and roles should remain after the web maintenance clear operation so the administrator can log back in.
8. The desktop app has been stress-tested with large inventory counts; future list pages should avoid loading unbounded records into the browser.

When handling future requests, be careful not to reintroduce demo data during production maintenance operations unless the user explicitly asks for a demo/testing database.

## Current Artifacts

Important project documents live in `docs/`:

1. `docs/warehouse-management-requirements.md` - requirements document, currently based on v0.5 business decisions.
2. `docs/warehouse-management-user-manual.md` - software user manual based on the requirements.
3. `docs/warehouse-management-user-manual.docx` - generated Word version of the user manual.
4. `docs/warehouse-management-user-manual.pdf` - generated PDF version of the user manual.
5. `docs/frontend-desktop-requirements.md` - desktop frontend redesign/performance requirements created after large-data testing.
6. `docs/frontend-mobile-requirements.md` - mobile frontend requirements for the next development stage.

There may also be a `frontend-requirements/` folder containing standalone copies of the desktop and mobile frontend requirement files.

Generated presentation-related working files live under `outputs/`, but this directory is ignored by Git. Utility scripts live under `scripts/`.

The interactive prototype lives in `warehouse-web/` and uses:

1. Next.js App Router.
2. TypeScript.
3. Tailwind CSS.
4. `lucide-react`.
5. PostgreSQL + Prisma for persisted business data, with local mock data retained only as a fallback/demo reference.

The current server deployment path is documented in `docs/aliyun-ecs-deployment.md`. On the ECS server, production builds must install build-time dependencies as well as runtime dependencies. Use a command like `NPM_CONFIG_PRODUCTION=false npm ci --include=dev` before `npm run build`, because Tailwind CSS and Prisma CLI are needed during build/deploy.

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
9. Mobile/PDA scanning for inbound, outbound, sales return, and stock query as the next major follow-up.
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

`挪仓` means goods move between warehouses. The current confirmed rule allows movement between the main warehouse and branch warehouses in either direction, and branch-to-branch transfer should also be handled through the same warehouse-to-warehouse transfer model unless the user later narrows the rule. Receiver confirmation is not required. Once submitted, the item is immediately considered to be in the target warehouse.

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

1. Source warehouse can be the main warehouse or a branch warehouse.
2. Target warehouse can be the main warehouse or a branch warehouse.
3. Source and target warehouses must be different.
4. No approval and no branch confirmation are required.
5. The scanned barcodes must currently belong to the selected source warehouse.

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
9. Native mobile app unless the user explicitly requests native development.
10. Terminal-store-level sales allocation.

## Mobile Development Guidance

The next development stage should focus on a mobile web/PDA-friendly frontend, not a native app by default. Build it in the existing Next.js application unless the user explicitly asks for a separate project. Keep the desktop backend/API behavior as the source of truth.

Mobile priorities:

1. Scanning-first operation flow.
2. Fast barcode entry with immediate validation feedback.
3. Large touch targets and one-handed operation.
4. Minimal page chrome and fewer decorative panels than desktop.
5. Avoid long tables; use task-focused lists, cards, bottom sheets, and detail pages.
6. Keep current permissions: super administrator, warehouse administrator, read-only inventory viewer.
7. Do not load full inventory/order datasets on initial mobile screens.
8. Prefer API pagination, exact barcode lookup, and narrow query results.
9. Keep high-risk maintenance out of ordinary mobile workflows unless the user explicitly asks for it.

Mobile workflows to prioritize:

1. Login and role-aware entry.
2. Barcode scan/entry hub.
3. Inbound by factory arrival.
4. Inbound by terminal store return/exchange.
5. Warehouse transfer.
6. Sales outbound.
7. Sales return.
8. Inventory lookup by barcode.
9. Barcode movement detail.

The mobile UI should assume warehouse operators may be using a phone or PDA scanner in a noisy, repetitive work environment. Confirmation and error states should be obvious, but the flow should avoid unnecessary modal friction for normal scanning.

## Production Maintenance Rules

The web high-risk maintenance entry is intentionally kept available for super administrators. Its current expected behavior is:

1. Require the exact confirmation text `确定重置`.
2. Clear operational/business data.
3. Clear inventory, orders, stock movements, master data, operation logs, and sessions.
4. Preserve users, roles, and role assignments.
5. Do not execute `prisma/seed.sql`.
6. Do not reinsert demo goods, warehouses, barcodes, salespeople, or terminal stores.

The local script `npm run db:reset-demo` may still be used for local development/demo reset if needed, but production web maintenance should not seed demo records.

## Documentation Guidance

When updating requirements or manuals:

1. Keep project documents under `docs/`.
2. Preserve the distinction between requirements, user manual, and generated deliverables.
3. Use Chinese for business-facing documentation unless the user asks otherwise.
4. Keep terms consistent: `总仓`, `分仓`, `单件条形码编号`, `厂家到货`, `终端店铺退换货`, `挪仓`, `销售出库`, `销售退回`.
5. If a new business rule changes an existing rule, update both the requirements document and user manual when appropriate.

## Development Guidance For Future Agents

The first production-oriented application already exists in `warehouse-web/`. Before making changes, inspect the current app structure and preserve the existing behavior unless the user asks for a redesign.

Run the local prototype from `warehouse-web/`:

1. `npm install`
2. `npm run dev`

The local database should be available before testing persisted flows. For large-data testing, avoid adding frontend behavior that depends on loading every inventory item, every movement, or every barcode at once.

For the next production implementation stage, prefer a data model centered on item barcode records. A practical initial model should include:

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
