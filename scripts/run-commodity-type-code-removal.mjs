import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  buildCommodityTypeCodeRemovalPreflight,
  COMMODITY_TYPES_SQL,
  EPDA_PARAMETER_SETS_SQL,
  findShippingAgencyServiceTypeId,
  normalizeTypeKey,
  SERVICE_TYPES_SQL,
  SHIPPING_AGENCY_INQUIRIES_SQL,
} from './lib/commodity-type-code-removal-preflight.mjs';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..'),
);
const EXPAND_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_commodity_type_code_transition_expand.sql',
);
const EXPAND_MIGRATION_ID =
  '2026-08-19_commodity_type_code_transition_expand_v1';
const EXPAND_CONFIRMATION =
  'APPLY_COMMODITY_TYPE_CODE_TRANSITION_EXPAND_20260819';
const EXPAND_LOCK_NAME =
  'seatrans:commodity-type-code-transition-expand:2026-08-19:v1';
const DATA_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_commodity_type_code_identity_data.sql',
);
const DATA_MIGRATION_ID = '2026-08-19_commodity_type_code_identity_data_v1';
const DATA_CONFIRMATION = 'APPLY_COMMODITY_TYPE_CODE_IDENTITY_DATA_20260819';
const DATA_LOCK_NAME =
  'seatrans:commodity-type-code-identity-data:2026-08-19:v1';
const CONTRACT_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_commodity_type_code_contract.sql',
);
const CONTRACT_MIGRATION_ID = 'commodity_type_code_contract_v1';
const CONTRACT_CONFIRMATION = 'APPLY_COMMODITY_TYPE_CODE_CONTRACT_20260819';
const CONTRACT_LOCK_NAME =
  'seatrans:commodity-type-code-contract:2026-08-19:v1';

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const args = {
    mode: 'dry-run',
    phase: 'expand',
    targetDb: null,
    targetHost: null,
    backupReference: null,
    backupCreatedAt: null,
    logicalExport: null,
    restoreTestReference: null,
    rollForwardTestReference: null,
    deployReference: null,
    observationReference: null,
    rootApprovalReference: null,
    confirmation: null,
  };
  for (const argument of argv) {
    if (argument === '--verify-static') {
      args.mode = 'verify-static';
      continue;
    }
    if (
      argument === '--verify' ||
      argument === '--dry-run' ||
      argument === '--preflight'
    ) {
      args.mode = 'dry-run';
      continue;
    }
    if (argument === '--apply') {
      args.mode = 'apply';
      continue;
    }
    const [key, ...parts] = argument.split('=');
    const value = parts.join('=');
    if (key === '--phase') {
      if (!['expand', 'data', 'contract'].includes(value)) {
        throw new Error('--phase must be expand, data or contract');
      }
      args.phase = value;
    } else if (key === '--target-db') args.targetDb = value;
    else if (key === '--target-host') args.targetHost = value;
    else if (key === '--backup-reference') args.backupReference = value;
    else if (key === '--backup-created-at') args.backupCreatedAt = value;
    else if (key === '--logical-export') args.logicalExport = value;
    else if (key === '--restore-test-reference')
      args.restoreTestReference = value;
    else if (key === '--roll-forward-test-reference')
      args.rollForwardTestReference = value;
    else if (key === '--deploy-reference') args.deployReference = value;
    else if (key === '--observation-reference')
      args.observationReference = value;
    else if (key === '--root-approval-reference')
      args.rootApprovalReference = value;
    else if (key === '--confirm') args.confirmation = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

function stripSqlComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .trim();
}

export function verifyCodeTransitionStatic(sql) {
  const executable = stripSqlComments(sql);
  const statements = executable
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  const expected =
    /^ALTER\s+TABLE\s+public\.commodity_types\s+ALTER\s+COLUMN\s+code\s+DROP\s+NOT\s+NULL$/i;
  if (statements.length !== 1 || !expected.test(statements[0])) {
    throw new Error(
      'Static verification failed: migration must only drop commodity_types.code NOT NULL',
    );
  }
  return { statementCount: 1, forwardOnly: true };
}

export function verifyCodeIdentityDataStatic(sql) {
  const executable = stripSqlComments(sql);
  if (!/^DO\s+\$commodity_type_code_identity_data\$/i.test(executable)) {
    throw new Error(
      'Identity data static verification requires one guarded DO block',
    );
  }
  if (
    /\b(?:insert|delete|truncate|drop|alter|create|grant|revoke)\b/i.test(
      executable,
    )
  ) {
    throw new Error('Identity data static verification found forbidden SQL');
  }
  const updatedTables = [
    ...executable.matchAll(/\bUPDATE\s+public\.([a-z_]+)/gi),
  ]
    .map((match) => match[1].toLowerCase())
    .sort();
  if (
    updatedTables.length !== 2 ||
    updatedTables[0] !== 'epda_parameter_set' ||
    updatedTables[1] !== 'shipping_agency_inquiries'
  ) {
    throw new Error(
      'Identity data static verification permits updates only to inquiries and EPDA parameter sets',
    );
  }
  for (const required of [
    /RAISE\s+EXCEPTION/i,
    /commodityTypeId/i,
    /typeNameSnapshot/i,
    /IS\s+DISTINCT\s+FROM/i,
    /service_type_id/i,
    /commodity_types/i,
  ]) {
    if (!required.test(executable)) {
      throw new Error(
        'Identity data static verification is missing a safety invariant',
      );
    }
  }
  if (/commodity_type_id\s*=\s*\d+/i.test(executable)) {
    throw new Error('Identity data migration must not hard-code Type IDs');
  }
  return { forwardOnly: true, updatedTables };
}

export function verifyCommodityTypeCodeContractStatic(sql) {
  const executable = stripSqlComments(sql);
  const fail = (message) => {
    throw new Error(`Contract static verification failed: ${message}`);
  };
  if (!/^DO\s+\$commodity_type_code_contract\$/i.test(executable)) {
    fail('migration must be one guarded DO block');
  }
  if (/\b(?:insert|delete|truncate|create|grant|revoke)\b/i.test(executable)) {
    fail('forbidden SQL operation');
  }
  if (/\bCASCADE\b/i.test(executable)) fail('CASCADE is forbidden');

  const updatedTables = [
    ...executable.matchAll(/\bUPDATE\s+public\.([a-z_]+)/gi),
  ].map((match) => match[1].toLowerCase());
  if (updatedTables.length !== 1 || updatedTables[0] !== 'epda_parameter_set') {
    fail('only one EPDA parameter-set update is permitted');
  }
  if (
    (executable.match(/\bALTER\s+TABLE\b/gi) ?? []).length !== 2 ||
    (executable.match(/\bDROP\s+INDEX\b/gi) ?? []).length !== 1
  ) {
    fail('only the approved schema statements are permitted');
  }
  const approvedDrops = [];
  if (
    /DROP\s+INDEX\s+IF\s+EXISTS\s+public\.uq_commodity_types_service_code_normalized/i.test(
      executable,
    )
  )
    approvedDrops.push('uq_commodity_types_service_code_normalized');
  if (
    /ALTER\s+TABLE\s+public\.commodity_types\s+DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+ck_commodity_types_code_nonblank/i.test(
      executable,
    )
  )
    approvedDrops.push('ck_commodity_types_code_nonblank');
  if (
    /ALTER\s+TABLE\s+public\.commodity_types\s+DROP\s+COLUMN\s+IF\s+EXISTS\s+code/i.test(
      executable,
    )
  )
    approvedDrops.push('commodity_types.code');
  const dropCount = (
    executable.match(/\bDROP\s+(?:INDEX|TABLE|COLUMN|CONSTRAINT)\b/gi) ?? []
  ).length;
  if (dropCount !== 3 || approvedDrops.length !== 3) {
    fail('contract must contain exactly the three approved drops');
  }
  for (const required of [
    /RAISE\s+EXCEPTION/i,
    /jsonb_typeof/i,
    /commodityTypeId/i,
    /typeNameSnapshot/i,
    /commodity_types/i,
    /rate_value\s*-\s*'code'/i,
  ]) {
    if (!required.test(executable)) fail('missing safety invariant');
  }
  return { forwardOnly: true, updatedTables, approvedDrops };
}

function checksumJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function contractRates(fixture) {
  const rows = [];
  const knownTypeIds = new Set(fixture.commodityTypes.map((type) => type.id));
  for (const parameterSet of fixture.epdaParameterSets) {
    const rates = parameterSet.values?.cargoAgencyRates;
    if (rates == null) continue;
    if (!Array.isArray(rates)) {
      throw new Error('Contract preflight found non-array EPDA rates');
    }
    const seen = new Set();
    rates.forEach((rate, index) => {
      const id = rate?.commodityTypeId;
      if (
        rate == null ||
        typeof rate !== 'object' ||
        Array.isArray(rate) ||
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !knownTypeIds.has(id) ||
        typeof rate.typeNameSnapshot !== 'string' ||
        !rate.typeNameSnapshot.trim() ||
        typeof rate.label !== 'string' ||
        typeof rate.rate !== 'number' ||
        !Number.isFinite(rate.rate)
      ) {
        throw new Error(
          `Contract preflight found malformed or unresolved EPDA rate ${parameterSet.id}:${index}`,
        );
      }
      if (seen.has(id)) {
        throw new Error(
          `Contract preflight found duplicate Commodity Type ID in parameter set ${parameterSet.id}`,
        );
      }
      seen.add(id);
      rows.push({ parameterSetId: parameterSet.id, index, rate });
    });
  }
  return rows;
}

export function buildCommodityTypeCodeContractPlan(fixture) {
  if (!Array.isArray(fixture?.commodityTypes)) {
    throw new Error('Contract preflight is missing Commodity Types');
  }
  if (!Array.isArray(fixture?.epdaParameterSets)) {
    throw new Error('Contract preflight is missing EPDA parameter sets');
  }
  const rates = contractRates(fixture);
  return {
    commodityTypeCodeRemovalCount: fixture.commodityTypes.filter((type) =>
      Object.hasOwn(type, 'code'),
    ).length,
    rateCodeRemovalCount: rates.filter(({ rate }) =>
      Object.hasOwn(rate, 'code'),
    ).length,
  };
}

export function applyCommodityTypeCodeContractFixture(fixture, plan) {
  buildCommodityTypeCodeContractPlan(fixture);
  const result = structuredClone(fixture);
  for (const commodityType of result.commodityTypes) delete commodityType.code;
  for (const parameterSet of result.epdaParameterSets) {
    const rates = parameterSet.values?.cargoAgencyRates;
    if (!Array.isArray(rates)) continue;
    for (const rate of rates) delete rate.code;
  }
  const removed =
    plan.commodityTypeCodeRemovalCount + plan.rateCodeRemovalCount;
  if (!Number.isSafeInteger(removed) || removed < 0) {
    throw new Error('Contract preflight produced an invalid removal plan');
  }
  return result;
}

export function summarizeCommodityTypeCodeContractFixture(fixture) {
  const rates = contractRates(fixture);
  const sorted = (rows) =>
    rows.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  const typeIdentity = sorted(
    fixture.commodityTypes.map((type) => [
      type.id,
      type.serviceTypeId,
      type.name,
    ]),
  );
  const rateContract = rates.map(({ parameterSetId, index, rate }) => [
    parameterSetId,
    index,
    rate.commodityTypeId,
    rate.typeNameSnapshot,
    rate.label,
    rate.rate,
  ]);
  const numericRates = rates.map(({ parameterSetId, index, rate }) => [
    parameterSetId,
    index,
    rate.rate,
  ]);
  return {
    commodityTypeCodeCount: fixture.commodityTypes.filter((type) =>
      Object.hasOwn(type, 'code'),
    ).length,
    rateCodeCount: rates.filter(({ rate }) => Object.hasOwn(rate, 'code'))
      .length,
    typeIdentityChecksum: checksumJson(typeIdentity),
    inquiryChecksum: checksumJson(fixture.shippingInquiries ?? []),
    rateContractChecksum: checksumJson(rateContract),
    numericRateChecksum: checksumJson(numericRates),
    cargoTypesChecksum: checksumJson(fixture.cargoTypes ?? []),
    packageTypesChecksum: checksumJson(fixture.packageTypes ?? []),
    documentChecksum: checksumJson(fixture.documents ?? {}),
  };
}

export function validateCommodityTypeCodeContractPostflight(
  before,
  after,
  plan,
) {
  const blockers = [];
  for (const field of [
    'typeIdentityChecksum',
    'inquiryChecksum',
    'rateContractChecksum',
    'numericRateChecksum',
    'cargoTypesChecksum',
    'packageTypesChecksum',
    'documentChecksum',
  ]) {
    if (before[field] !== after[field]) blockers.push(`${field} changed`);
  }
  if (after.commodityTypeCodeCount !== 0)
    blockers.push('Commodity Type code remains');
  if (after.rateCodeCount !== 0) blockers.push('legacy EPDA rate code remains');
  if (before.commodityTypeCodeCount !== plan.commodityTypeCodeRemovalCount)
    blockers.push('Commodity Type removal count changed');
  if (before.rateCodeCount !== plan.rateCodeRemovalCount)
    blockers.push('rate removal count changed');
  if (blockers.length > 0) {
    throw new Error(`Contract postflight blockers: ${blockers.join('; ')}`);
  }
}

