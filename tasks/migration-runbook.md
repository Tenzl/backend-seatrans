# Commodity catalog database runbook

Target verified from `.env`: masked host `aw***om`, database `postgres`, SSL
enabled. Run from `backend2.0`. Only the root/operator may execute apply commands.

## Evidence and attestations

```powershell
$targetDb = 'postgres'
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$evidenceDir = Join-Path $env:TEMP "seatrans-commodity-migration-$stamp"
New-Item -ItemType Directory -Path $evidenceDir | Out-Null

# Replace these with real external/provider evidence. Do not invent values.
$backupRef = '<REAL_PROVIDER_SNAPSHOT_REFERENCE>'
$restoreRef = '<RESTORE_COPY_TEST_REFERENCE>'
$rollForwardRef = '<IDEMPOTENT_ROLL_FORWARD_TEST_REFERENCE>'
$preflightFile = Join-Path $evidenceDir '00-preflight.txt'

node scripts/preflight-independent-commodity-catalog.mjs |
  Tee-Object -FilePath $preflightFile
```

Stop unless the output target is database `postgres`, the report has no
unexpected blockers, and `$preflightFile` is non-empty. Capture every command
below with `Tee-Object` into a separate file in `$evidenceDir`.

## Apply-safe phases

Run each dry-run first. Inspect it before running the corresponding apply.

```powershell
# 1. Commodity Type schema
node scripts/run-independent-commodity-catalog-migration.mjs --phase=expand
node scripts/run-independent-commodity-catalog-migration.mjs --apply --phase=expand --target-db=$targetDb --backup-reference=$backupRef --logical-export=$preflightFile --confirm=APPLY_COMMODITY_TYPES_EXPAND_20260819

# 2. Commodity Type data
node scripts/run-independent-commodity-catalog-migration.mjs --phase=data
node scripts/run-independent-commodity-catalog-migration.mjs --apply --phase=data --target-db=$targetDb --backup-reference=$backupRef --logical-export=$preflightFile --confirm=APPLY_COMMODITY_TYPES_DATA_20260819

# 3. Gallery nullable Type identity
node scripts/run-independent-commodity-catalog-migration.mjs --phase=gallery-expand
node scripts/run-independent-commodity-catalog-migration.mjs --apply --phase=gallery-expand --target-db=$targetDb --backup-reference=$backupRef --logical-export=$preflightFile --confirm=APPLY_GALLERY_COMMODITY_TYPE_EXPAND_20260819

# 4. Shipping inquiry nullable Type/Commodity identities
node scripts/run-independent-commodity-catalog-migration.mjs --phase=inquiry-expand
node scripts/run-independent-commodity-catalog-migration.mjs --apply --phase=inquiry-expand --target-db=$targetDb --backup-reference=$backupRef --logical-export=$preflightFile --confirm=APPLY_SHIPPING_INQUIRY_COMMODITY_IDS_20260819

# 5. Package Type schema, then data. Never apply --phase=all.
node scripts/run-package-types-migration.mjs --preflight --phase=expand
node scripts/run-package-types-migration.mjs --apply --phase=expand --target-db=$targetDb --backup-reference=$backupRef --logical-export=$preflightFile --confirm=APPLY_PACKAGE_TYPES_EXPAND_20260819
node scripts/run-package-types-migration.mjs --preflight --phase=data
node scripts/run-package-types-migration.mjs --apply --phase=data --target-db=$targetDb --backup-reference=$backupRef --logical-export=$preflightFile --confirm=APPLY_PACKAGE_TYPES_DATA_20260819

# 6. Duplicate Commodity merge. Export path must not exist yet.
$duplicateExport = Join-Path $evidenceDir '06-duplicate-recovery.json'
node scripts/run-independent-commodity-catalog-migration.mjs --phase=duplicate-data
node scripts/run-independent-commodity-catalog-migration.mjs --apply --phase=duplicate-data --target-db=$targetDb --backup-reference=$backupRef --logical-export=$duplicateExport --restore-test-reference=$restoreRef --roll-forward-test-reference=$rollForwardRef --confirm=APPLY_INDEPENDENT_COMMODITIES_DATA_20260819
node scripts/run-independent-commodity-catalog-migration.mjs --phase=duplicate-data
node scripts/preflight-independent-commodity-catalog.mjs
```

Expected current postflight:

- 28 Commodity rows; ID 37 is gone and all its ID references point to ID 19.
- ID 19 retains nine Gallery references.
- Zero normalized duplicate Commodity names per Service and zero orphan IDs.
- Historical Booking/AN/DO/BL text snapshot checksum is unchanged.
- At least the six currently observed Service-scoped Types exist and every
  Group/cargo-type source resolves.
- Package Type contains at least 101 rows and every stored BL/AN/DO value
  resolves; document row checksums remain unchanged.
- Gallery and inquiry pre-existing row checksums remain unchanged.
- `commodity_groups` and the three legacy Commodity columns still exist.

## HOLD: contract phase

Do not apply contract merely because earlier phases succeeded. It may be
applied only after the compatible application version is deployed (or traffic
is stopped), an observation/deployment reference is approved, and a fresh
backup plus restore-test reference exist.

```powershell
node scripts/run-independent-commodity-catalog-migration.mjs --phase=contract

# Later only, after the hold conditions are independently confirmed:
$contractExport = Join-Path $evidenceDir 'contract-recovery.json'
$observationRef = '<DEPLOYED_VERSION_AND_OBSERVATION_REFERENCE>'
$freshContractBackupRef = '<FRESH_PROVIDER_SNAPSHOT_REFERENCE>'
node scripts/run-independent-commodity-catalog-migration.mjs --apply --phase=contract --target-db=$targetDb --backup-reference=$freshContractBackupRef --logical-export=$contractExport --observation-reference=$observationRef --restore-test-reference=$restoreRef --confirm=APPLY_COMMODITY_GROUPS_CONTRACT_20260819
```

Contract postflight must show only these removals:
`commodities.group_id`, `commodities.required_image_count`,
`commodities.cargo_type`, and `commodity_groups`. It must preserve
`cargo_types` and `package_types` checksums.

## Reviewed SQL checksums

| Phase                    | SHA-256                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| Commodity Type expand    | `f11d937f6d41abf30300f4d499d91794ee3aaae6733c707a0c29338b7c01a4ad` |
| Commodity Type data      | `552e232331f978603fa9c3b391f6627abd889fbff3f6b09952cfdcd7fb83bad5` |
| Gallery expand           | `16d3401afb477954885298b734a483978e0ad4fe6af0b90897b20659190ee3f7` |
| Inquiry expand           | `c3a655f8302df45e01b0ac7c2cdea97317c02444c843d5bf4410648b89370dad` |
| Package Type expand      | `2030d0c69fae9953a80c6e3ff51b8a0dfdb3f77f270b39b9ed528de01778e476` |
| Package Type data        | `695d9bd77ef9d21642321d41e3cbff356f0446768067949c91bc00fece200337` |
| Duplicate Commodity data | `d91dc387ebf4d245e7d5ab76b9b1e386d676800399da2f31246af04257f11715` |
| Legacy contract          | `3df46f4fea77634dfe7f6fa40af3da4f815af5ed58b7671f426129ca164d668c` |
