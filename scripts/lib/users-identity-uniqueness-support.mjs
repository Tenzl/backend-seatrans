export const INDEX_SPECS = [
  {
    key: 'email',
    targetName: 'uq_users_email_normalized',
    keyKind: 'normalizedEmail',
    predicateTerms: null,
  },
  {
    key: 'username',
    targetName: 'uq_users_username_normalized_nonblank',
    keyKind: 'normalizedUsername',
    predicateTerms: ['usernameisnotnull', "btrimusername<>''"],
  },
  {
    key: 'oauthIdentity',
    targetName: 'uq_users_oauth_identity',
    keyKind: 'normalizedOauthPair',
    predicateTerms: [
      'oauth_providerisnotnull',
      "btrimoauth_provider<>''",
      'oauth_provider_idisnotnull',
      "btrimoauth_provider_id<>''",
    ],
  },
];

const REQUIRED_COLUMNS = [
  'id',
  'email',
  'username',
  'oauth_provider',
  'oauth_provider_id',
];
const INDEXABLE_TEXT_TYPES = new Set([
  'character',
  'character varying',
  'text',
]);

export function parseArgs(argv) {
  const result = {
    apply: false,
    targetDb: null,
    backupReference: null,
    logicalExport: null,
    confirmation: null,
  };

  for (const argument of argv) {
    if (argument === '--apply') {
      result.apply = true;
      continue;
    }
    if (argument === '--dry-run') continue;

    const [key, ...valueParts] = argument.split('=');
    const value = valueParts.join('=');
    if (key === '--target-db') result.targetDb = value;
    else if (key === '--backup-reference') result.backupReference = value;
    else if (key === '--logical-export') result.logicalExport = value;
    else if (key === '--confirm') result.confirmation = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }

  return result;
}

