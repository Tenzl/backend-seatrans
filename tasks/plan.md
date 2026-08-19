# Implementation Plan: Type và Commodity độc lập theo Service

## Overview

Làm lại commodity catalog trong `backend2.0` và `dashboard_admin` thành hai danh mục độc lập theo Service: `Commodity Type` và `Commodity`. Không có bảng liên kết, không có Type nằm trong Commodity và việc chọn Type không lọc Commodity. Đồng thời loại bỏ hoàn toàn quota số ảnh theo Commodity và chuyển danh sách Package type của cargo rows trong BL/AN/DO từ constant Dashboard sang catalog database. Gallery, EPDA và Booking sẽ lưu/chọn Type và Commodity như hai trường độc lập; Post không thay đổi vì không có dependency.

## Scope

- Chỉ sửa `backend2.0` và `dashboard_admin`.
- Không sửa `frontend`, backend cũ hoặc thư mục khác.
- Không chạy migration/destructive action trong giai đoạn planning.
- Tasks được theo dõi tại `backend2.0/tasks/todo.md`.

## Architecture Decisions

1. Chỉ có hai catalog:
   - `commodity_types(id, service_type_id, name, created_at, updated_at)`.
   - `commodities(id, service_type_id, name, display_name, description, created_at, updated_at)`.
2. Không tạo `commodity_type_assignments`; không có FK hoặc mảng Type trong Commodity.
3. Type và Commodity unique trong phạm vi một Service; cùng tên vẫn được phép ở Service khác.
4. Các record nghiệp vụ có thể lưu cả `commodity_type_id` và `commodity_id`, nhưng hai FK này độc lập. Backend chỉ xác nhận từng record thuộc đúng Service, không kiểm tra quan hệ Type–Commodity.
5. `commodity_types.id` là định danh ổn định cho EPDA/rate; Type không còn
   trường `code`. Đổi `name` không đổi ID hoặc snapshot lịch sử.
6. Booking/EPDA lưu ID để giữ identity và lưu text snapshot để lịch sử không đổi khi catalog được rename.
7. Gallery bỏ quota ảnh theo Commodity. Giới hạn kỹ thuật mỗi request như `maxFiles` và `maxFileSize` vẫn giữ để bảo vệ upload.
8. Schema cũ được loại bỏ theo expand → migrate → contract; không rename/drop trực tiếp ở release đầu.
9. Bảng legacy `cargo_types` có 3 row thật và được dùng làm nguồn backfill Type, không dùng làm runtime target và không xóa trong feature này.
10. Package type là catalog global `package_types(id, code, display_name, is_active, sort_order, created_at, updated_at)`, không phụ thuộc Service/Commodity Type/Commodity.
11. Cargo rows tiếp tục lưu `packageType` dạng text snapshot trong JSON để lịch sử/PDF ổn định; database catalog chỉ là nguồn option runtime.
12. Seed Package type là hợp của 101 option đang hard-code và mọi giá trị distinct đọc từ `containers[].packageType` trong BL/AN/DO tại thời điểm migration.
13. Duplicate Commodity trong cùng Service được merge theo normalized name. Canonical ưu tiên row đang có nhiều reference nhất, sau đó ID nhỏ nhất; toàn bộ FK/JSON ID được chuyển trước khi xóa duplicate.

## Target Behavior

- Admin chọn một Service và nhìn thấy hai bảng Type/Commodity song song.
- Add/Edit/Delete Type không tác động Commodity.
- Add/Edit/Delete Commodity không cần Type và không có Required image count.
- Gallery chọn Service → Type và Commodity bằng hai picker độc lập.
- EPDA chọn Type và Commodity độc lập; chọn Type không thay đổi danh sách Commodity.
- Booking chọn Type và Commodity độc lập; AN/BL dùng snapshot đã lưu.
- Package type combobox tải option từ database; stored legacy value vẫn hiển thị dù đã inactive hoặc chưa có trong catalog.
- Post/Post Image giữ nguyên.