export function verifyCommodityTypeCodeContractApplyGuards(
  args,
  config,
  now = new Date(),
) {
  if (args.mode !== 'apply') return null;
  if (args.targetDb !== config.database)
    throw new Error('--target-db must exactly match configured database');
  if (args.targetHost !== config.host)
    throw new Error('--target-host must exactly match configured host');
  if (!args.backupReference?.trim())
    throw new Error('--backup-reference is required');
  const backupCreatedAt = new Date(args.backupCreatedAt ?? '');
  const age = now.getTime() - backupCreatedAt.getTime();
  if (
    !Number.isFinite(backupCreatedAt.getTime()) ||
    age < 0 ||
    age > 24 * 60 * 60 * 1000
  ) {
    throw new Error('--backup-created-at must identify a fresh backup');
  }
  for (const [field, option] of [
    ['restoreTestReference', '--restore-test-reference'],
    ['deployReference', '--deploy-reference'],
    ['observationReference', '--observation-reference'],
    ['rootApprovalReference', '--root-approval-reference'],
  ]) {
    if (!args[field]?.trim()) throw new Error(`${option} is required`);
  }
  if (args.confirmation !== CONTRACT_CONFIRMATION)
    throw new Error(`--confirm must equal ${CONTRACT_CONFIRMATION}`);
  if (!args.logicalExport || !isAbsolute(args.logicalExport))
    throw new Error('--logical-export must be an absolute path');
  const exportPath = resolve(args.logicalExport);
  const projectRelative = relative(PROJECT_ROOT, exportPath);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  )
    throw new Error('--logical-export must be outside backend2.0');
  if (!existsSync(dirname(exportPath)))
    throw new Error('--logical-export parent must exist');
  if (existsSync(exportPath))
    throw new Error('--logical-export refuses to overwrite');
  return { path: exportPath, backupCreatedAt: backupCreatedAt.toISOString() };
}

export function createCommodityTypeCodeContractRecoveryEnvelope(
  snapshot,
  evidence,
) {
  return {
    format: 'seatrans-commodity-type-code-contract-recovery-v1',
    createdAt: new Date().toISOString(),
    checksum: checksumJson(snapshot),
    snapshot,
    evidence: {
      ...evidence,
      restoreTested: true,
      deploymentObserved: true,
      explicitlyApproved: true,
    },
  };
}

export function writeCommodityTypeCodeContractRecoveryExport(path, envelope) {
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return readCommodityTypeCodeContractRecoveryExport(path);
}

export function readCommodityTypeCodeContractRecoveryExport(path) {
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  if (envelope.format !== 'seatrans-commodity-type-code-contract-recovery-v1')
    throw new Error('Contract recovery export format is unsupported');
  if (checksumJson(envelope.snapshot) !== envelope.checksum)
    throw new Error('Contract recovery export checksum mismatch');
  if (
    !Array.isArray(envelope.snapshot?.commodityTypesLegacy) ||
    !Array.isArray(envelope.snapshot?.epdaParameterSets) ||
    envelope.snapshot?.schema == null
  )
    throw new Error('Contract recovery export is missing targeted data');
  if (
    envelope.evidence?.restoreTested !== true ||
    envelope.evidence?.deploymentObserved !== true ||
    envelope.evidence?.explicitlyApproved !== true ||
    !String(envelope.evidence?.rootApprovalReference ?? '').trim()
  )
    throw new Error('Contract recovery export lacks approval evidence');
  return envelope;
}

function normalizedFixtureTypes(fixture) {
  return fixture.commodityTypes.filter(
    (type) => type.serviceTypeId === fixture.shippingAgencyServiceTypeId,
  );
}

function fixtureTypeCandidates(fixture, code) {
  const key = normalizeTypeKey(code);
  if (!key) return [];
  return normalizedFixtureTypes(fixture)
    .filter((type) => normalizeTypeKey(type.code) === key)
    .sort((left, right) => left.id - right.id);
}

export function buildCodeIdentityPlan(fixture) {
  if (!Number.isSafeInteger(fixture.shippingAgencyServiceTypeId)) {
    throw new Error('Shipping Agency Service identity is missing');
  }
  const typeGroups = new Map();
  for (const type of normalizedFixtureTypes(fixture)) {
    const key = normalizeTypeKey(type.code);
    const rows = typeGroups.get(key) ?? [];
    rows.push(type);
    typeGroups.set(key, rows);
  }
  const ambiguous = [...typeGroups.entries()].filter(
    ([key, rows]) => !key || rows.length !== 1,
  );
  if (ambiguous.length > 0) {
    throw new Error(
      'Identity data preflight found ambiguous Commodity Type codes',
    );
  }

  const inquiryMappings = fixture.shippingInquiries.map((inquiry) => {
    const candidates = fixtureTypeCandidates(fixture, inquiry.cargoType);
    if (candidates.length !== 1) {
      throw new Error(
        `Identity data preflight found unresolved inquiry ${inquiry.id}`,
      );
    }
    const commodityType = candidates[0];
    if (
      inquiry.commodityTypeId != null &&
      inquiry.commodityTypeId !== commodityType.id
    ) {
      throw new Error(
        `Identity data preflight found conflicting stored Type ID on inquiry ${inquiry.id}`,
      );
    }
    return { inquiryId: inquiry.id, commodityTypeId: commodityType.id };
  });

  const rateMappings = [];
  for (const parameterSet of fixture.epdaParameterSets) {
    const rates = parameterSet.values?.cargoAgencyRates;
    if (rates == null) continue;
    if (!Array.isArray(rates)) {
      throw new Error('Identity data preflight found malformed EPDA rates');
    }
    rates.forEach((rate, rateIndex) => {
      if (
        rate == null ||
        typeof rate !== 'object' ||
        typeof rate.code !== 'string' ||
        !rate.code.trim() ||
        typeof rate.label !== 'string' ||
        typeof rate.rate !== 'number' ||
        !Number.isFinite(rate.rate)
      ) {
        throw new Error('Identity data preflight found malformed EPDA rate');
      }
      if (
        (rate.commodityTypeId != null &&
          !Number.isSafeInteger(rate.commodityTypeId)) ||
        (rate.typeNameSnapshot != null &&
          typeof rate.typeNameSnapshot !== 'string')
      ) {
        throw new Error('Identity data preflight found malformed EPDA rate');
      }
      const candidates = fixtureTypeCandidates(fixture, rate.code);
      if (candidates.length !== 1) {
        throw new Error(
          `Identity data preflight found unresolved EPDA rate ${parameterSet.id}:${rateIndex}`,
        );
      }
      const commodityType = candidates[0];
      if (
        rate.commodityTypeId != null &&
        rate.commodityTypeId !== commodityType.id
      ) {
        throw new Error(
          `Identity data preflight found conflicting stored Type ID on EPDA rate ${parameterSet.id}:${rateIndex}`,
        );
      }
      rateMappings.push({
        parameterSetId: parameterSet.id,
        rateIndex,
        commodityTypeId: commodityType.id,
        typeNameSnapshot:
          typeof rate.typeNameSnapshot === 'string' &&
          rate.typeNameSnapshot.trim() !== ''
            ? rate.typeNameSnapshot
            : commodityType.name,
      });
    });
  }
  return { inquiryMappings, rateMappings };
}

export function applyCodeIdentityFixture(fixture, plan) {
  const result = structuredClone(fixture);
  const inquiryMappings = new Map(
    plan.inquiryMappings.map((row) => [row.inquiryId, row]),
  );
  for (const inquiry of result.shippingInquiries) {
    const mapping = inquiryMappings.get(inquiry.id);
    if (mapping) inquiry.commodityTypeId = mapping.commodityTypeId;
  }
  const rateMappings = new Map(
    plan.rateMappings.map((row) => [
      `${row.parameterSetId}:${row.rateIndex}`,
      row,
    ]),
  );
  for (const parameterSet of result.epdaParameterSets) {
    const rates = parameterSet.values?.cargoAgencyRates;
    if (!Array.isArray(rates)) continue;
    rates.forEach((rate, rateIndex) => {
      const mapping = rateMappings.get(`${parameterSet.id}:${rateIndex}`);
      if (!mapping) return;
      rate.commodityTypeId = mapping.commodityTypeId;
      rate.typeNameSnapshot = mapping.typeNameSnapshot;
    });
  }
  return result;
}

