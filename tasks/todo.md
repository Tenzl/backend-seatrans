# Task List: Independent Commodity Type and Commodity Catalogs

## Task 1: Database catalog preflight

**Description:** Add a read-only report for current Groups, cargo types, Commodity duplicates/references and Package type values stored in document JSON before designing any destructive migration.

**Acceptance criteria:**

- [x] Reports legacy `cargo_types`, all Service-scoped `commodity_groups`, `commodities.cargo_type` and `required_image_count` without writing data.
- [x] Reports duplicate normalized Commodity names with Gallery/Booking/AN/DO/Inquiry references and recommends canonical row by reference count then lowest ID.
- [x] Reports normalized distinct `containers[].packageType` from BL, AN and DO plus whether each value exists in the current 101-option source list.

**Verification:**

- [x] Run preflight twice and compare stable output.
- [x] Verify transaction/session performs no INSERT/UPDATE/DELETE/DDL.
- [x] Human reviews the report before Task 2 (approved findings: PKE 19/37 and `CRATE(S)`).

**Dependencies:** None

**Files likely touched:**

- `backend2.0/scripts/preflight-independent-commodity-catalog.mjs`
- `backend2.0/scripts/lib/commodity-catalog-preflight.mjs`
- `backend2.0/scripts/lib/commodity-catalog-preflight.test.mjs`

**Estimated scope:** Medium (3 files)

## Task 2: Expand Commodity Type schema

**Description:** Add the new independent `commodity_types` table and TypeORM entity without changing or dropping the current Group model.

**Acceptance criteria:**

- [ ] Type has Service FK, stable code and name with per-Service uniqueness.
- [ ] Migration is idempotent and has preflight/postflight checks.
- [ ] No assignment table or Commodity Type FK is created.

**Verification:**

- [ ] Apply migration to an empty test database and a legacy-shaped test database.
- [ ] Run postflight for indexes, constraints and zero Group changes.
- [ ] Backend builds with the new entity registered.

**Dependencies:** Task 1

**Files likely touched:**

- `backend2.0/scripts/migrations/*_commodity_types_expand.sql`
- `backend2.0/scripts/run-independent-commodity-catalog-migration.mjs`
- `backend2.0/src/features/commodities/entities/commodity-type.entity.ts`
- `backend2.0/src/features/commodities/commodities.module.ts`

**Estimated scope:** Medium (4 files)

## Task 3: Deliver backend Commodity Type CRUD

**Description:** Add Service-scoped Type list/create/update/delete endpoints and a temporary compatibility boundary for the existing Group API.

**Acceptance criteria:**

- [x] Type CRUD validates Service, duplicate code/name and in-use deletion.
- [x] Type responses contain no Commodity collection.
- [x] Existing Group endpoints remain functional until Dashboard cutover.

**Verification:**

- [x] Focused service/controller tests cover success, duplicate, wrong Service and delete conflict.
- [ ] `pnpm lint` and `pnpm build` pass in `backend2.0`.
- [ ] Manual API check creates a Type without creating a Commodity.

**Dependencies:** Task 2

**Files likely touched:**

- `backend2.0/src/features/commodities/commodity-types.service.ts`
- `backend2.0/src/features/commodities/commodity-types.service.spec.ts`
- `backend2.0/src/features/commodities/commodity-types-admin.controller.ts`
- `backend2.0/src/features/commodities/dto/commodity-type.dto.ts`
- `backend2.0/src/features/commodities/commodities.module.ts`

**Estimated scope:** Medium (5 files)

## Checkpoint A: Preflight and Type foundation

- [ ] Tasks 1–3 acceptance criteria pass.
- [ ] Backend focused tests and build pass.
- [ ] Preflight report has human review.
- [ ] No old table/column has been dropped.

## Task 4: Backfill initial Commodity Types

**Description:** Seed independent Types from all real Groups and the legacy `cargo_types` rows without recording any Type–Commodity relationship.

**Acceptance criteria:**

- [ ] Seeds all 6 currently observed Groups across Shipping Agency, Freight Forwarding, Chartering and Logistics, while remaining data-driven for new rows.
- [x] Migrates the 3 legacy cargo types and canonicalizes legacy `EQUIPMENT` to `IN_EQUIPMENT` while preserving `IN_BULK` and `IN_BAG_PACK`.
- [x] Does not update Commodity rows or create an assignment table.

**Verification:**

- [x] Data migration is idempotent.
- [ ] Before/after Type counts and duplicate checks are recorded.
- [x] Roll-forward recovery procedure is documented.

**Dependencies:** Task 3

**Files likely touched:**

- `backend2.0/scripts/migrations/*_commodity_types_data.sql`
- `backend2.0/scripts/run-independent-commodity-catalog-migration.mjs`
- `backend2.0/scripts/lib/commodity-type-backfill.test.mjs`

**Estimated scope:** Medium (3 files)

## Task 5: Deliver Dashboard Type management

**Description:** Add the left-hand Type table and independent Type CRUD for the selected Service.

**Acceptance criteria:**

- [ ] Type table supports add/edit/delete without loading or mutating Commodities.
- [ ] Service change reloads Types by Service ID.
- [ ] No Type row displays Commodity count or membership controls.

**Verification:**

- [ ] Vitest covers CRUD state, Service switching and API failures.
- [ ] Dashboard lint and typecheck pass.
- [ ] Manual check creates/deletes a Type while Commodity data remains unchanged.