## Dependency Graph

```text
DB preflight
  └─ commodity_types expand schema
      ├─ Type API ── Type admin table
      ├─ Independent Commodity API ── Commodity admin table
      ├─ Gallery type metadata ── Gallery pickers
      ├─ EPDA type/commodity IDs ── EPDA pickers
      ├─ package_types schema/data ── Package Type API ── BL/AN/DO combobox
      └─ Booking JSON contract ── Booking → AN → BL

All new readers/writers verified
  └─ data cleanup and contract migration
```

## Ordered Task Index

### Phase A — Preflight and Type foundation

1. Database catalog preflight.
2. Expand `commodity_types` schema.
3. Deliver backend Commodity Type CRUD and compatibility boundary.

### Checkpoint A

- Preflight report reviewed.
- Type API tests pass and backend builds.
- No old schema has been dropped.

### Phase B — Independent catalogs end-to-end

4. Backfill initial Commodity Types.
5. Deliver Type management table in Dashboard.
6. Deliver independent, quota-free Commodity backend contract.

### Checkpoint B

- Type and Commodity API contracts are independent.
- Old records remain readable.
- Backend focused tests, lint and build pass.

7. Deliver independent Commodity management table.
8. Remove Gallery quota/requirement UX.

### Checkpoint C

- Dashboard shows two independent tables.
- No Required image field or quota warning remains.
- Dashboard focused tests, lint and typecheck pass.

### Phase C — Gallery vertical slice

9. Expand Gallery storage for independent Type metadata.
10. Deliver Gallery Type read/write/filter backend contract.
11. Deliver independent Gallery Type and Commodity pickers.

### Checkpoint D

- New images can store both IDs independently.
- Legacy images without Type still load.
- Gallery upload/edit/filter runtime flow passes.

### Phase D — EPDA vertical slice

12. Expand Shipping Agency inquiry identity columns.
13. Deliver EPDA backend resolution for independent catalogs.
14. Deliver dynamic independent EPDA pickers.

### Checkpoint E

- Type selection does not filter Commodity.
- Existing string-only inquiries still work.
- EPDA calculation, audit, snapshot and PDF regression tests pass.

### Phase E — Package Type database catalog

15. Expand `package_types` schema.
16. Backfill Package types from current options and real document payloads.
17. Deliver backend Package Type catalog API.
18. Deliver database-driven Package Type combobox.

### Checkpoint F

- Package Type runtime has no hard-coded option list.
- Database includes all 101 current options and distinct values found in BL/AN/DO.
- Existing Package type snapshots and PDF output remain unchanged.

### Phase F — Booking vertical slice

19. Deliver independent Booking Type/Commodity backend contract.
20. Deliver independent Booking Type/Commodity form controls.
21. Preserve legacy Booking → AN → BL behavior and usage guards.

### Checkpoint G

- Booking stores independent IDs and snapshots.
- AN/BL map the stored description correctly.
- Legacy booking payloads remain readable.

### Phase G — Data cleanup and contract

22. Merge duplicate Commodity references and validate real data.
23. Contract-drop Group/cargoType/required-image schema.
24. Run final integration, documentation and release-readiness gate.

### Checkpoint Complete

- All acceptance criteria in `tasks/todo.md` pass.
- Full backend and dashboard verification passes.
- Runtime smoke tests cover Commodity admin, Gallery, EPDA, Package Type and Booking → AN → BL.
- Human reviews migration reports and explicitly approves contract/deploy.

## Migration Strategy

### Expand

- Add `commodity_types` without touching `commodity_groups`.
- Add `package_types` in a separate schema migration; do not mix DDL with seed DML.
- Add nullable `commodity_type_id` to consumer tables only when that vertical slice starts.
- Keep legacy columns readable until every consumer is migrated.

### Migrate