export function summarizeCodeIdentityFixture(fixture) {
  const inquiryCargoRows = fixture.shippingInquiries
    .map((row) => [row.id, row.cargoType ?? null])
    .sort((left, right) => left[0] - right[0]);
  const inquiryIdentityRows = fixture.shippingInquiries
    .map((row) => [row.id, row.commodityTypeId ?? null])
    .sort((left, right) => left[0] - right[0]);
  const numericRateRows = [];
  const legacyRateRows = [];
  const rateIdentityRows = [];
  for (const parameterSet of fixture.epdaParameterSets) {
    const rates = parameterSet.values?.cargoAgencyRates;
    if (!Array.isArray(rates)) continue;
    rates.forEach((rate, index) => {
      numericRateRows.push([parameterSet.id, index, rate.rate ?? null]);
      legacyRateRows.push([
        parameterSet.id,
        index,
        rate.code ?? null,
        rate.label ?? null,
        rate.rate ?? null,
      ]);
      rateIdentityRows.push([
        parameterSet.id,
        index,
        rate.commodityTypeId ?? null,
        rate.typeNameSnapshot ?? null,
      ]);
    });
  }
  const sortRates = (rows) =>
    rows.sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  sortRates(numericRateRows);
  sortRates(legacyRateRows);
  sortRates(rateIdentityRows);
  return {
    inquiryCount: inquiryCargoRows.length,
    rateCount: numericRateRows.length,
    inquiryCargoTypeChecksum: checksumJson(inquiryCargoRows),
    inquiryIdentityChecksum: checksumJson(inquiryIdentityRows),
    numericRateChecksum: checksumJson(numericRateRows),
    legacyRateChecksum: checksumJson(legacyRateRows),
    rateIdentityChecksum: checksumJson(rateIdentityRows),
    inquiryIdentityRows,
    rateIdentityRows,
  };
}

export function validateCodeIdentityDataPreflight(summary, plan) {
  if (summary.inquiryCount !== plan.inquiryMappings.length) {
    throw new Error('Identity data preflight does not cover every inquiry');
  }
  if (summary.rateCount !== plan.rateMappings.length) {
    throw new Error('Identity data preflight does not cover every EPDA rate');
  }
}

export function validateCodeIdentityDataPostflight(before, after, plan) {
  const blockers = [];
  if (after.inquiryCount !== before.inquiryCount)
    blockers.push('inquiry row count changed');
  if (after.rateCount !== before.rateCount)
    blockers.push('EPDA rate count changed');
  if (after.inquiryCargoTypeChecksum !== before.inquiryCargoTypeChecksum)
    blockers.push('inquiry cargo_type snapshots changed');
  if (after.numericRateChecksum !== before.numericRateChecksum)
    blockers.push('EPDA numeric rates changed');
  if (after.legacyRateChecksum !== before.legacyRateChecksum)
    blockers.push('EPDA legacy code/label/rate values changed');
  const expectedInquiryRows = plan.inquiryMappings
    .map((row) => [row.inquiryId, row.commodityTypeId])
    .sort((left, right) => left[0] - right[0]);
  const expectedRateRows = plan.rateMappings
    .map((row) => [
      row.parameterSetId,
      row.rateIndex,
      row.commodityTypeId,
      row.typeNameSnapshot,
    ])
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  if (
    checksumJson(after.inquiryIdentityRows) !==
    checksumJson(expectedInquiryRows)
  )
    blockers.push('inquiry Type IDs are incomplete');
  if (checksumJson(after.rateIdentityRows) !== checksumJson(expectedRateRows))
    blockers.push('EPDA rate Type identities are incomplete');
  if (blockers.length > 0) {
    throw new Error(
      `Identity data postflight blockers: ${blockers.join('; ')}`,
    );
  }
}

export function createCodeIdentityRecoveryEnvelope(snapshot, evidence) {
  return {
    format: 'seatrans-commodity-type-code-identity-recovery-v1',
    createdAt: new Date().toISOString(),
    checksum: checksumJson(snapshot),
    snapshot,
    evidence: {
      backupReference: evidence.backupReference,
      restoreTested: true,
      rollForwardTested: true,
      restoreTestReference: evidence.restoreTestReference,
      rollForwardTestReference: evidence.rollForwardTestReference,
    },
  };
}