**Dependencies:** Task 4

**Files likely touched:**

- `dashboard_admin/src/modules/gallery/services/commodityService.ts`
- `dashboard_admin/src/modules/gallery/components/admin/CommodityManagement.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/CommodityTypesTable.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/useCommodityTypes.ts`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/useCommodityTypes.test.ts`

**Estimated scope:** Medium (5 files)

## Task 6: Deliver independent quota-free Commodity backend

**Description:** Change Commodity CRUD contract so a Commodity belongs only to Service and no longer exposes Group, cargoType or required image target.

**Acceptance criteria:**

- [x] Create/update/list DTOs contain no Group, Type, cargoType or requiredImageCount.
- [x] Duplicate Commodity name is rejected within one Service and allowed across Services.
- [x] Legacy physical columns remain untouched until contract migration.

**Verification:**

- [x] Focused tests prove CRUD independence, duplicate scope and legacy-row reads.
- [ ] Backend lint and build pass.
- [ ] Manual API check creates a Commodity without a Type.

**Dependencies:** Task 1

**Files likely touched:**

- `backend2.0/src/features/commodities/commodities.service.ts`
- `backend2.0/src/features/commodities/commodities.service.spec.ts`
- `backend2.0/src/features/commodities/commodities-admin.controller.ts`
- `backend2.0/src/features/commodities/dto/create-commodity.dto.ts`
- `backend2.0/src/features/commodities/dto/commodity.dto.ts`

**Estimated scope:** Medium (5 files)

## Checkpoint B: Independent backend catalogs

- [ ] Tasks 4–6 acceptance criteria pass.
- [ ] Type and Commodity APIs operate independently.
- [ ] No assignment endpoint/table exists.
- [ ] Backend focused/full relevant tests pass.

## Task 7: Deliver Dashboard Commodity management

**Description:** Replace the Group-owned Commodity panel with a right-hand independent Commodity table for the selected Service.

**Acceptance criteria:**

- [ ] Add/edit/delete Commodity does not request or display Type/Group.
- [ ] Required image count field and validation are absent.
- [ ] Type CRUD and Commodity CRUD do not invalidate or mutate each other's state unnecessarily.

**Verification:**

- [ ] Vitest covers independent CRUD and Service switching.
- [ ] Dashboard lint and typecheck pass.
- [ ] Manual check shows both tables side by side and independent.

**Dependencies:** Tasks 5 and 6

**Files likely touched:**

- `dashboard_admin/src/modules/gallery/services/commodityService.ts`
- `dashboard_admin/src/modules/gallery/components/admin/CommodityManagement.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/CommoditiesTable.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/useCommodities.ts`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/useCommodities.test.ts`

**Estimated scope:** Medium (5 files)

## Task 8: Remove Gallery quota requirement UX

**Description:** Remove per-Commodity target, remaining/exceeded messages and current/required display while retaining technical upload limits.

**Acceptance criteria:**

- [ ] No banner or copy mentions required, remaining, complete or exceeded image count.
- [ ] Commodity picker no longer renders `(current/required)`.
- [ ] `maxFiles` and `maxFileSize` remain enforced per upload request.

**Verification:**

- [ ] Focused tests remove quota cases and retain batch/file-size cases.
- [ ] Dashboard lint and typecheck pass.
- [ ] Manual upload permits additional images regardless of existing total.

**Dependencies:** Task 7

**Files likely touched:**

- `dashboard_admin/src/modules/gallery/components/admin/ImageUpload.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/gallery-upload/UploadRequirementBanner.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/gallery-upload/galleryUploadRules.ts`
- `dashboard_admin/src/modules/gallery/components/admin/gallery-upload/galleryUploadRules.test.ts`
- `dashboard_admin/src/modules/gallery/components/admin/galleryManageContext.tsx`

**Estimated scope:** Medium (5 files)

## Checkpoint C: Independent admin UI and no quota

- [ ] Tasks 7–8 acceptance criteria pass.
- [ ] Two tables are visible and independent.
- [ ] No quota field/message remains in Commodity or Gallery UI.
- [ ] Dashboard focused tests, lint and typecheck pass.

## Task 9: Expand Gallery Type storage

**Description:** Add nullable independent Type metadata to Gallery images without changing the existing Commodity FK.

**Acceptance criteria:**

- [x] `gallery_images.commodity_type_id` is nullable and references `commodity_types`.
- [x] Existing image rows remain valid without backfill.
- [x] No composite/assignment constraint links Type to Commodity.

**Verification:**

- [ ] Migration applies idempotently to legacy-shaped database.
- [x] Postflight verifies FK/index and unchanged image count.
- [x] Backend builds with the expanded entity.

**Dependencies:** Task 4

**Files likely touched:**

- `backend2.0/scripts/migrations/*_gallery_commodity_type_expand.sql`
- `backend2.0/scripts/run-independent-commodity-catalog-migration.mjs`
- `backend2.0/src/features/gallery/entities/gallery-image.entity.ts`

**Estimated scope:** Medium (3 files)

## Task 10: Deliver Gallery Type backend contract

**Description:** Support Type ID on Gallery create/update/list/filter and validate Type and Commodity independently against Service.

**Acceptance criteria:**

- [x] Write requests accept Type ID and Commodity ID separately.
- [x] Each ID must belong to the submitted Service; no membership validation exists.
- [x] List/filter responses support nullable Type for legacy images.

