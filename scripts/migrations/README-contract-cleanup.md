# Contract cleanup manifest

This file records destructive cleanup candidates. Nothing listed here may be
dropped during an expand/data rollout. Each item needs a fresh backup, a
read-only production preflight, an application release with zero references,
and a separately approved contract migration.

## Commodity catalog contract (approved, not automatically applied)

`2026-08-19_commodity_groups_contract.sql` is limited to these four approved
removals:

1. `commodities.group_id`
2. `commodities.required_image_count`
3. `commodities.cargo_type`
4. `commodity_groups`

It also creates the replacement normalized unique index on Commodity name per
Service. It must not alter or drop `cargo_types` or `package_types`.

Run static verification without connecting to a database:

```powershell
node scripts/run-independent-commodity-catalog-migration.mjs `
  --phase=contract --verify-static
```

Before apply, first test the exact backup restoration on a production-like
copy. Apply then requires the exact database name, a fresh provider backup
reference, the approved observation-window reference, the restore-test
reference, and a new absolute logical-export path outside `backend2.0`:

```powershell
node scripts/run-independent-commodity-catalog-migration.mjs `
  --phase=contract --apply `
  --target-db=<exact-database-name> `
  --backup-reference=<fresh-provider-backup> `
  --observation-reference=<approved-observation> `
  --restore-test-reference=<production-copy-restore-test> `
  --logical-export=<new-absolute-external-json-path> `
  --confirm=APPLY_COMMODITY_GROUPS_CONTRACT_20260819
```

The runner refuses an existing export path. Before any DDL it writes and
re-reads a checksummed recovery envelope containing every `commodity_groups`
row, the three legacy Commodity values keyed by ID, and the relevant column,
constraint, and index metadata. The ledger records the export checksum and all
three external evidence references. A checksum mismatch, stale successful
ledger with legacy schema, duplicate independent Commodity key, unexpected
foreign-key dependent, or change to the protected catalogs aborts the run.

## Confirmed future column drop

### `epda_parameter_set.member_port_ids`

Reason: group membership is normalized in
`epda_parameter_group_members`; the JSONB column remains only until a contract
drop. Runtime no longer dual-reads or dual-writes this column after the
2026-08-11 membership cutover / remigration.

Drop only after all of the following are true:

1. `epda_parameter_group_members` is the only membership read/write source.
2. Backend source and tests have no entity/query fallback to `member_port_ids`.
3. Dashboard continues receiving `memberPortIds`, derived from the normalized
   table, without relying on the physical JSONB column.
4. Every legacy JSONB member is present in the normalized table and the
   per-port uniqueness invariant holds.
5. Production has completed an agreed observation window and a new backup.

## Confirmed future table drop

### `cargo_types`

The table still exists and has not passed a contract preflight. Its former
direct-write drop runner was removed because it had no backup, target,
advisory-lock, checksum-ledger, or confirmation guard. Drop this table only
after exporting its rows, proving zero application and integration references,
and approving a separately guarded contract migration.

## Already dropped

### `inquiry_field_change_logs`

Dropped via `2026-08-11_drop_legacy_unused_tables.sql`. Canonical audit table is
`shipping_agency_field_change_logs`.

### `booking_partner_field_change_logs`

Dropped via the same migration; partner field-change feature removed from the app.

### `migrations`

Dropped via the same migration; leftover tracker unrelated to
`app_schema_migrations` / `app_data_migrations`.

### `booking_shipping` / `booking_transit_ports`

Dropped via `2026-08-11_drop_booking_shipping_tables.sql`. Unused by
`backend2.0` / `dashboard_admin` (booking ports live in document JSON payloads).

## Already absent; do not schedule another drop

The following legacy columns from the old per-service inquiry split are already
absent from `shipping_agency_inquiries` in the current database:

- `loading_port`
- `discharging_port`
- `laycan_from`
- `laycan_to`
- `delivery_term`
- `container_20ft`
- `container_40ft`
- `shipment_from`
- `shipment_to`
- `subject`
- `preferred_province_id`
- `related_department_id`
- `message`

They must not be added to a new contract migration unless a future preflight
shows that a separate environment still contains them.

## Not drop candidates

- `inquiry_idempotency_keys`: required for public inquiry submit idempotency.
- `epda_parameter_set.area`: AREA and GROUP records still use this shared
  column; only PORT rows are constrained to `NULL`.
- `shipping_agency_inquiries.details`: still written by the current inquiry
  submission flow.
- `notifications.inquiry_id`: intentionally retained as a polymorphic
  reference resolved together with `metadata.serviceSlug`.