export function writeCodeIdentityRecoveryExport(path, envelope) {
  writeFileSync(path, `${JSON.stringify(envelope, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  });
  return readCodeIdentityRecoveryExport(path);
}

export function readCodeIdentityRecoveryExport(path) {
  const envelope = JSON.parse(readFileSync(path, 'utf8'));
  if (envelope.format !== 'seatrans-commodity-type-code-identity-recovery-v1') {
    throw new Error('Identity data recovery export format is unsupported');
  }
  if (checksumJson(envelope.snapshot) !== envelope.checksum) {
    throw new Error('Identity data recovery export checksum mismatch');
  }
  if (
    !Array.isArray(envelope.snapshot?.shippingInquiries) ||
    !Array.isArray(envelope.snapshot?.epdaParameterSets)
  ) {
    throw new Error('Identity data recovery export is missing targeted rows');
  }
  if (
    envelope.evidence?.restoreTested !== true ||
    envelope.evidence?.rollForwardTested !== true ||
    !String(envelope.evidence?.restoreTestReference ?? '').trim() ||
    !String(envelope.evidence?.rollForwardTestReference ?? '').trim()
  ) {
    throw new Error('Identity data recovery export lacks tested evidence');
  }
  return envelope;
}

export function verifyCodeIdentityDataApplyGuards(args, config) {
  if (args.mode !== 'apply') return null;
  if (args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for data --apply');
  }
  if (!args.restoreTestReference?.trim()) {
    throw new Error('--restore-test-reference is required for data --apply');
  }
  if (!args.rollForwardTestReference?.trim()) {
    throw new Error(
      '--roll-forward-test-reference is required for data --apply',
    );
  }
  if (args.confirmation !== DATA_CONFIRMATION) {
    throw new Error(`--confirm must equal ${DATA_CONFIRMATION}`);
  }
  if (!args.logicalExport || !isAbsolute(args.logicalExport)) {
    throw new Error('--logical-export must be an absolute path');
  }
  const exportPath = resolve(args.logicalExport);
  const projectRelative = relative(PROJECT_ROOT, exportPath);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
  if (
    !existsSync(dirname(exportPath)) ||
    !statSync(dirname(exportPath)).isDirectory()
  ) {
    throw new Error('--logical-export parent must be an existing directory');
  }
  if (existsSync(exportPath)) {
    throw new Error('--logical-export refuses to overwrite an existing file');
  }
  return { path: exportPath };
}

export function hasRetainedNonblankConstraint(constraints, name, column) {
  const constraint = constraints.find((item) => item.name === name);
  if (!constraint || constraint.type !== 'c') return false;
  const normalized = String(constraint.definition ?? '')
    .replace(/::(?:character varying|text)/gi, '')
    .replace(/[()]/g, ' ')
    .replace(/\s+/g, ' ');
  return new RegExp(`btrim\\s+${column}\\s+<>\\s+''`, 'i').test(normalized);
}

function hasNamedNormalizedUniqueIndex(indexes, name, column) {
  const index = indexes.find((item) => item.name === name);
  if (!index) return false;
  const definition = index.definition ?? '';
  return (
    /CREATE\s+UNIQUE\s+INDEX/i.test(definition) &&
    /service_type_id/i.test(definition) &&
    new RegExp(`lower\\s*\\([\\s\\S]*?${column}`, 'i').test(definition)
  );
}

async function inspectCodeTransition(client) {
  const table = await client.query(
    "SELECT to_regclass('public.commodity_types') IS NOT NULL AS exists",
  );
  if (table.rows[0]?.exists !== true) {
    return {
      tableExists: false,
      codeColumnExists: false,
      nameColumnExists: false,
      codeNullable: null,
      nameNullable: null,
      codeNonblankCheckExists: false,
      nameNonblankCheckExists: false,
      codeNormalizedUniqueExists: false,
      nameNormalizedUniqueExists: false,
      blankNameCount: 0,
      normalizedNameDuplicateCount: 0,
      rowCount: 0,
      rowChecksum: null,
      nameChecksum: null,
    };
  }

  const columns = (
    await client.query(`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'commodity_types'
         AND column_name IN ('code', 'name')
       ORDER BY column_name
    `)
  ).rows;
  const codeColumn = columns.find((column) => column.column_name === 'code');
  const nameColumn = columns.find((column) => column.column_name === 'name');
  const constraints = (
    await client.query(`
      SELECT conname AS name, contype AS type,
             pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid = 'public.commodity_types'::regclass
       ORDER BY conname
    `)
  ).rows;
  const indexes = (
    await client.query(`
      SELECT indexname AS name, indexdef AS definition
        FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'commodity_types'
       ORDER BY indexname
    `)
  ).rows;

  let snapshot = {
    row_count: 0,
    row_checksum: null,
    name_checksum: null,
    blank_name_count: 0,
    normalized_name_duplicate_count: 0,
  };
  if (codeColumn && nameColumn) {
    snapshot = (
      await client.query(`
        SELECT
          count(*)::integer AS row_count,
          md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY id), ''))
            AS row_checksum,
          md5(coalesce(string_agg(
            md5(jsonb_build_array(id, service_type_id, name)::text),
            '' ORDER BY id
          ), '')) AS name_checksum,
          count(*) FILTER (WHERE btrim(name) = '')::integer AS blank_name_count,
          (
            SELECT count(*)::integer
              FROM (
                SELECT service_type_id, lower(btrim(name))
                  FROM public.commodity_types
                 GROUP BY service_type_id, lower(btrim(name))
                HAVING count(*) > 1
              ) AS duplicate_names
          ) AS normalized_name_duplicate_count
        FROM public.commodity_types AS t
      `)
    ).rows[0];
  }

  return {
    tableExists: true,
    codeColumnExists: codeColumn != null,
    nameColumnExists: nameColumn != null,
    codeNullable: codeColumn?.is_nullable === 'YES',
    nameNullable: nameColumn?.is_nullable === 'YES',
    codeNonblankCheckExists: hasRetainedNonblankConstraint(
      constraints,
      'ck_commodity_types_code_nonblank',
      'code',
    ),
    nameNonblankCheckExists: hasRetainedNonblankConstraint(
      constraints,
      'ck_commodity_types_name_nonblank',
      'name',
    ),
    codeNormalizedUniqueExists: hasNamedNormalizedUniqueIndex(
      indexes,
      'uq_commodity_types_service_code_normalized',
      'code',
    ),
    nameNormalizedUniqueExists: hasNamedNormalizedUniqueIndex(
      indexes,
      'uq_commodity_types_service_name_normalized',
      'name',
    ),
    blankNameCount: Number(snapshot.blank_name_count ?? 0),
    normalizedNameDuplicateCount: Number(
      snapshot.normalized_name_duplicate_count ?? 0,
    ),
    rowCount: Number(snapshot.row_count ?? 0),
    rowChecksum: snapshot.row_checksum ?? null,
    nameChecksum: snapshot.name_checksum ?? null,
  };
}

export function validateCodeTransitionPreflight(report) {
  const blockers = [];
  if (!report.tableExists) blockers.push('commodity_types table is missing');
  if (!report.codeColumnExists) blockers.push('code column is missing');
  if (!report.nameColumnExists) blockers.push('name column is missing');
  if (report.nameNullable) blockers.push('name must remain NOT NULL');
  if (!report.codeNonblankCheckExists)
    blockers.push('code nonblank check is missing');
  if (!report.nameNonblankCheckExists)
    blockers.push('name nonblank check is missing');
  if (!report.codeNormalizedUniqueExists)
    blockers.push('code normalized unique index is missing');
  if (!report.nameNormalizedUniqueExists)
    blockers.push('name normalized unique index is missing');
  if (report.blankNameCount !== 0) blockers.push('blank Type names exist');
  if (report.normalizedNameDuplicateCount !== 0)
    blockers.push('normalized duplicate Type names exist');
  if (blockers.length > 0) {
    throw new Error(
      `Code transition preflight blockers: ${blockers.join('; ')}`,
    );
  }
}

export function validateCodeTransitionPostflight(before, after) {
  const blockers = [];
  try {
    validateCodeTransitionPreflight(after);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (!after.codeNullable) blockers.push('code is not nullable');
  if (after.rowCount !== before.rowCount)
    blockers.push('Commodity Type rows changed');
  if (after.nameChecksum !== before.nameChecksum)
    blockers.push('Commodity Type names changed');
  if (after.rowChecksum !== before.rowChecksum)
    blockers.push('Commodity Type row content changed');
  if (blockers.length > 0) {
    throw new Error(
      `Code transition postflight blockers: ${blockers.join('; ')}`,
    );
  }
}

async function inspectReadOnly(client) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const report = await inspectCodeTransition(client);
    await client.query('ROLLBACK');
    return report;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function buildSsl() {
  const explicit = process.env.DB_SSL?.trim().toLowerCase();
  if (
    !['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
      explicit ?? '',
    )
  ) {
    return undefined;
  }
  return {
    rejectUnauthorized:
      process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === 'true',
  };
}

function buildClientConfig() {
  const dbUrl = process.env.DB_URL?.trim();
  const ssl = buildSsl();
  if (dbUrl) {
    const parsed = new URL(dbUrl);
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\/+/, ''),
      ssl,
    };
  }
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl,
  };
}

function verifyApplyGuards(args, config) {
  if (args.mode !== 'apply') return null;
  if (args.targetDb !== config.database) {
    throw new Error('--target-db must exactly match the configured database');
  }
  if (!args.backupReference?.trim()) {
    throw new Error('--backup-reference is required for --apply');
  }
  if (args.confirmation !== EXPAND_CONFIRMATION) {
    throw new Error(`--confirm must equal ${EXPAND_CONFIRMATION}`);
  }
  if (!args.logicalExport || !isAbsolute(args.logicalExport)) {
    throw new Error('--logical-export must be an absolute existing file');
  }
  const exportPath = realpathSync(args.logicalExport);
  const stats = statSync(exportPath);
  if (!stats.isFile() || stats.size === 0) {
    throw new Error('--logical-export must be a non-empty file');
  }
  const projectRelative = relative(PROJECT_ROOT, exportPath);
  if (
    projectRelative === '' ||
    (!projectRelative.startsWith('..') && !isAbsolute(projectRelative))
  ) {
    throw new Error('--logical-export must be stored outside backend2.0');
  }
  return { path: exportPath, size: stats.size };
}

async function ensureLedger(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.app_schema_migrations (
      migration_id VARCHAR(200) PRIMARY KEY,
      script_checksum VARCHAR(64) NOT NULL,
      status VARCHAR(20) NOT NULL,
      backup_reference TEXT,
      logical_export_reference TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

async function collectCodeIdentityInspection(
  client,
  requireTransition = false,
) {
  const transition = await inspectCodeTransition(client);
  validateCodeTransitionPreflight(transition);
  if (requireTransition && !transition.codeNullable) {
    throw new Error(
      'Identity data preflight requires the code transition expand phase first',
    );
  }
  const serviceTypes = (await client.query(SERVICE_TYPES_SQL)).rows;
  const shippingAgencyServiceTypeId =
    findShippingAgencyServiceTypeId(serviceTypes);
  const commodityTypes = (await client.query(COMMODITY_TYPES_SQL)).rows;
  const shippingInquiries = (await client.query(SHIPPING_AGENCY_INQUIRIES_SQL))
    .rows;
  const epdaParameterSets = (await client.query(EPDA_PARAMETER_SETS_SQL)).rows;
  const fixture = {
    shippingAgencyServiceTypeId,
    commodityTypes,
    shippingInquiries,
    epdaParameterSets,
  };
  const report = buildCommodityTypeCodeRemovalPreflight({
    commodityTypes,
    inquiries: shippingInquiries,
    epdaParameterSets,
    shippingAgencyServiceTypeId,
  });
  if (report.blockers.length > 0) {
    throw new Error(
      `Identity data preflight blockers: ${JSON.stringify(report.blockers)}`,
    );
  }
  const plan = buildCodeIdentityPlan(fixture);
  const summary = summarizeCodeIdentityFixture(fixture);
  validateCodeIdentityDataPreflight(summary, plan);
  const expected = summarizeCodeIdentityFixture(
    applyCodeIdentityFixture(fixture, plan),
  );
  return {
    fixture,
    plan,
    summary,
    publicReport: {
      transition,
      mappingSummary: report.summary,
      inquiryMappingCount: plan.inquiryMappings.length,
      epdaRateMappingCount: plan.rateMappings.length,
      inquiryCargoTypeChecksum: summary.inquiryCargoTypeChecksum,
      numericRateChecksum: summary.numericRateChecksum,
      legacyRateChecksum: summary.legacyRateChecksum,
      inquiryIdentityComplete:
        summary.inquiryIdentityChecksum === expected.inquiryIdentityChecksum,
      epdaRateIdentityComplete:
        summary.rateIdentityChecksum === expected.rateIdentityChecksum,
    },
  };
}

async function inspectCodeIdentityReadOnly(client) {
  await client.query(
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const result = await collectCodeIdentityInspection(client, false);
    await client.query('ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function collectCodeIdentityRecoverySnapshot(client) {
  const shippingInquiries = (
    await client.query(`
      SELECT id, cargo_type AS "cargoType",
             commodity_type_id AS "commodityTypeId"
        FROM public.shipping_agency_inquiries
       ORDER BY id
    `)
  ).rows;
  const epdaParameterSets = (
    await client.query(`
      SELECT id, values, version, updated_at AS "updatedAt"
        FROM public.epda_parameter_set
       ORDER BY id
    `)
  ).rows;
  return { shippingInquiries, epdaParameterSets };
}

export async function collectContractFixture(client) {
  const commodityTypes = (
    await client.query(`
      SELECT to_jsonb(commodity_type) AS row
        FROM public.commodity_types AS commodity_type
       ORDER BY commodity_type.id
    `)
  ).rows.map(({ row }) => ({
    id: row.id,
    serviceTypeId: row.service_type_id,
    name: row.name,
    ...(Object.hasOwn(row, 'code') ? { code: row.code } : {}),
  }));
  const shippingInquiries = (
    await client.query(`
      SELECT id, commodity_type_id AS "commodityTypeId",
             cargo_type AS "cargoType"
        FROM public.shipping_agency_inquiries
       ORDER BY id
    `)
  ).rows;
  const epdaParameterSets = (
    await client.query(`
      SELECT id, values
        FROM public.epda_parameter_set
       ORDER BY id
    `)
  ).rows;
  const cargoTypes = (
    await client.query(`
      SELECT to_jsonb(cargo_type) AS row
        FROM public.cargo_types AS cargo_type
       ORDER BY cargo_type.code, cargo_type.service_type_type
    `)
  ).rows.map(({ row }) => row);
  const packageTypes = (
    await client.query(`
      SELECT to_jsonb(package_type) AS row
        FROM public.package_types AS package_type
       ORDER BY package_type.id
    `)
  ).rows.map(({ row }) => row);
  const documents = {};
  for (const table of [
    'booking_records',
    'arrival_notice_records',
    'delivery_order_records',
    'bill_of_lading_records',
  ]) {
    documents[table] = (
      await client.query(
        `SELECT to_jsonb(document_row) AS row FROM public.${table} AS document_row ORDER BY document_row.id`,
      )
    ).rows.map(({ row }) => row);
  }
  return {
    commodityTypes,
    shippingInquiries,
    epdaParameterSets,
    cargoTypes,
    packageTypes,
    documents,
  };
}

async function inspectContractSchema(client) {
  const result = (
    await client.query(`
      SELECT
        EXISTS (
          SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = 'commodity_types'
             AND column_name = 'code'
        ) AS "codeColumnExists",
        to_regclass('public.uq_commodity_types_service_code_normalized')
          IS NOT NULL AS "codeIndexExists",
        EXISTS (
          SELECT 1 FROM pg_constraint
           WHERE conrelid = 'public.commodity_types'::regclass
             AND conname = 'ck_commodity_types_code_nonblank'
        ) AS "codeCheckExists"
    `)
  ).rows[0];
  return result;
}

function validateContractSchemaState(schema, allowContracted) {
  const count = [
    schema.codeColumnExists,
    schema.codeIndexExists,
    schema.codeCheckExists,
  ].filter(Boolean).length;
  if (count === 3) return 'ready';
  if (allowContracted && count === 0) return 'contracted';
  throw new Error('Contract preflight found a partial Type-code schema');
}

async function collectContractInspection(client, allowContracted = false) {
  const schema = await inspectContractSchema(client);
  const schemaState = validateContractSchemaState(schema, allowContracted);
  const fixture = await collectContractFixture(client);
  const plan = buildCommodityTypeCodeContractPlan(fixture);
  const summary = summarizeCommodityTypeCodeContractFixture(fixture);
  if (schemaState === 'ready' && summary.commodityTypeCodeCount === 0) {
    throw new Error('Contract preflight cannot recover legacy Type code rows');
  }
  if (
    schemaState === 'contracted' &&
    (summary.commodityTypeCodeCount !== 0 || summary.rateCodeCount !== 0)
  ) {
    throw new Error('Contract postflight still contains legacy code');
  }
  return { schema, schemaState, fixture, plan, summary };
}

async function inspectContractReadOnly(client) {
  await client.query(
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const inspection = await collectContractInspection(client, true);
    await client.query('ROLLBACK');
    return inspection;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function collectContractRecoverySnapshot(client) {
  const commodityTypesLegacy = (
    await client.query(`
      SELECT to_jsonb(commodity_type) AS row
        FROM public.commodity_types AS commodity_type
       ORDER BY commodity_type.id
    `)
  ).rows.map(({ row }) => row);
  const epdaParameterSets = (
    await client.query(`
      SELECT id, values, version, updated_at AS "updatedAt"
        FROM public.epda_parameter_set
       ORDER BY id
    `)
  ).rows;
  const columns = (
    await client.query(`
      SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'commodity_types'
       ORDER BY ordinal_position
    `)
  ).rows;
  const constraints = (
    await client.query(`
      SELECT conname AS name, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
       WHERE conrelid = 'public.commodity_types'::regclass
       ORDER BY conname
    `)
  ).rows;
  const indexes = (
    await client.query(`
      SELECT indexname AS name, indexdef AS definition
        FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'commodity_types'
       ORDER BY indexname
    `)
  ).rows;
  return {
    commodityTypesLegacy,
    epdaParameterSets,
    schema: { columns, constraints, indexes },
  };
}

async function runContract(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(CONTRACT_SQL_PATH, 'utf8');
  verifyCommodityTypeCodeContractStatic(sql);
  const checksum = createHash('sha256').update(sql).digest('hex');
  const recoveryPath = verifyCommodityTypeCodeContractApplyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    if (args.mode !== 'apply') {
      const before = await inspectContractReadOnly(client);
      console.log(
        JSON.stringify(
          {
            mode: 'dry-run',
            phase: 'contract',
            hold: true,
            migrationId: CONTRACT_MIGRATION_ID,
            scriptChecksum: checksum,
            preflight: {
              schemaState: before.schemaState,
              rateCodeRemovalCount: before.plan.rateCodeRemovalCount,
              protectedChecksums: before.summary,
            },
          },
          null,
          2,
        ),
      );
      console.log('Contract HOLD. READ ONLY preflight; no writes occurred.');
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [CONTRACT_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired)
      throw new Error('Another Commodity Type code contract is running');
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query(
        'LOCK TABLE public.commodity_types, public.epda_parameter_set IN ACCESS EXCLUSIVE MODE',
      );
      const before = await collectContractInspection(client, true);
      const ledgerTable = (
        await client.query(
          "SELECT to_regclass('public.app_schema_migrations') IS NOT NULL AS exists",
        )
      ).rows[0]?.exists;
      if (ledgerTable !== true)
        throw new Error('Contract requires the existing migration ledger');
      const ledger = (
        await client.query(
          `SELECT script_checksum AS "scriptChecksum", status
             FROM public.app_schema_migrations
            WHERE migration_id = $1`,
          [CONTRACT_MIGRATION_ID],
        )
      ).rows[0];
      if (ledger && ledger.scriptChecksum !== checksum)
        throw new Error('Contract migration ID has a different checksum');
      if (ledger?.status === 'SUCCEEDED') {
        if (before.schemaState !== 'contracted')
          throw new Error('Contract ledger/schema state mismatch');
        validateCommodityTypeCodeContractPostflight(
          before.summary,
          before.summary,
          before.plan,
        );
        await client.query('ROLLBACK');
        console.log('Commodity Type code contract already succeeded.');
        return;
      }
      if (before.schemaState !== 'ready')
        throw new Error('Contracted schema is missing a successful ledger row');

      const recoverySnapshot = await collectContractRecoverySnapshot(client);
      const recoveryEnvelope = createCommodityTypeCodeContractRecoveryEnvelope(
        recoverySnapshot,
        {
          backupReference: args.backupReference.trim(),
          backupCreatedAt: recoveryPath.backupCreatedAt,
          restoreTestReference: args.restoreTestReference.trim(),
          deployReference: args.deployReference.trim(),
          observationReference: args.observationReference.trim(),
          rootApprovalReference: args.rootApprovalReference.trim(),
        },
      );
      const verifiedRecovery = writeCommodityTypeCodeContractRecoveryExport(
        recoveryPath.path,
        recoveryEnvelope,
      );
      await client.query(
        `INSERT INTO public.app_schema_migrations (
           migration_id, script_checksum, status, backup_reference,
           logical_export_reference, started_at, completed_at, details
         ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
         ON CONFLICT (migration_id) DO UPDATE SET
           status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
           logical_export_reference = EXCLUDED.logical_export_reference,
           started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
        [
          CONTRACT_MIGRATION_ID,
          checksum,
          args.backupReference.trim(),
          recoveryPath.path,
          JSON.stringify({
            recoveryExportChecksum: verifiedRecovery.checksum,
            deployReference: args.deployReference.trim(),
            observationReference: args.observationReference.trim(),
            rootApprovalReference: args.rootApprovalReference.trim(),
            before: before.summary,
          }),
        ],
      );
      await client.query(sql);
      const after = await collectContractInspection(client, true);
      if (after.schemaState !== 'contracted')
        throw new Error('Contract postflight schema is incomplete');
      validateCommodityTypeCodeContractPostflight(
        before.summary,
        after.summary,
        before.plan,
      );
      await client.query(
        `UPDATE public.app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(), details = $2::jsonb
          WHERE migration_id = $1`,
        [
          CONTRACT_MIGRATION_ID,
          JSON.stringify({
            recoveryExportChecksum: verifiedRecovery.checksum,
            before: before.summary,
            after: after.summary,
          }),
        ],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify(
          { committed: true, phase: 'contract', postflight: after.summary },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        CONTRACT_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

async function runData(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(DATA_SQL_PATH, 'utf8');
  verifyCodeIdentityDataStatic(sql);
  const checksum = createHash('sha256').update(sql).digest('hex');
  const recoveryPath = verifyCodeIdentityDataApplyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    if (args.mode !== 'apply') {
      const before = await inspectCodeIdentityReadOnly(client);
      console.log(
        JSON.stringify(
          {
            mode: 'dry-run',
            phase: 'data',
            migrationId: DATA_MIGRATION_ID,
            scriptChecksum: checksum,
            preflight: before.publicReport,
          },
          null,
          2,
        ),
      );
      console.log(
        'Dry-run only. READ ONLY preflight completed; no writes occurred.',
      );
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [DATA_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error(
        'Another Commodity Type identity data migration is running',
      );
    }
    await ensureLedger(client);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '5min'");
      await client.query(
        'LOCK TABLE public.service_types, public.commodity_types, public.shipping_agency_inquiries, public.epda_parameter_set IN SHARE ROW EXCLUSIVE MODE',
      );
      const before = await collectCodeIdentityInspection(client, true);
      const ledger = (
        await client.query(
          `SELECT script_checksum AS "scriptChecksum", status
             FROM public.app_schema_migrations
            WHERE migration_id = $1`,
          [DATA_MIGRATION_ID],
        )
      ).rows[0];
      if (ledger && ledger.scriptChecksum !== checksum) {
        throw new Error('Identity data migration ID has a different checksum');
      }
      if (ledger?.status === 'SUCCEEDED') {
        validateCodeIdentityDataPostflight(
          before.summary,
          before.summary,
          before.plan,
        );
        await client.query('ROLLBACK');
        console.log(
          'Commodity Type identity data migration already succeeded.',
        );
        return;
      }

      const recoverySnapshot =
        await collectCodeIdentityRecoverySnapshot(client);
      const recoveryEnvelope = createCodeIdentityRecoveryEnvelope(
        recoverySnapshot,
        {
          backupReference: args.backupReference.trim(),
          restoreTestReference: args.restoreTestReference.trim(),
          rollForwardTestReference: args.rollForwardTestReference.trim(),
        },
      );
      const verifiedRecovery = writeCodeIdentityRecoveryExport(
        recoveryPath.path,
        recoveryEnvelope,
      );
      await client.query(
        `INSERT INTO public.app_schema_migrations (
           migration_id, script_checksum, status, backup_reference,
           logical_export_reference, started_at, completed_at, details
         ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
         ON CONFLICT (migration_id) DO UPDATE SET
           status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
           logical_export_reference = EXCLUDED.logical_export_reference,
           started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
        [
          DATA_MIGRATION_ID,
          checksum,
          args.backupReference.trim(),
          recoveryPath.path,
          JSON.stringify({
            restoreTestReference: args.restoreTestReference.trim(),
            rollForwardTestReference: args.rollForwardTestReference.trim(),
            recoveryExportChecksum: verifiedRecovery.checksum,
            before: before.publicReport,
          }),
        ],
      );
      await client.query(sql);
      const after = await collectCodeIdentityInspection(client, true);
      validateCodeIdentityDataPostflight(
        before.summary,
        after.summary,
        before.plan,
      );
      await client.query(
        `UPDATE public.app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(), details = $2::jsonb
          WHERE migration_id = $1`,
        [
          DATA_MIGRATION_ID,
          JSON.stringify({
            restoreTestReference: args.restoreTestReference.trim(),
            rollForwardTestReference: args.rollForwardTestReference.trim(),
            recoveryExportChecksum: verifiedRecovery.checksum,
            before: before.publicReport,
            after: after.publicReport,
          }),
        ],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify(
          { committed: true, phase: 'data', postflight: after.publicReport },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        DATA_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

async function runExpand(args) {
  loadEnvFile(join(PROJECT_ROOT, '.env'));
  loadEnvFile(join(PROJECT_ROOT, '.env.local'));
  const config = buildClientConfig();
  const sql = readFileSync(EXPAND_SQL_PATH, 'utf8');
  verifyCodeTransitionStatic(sql);
  const checksum = createHash('sha256').update(sql).digest('hex');
  const logicalExport = verifyApplyGuards(args, config);
  const client = new pg.Client(config);
  await client.connect();
  let lockAcquired = false;
  try {
    const before = await inspectReadOnly(client);
    validateCodeTransitionPreflight(before);
    console.log(
      JSON.stringify(
        {
          mode: args.mode,
          phase: 'expand',
          migrationId: EXPAND_MIGRATION_ID,
          scriptChecksum: checksum,
          preflight: before,
        },
        null,
        2,
      ),
    );
    if (args.mode !== 'apply') {
      console.log(
        'Dry-run only. READ ONLY preflight completed; no writes occurred.',
      );
      return;
    }

    const lock = await client.query(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [EXPAND_LOCK_NAME],
    );
    lockAcquired = lock.rows[0]?.acquired === true;
    if (!lockAcquired) {
      throw new Error('Another Commodity Type code transition is running');
    }
    await ensureLedger(client);
    const ledger = await client.query(
      `SELECT script_checksum, status
         FROM public.app_schema_migrations
        WHERE migration_id = $1`,
      [EXPAND_MIGRATION_ID],
    );
    const existing = ledger.rows[0];
    if (existing && existing.script_checksum !== checksum) {
      throw new Error('Migration ID exists with a different checksum');
    }
    if (existing?.status === 'SUCCEEDED') {
      validateCodeTransitionPostflight(before, before);
      console.log('Commodity Type code transition already succeeded.');
      return;
    }

    await client.query('BEGIN');
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '2min'");
      await client.query(
        `INSERT INTO public.app_schema_migrations (
           migration_id, script_checksum, status, backup_reference,
           logical_export_reference, started_at, completed_at, details
         ) VALUES ($1, $2, 'RUNNING', $3, $4, NOW(), NULL, $5::jsonb)
         ON CONFLICT (migration_id) DO UPDATE SET
           status = 'RUNNING', backup_reference = EXCLUDED.backup_reference,
           logical_export_reference = EXCLUDED.logical_export_reference,
           started_at = NOW(), completed_at = NULL, details = EXCLUDED.details`,
        [
          EXPAND_MIGRATION_ID,
          checksum,
          args.backupReference.trim(),
          logicalExport.path,
          JSON.stringify({ before }),
        ],
      );
      await client.query(sql);
      const after = await inspectCodeTransition(client);
      validateCodeTransitionPostflight(before, after);
      await client.query(
        `UPDATE public.app_schema_migrations
            SET status = 'SUCCEEDED', completed_at = NOW(), details = $2::jsonb
          WHERE migration_id = $1`,
        [EXPAND_MIGRATION_ID, JSON.stringify({ before, after })],
      );
      await client.query('COMMIT');
      console.log(
        JSON.stringify(
          { committed: true, phase: 'expand', postflight: after },
          null,
          2,
        ),
      );
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    if (lockAcquired) {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [
        EXPAND_LOCK_NAME,
      ]);
    }
    await client.end();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sqlPath =
    args.phase === 'contract'
      ? CONTRACT_SQL_PATH
      : args.phase === 'data'
        ? DATA_SQL_PATH
        : EXPAND_SQL_PATH;
  const sql = readFileSync(sqlPath, 'utf8');
  const staticReport =
    args.phase === 'contract'
      ? verifyCommodityTypeCodeContractStatic(sql)
      : args.phase === 'data'
        ? verifyCodeIdentityDataStatic(sql)
        : verifyCodeTransitionStatic(sql);
  if (args.mode === 'verify-static') {
    console.log(
      JSON.stringify(
        {
          staticVerification: {
            phase: args.phase,
            scriptChecksum: createHash('sha256').update(sql).digest('hex'),
            ...staticReport,
          },
        },
        null,
        2,
      ),
    );
    return;
  }
  if (args.phase === 'contract') {
    await runContract(args);
    return;
  }
  if (args.phase === 'data') {
    await runData(args);
    return;
  }
  await runExpand(args);
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