**Verification:**

- [x] Gallery service tests cover valid pair, cross-Service Type, cross-Service Commodity and null legacy Type.
- [ ] Backend lint and build pass.
- [ ] Manual API check stores an arbitrary same-Service Type and Commodity combination.

**Dependencies:** Tasks 6 and 9

**Files likely touched:**

- `backend2.0/src/features/gallery/gallery.service.ts`
- `backend2.0/src/features/gallery/gallery.service.spec.ts`
- `backend2.0/src/features/gallery/gallery-admin.controller.ts`
- `backend2.0/src/features/gallery/dto/gallery-image.dto.ts`
- `backend2.0/src/features/gallery/dto/gallery-multipart-fields.dto.ts`

**Estimated scope:** Medium (5 files)

## Task 11: Deliver independent Gallery pickers

**Description:** Add separate Type and Commodity selectors to Gallery upload/edit/filter, both scoped only by Service.

**Acceptance criteria:**

- [ ] Changing Type never clears or filters Commodity.
- [ ] Changing Service clears both and reloads both catalogs.
- [ ] Legacy images with null Type remain viewable and editable.

**Verification:**

- [ ] Vitest covers independent selection, Service reset and legacy edit.
- [ ] Dashboard lint and typecheck pass.
- [ ] Manual upload/edit/filter flow succeeds.

**Dependencies:** Tasks 5, 7 and 10

**Files likely touched:**

- `dashboard_admin/src/modules/gallery/services/galleryService.ts`
- `dashboard_admin/src/modules/gallery/components/admin/galleryManageContext.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/ImageUpload.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/image-management/EditGalleryImageDialog.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/image-management/galleryImageRules.test.ts`

**Estimated scope:** Medium (5 files)

## Checkpoint D: Gallery vertical slice

- [ ] Tasks 9–11 acceptance criteria pass.
- [ ] Gallery backend and dashboard focused tests pass.
- [ ] Runtime upload/edit/filter works for new and legacy images.
- [ ] No per-Commodity quota behavior returns.

## Task 12: Expand Shipping Agency inquiry IDs

**Description:** Add nullable Type and Commodity identity columns while retaining existing cargo strings as snapshots.

**Acceptance criteria:**

- [x] Inquiry can store independent nullable `commodity_type_id` and `commodity_id`.
- [x] Existing rows and public string-only payloads remain valid.
- [x] No DB constraint links the two IDs together.

**Verification:**

- [ ] Migration applies idempotently and preserves inquiry count.
- [x] Postflight verifies FKs and null legacy rows.
- [x] Backend builds with expanded entity.

**Dependencies:** Tasks 4 and 6

**Files likely touched:**

- `backend2.0/scripts/migrations/*_shipping_inquiry_commodity_ids_expand.sql`
- `backend2.0/scripts/run-independent-commodity-catalog-migration.mjs`
- `backend2.0/src/features/inquiry/entities/shipping-agency-inquiry.entity.ts`

**Estimated scope:** Medium (3 files)

## Task 13: Deliver EPDA independent catalog backend

**Description:** Resolve and validate EPDA Type/Commodity independently while preserving legacy strings, OTHER handling and business rate codes.

**Acceptance criteria:**

- [x] Admin create/update accepts independent IDs and writes text snapshots.
- [x] Each ID is validated against Shipping Agency Service only.
- [x] Existing code-based rates and string-only inquiries keep working.

**Verification:**

- [x] Service tests cover independent IDs, cross-Service rejection, OTHER and legacy strings.
- [ ] EPDA snapshot/audit/PDF focused tests pass.
- [x] Backend lint and build pass.

**Dependencies:** Tasks 3, 6 and 12

**Files likely touched:**

- `backend2.0/src/features/inquiry/services/shipping-agency-epda.service.ts`
- `backend2.0/src/features/inquiry/services/shipping-agency-epda.service.spec.ts`
- `backend2.0/src/features/inquiry/dto/create-internal-shipping-agency-inquiry.dto.ts`
- `backend2.0/src/features/inquiry/dto/update-shipping-agency-epda.dto.ts`
- `backend2.0/src/features/inquiry/mappers/shipping-agency-inquiry.mapper.ts`

**Estimated scope:** Medium (5 files)

## Task 14: Deliver dynamic independent EPDA pickers

**Description:** Replace hard-coded Type options and cargoType-based Commodity filtering with two Service-scoped independent catalogs.

**Acceptance criteria:**

- [ ] Type options come from backend catalog.
- [ ] Commodity options are unchanged when Type changes.
- [ ] Existing inquiry hydration preserves legacy values missing from catalog.

**Verification:**

- [ ] Vitest covers dynamic Types, independent Commodities and legacy hydration.
- [ ] Dashboard lint and typecheck pass.
- [ ] Manual EPDA create/edit/calculate/PDF flow succeeds.

**Dependencies:** Tasks 5, 7 and 13

**Files likely touched:**

- `dashboard_admin/src/features/admin/sections/epda-editor/controller/useEpdaReferenceData.ts`
- `dashboard_admin/src/features/admin/sections/epda-editor/controller/epdaReferenceDataRules.ts`
- `dashboard_admin/src/features/admin/sections/epda-editor/controller/epdaReferenceDataRules.test.ts`
- `dashboard_admin/src/features/admin/sections/epda-editor/controller/useEpdaEditorFormModel.ts`
- `dashboard_admin/src/modules/gallery/shippingAgencyCargoCatalog.ts`