- Seed Type rows from all 6 real Groups across Shipping Agency, Freight Forwarding, Chartering and Logistics, plus the 3 legacy `cargo_types` rows. Canonicalize `EQUIPMENT` to `IN_EQUIPMENT`.
- Do not create Type–Commodity links.
- Merge the confirmed duplicate `PKE` rows by keeping ID 19 (9 Gallery references) and remapping any ID 37 reference to 19 before deleting 37. Apply the same deterministic reference-count/lowest-ID rule if preflight finds new duplicates at execution time.
- Treat blank or sentinel text such as the current literal description `"NULL"` as SQL null during the approved duplicate merge; do not overwrite a real non-empty description.
- Seed Package types in a separate data migration from the 101 existing options plus distinct non-empty JSON values from active and historical BL/AN/DO rows. Current production snapshot contains `CRATE(S)` once in BL and it already belongs to the 101-option set.
- Backfill consumer Type IDs only when the source value maps uniquely; otherwise retain null plus legacy text.

### Contract

- Remove runtime references first.
- After observation and postflight, separately drop `commodities.group_id`, `commodities.cargo_type`, `commodities.required_image_count` and `commodity_groups`.
- Leave legacy `cargo_types` for a separately approved cleanup.

## Definition of Done

Every task requires both its task-specific acceptance criteria and this shared gate:

- Behavior is runtime-verified, not only compiled.
- New behavior has regression tests; existing focused tests pass.
- Error/legacy paths are covered.
- No unrelated refactor, dead code, debug output or duplicate business logic.
- Formatting, lint and typecheck/build pass for touched project.
- API backward compatibility and migration rollback are documented.
- Critical data changes have preflight/postflight evidence.
- Human review is required before merge, migration apply or deploy.

## Risks and Mitigations

| Risk                                                                 | Impact | Mitigation                                                                                                                                  |
| -------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Duplicate Commodity names across old Groups                          | High   | Preflight, approved canonical-ID map, reference rewrite before unique index                                                                 |
| Existing `cargo_types` conflicts with new naming                     | High   | Use `commodity_types`; do not reuse/drop legacy table in this scope                                                                         |
| Production data changes between planning and migration               | High   | Re-run locked/read-only preflight immediately before apply; migration derives duplicates and Package types from live rows at execution time |
| Package type variants differ only by casing/spacing                  | Medium | Unique normalized code, preserve chosen display label and existing payload snapshot text                                                    |
| Disabling a Package type breaks historical BL save/render            | High   | Soft deactivate catalog rows; combobox preserves stored legacy value; renderer continues using snapshot string                              |
| Legacy Gallery rows cannot infer Type                                | Medium | Keep `commodity_type_id` nullable and preserve rows for manual classification                                                               |
| EPDA business rules currently depend on three hard-coded cargo codes | High   | Store stable Type code, preserve rules for existing codes, make new codes explicit in rate config                                           |
| Booking history changes after catalog rename                         | High   | Persist ID plus text snapshot; never regenerate historical text on read                                                                     |
| Old Dashboard and new backend deploy at different times              | Medium | Keep compatibility adapter through observation window                                                                                       |
| Removing quota accidentally removes upload safety                    | Medium | Remove only per-Commodity target; retain batch/file-size technical limits                                                                   |

## Parallelization

- Must be sequential: Tasks 1–4, Tasks 15–18, Tasks 22–24, and every schema → API dependency.
- After Checkpoint B, Gallery and EPDA backend slices can be developed independently if their API contracts are frozen first.
- Dashboard tests for a completed API contract can run in parallel with backend regression tests.
- Booking must wait for final Type and Commodity response shapes; Package Type catalog can be built independently after Checkpoint B.

## Open Review Point

- Proposed Booking/AN display remains `{commodity} IN {type}` when both snapshots exist; when one is empty, display the remaining value. Confirm this text format before Task 19 begins.

# Change Plan: Remove Commodity Type `code`

