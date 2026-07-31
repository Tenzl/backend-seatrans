# Contract cleanup manifest

This file records destructive cleanup candidates. Nothing listed here may be
dropped during an expand/data rollout. Each item needs a fresh backup, a
read-only production preflight, an application release with zero references,
and a separately approved contract migration.

## Confirmed future column drop

### `epda_parameter_set.member_port_ids`

Reason: group membership is normalized in
`epda_parameter_group_members`; the JSONB column remains only for the temporary
dual-read/dual-write rollback window.

Drop only after all of the following are true:

1. `epda_parameter_group_members` is the only membership read/write source.
2. Backend source and tests have no entity/query fallback to `member_port_ids`.
3. Dashboard continues receiving `memberPortIds`, derived from the normalized
   table, without relying on the physical JSONB column.
4. Every legacy JSONB member is present in the normalized table and the
   per-port uniqueness invariant holds.
5. Production has completed an agreed observation window and a new backup.

## Confirmed future table drop

### `inquiry_field_change_logs`

Reason: this is the unused table created by the old startup bootstrap. The
canonical entity and 174 current audit records use
`shipping_agency_field_change_logs`.

Read-only preflight on 2026-07-30 found zero rows in the legacy table. Do not
drop it until a fresh preflight still reports zero rows and repository-wide
search confirms no runtime, report, export, or external integration references
it.

### `cargo_types`

The table still exists and has not passed a contract preflight. Its former
direct-write drop runner was removed because it had no backup, target,
advisory-lock, checksum-ledger, or confirmation guard. Drop this table only
after exporting its rows, proving zero application and integration references,
and approving a separately guarded contract migration.

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

- `epda_parameter_set.area`: AREA and GROUP records still use this shared
  column; only PORT rows are constrained to `NULL`.
- `shipping_agency_inquiries.details`: still written by the current inquiry
  submission flow.
- `notifications.inquiry_id`: intentionally retained as a polymorphic
  reference resolved together with `metadata.serviceSlug`.
