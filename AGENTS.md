# AGENTS.md

## Project Background

This workspace is for a warehouse goods management software project. The product has completed the initial requirements, documentation, desktop web implementation, deployment preparation, and first production-hardening passes. The desktop web app is usable enough for the current stage, and the next major workstream is mobile/PDA-oriented development.

The software now manages goods across a flat warehouse structure. The previous `总仓` / `分仓` distinction has been removed from user-facing business logic. All physical storage sites should be treated uniformly as `仓库`.

The current product is a barcode-flow traceability system. Each scanned carton has one unique, non-repeatable barcode. Local product and quantity-stock data remain only as legacy compatibility data; they are no longer part of the primary workflow or user-facing master data.

Version 1.0 focuses on practical desktop web warehouse operations. The desktop work can now be treated as the baseline product. Future changes should avoid broad desktop rewrites unless the user explicitly reopens desktop UI or workflow work.

The production PDA client is now a separate native Android project at `/Users/suhengtan/Documents/warehouse-pda-android`, backed by `https://github.com/Samuel-281/warehouse-pda-android.git`. It uses Kotlin, Jetpack Compose, Retrofit, and OkHttp. The original Web `/pda` page remains only a low-fidelity sketch and must not be treated as the production mobile client.

## Current Stage Snapshot

The current product state is:

1. Desktop web development is mostly complete for the current business scope.
2. The app has moved from local mock state to PostgreSQL + Prisma persisted data.
3. The production app runs on an Aliyun Simple Application Server with website, API, and PostgreSQL on the same machine. The production URL is currently `http://43.108.14.102`; the older ECS instance remains a test server.
4. The user expects updates to be pushed through GitHub and then pulled on the ECS server.
5. The high-risk web maintenance reset entry should remain available to super administrators.
6. The web maintenance reset must clear operational/business data without re-seeding demo or test data.
7. User accounts and roles should remain after the web maintenance clear operation so the administrator can log back in.
8. The desktop app has been stress-tested with large inventory counts; future list pages should avoid loading unbounded records into the browser.
9. Warehouse master data is now single-level. Do not require a main warehouse before creating a warehouse.

## Current Traceability Business Model

The current source of truth is the traceability model below:

1. The system's primary responsibility is recording where each unique carton barcode went, not maintaining authoritative stock quantities.
2. Daily master data contains only warehouses and salespeople. Goods and terminal stores are not locally maintained master data.
3. `快速出库` records source warehouse, destination type, destination, and mixed carton barcodes. It does not ask for goods and does not change the legacy quantity-stock ledger.
4. A sales outbound barcode enters `待签收` and is temporarily owned by the selected salesperson. The outbound salesperson remains permanently visible in history.
5. A warehouse destination immediately changes the current owner to the target warehouse.
6. `扫码回库` is the only return window. It records return warehouse and mixed barcodes only, with no goods, store, salesperson, production date, or stock-quantity input.
7. Qince receipt data is authoritative for product name, product unit, receiving terminal-store name, and receipt time.
8. A valid Qince receipt enriches the barcode profile, changes current ownership to the reported terminal store, and marks it `已签收` without changing quantity stock.
9. A later receipt may move a barcode directly from store A to store B without a warehouse return. Both receipt events remain in history.
10. A product-name conflict does not overwrite the first confirmed product. The barcode is marked `签收异常` and the conflicting receipt remains auditable.
11. User-facing receipt statuses are `待签收`, `已签收`, and `签收异常`. Current owner is a separate dimension: warehouse, salesperson, or terminal store.
12. Legacy goods, inventory, and order tables must be preserved for compatibility and migration history, but new daily workflows must not depend on them.

Older documentation may still mention the previous prototype model where every inventory unit depended on a barcode record. Treat this Web 1.0 business model as the source of truth unless the user explicitly changes it.

When handling future requests, be careful not to reintroduce demo data during production maintenance operations unless the user explicitly asks for a demo/testing database.

## Current Artifacts

Important project documents live in `docs/`:

1. `docs/warehouse-management-requirements.md` - current barcode-flow traceability requirements.
2. `docs/warehouse-management-user-manual.md` - current barcode-flow traceability user manual.
3. `docs/warehouse-management-user-manual.docx` - generated Word snapshot from an older workflow; regenerate before external distribution.
4. `docs/warehouse-management-user-manual.pdf` - generated PDF snapshot from an older workflow; regenerate before external distribution.
5. `docs/frontend-desktop-requirements.md` - desktop frontend redesign/performance requirements created after large-data testing.
6. `docs/frontend-mobile-requirements.md` - mobile frontend requirements for the next development stage.

There may also be a `frontend-requirements/` folder containing standalone copies of the desktop and mobile frontend requirement files.