export function normalizeIndexToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/pg_catalog\./g, '')
    .replace(/::(?:text|character varying|varchar|bpchar)/g, '')
    .replace(/["\s()]/g, '');
}

function normalizePredicateTerms(predicate) {
  if (predicate == null || !String(predicate).trim()) return [];
  return String(predicate)
    .split(/\bAND\b/i)
    .map(normalizeIndexToken)
    .filter(Boolean)
    .sort();
}

function hasExpectedKeys(index, spec) {
  const keys = Array.isArray(index.key_expressions)
    ? index.key_expressions.map(normalizeIndexToken)
    : [];

  if (spec.keyKind === 'normalizedEmail') {
    return (
      keys.length === 1 &&
      new Set([
        'lowerbtrimemail',
        'lowertrimemail',
        'lowertrimbothfromemail',
      ]).has(keys[0])
    );
  }
  if (spec.keyKind === 'normalizedUsername') {
    return (
      keys.length === 1 &&
      new Set([
        'lowerbtrimusername',
        'lowertrimusername',
        'lowertrimbothfromusername',
      ]).has(keys[0])
    );
  }

  return (
    keys.length === 2 &&
    keys[0] === 'lowerbtrimoauth_provider' &&
    keys[1] === 'btrimoauth_provider_id'
  );
}

function hasExpectedPredicate(index, spec) {
  const actual = normalizePredicateTerms(index.predicate);
  if (spec.predicateTerms === null) {
    return (
      actual.length === 0 ||
      actual.join('|') === `${spec.key}isnotnull`.toLowerCase()
    );
  }
  return (
    actual.join('|') ===
    spec.predicateTerms.map(normalizeIndexToken).sort().join('|')
  );
}

export function isSemanticEquivalentIndex(index, spec) {
  return (
    index.table_name === 'users' &&
    index.is_unique === true &&
    index.is_valid === true &&
    index.is_ready === true &&
    index.access_method === 'btree' &&
    Number(index.key_attribute_count) ===
      (spec.keyKind === 'normalizedOauthPair' ? 2 : 1) &&
    hasExpectedKeys(index, spec) &&
    hasExpectedPredicate(index, spec) &&
    !/\bCOLLATE\b/i.test(index.definition ?? '')
  );
}

function summarizeIndex(report, spec) {
  const equivalentIndexes = report.indexes
    .filter((index) => isSemanticEquivalentIndex(index, spec))
    .map((index) => ({
      name: index.index_name,
      definition: index.definition,
    }));
  const targetIndex = report.indexes.find(
    (index) => index.index_name === spec.targetName,
  );
  const targetDetails =
    targetIndex && !isSemanticEquivalentIndex(targetIndex, spec)
      ? {
          name: targetIndex.index_name,
          tableName: targetIndex.table_name,
          isUnique: targetIndex.is_unique,
          isValid: targetIndex.is_valid,
          isReady: targetIndex.is_ready,
          keyExpressions: targetIndex.key_expressions,
          predicate: targetIndex.predicate,
          definition: targetIndex.definition,
        }
      : null;

  return {
    targetName: spec.targetName,
    alreadyCovered: equivalentIndexes.length > 0,
    equivalentIndexes,
    targetNameConflict:
      equivalentIndexes.length === 0 && targetDetails ? [targetDetails] : [],
    targetNameWarnings:
      equivalentIndexes.length > 0 && targetDetails ? [targetDetails] : [],
  };
}

export function summarize(report) {
  const columnsByName = new Map(
    report.columns.map((column) => [column.column_name, column]),
  );
  const columnChecks = REQUIRED_COLUMNS.map((name) => {
    const column = columnsByName.get(name);
    return {
      name,
      exists: Boolean(column),
      dataType: column?.data_type ?? null,
      nullable: column?.is_nullable ?? null,
      supportedType:
        name === 'id' || INDEXABLE_TEXT_TYPES.has(column?.data_type),
      requiredNotNull:
        !['id', 'email'].includes(name) || column?.is_nullable === 'NO',
    };
  });
  const indexes = Object.fromEntries(
    INDEX_SPECS.map((spec) => [spec.key, summarizeIndex(report, spec)]),
  );
  const allIndexesCovered = Object.values(indexes).every(
    (index) => index.alreadyCovered,
  );

  return {
    tableExists: report.tableExists,
    columns: columnChecks,
    rowCount: report.rowCount,
    rowChecksum: report.rowChecksum,
    duplicates: report.duplicates,
    indexes,
    ledger: {
      tableExists: report.ledger.tableExists,
      compatible: report.ledger.compatible,
      entry: report.ledger.entry,
      checksumMatches:
        !report.ledger.entry ||
        report.ledger.entry.script_checksum === report.expectedScriptChecksum,
      succeededButIndexesMissing:
        report.ledger.entry?.status === 'SUCCEEDED' && !allIndexesCovered,
    },
  };
}

export function assertSafeToApply(summary) {
  const blockers = {
    missingUsersTable: summary.tableExists ? [] : ['public.users'],
    missingOrUnsupportedColumns: summary.columns.filter(
      (column) =>
        !column.exists || !column.supportedType || !column.requiredNotNull,
    ),
    emailDuplicates: summary.duplicates.email,
    usernameDuplicates: summary.duplicates.username,
    oauthIdentityDuplicates: summary.duplicates.oauthIdentity,
    targetNameConflicts: Object.values(summary.indexes).flatMap(
      (index) => index.targetNameConflict,
    ),
    incompatibleLedger:
      summary.ledger.tableExists && !summary.ledger.compatible
        ? ['public.app_schema_migrations']
        : [],
    ledgerChecksumConflict: summary.ledger.checksumMatches
      ? []
      : [summary.ledger.entry],
    ledgerSchemaDrift: summary.ledger.succeededButIndexesMissing
      ? [summary.ledger.entry]
      : [],
  };
  if (Object.values(blockers).some((items) => items.length > 0)) {
    throw new Error(
      `Preflight found blockers; no schema changes were made: ${JSON.stringify(
        blockers,
      )}`,
    );
  }
}

export function indexStatementsByName(sql) {
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);
  const byName = new Map();

  for (const statement of statements) {
    const match = statement.match(
      /CREATE\s+UNIQUE\s+INDEX\s+CONCURRENTLY\s+IF\s+NOT\s+EXISTS\s+([a-zA-Z0-9_]+)/i,
    );
    if (!match) {
      throw new Error('Migration SQL contains an unsupported statement');
    }
    byName.set(match[1], `${statement};`);
  }

  const missing = INDEX_SPECS.filter(
    (spec) => !byName.has(spec.targetName),
  ).map((spec) => spec.targetName);
  if (missing.length > 0 || byName.size !== INDEX_SPECS.length) {
    throw new Error(
      `Migration SQL index set mismatch: ${JSON.stringify({
        missing,
        found: [...byName.keys()],
      })}`,
    );
  }
  return byName;
}