**Estimated scope:** Medium (5 files)

## Checkpoint E: EPDA vertical slice

- [ ] Tasks 12–14 acceptance criteria pass.
- [ ] Type does not filter Commodity.
- [ ] Legacy and new EPDA records both work.
- [ ] Calculation, snapshot, audit and PDF regression tests pass.

## Task 15: Expand Package Type schema

**Description:** Add a global database catalog for BL/AN/DO cargo-row Package types without changing stored document snapshots.

**Acceptance criteria:**

- [ ] Creates `package_types` with stable code, display name, active flag and sort order.
- [ ] Code uniqueness is case/space normalized and the migration is idempotent.
- [ ] No Service, Commodity Type or Commodity dependency is added.

**Verification:**

- [ ] Apply expand migration to empty and production-like copies.
- [ ] Postflight verifies table, indexes and zero Booking document changes.
- [ ] Backend builds with the entity registered.

**Dependencies:** Task 1

**Files likely touched:**

- `backend2.0/scripts/migrations/*_package_types_expand.sql`
- `backend2.0/scripts/run-package-types-migration.mjs`
- `backend2.0/src/features/booking-documents/entities/package-type.entity.ts`
- `backend2.0/src/features/booking-documents/booking-documents.module.ts`

**Estimated scope:** Medium (4 files)

## Task 16: Backfill Package Types from code and real payloads

**Description:** Seed the catalog from the 101 current Dashboard options and every distinct non-empty Package type found in BL/AN/DO container JSON at migration time.

**Acceptance criteria:**

- [ ] Inserts all 101 current options in their existing display order.
- [ ] Inserts normalized distinct values from active and historical BL/AN/DO payloads; current snapshot includes `CRATE(S)` once in BL.
- [ ] Does not rewrite `containers[].packageType` snapshot text.

**Verification:**

- [ ] Data migration is idempotent and records source/catalog counts.
- [ ] Postflight proves every non-empty stored value resolves case-insensitively to a catalog row.
- [ ] Current production snapshot results in 101 unique rows unless live data changes before apply.

**Dependencies:** Task 15

**Files likely touched:**

- `backend2.0/scripts/migrations/*_package_types_data.sql`
- `backend2.0/scripts/run-package-types-migration.mjs`
- `backend2.0/scripts/lib/package-types-data.test.mjs`

**Estimated scope:** Medium (3 files)

## Task 17: Deliver backend Package Type catalog API

**Description:** Provide database-backed Package Type list/create/update/deactivate endpoints for Booking Documents while retaining text snapshots in payloads.

**Acceptance criteria:**

- [x] Active list is sorted by `sort_order` then display name.
- [x] Create/update reject normalized duplicates; delete is soft deactivate so history remains resolvable.
- [x] Document validation/rendering does not depend on a hard-coded Package type constant.

**Verification:**

- [x] Focused tests cover list order, duplicate, update and deactivate.
- [ ] Backend lint and build pass.
- [ ] Manual API check changes available options without a backend code change.

**Dependencies:** Task 16

**Files likely touched:**

- `backend2.0/src/features/booking-documents/package-types.service.ts`
- `backend2.0/src/features/booking-documents/package-types.service.spec.ts`
- `backend2.0/src/features/booking-documents/package-types-admin.controller.ts`
- `backend2.0/src/features/booking-documents/dto/package-type.dto.ts`
- `backend2.0/src/features/booking-documents/booking-documents.module.ts`

**Estimated scope:** Medium (5 files)

## Task 18: Deliver database-driven Package Type combobox

**Description:** Replace the 101-value Dashboard constant with API data while preserving the selected legacy snapshot when it is inactive or unknown.

**Acceptance criteria:**

- [ ] Combobox loads active options from database and supports search/order as before.
- [ ] Stored legacy value remains visible and selectable at the top when absent from the active catalog.
- [ ] `AN_CONTAINER_PACKAGE_TYPES` and derived runtime option/set constants are removed.

**Verification:**

- [ ] Vitest covers loading, API error, inactive/legacy value and selection.
- [ ] Dashboard lint and typecheck pass.
- [ ] Manual BL/AN/DO edit and PDF preview preserve `CRATE(S)`.

**Dependencies:** Task 17

**Files likely touched:**

- `dashboard_admin/src/features/admin/sections/transport-documents/PackageTypeCombobox.tsx`
- `dashboard_admin/src/features/admin/sections/transport-documents/PackageTypeCombobox.test.tsx`
- `dashboard_admin/src/features/admin/sections/transport-documents/AnContainersEditor.tsx`
- `dashboard_admin/src/features/admin/sections/transport-documents/anContainerModel.ts`
- `dashboard_admin/src/features/admin/sections/transport-documents/packageTypeService.ts`

**Estimated scope:** Medium (5 files)

## Checkpoint F: Package Type database catalog

- [ ] Tasks 15–18 acceptance criteria pass.
- [ ] Database covers all current hard-coded and persisted Package type values.
- [ ] Dashboard runtime has no hard-coded Package type option list.
- [ ] Existing document snapshots and PDF output are unchanged.

## Task 19: Deliver Booking independent backend contract

**Description:** Accept independent Freight Forwarding Type/Commodity IDs and persist stable snapshots in Booking/AN payloads.

**Acceptance criteria:**