Generated presentation-related working files live under `outputs/`, but this directory is ignored by Git. Utility scripts live under `scripts/`.

The interactive prototype lives in `warehouse-web/` and uses:

1. Next.js App Router.
2. TypeScript.
3. Tailwind CSS.
4. `lucide-react`.
5. PostgreSQL + Prisma as the only runtime business data source. The production UI must not fall back to local mock or `localStorage` inventory.

The current server deployment path is documented in `docs/aliyun-ecs-deployment.md`. On the ECS server, production builds must install build-time dependencies as well as runtime dependencies. Use a command like `NPM_CONFIG_PRODUCTION=false npm ci --include=dev` before `npm run build`, because Tailwind CSS and Prisma CLI are needed during build/deploy.

## Confirmed Business Scope

The current scope includes:

1. Login and role-based access.
2. Warehouse and salesperson master data.
3. Fast mixed-barcode outbound to a salesperson or warehouse.
4. Unified mixed-barcode return to a warehouse.
5. Exact barcode ownership, receipt-status, and movement-history query.
6. Qince terminal receipt import/sync, product enrichment, and terminal-store ownership reconciliation.
7. Web and native Android PDA operation surfaces.
8. Operation logs.

Daily workflows should prioritize:

1. `快速出库`
2. `扫码回库`
3. `条码查询`
4. `勤策终端签收同步`
5. `条码流转查询`

## Warehouse Rules

Warehouses are single-level. Do not introduce `总仓`, `分仓`, city-county-town hierarchy, or parent-child warehouse logic unless the user explicitly changes the requirement again.

`挪仓` means goods move between any two different warehouses. Receiver confirmation is not required. Once submitted, the item is immediately considered to be in the target warehouse.

## Barcode Rules

Each physical item has one unique barcode. The barcode must not be duplicated.

The system does not need to generate barcode numbers. It only needs to accept scanned or manually entered barcodes, validate uniqueness, and use them as the main traceability key.

Do not require goods or quantity-stock records before creating a traceable barcode. Product data is enriched later from Qince receipts.

## Return Rules

1. There is only one `扫码回库` window.
2. Pending salesperson barcodes, signed terminal-store barcodes, and unknown external-return barcodes may be submitted together.
3. The operator selects only the return warehouse and scans barcodes.
4. Product, terminal store, salesperson, production date, shelf life, and stock quantity are not requested.
5. Unknown barcodes create a traceability profile without product data; Qince may enrich them later.
6. Barcodes already owned by a warehouse are rejected as duplicate return.

## Outbound Rules

The user-facing application has one `快速出库` entry with two destination types:

1. `挪仓`
2. `销售出库`

For `挪仓`:

1. Source warehouse can be any enabled warehouse.
2. Target warehouse can be any enabled warehouse.
3. Source and target warehouses must be different.
4. No approval and no receiver confirmation are required.
5. No goods or stock quantity is selected. A new barcode creates a tracking profile; an existing barcode must be valid for the selected source warehouse.

For `销售出库`:

1. Goods may be shipped out from any enabled warehouse.
2. Goods are assigned to a salesperson.
3. Goods are not assigned to a specific terminal store.
4. New scanned barcodes become tracked at submission; existing barcodes must be valid for the selected source warehouse.
5. After submission, the item enters `待签收`; the selected salesperson remains its pending custodian and part of the permanent outbound history.

## Receipt And Return Rules

Qince receipt data and warehouse returns form one continuous barcode history.

1. A valid Qince receipt changes the current owner to the reported terminal-store name and status to `已签收`; it does not change warehouse quantity.
2. The store name comes from Qince and is not maintained as local terminal-store master data.
3. Multiple valid receipts after one sales outbound may move external ownership from store A to store B without warehouse stock movement.
4. Unified return moves pending, signed, or unknown external-return barcodes into the selected warehouse without changing legacy quantity stock.
5. Unified return does not record terminal store, salesperson, production date, or shelf life.
6. Receipt reconciliation is ordered by the external scan time. Older data imported after a later return remains history only and cannot replace the current warehouse owner.

## Traceability Query Expectations

Traceability query should support, at minimum:

1. Exact single-barcode lookup.
2. Filtering by receipt status and current owner type.
3. Search by Qince-enriched product name or terminal-store name.
4. Show current warehouse, salesperson, or terminal-store ownership.
5. Show `待签收`, `已签收`, or `签收异常` separately from current owner.
6. Show Qince-enriched product and unit where available.
7. Show full outbound, return, transfer, and Qince receipt history.

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
9. A separate iOS client or a second mobile implementation beyond the existing Android PDA app.
10. Terminal-store-level sales allocation.

