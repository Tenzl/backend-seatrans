# Relational integrity expand migration

Migration ID: `2026-07-30_relational_integrity_expand_v1`

Scope:

- Audit the existing foreign keys for booking-document creator, inquiry user
  actors, inquiry-document uploader, booking shipping and transit ports.
- Add a missing foreign key as `NOT VALID` without replacing an existing
  semantically equivalent TypeORM-named constraint.
- Add only the missing query-path indexes with
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS`.
- Do not validate constraints, remove columns, rewrite rows or delete data.

## Safe dry-run

Dry-run is the default and uses a PostgreSQL `READ ONLY` transaction:

```powershell
npm run db:migrate:relational-integrity
```

The audit reports missing tables/columns, missing or mismatched foreign keys,
orphan rows, invalid indexes and missing indexes. It does not create the
migration ledger or make schema changes.

## Apply guard

Do not apply until the dry-run is clean, the exact target has been reviewed,
and the backup plus logical export have been verified outside the repository.

An apply requires every guard:

```powershell
npm run db:migrate:relational-integrity -- `
  --apply `
  --target-db=<exact-configured-database-name> `
  --backup-reference=<provider-backup-reference> `
  --logical-export=<absolute-path-outside-backend2.0> `
  --confirm=APPLY_RELATIONAL_INTEGRITY_EXPAND_20260730
```

The runner uses an advisory lock, SQL checksum and
`app_schema_migrations` ledger. Foreign-key validation, if ever needed, must be
a separate reviewed migration.
