# EPDA parameter hardening rollout

These migrations are intentionally not registered with backend startup. Run
each phase manually, in order, during a controlled maintenance window.

## 1. Preflight

Dry-run is the default and never changes schema or data:

```bash
npm run db:migrate:epda-hardening
```

Record the reported scope counts and JSONB checksums. Resolve every reported
anomaly manually before continuing.

## 2. Expand

Before apply:

- complete and verify a provider snapshot;
- create an existing, access-controlled export directory outside this repo;
- ensure `pg_dump` is available on `PATH`;
- notify operators because the runner briefly locks the EPDA source tables.

```bash
node scripts/run-epda-parameter-hardening.mjs \
  --phase=expand \
  --apply \
  --target-db=EXPECTED_DATABASE_NAME \
  --backup-reference=PROVIDER_SNAPSHOT_REFERENCE \
  --export-dir=/absolute/protected/export/directory \
  --confirm=APPLY_EPDA_HARDENING
```

The runner creates separate logical SQL exports for
`epda_parameter_set` and `epda_parameter_change_logs`, plus a checksum
manifest. It records the script checksum and outcome in
`app_data_migrations`.

## 3. Compatible application deployment

Deploy `backend2.0` and `dashboard_admin` after expand. Keep
`EPDA_REQUIRE_EXPECTED_VERSION=false` only during the short compatibility
window. The backend dual-reads and dual-writes group membership during this
rollout.

## 4. Data and validation

Run the data dry-run first. It will only succeed after expand is recorded:

```bash
npm run db:migrate:epda-hardening:data
```

Apply it with the same guarded flags used for expand, then repeat for
`--phase=validate`. The data phase runs in one transaction, compares effective
parameters for every port, checks exact cleanup/membership counts, and rolls
back on any difference.

After the dashboard rollout is stable, set:

```dotenv
EPDA_REQUIRE_EXPECTED_VERSION=true
```

Then smoke-test EPDA create/edit, save/delete audit history, and ports with and
without overrides. Store the runner manifest with the provider backup
reference.

## Contract phase

There is deliberately no contract/drop migration in this rollout.
`member_port_ids` remains available for dual-write rollback. Dropping it
requires a new backup, a separate reviewed migration, and explicit production
approval after the observation period.