## Mobile Development Guidance

The production PDA client is the separate native Android repository at `/Users/suhengtan/Documents/warehouse-pda-android`. Keep the Web backend/API in this repository as the source of truth. Do not move Android source into a Web Git branch and do not copy the Android app into `warehouse-web/`.

At the start of every PDA change requested from this workspace:

1. Read `/Users/suhengtan/Documents/warehouse-pda-android/AGENTS.md`.
2. Inspect that repository's `git status`, current branch, recent commits, and tags before editing.
3. Preserve all uncommitted and untracked PDA files unless the user explicitly asks to include or remove them.
4. Commit Web/API and Android changes in their respective repositories.
5. If an API contract changes, implement and verify the Web backend first, then update the Android client, then deploy the backend before publishing the APK.
6. Keep the Android server address configurable. The current production API base URL is `http://43.108.14.102`.
7. Verify Android changes with `./gradlew :app:assembleDebug` plus emulator or real-device checks where available.

As of July 2026, the Android repository `main` branch has reached tag `v0.2.0`. Treat repository state as authoritative and re-check it each time rather than assuming this snapshot is still current.

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
2. Fast mixed-barcode outbound to a salesperson.
3. Fast mixed-barcode transfer to another warehouse.
4. Unified barcode return to a warehouse.
5. Exact barcode ownership and receipt-status lookup.
6. Complete barcode movement and Qince receipt detail.

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
4. Keep terms consistent: `仓库`, `销售人员`, `箱码`, `快速出库`, `扫码回库`, `待签收`, `已签收`, `签收异常`, `勤策终端签收`.
5. If a new business rule changes an existing rule, update both the requirements document and user manual when appropriate.

## Development Guidance For Future Agents

The first production-oriented application already exists in `warehouse-web/`. Before making changes, inspect the current app structure and preserve the existing behavior unless the user asks for a redesign.

Run the local prototype from `warehouse-web/`:

1. `npm install`
2. `npm run dev`

The local database should be available before testing persisted flows. For large-data testing, avoid adding frontend behavior that depends on loading every inventory item, every movement, or every barcode at once.

The production data model must preserve legacy stock tables for compatibility while using the tracking models for new daily work. It should include:

1. Warehouse master data.
2. Salespersons.
3. Tracked carton barcodes with current owner and receipt status.
4. Tracking orders and immutable tracking movements.
5. Qince receipt records and synchronization runs.
6. Users, roles, and operation logs.
7. Legacy goods, quantity balances, inventory items, and old business orders until a separate archival migration is approved.

Any business operation that changes item location or ownership should write an immutable movement ledger entry.

## Dust Cleanup Baseline

The July 2026 cleanup established these additional invariants:

1. Warehouse quantity changes are atomic and protected by a database nonnegative constraint.
2. A single scan submission is limited to 500 barcodes.
3. Orders are server-side paginated and exact barcode search covers the full database.
4. Business orders are voided, not deleted. Voiding requires a reason and is rejected when a barcode has a later movement.
5. Barcode correction preserves old and current barcode history; write-off preserves the unique barcode and movement history.
6. Hard deletion is only allowed for an unreferenced erroneous barcode profile.
7. Super administrators can perform a reasoned manual stock adjustment, which writes a dedicated movement.
8. Passwords use scrypt; a legacy plaintext password is upgraded after a successful login.
9. Integration tests use a local database whose name ends in `_test`; test tooling must refuse remote database hosts.
10. Web business submissions use an optional `clientRequestId` for idempotency. Existing PDA clients may omit it, but new clients should retain the same value while retrying an uncertain submission.
11. Users may change their own password. Super administrators may edit, enable, disable, and reset other accounts, but the system must retain at least one enabled super administrator.
12. The super-administrator consistency audit is diagnostic only. It must not automatically repair quantity balances, barcode ownership, movements, or voided orders.
13. Production health is exposed at `/api/health` without secrets. PostgreSQL backups are verified locally and uploaded to a private OSS bucket through an ECS RAM role; long-lived OSS AccessKeys must not be committed or stored in application environment files.
14. New daily work uses `tracked_barcodes`, `tracking_orders`, `tracking_order_barcodes`, and `tracking_movements`; legacy quantity-stock records are compatibility data only.
15. Fast outbound and unified return never require goods or quantity-stock records and never mutate the legacy quantity ledger.
16. Qince is authoritative for product name, product unit, signed terminal-store name, and receipt time.
17. Receipt status and current owner must remain separate fields.
18. A later Qince receipt may move current external ownership from store A to store B while retaining both receipt events.
19. Product conflicts must be visible as `签收异常`; do not silently overwrite the first confirmed product name.
