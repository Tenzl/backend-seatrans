# Customer ID sequence expand migration

`customer_id_sequences` reserves daily, contiguous customer identifiers for
booking partners. The application does not create this table at runtime.

## Safe default

`npm run db:migrate:customer-id-sequences` performs a read-only preflight. It
reports whether the table exists, its columns and constraints, row
count/checksum, anomalies, and matching ledger state. It writes nothing.

The expected schema is:

- `sequence_date CHAR(6) PRIMARY KEY`, formatted as `YYMMDD`.
- `current_value BIGINT NOT NULL DEFAULT 0`, never negative.

The preflight refuses to continue when an existing table has incompatible
columns, extra columns, duplicate dates, invalid dates, negative counters, or
conflicting named constraints. It never guesses how to repair production data.

## Apply guard

Apply only after a provider snapshot and a verified logical export:

```powershell
node scripts/run-customer-id-sequences-migration.mjs `
  --apply `
  --target-db=seatrans `
  --backup-reference=<provider-snapshot-reference> `
  --logical-export=<absolute-path-outside-backend2.0> `
  --confirm=APPLY_CUSTOMER_ID_SEQUENCES_20260730
```

The runner verifies the export is a non-empty file, computes its SHA-256,
masks the database host in output, takes a PostgreSQL advisory lock, configures
timeouts, verifies the SQL checksum in `app_schema_migrations`, and compares
row counts/checksums before and after the expand transaction.

Do not edit the SQL after it has been applied. Recovery is a separately
reviewed forward migration or restore from the verified backup.
