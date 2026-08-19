# Independent Commodity catalogs

## Current model

Commodity Type and Commodity are independent, Service-scoped catalogs.
There is no assignment table and selecting a Type never filters Commodity.

- `commodity_types`: immutable numeric `id`, display `name`, and
  `service_type_id`. The application contract does not expose or write a Type
  `code`.
- `commodities`: `name`, `display_name`, optional `description`, and
  `service_type_id`.
- BL/AN/DO Package Type options are the Freight Forwarding rows in
  `commodity_types`. The former global `package_types` table has been removed.

Gallery and shipping-agency inquiries may store independent nullable
`commodity_type_id` and `commodity_id` values. Booking document payloads store
both IDs and text snapshots. BL/AN/DO container rows continue to store Package
Type text snapshots, so catalog rename/deactivation does not rewrite historical
documents or PDFs.

## Admin APIs

| Catalog        | Routes                                                                               |
| -------------- | ------------------------------------------------------------------------------------ |
| Commodity Type | `GET\|POST /v1/admin/commodity-types`, `PATCH\|DELETE /v1/admin/commodity-types/:id` |
| Commodity      | `GET\|POST /v1/admin/commodities`, `GET\|PUT\|DELETE /v1/admin/commodities/:id`      |

Commodity Type and Commodity list/create requests use `serviceTypeId`. Each ID
submitted by Gallery, EPDA, or Booking is validated against the expected
Service independently. Historical BL/AN/DO rows retain their Package Type text
snapshot even though new selections come from Freight Forwarding Types.

Commodity Type responses contain `id`, `serviceTypeId`, `name`, `createdAt`
and `updatedAt`. Create/update payloads accept names, never Type codes. EPDA
rates are keyed by `commodityTypeId` and retain `typeNameSnapshot` plus `label`
for historical display. New writes never emit legacy rate `code` keys.

## Migration and recovery

Run migrations in this order and never combine schema and data phases:

1. Commodity Type expand.
2. Commodity Type data backfill.
3. Gallery Commodity Type expand.
4. Shipping inquiry catalog-ID expand.
5. Package Type expand.
6. Package Type data backfill.
7. Verify the new application readers/writers.
8. Merge duplicate Commodity data.
9. After the new application version has been deployed and observed, run the
   separately approved legacy Group/quota contract.
10. Apply the Commodity Type code transition expand phase, then its identity
    data phase, with separate confirmations and recovery exports.
11. Deploy/restart the code-free backend and dashboard and observe that no
    code-only Type/rate records are written.
12. Only after a second explicit approval, apply the separate Commodity Type
    code contract to remove the legacy rate keys and database code objects.
13. Copy all 101 legacy Package Types into Freight Forwarding Types, remove the
    obsolete `PALLETS` Type/snapshots without changing cargo volume/container
    data, switch document pickers to Freight Forwarding Types, then drop the
    legacy `package_types` table.

Every database command performs a read-only preflight first. Apply requires an
exact database name, external backup reference, external logical export, and
phase-specific confirmation. The duplicate merge additionally writes a
checksummed recovery envelope before changing data. It preserves historical
text snapshots, rewrites all known ID references, and validates zero duplicates
and zero orphans before commit.

The contract migrations are intentionally not part of the immediate data
rollout. The Type-code contract requires its own fresh backup timestamp,
checksummed targeted recovery export, restore-test reference, deployment
reference, observation reference, root approval reference and exact
confirmation. Any malformed, duplicate, unresolved or ID-less EPDA rate causes
refusal.

The external commodity-catalog backup includes all `epda_parameter_set` schema
metadata and rows because the identity and contract phases update that table.
The data phase additionally writes a targeted recovery envelope inside its
locked transaction before executing SQL.

As of 2026-08-19, the Type-code transition, identity backfill, and final
Type-code contract have all been applied to the configured `postgres` target.
The final postflight reports no `commodity_types.code` column/index/check and no
legacy `cargoAgencyRates[].code` keys. The external backup and both targeted
recovery envelopes are retained outside the repository under the migration
evidence directory.

As of 2026-08-20, the Package Type consolidation is complete on the configured
`postgres` target: Freight Forwarding has exactly 101 Types, normalized
duplicates are zero, `PALLETS` catalog/snapshot counts are zero, and
`package_types` no longer exists. Booking `cargoVolumes` and BL/AN/DO
`containers` checksums were unchanged by the migration.

Production rollback is forward-only: fix the blocker and rerun an idempotent
phase, or restore the verified provider snapshot/logical export. Never edit a
migration after it has been applied.
