# Booking document four-table split

`2026-08-04_split_booking_document_records.sql` permanently deletes the exact
legacy data set `booking=5, an=5, do=2, bl=2` (14 rows), creates the four empty
replacement tables, and drops `booking_document_records` without `CASCADE`.
There is no backfill and no document edit-history table.

Run only during a maintenance window through the guarded runner:

```powershell
node scripts/run-booking-document-table-split.mjs --inspect --target-db=<database>
node scripts/run-booking-document-table-split.mjs --dry-run --target-db=<database>
node scripts/run-booking-document-table-split.mjs --apply --target-db=<database> --confirm=DELETE_14_AND_SPLIT_BOOKING_DOCUMENTS_20260804
```

Inspect and dry-run use a read-only transaction. Apply takes an advisory lock,
repeats the exact distribution guard inside the migration transaction, and
commits only after verifying that the legacy table is absent, all generated
columns/FKs/indexes exist, and all four new tables contain zero rows.

The rollback SQL is schema-only and refuses to run after any replacement table
contains data. It recreates an empty legacy schema; the deleted 14 rows can only
be recovered from an external backup.

`seed-import-export-booking-forms.mjs` targets the split schema. The older
workflow seed/apply helpers detect the split and fail with an explicit obsolete
schema message rather than writing to the wrong tables.