- [x] Backend validates each ID by Service, never by pairing.
- [x] Booking stores Type/Commodity IDs plus text snapshots.
- [x] Legacy payload containing only `commodityId`/`commodity` remains valid.

**Verification:**

- [x] Validator tests cover new IDs, arbitrary same-Service combination and legacy payload.
- [x] Booking-document focused tests pass.
- [x] Backend lint and build pass.

**Dependencies:** Tasks 3 and 6

**Files likely touched:**

- `backend2.0/src/features/booking-documents/booking-document-payload.validator.ts`
- `backend2.0/src/features/booking-documents/booking-document-payload.validator.spec.ts`
- `backend2.0/src/features/booking-documents/dto/booking-confirmation-preview.dto.ts`
- `backend2.0/src/features/booking-documents/dto/arrival-notice-preview.dto.ts`
- `backend2.0/src/features/commodities/commodity-types.service.ts`

**Estimated scope:** Medium (5 files)

## Task 20: Deliver independent Booking form controls

**Description:** Replace the combined Group-based Commodity option with separate Type and Commodity selectors.

**Acceptance criteria:**

- [ ] Type and Commodity selectors load Freight Forwarding catalogs independently.
- [ ] Changing Type does not filter or clear Commodity.
- [ ] Form saves both IDs and snapshots and can render legacy selections.

**Verification:**

- [ ] Vitest covers independent selection, save/reload and legacy fallback.
- [ ] Dashboard lint and typecheck pass.
- [ ] Manual Booking save/reopen succeeds.

**Dependencies:** Tasks 5, 7 and 19

**Files likely touched:**

- `dashboard_admin/src/features/admin/sections/transport-documents/BookingCommoditySelect.tsx`
- `dashboard_admin/src/features/admin/sections/transport-documents/TransportDocumentForm.tsx`
- `dashboard_admin/src/features/admin/sections/transport-documents/transportDocument.types.ts`
- `dashboard_admin/src/features/admin/sections/transport-documents/transportDocumentSchemas.ts`
- `dashboard_admin/src/features/admin/sections/transport-documents/transportDocumentSchemas.test.ts`

**Estimated scope:** Medium (5 files)

## Task 21: Preserve Booking to AN/BL compatibility

**Description:** Map independent snapshots through AN/BL without regenerating historical descriptions and extend delete guards for new IDs.

**Acceptance criteria:**

- [ ] New Booking prefills AN/BL using stored Type/Commodity snapshots.
- [ ] Legacy descriptions and Package type strings remain unchanged on open/save.
- [x] Usage checker protects referenced Type/Commodity IDs and old string keys.

**Verification:**

- [ ] Prefill tests cover both IDs, missing one side and legacy payload.
- [x] Usage-checker tests cover all four Booking JSON tables.
- [ ] Manual Booking → AN → BL flow succeeds.

**Dependencies:** Tasks 18 and 20

**Files likely touched:**

- `dashboard_admin/src/features/admin/sections/transport-documents/transportDocumentPrefill.ts`
- `dashboard_admin/src/features/admin/sections/transport-documents/transportDocumentPrefill.test.ts`
- `backend2.0/src/features/commodities/ports/typeorm-commodity-usage.checker.ts`
- `backend2.0/src/features/commodities/ports/commodity-usage.checker.ts`
- `backend2.0/src/features/commodities/commodity-an-description.spec.ts`

**Estimated scope:** Medium (5 files)

## Checkpoint G: Booking vertical slice

- [ ] Tasks 19–21 acceptance criteria pass.
- [ ] New and legacy Booking payloads work.
- [ ] Booking → AN → BL runtime flow passes.
- [ ] Type/Commodity delete guards cover persisted references.

## Task 22: Merge duplicate Commodity references

**Description:** Merge duplicate normalized Commodity rows in real data and rewrite ID references without changing historical text snapshots.

**Acceptance criteria:**

- [ ] Confirmed `PKE` duplicate keeps canonical ID 19; every possible ID 37 reference is rewritten to 19 before ID 37 is deleted.
- [ ] Gallery, Booking/AN/DO/BL JSON IDs point to canonical Commodity IDs; inquiry strings and historical display snapshots are unchanged.
- [ ] Future duplicates use highest total reference count then lowest ID; sentinel description `"NULL"` is treated as null unless a real description exists.

**Verification:**

- [ ] Data migration is idempotent and records before/after checksums/counts; the current 9 Gallery references remain on ID 19.
- [ ] Postflight reports 28 Commodity rows for the current snapshot, zero orphan references and zero duplicate normalized names per Service.
- [ ] Restore/roll-forward recovery procedure is tested on a production copy before apply.

**Dependencies:** Tasks 10, 13 and 21

**Files likely touched:**

- `backend2.0/scripts/migrations/*_independent_commodities_data.sql`
- `backend2.0/scripts/run-independent-commodity-catalog-migration.mjs`
- `backend2.0/scripts/lib/independent-commodities-data.test.mjs`

**Estimated scope:** Medium (3 files)

## Task 23: Contract legacy Group and quota schema

**Description:** After observation and zero-reference proof, drop Group ownership, Commodity cargo type and required image target in a separate contract migration.

**Acceptance criteria:**

- [ ] Runtime source has zero reads/writes of Group, `group_id`, Commodity `cargo_type` and `required_image_count`.
- [ ] Contract drops only approved legacy objects and does not touch `cargo_types` or `package_types`.
- [ ] Migration refuses to run if postflight prerequisites fail.