## Overview

Remove the user-facing and persisted `code` field from `commodity_types`. The
final Type identity is its numeric `id`; `name` is the editable display value.
Booking and Gallery already use ID plus a text snapshot. Shipping Agency EPDA
must stop using Type `code` as its selection/rate key before the database
column can be dropped.

Scope remains limited to `backend2.0` and `dashboard_admin`.

## Final Contract

- `commodity_types`: `id`, `service_type_id`, `name`, `created_at`,
  `updated_at`; normalized Type names remain unique per Service.
- Type API create/update/list responses contain no `code`.
- Type admin UI contains one editable field: Type name.
- Booking and Gallery continue storing independent Type IDs and name
  snapshots; their document contracts do not change.
- Shipping Agency inquiry uses `commodity_type_id` as authoritative identity.
  `cargo_type` remains a historical text snapshot; new writes store the Type
  name while old values such as `IN_BULK` remain readable and unchanged.
- EPDA `cargoAgencyRates` use `commodityTypeId` plus a name snapshot. Legacy
  JSON `code` remains dual-readable during transition and is removed only in
  the contract phase.
- Legacy `cargo_types` is not dropped or modified in this change.

## Current Evidence

- All seven current `shipping_agency_inquiries` have a null Type ID and the
  snapshot `IN_BULK`; they can map uniquely through the current Type code to
  Shipping Agency Type `BULK`.
- Booking resolves Type through ID/name and does not require Type code.
- Gallery stores/filter Type by ID and does not require Type code.
- EPDA create/update currently copies `commodityType.code` into `cargo_type`.
- Dashboard EPDA currently turns Type rows into `{ code, displayLabel }` and
  uses code to restore selection.
- EPDA parameter JSON currently keys cargo agency rates by `code`; this is a
  separate legacy dependency that must move to Type ID.

## Dependency Graph

```text
Live code/rate preflight
  └─ transition schema: commodity_types.code nullable
      └─ ID backfill: inquiries + EPDA rate JSON
          ├─ code-free Type backend API
          │   └─ code-free Type admin UI
          └─ ID-based EPDA backend contract
              └─ ID-based EPDA Dashboard controls
                  └─ deploy + observe + zero-reference audit
                      └─ contract drop Type code/index/check and legacy rate keys
```

## Ordered Task Index

### Phase H — Preflight and transition storage

25. Inventory live Type-code, inquiry and EPDA-rate mappings.
26. Make `commodity_types.code` transitionally nullable without dropping it.
27. Backfill inquiry and EPDA-rate Type IDs through the current code mapping.

### Checkpoint H

- Every resolvable legacy value has exactly one Type ID.
- Existing inquiry snapshots and EPDA numeric rates are unchanged.
- Old application code can still run against the transition schema.

### Phase I — Code-free runtime

28. Remove Type code from the backend Type API and CRUD rules.
29. Move EPDA backend selection and cargo-rate resolution to Type ID.
30. Remove Type code from Dashboard Type management.
31. Move Dashboard EPDA selection to Type ID and Type name.

### Checkpoint I

- Type create/edit/list has no code input or response field.
- Old `IN_BULK` inquiry loads and calculates identically.
- New and renamed Types save by ID and keep historical snapshots stable.
- Booking and Gallery focused regressions remain green.

### Phase J — Contract and release

32. After compatible deployment and observation, contract-drop Type code and
    legacy EPDA rate-code keys.
33. Run full integration, migration recovery and release-readiness gates.

## Migration Strategy

### Expand

- Add no replacement key column: the existing primary key is the stable Type
  identity.
- Drop only `NOT NULL` from `commodity_types.code` during transition. Keep the
  column, check and normalized index so an older process can continue reading
  existing rows during deployment.
- Do not edit the already-applied `2026-08-19` migrations; create new
  forward-only migrations with new ledger IDs and checksums.

### Migrate

