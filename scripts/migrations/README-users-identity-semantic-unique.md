# Users identity semantic uniqueness

Migration ID: `2026-07-30_users_identity_semantic_unique_v1`

This is a separate forward migration. It does not edit any migration that has
already run. It adds these PostgreSQL indexes:

- `uq_users_email_normalized` on `LOWER(BTRIM(email))`;
- `uq_users_username_normalized_nonblank` on
  `LOWER(BTRIM(username))` for non-null, nonblank usernames;
- `uq_users_oauth_identity` on normalized
  `(LOWER(BTRIM(oauth_provider)), BTRIM(oauth_provider_id))` when both values
  are non-null and nonblank. Legacy empty strings mean “no OAuth identity” and
  are deliberately outside the identity key rather than being rewritten.

All three use `CREATE UNIQUE INDEX CONCURRENTLY` and run outside an explicit
transaction so normal application reads and writes remain available.

## Safe dry-run

Dry-run is the default:

```powershell
npm run db:migrate:users-identity
```

The runner acquires a PostgreSQL advisory lock, then audits `users` inside a
`READ ONLY` transaction. It reports:

- masked host, exact database name and connected database identity;
- required column metadata, row count and identity-field checksum;
- every duplicate email, username or OAuth identity group, including record
  IDs and a one-way identity fingerprint instead of raw identity values;
- target-name conflicts;
- valid, ready semantic-equivalent unique indexes under any name.

Dry-run does not create the migration ledger or any index. Duplicate groups,
missing/unsupported columns, and a different or invalid index occupying a
required target name are blockers. The runner never edits users, renames
identities, drops indexes or otherwise auto-fixes ambiguous production data.

Run the static safety tests independently:

```powershell
node --test scripts/tests/users-identity-uniqueness-migration.test.mjs
```

## Apply guard

Apply only after a clean dry-run, a completed provider snapshot and a non-empty
logical export of `users` stored outside `backend2.0`:

```powershell
npm run db:migrate:users-identity -- `
  --apply `
  --target-db=<exact-configured-database-name> `
  --backup-reference=<provider-snapshot-reference> `
  --logical-export=<absolute-path-to-users-export-outside-backend2.0> `
  --confirm=APPLY_USERS_IDENTITY_SEMANTIC_UNIQUE_20260730
```

The apply path verifies the target name, backup attestation, logical export
path/size/SHA-256 and SQL SHA-256 before writing. It records those details plus
preflight/postflight reports in `app_schema_migrations`. Each index already
covered by a valid semantic equivalent is skipped.

`CREATE INDEX CONCURRENTLY` cannot be rolled back transactionally. Recovery is
a separately reviewed forward migration, such as `DROP INDEX CONCURRENTLY`,
or restoration from the verified backup. Never edit this migration after it
has been applied.