**Verification:**

- [ ] `rg` zero-reference audit passes in both scoped codebases.
- [ ] Contract migration passes on a production-like copy after backup.
- [ ] Backend and Dashboard full builds/tests pass after contract.

**Dependencies:** Task 22 and approved observation window

**Files likely touched:**

- `backend2.0/scripts/migrations/*_commodity_groups_contract.sql`
- `backend2.0/scripts/run-independent-commodity-catalog-migration.mjs`
- `backend2.0/scripts/migrations/README-contract-cleanup.md`
- `backend2.0/src/features/commodities/entities/commodity.entity.ts`

**Estimated scope:** Medium (4 files)

## Task 24: Final integration and release-readiness

**Description:** Run the complete scoped verification matrix, update current-state documentation and produce go/no-go evidence.

**Acceptance criteria:**

- [ ] Commodity admin, Gallery, EPDA, Package Type and Booking → AN → BL pass runtime smoke tests.
- [ ] Full backend and dashboard quality commands pass.
- [ ] Current API/schema behavior and rollback path are documented.

**Verification:**

- [ ] Backend: `pnpm lint`, `pnpm test`, `pnpm build`.
- [ ] Dashboard: `pnpm format:check`, `pnpm architecture:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test:run`.
- [ ] Human reviews migration/postflight evidence and approves before deploy.

**Dependencies:** Task 23

**Files likely touched:**

- `backend2.0/docs/API_CONVENTIONS.md`
- `backend2.0/docs/commodity-catalog.md`
- `dashboard_admin/ARCHITECTURE.md`
- `backend2.0/tasks/plan.md`
- `backend2.0/tasks/todo.md`

**Estimated scope:** Medium (5 files)

## Checkpoint Complete

- [ ] Tasks 1–24 and every checkpoint are complete.
- [ ] Shared Definition of Done in `tasks/plan.md` is satisfied.
- [ ] No implementation occurred outside `backend2.0` and `dashboard_admin`.
- [ ] Human has reviewed and approved merge/migration/deploy.

## Task 25: Preflight Commodity Type code dependencies

**Description:** Produce a read-only report of Type codes, inquiry snapshots,
inquiry Type IDs and EPDA cargo-rate JSON before changing the contract.

**Acceptance criteria:**

- [x] Report every Type code/name/Service and detect normalized ambiguity.
- [x] Report all inquiry `cargo_type` → Type candidates and every unresolved or
      multiply-resolved value.
- [x] Report every EPDA rate code, candidate Type ID and numeric-rate checksum.

**Verification:**

- [x] Read-only guard test rejects DDL/DML.
- [x] Current live evidence confirms seven `IN_BULK` inquiry rows and a unique
      Shipping Agency `BULK` Type mapping, or the plan is revised.
- [x] Human reviews the report before Task 26.

**Dependencies:** Existing Commodity Type migration and production postflight

**Files likely touched:**

- `backend2.0/scripts/preflight-commodity-type-code-removal.mjs`
- `backend2.0/scripts/lib/commodity-type-code-removal-preflight.mjs`
- `backend2.0/scripts/lib/commodity-type-code-removal-preflight.test.mjs`

**Estimated scope:** Medium (3 files)

## Task 26: Expand the code-removal transition schema

**Description:** Make Type code nullable so the code-free runtime can stop
writing it, while retaining the legacy column/index/check for mixed-version
compatibility.

**Acceptance criteria:**

- [x] New forward migration drops only `commodity_types.code` NOT NULL.
- [x] Name remains nonblank and normalized-unique per Service.
- [x] Migration is idempotent and preserves all Type rows and names.

**Verification:**

- [x] Static SQL contract and guarded runner tests pass.
- [x] Empty and legacy-shaped database-copy tests pass.
- [x] Preflight/postflight Type row and name checksums match.

**Dependencies:** Task 25

**Files likely touched:**

- `backend2.0/scripts/migrations/*_commodity_type_code_transition_expand.sql`
- `backend2.0/scripts/run-commodity-type-code-removal.mjs`
- `backend2.0/scripts/lib/commodity-type-code-removal-expand.test.mjs`

**Estimated scope:** Medium (3 files)

## Task 27: Backfill EPDA Type identities

**Description:** While Type code still exists, populate inquiry Type IDs and
EPDA cargo-rate Type IDs without changing historical text or numeric rates.

**Acceptance criteria:**

- [x] Inquiry IDs are derived by Service plus normalized current Type code;
      numeric IDs are never hard-coded.
- [x] EPDA rate JSON gains `commodityTypeId` and `typeNameSnapshot` while
      retaining its legacy code during transition.
- [x] Ambiguous/unresolved rows abort the migration and no snapshot/rate is
      silently changed.

**Verification:**

- [x] Data migration is idempotent with separate confirmation/checksum.
- [x] Current live postflight maps all seven `IN_BULK` rows uniquely.
- [x] Inquiry text checksum and EPDA numeric-rate checksum are unchanged.

**Dependencies:** Task 26

**Files likely touched:**

- `backend2.0/scripts/migrations/*_commodity_type_code_identity_data.sql`
- `backend2.0/scripts/run-commodity-type-code-removal.mjs`
- `backend2.0/scripts/lib/commodity-type-code-identity-data.test.mjs`

**Estimated scope:** Medium (3 files)

## Checkpoint H: Transition data is safe