- Backfill inquiry `commodity_type_id` by Service plus the current normalized
  Type code. Never hard-code numeric Type IDs.
- Current expected live result is seven `IN_BULK` inquiries mapped to the
  Shipping Agency `BULK` Type; abort if counts or uniqueness change.
- Add `commodityTypeId` and `typeNameSnapshot` to each resolvable EPDA
  `cargoAgencyRates` JSON item while preserving its rate and legacy code.
- New runtime reads rate by Type ID first and legacy code only as fallback.
- Preserve historical `shipping_agency_inquiries.cargo_type` values exactly;
  new writes snapshot `commodity_types.name`.

### Contract

- Require zero runtime reads/writes of `CommodityType.code`, zero API `code`
  fields, and zero new EPDA rate JSON writes keyed only by code.
- Require all resolvable inquiry/rate rows to carry a valid Type ID.
- Under backup, explicit target confirmation and observation evidence, drop
  `uq_commodity_types_service_code_normalized`,
  `ck_commodity_types_code_nonblank`, then `commodity_types.code`.
- Remove legacy `cargoAgencyRates[].code` only from rows that have a verified
  `commodityTypeId`; preserve unresolved historical rows and report them.
- Do not include this drop in the existing Group/quota contract migration.

## Risks and Mitigations

| Risk                                             | Impact | Mitigation                                                                                                       |
| ------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------- |
| Type rename changes EPDA calculation             | High   | Resolve rates by immutable Type ID; keep a name snapshot only for display/audit                                  |
| Legacy `IN_BULK` cannot resolve after code drop  | High   | Backfill IDs while code still exists; dual-read old snapshot strings during observation                          |
| Mixed old/new processes see null code            | High   | Deploy transition schema first; new runtime stops exposing code, and contract waits until old processes are gone |
| EPDA rate JSON is silently reassigned            | High   | Unique Service/code preflight, before/after numeric-rate checksum, abort on ambiguous/unresolved mappings        |
| Historical inquiry text changes                  | High   | Never rewrite `cargo_type`; verify row/text checksums before and after                                           |
| A custom Type has no configured EPDA rate        | Medium | Return explicit “rate not configured for Type” state or documented default; never infer by mutable name          |
| Existing Group/quota contract overlaps this drop | High   | Use a separate migration ID, recovery export and approval gate                                                   |

## Parallelization

- Tasks 25–27 and Task 32 are sequential database work.
- After Task 27 freezes the transition contract, Tasks 28 and 30 may run in
  parallel; Tasks 29 and 31 may run in parallel after their shared DTO shape is
  agreed.
- Migration apply, deployment observation and contract apply remain strictly
  sequential and root/operator-only.

## Approval Gate

Implementation must not begin until the user approves Tasks 25–33. Contract
apply requires a second explicit approval after compatible backend/dashboard
deployment and observation evidence.

## 2026-08-19 execution status

- Tasks 25–31 are implemented and verified. The transition expand and identity
  data phases were applied after a checksummed external backup; live postflight
  maps seven inquiries and nine EPDA rates without changing historical inquiry
  text or numeric rates.
- Task 32 contract was applied after the code-free backend build started cleanly
  and both live/ready health checks passed. Postflight reports
  `schemaState=contracted`, zero Type code columns/objects and zero legacy EPDA
  rate-code keys. Type IDs/names, inquiry snapshots, numeric rates,
  `cargo_types`, `package_types`, and booking-document checksums are unchanged.

## 2026-08-20 superseding Package Type decision

- The earlier standalone global `package_types` design is retired.
- All 101 legacy Package Type names are Freight Forwarding
  `commodity_types`; BL/AN/DO selectors use that Service-scoped catalog.
- The old Freight Forwarding `PALLETS` Type and its document snapshots are
  removed while booking `cargoVolumes` and document `containers` remain exact.
- The separate Package Type API/runtime and `package_types` table are removed.
