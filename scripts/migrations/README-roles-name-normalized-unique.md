# Roles normalized-name unique index

Migration ID: `2026-07-30_roles_name_normalized_unique_v1`

This is a separate forward migration. It does not modify any migration that
has already run.

The migration enforces uniqueness on `LOWER(BTRIM(roles.name))`, matching the
backend's canonical role-name comparison. The index is built with
`CREATE UNIQUE INDEX CONCURRENTLY`, outside an explicit transaction.

## Safe dry-run

Dry-run is the default:

```powershell
npm run db:migrate:roles-name-uniqueness
```

The runner acquires a PostgreSQL advisory lock and performs its audit inside a
`READ ONLY` transaction. It reports:

- masked host and exact database name;
- `roles` row count and checksum;
- every normalized duplicate group with the original role IDs and names;
- the target index state;
- any valid, ready semantic equivalent under another index name.

Dry-run never creates the ledger or index. Duplicate groups, a missing or
nullable `roles.name`, or an invalid/different index occupying the target name
are blockers. The runner does not automatically rename roles or drop an
invalid index.

## Apply guard

Apply only after a clean dry-run, a provider snapshot, and a non-empty logical
export of `roles` stored outside `backend2.0`:

```powershell
npm run db:migrate:roles-name-uniqueness -- `
  --apply `
  --target-db=<exact-configured-database-name> `
  --backup-reference=<provider-backup-reference> `
  --logical-export=<absolute-path-to-roles-export-outside-backend2.0> `
  --confirm=APPLY_ROLES_NAME_NORMALIZED_UNIQUE_20260730
```

The apply path records the immutable SQL checksum, backup/export references,
preflight and postflight details in `app_schema_migrations`. If a valid
semantic equivalent already exists, it skips the index build and records the
migration as succeeded.

`CREATE INDEX CONCURRENTLY` cannot be rolled back transactionally. Recovery is
a separately reviewed forward migration (for example
`DROP INDEX CONCURRENTLY`) or restoration from the verified backup. Never edit
this migration after it has been applied.