- [x] Tasks 25–27 acceptance criteria pass.
- [x] Backup and restore/roll-forward references exist.
- [x] Old runtime remains compatible with the transition schema.
- [x] No historical inquiry text or EPDA numeric rate changed.

## Task 28: Remove code from the backend Type API

**Description:** Change Type CRUD to use only Service, name and ID while the
legacy database column remains hidden and nullable during transition.

**Acceptance criteria:**

- [x] Type list/create/update DTOs expose no `code` property.
- [x] Create/update validate only normalized unique Type name per Service.
- [x] Booking/Gallery Type resolution continues using ID and name snapshot.

**Verification:**

- [x] Focused CRUD tests prove request/response code keys are rejected/absent.
- [x] Booking and Gallery focused regressions pass.
- [ ] Backend lint and build pass. Full build and scoped lint pass; repository-wide
      lint still has the documented pre-existing baseline failures.

**Dependencies:** Task 27

**Files likely touched:**

- `backend2.0/src/features/commodities/entities/commodity-type.entity.ts`
- `backend2.0/src/features/commodities/dto/commodity-type.dto.ts`
- `backend2.0/src/features/commodities/commodity-types.service.ts`
- `backend2.0/src/features/commodities/commodity-types.service.spec.ts`

**Estimated scope:** Medium (4 files)

## Task 29: Move EPDA backend from Type code to Type ID

**Description:** Make Type ID authoritative for inquiry selection and EPDA
cargo-rate resolution; keep legacy strings read-only during transition.

**Acceptance criteria:**

- [x] New inquiry writes snapshot Type name, never Type code.
- [x] Cargo agency rates resolve by `commodityTypeId`; legacy code is fallback
      only for historical JSON.
- [x] Audit, snapshot, PDF and unrelated updates preserve old `cargo_type` text.

**Verification:**

- [x] Tests cover current `IN_BULK`, renamed Type, custom Type, missing rate and
      legacy rate fallback.
- [x] Seven backfilled inquiries load through Type ID.
- [x] EPDA focused tests and backend build pass.

**Dependencies:** Tasks 27 and 28

**Files likely touched:**

- `backend2.0/src/features/inquiry/services/shipping-agency-epda.service.ts`
- `backend2.0/src/features/inquiry/services/shipping-agency-epda.service.spec.ts`
- `backend2.0/src/features/epda-parameters/entities/epda-parameter-set.entity.ts`
- `backend2.0/src/features/epda-parameters/epda-parameter-values.validation.ts`
- `backend2.0/src/features/epda-parameters/epda-parameter-values.validation.spec.ts`

**Estimated scope:** Medium (5 files)

## Task 30: Remove code from Dashboard Type management

**Description:** Reduce Type management to a single Type-name field and update
the client contract to match the backend.

**Acceptance criteria:**

- [x] Type client types and payloads contain no code.
- [x] Create/edit table shows only Type name.
- [x] Query invalidation remains isolated from Commodity queries.

**Verification:**

- [x] Component/hook tests cover create, rename, duplicate and delete.
- [x] No `New Type code`, `Edit Type code` or Type-code column remains.
- [x] Dashboard lint, typecheck and focused tests pass.

**Dependencies:** Task 28

**Files likely touched:**

- `dashboard_admin/src/modules/gallery/services/commodityService.ts`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/useCommodityTypes.ts`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/useCommodityTypes.test.ts`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/CommodityTypesTable.tsx`
- `dashboard_admin/src/modules/gallery/components/admin/commodity-management/CommodityTypesTable.test.tsx`

**Estimated scope:** Medium (5 files)

## Task 31: Move Dashboard EPDA selection to Type ID

**Description:** Build EPDA Type options from ID/name, preserve unmatched
legacy snapshots as pinned display values, and submit Type ID independently.

**Acceptance criteria:**

- [x] Type options contain ID/value and Type name label, not Type code.
- [x] Existing `IN_BULK` inquiry selects its backfilled Type ID and calculates
      the same result.
- [x] Changing Type does not clear Commodity; unmatched legacy text remains
      visible without inventing an ID.

**Verification:**

- [x] Rule tests cover ID selection, rename, custom Type and legacy fallback.
- [x] EPDA save/reload tests prove Type ID, snapshot, label and code-free write behavior.
- [x] Dashboard lint, typecheck and focused tests pass.

**Dependencies:** Tasks 29 and 30

**Files likely touched:**

- `dashboard_admin/src/features/admin/sections/epda-editor/controller/epdaReferenceDataRules.ts`
- `dashboard_admin/src/features/admin/sections/epda-editor/controller/epdaReferenceDataRules.test.ts`
- `dashboard_admin/src/features/admin/sections/epda-editor/controller/useEpdaReferenceData.ts`
- `dashboard_admin/src/features/admin/sections/epda-editor/controller/useEpdaEditorFormModel.ts`
- `dashboard_admin/src/modules/gallery/shippingAgencyCargoCatalog.ts`

**Estimated scope:** Medium (5 files)

## Checkpoint I: Code-free runtime deployed

- [x] Tasks 28–31 acceptance criteria pass.
- [x] Type API/UI has zero public `code` fields.
- [ ] Booking, Gallery and EPDA runtime smoke tests pass. Focused automated
      regressions pass; deployed runtime smoke remains pending.
- [ ] Compatible backend/dashboard are deployed and old processes are gone.
- [ ] Observation shows no new code-only inquiry/rate records.

## Task 32: Contract-drop Commodity Type code

**Description:** After deployment observation, remove the Type-code database
objects and contract EPDA rate JSON to verified Type IDs.

**Acceptance criteria:**

- [x] Zero-reference audit proves runtime no longer reads/writes Type code.
- [x] Contract drops only the Type code normalized index, nonblank check and
      `commodity_types.code` column.
- [x] Legacy EPDA rate code is removed only where a verified Type ID exists;
      unresolved historical rows cause refusal.

**Verification:**

- [x] Guard requires target DB, fresh backup, recovery export, deploy/observation
      reference and exact confirmation.
- [x] Contract passes on the live target and rerun is safely recognized.
- [x] Postflight preserves Type IDs/names, inquiry snapshots, rates,
      `cargo_types`, `package_types` and document checksums.

**Dependencies:** Checkpoint I and explicit contract approval

**Files likely touched:**

- `backend2.0/scripts/migrations/*_commodity_type_code_contract.sql`
- `backend2.0/scripts/run-commodity-type-code-removal.mjs`
- `backend2.0/scripts/lib/commodity-type-code-contract.test.mjs`
- `backend2.0/src/features/commodities/entities/commodity-type.entity.ts`

**Estimated scope:** Medium (4 files)

## Task 33: Verify and document the code-free contract

**Description:** Run full scoped verification, update API/schema documentation
and produce deploy/migration evidence.

**Acceptance criteria:**

- [x] Backend, Dashboard and database agree on the code-free Type shape.
- [ ] Booking, Gallery and EPDA new/legacy flows pass end to end.
- [x] Migration recovery and remaining legacy snapshot behavior are documented.

**Verification:**

- [ ] Backend full tests, lint/build and migration tests pass.
- [x] Dashboard full tests, lint, typecheck, architecture and build pass.
- [ ] Human reviews postflight and explicitly approves completion.

**Dependencies:** Task 32

**Files likely touched:**

- `backend2.0/docs/API_CONVENTIONS.md`
- `backend2.0/docs/commodity-catalog.md`
- `backend2.0/tasks/plan.md`
- `backend2.0/tasks/todo.md`
- `dashboard_admin/ARCHITECTURE.md`

**Estimated scope:** Medium (5 files)

## Checkpoint Code Removal Complete

- [ ] Tasks 25–33 and Checkpoints H/I pass.
- [x] `commodity_types.code` and its DB objects are absent.
- [x] No Type API/UI contract contains code.
- [x] Historical inquiry text and numeric EPDA results remain correct.
- [x] No changes occurred outside `backend2.0` and `dashboard_admin`.

### 2026-08-19 verification evidence

- External backup:
  `C:\Users\DEV\AppData\Local\Temp\seatrans-code-removal-20260819-root\commodity-catalog-backup-before-code-removal.json`,
  checksum
  `ce4edb7bba19965cb897204c715e3ace2f9663ab7fb8d3349faa58447ad21e6b`;
  scope includes all 12 `epda_parameter_set` rows.
- Expand applied with SQL checksum
  `2783c96c5f0f591dff7fa89326f33f02d7f7f033343b826deba5d15700c08cf4`.
  The seven Type rows retain row checksum
  `9ad2b06ffb8073c32d256bb17ce3eb7c` and name checksum
  `fc7069335667c16ee1b96a3d5e7e1608`; `code` is nullable while its legacy
  check/index remain for transition compatibility.
- Identity data applied with SQL checksum
  `1fbee1faa5455e1e015ad59dac980762d610360cf1f80a260e1373e289758d3a`.
  All seven inquiries and nine rates carry Type IDs. Inquiry text checksum is
  `9dbc31d0c4de1ddc9107345be9d65dc2acf1cdeffbf79199dac6ccd5e1a218c7`
  and numeric-rate checksum is
  `dd105257930f1750c5c5940d95d90845293183c73fc7331dc50d065b00f44878`.
- Contract SQL checksum is
  `e63242e2866debcdb94f6c266bb89da455770f3eb25d1b4a0fd1385a34de3f35`.
  The code-free backend build passed live/ready health checks before and after
  apply. Contract postflight is `schemaState=contracted`, with zero Type-code
  columns/objects and zero legacy EPDA rate-code keys. Type identity, inquiry,
  numeric-rate, `cargo_types`, `package_types`, and document checksums match the
  dry-run baseline.
- Automated gates: backend 94 suites/614 tests and build pass; migration suite
  105/105 passes; Dashboard 71 files/359 tests, lint, typecheck, architecture
  (469 TypeScript files) and production build (38/38 pages) pass. Backend
  repository-wide lint remains red at its pre-existing baseline (226 findings);
  every file changed by Tasks 28–29 passes scoped ESLint.

## Task 34: Consolidate Package Types into Freight Forwarding Types

- [x] Copy all 101 normalized `package_types.display_name` rows into Freight
      Forwarding `commodity_types`.
- [x] Remove the obsolete `PALLETS` Type and clear its historical Type identity
      while preserving commodity text and cargo volumes.
- [x] Make BL/AN/DO Package Type selectors read Freight Forwarding Types.
- [x] Remove the separate Package Type backend runtime and drop
      `package_types` after checksummed backups and a rollback rehearsal.
- [x] Postflight: 101 Freight Forwarding Types, zero duplicates, zero
      `PALLETS`, no legacy table, unchanged cargo checksums.
