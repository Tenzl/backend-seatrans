import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  inspectPackageTypeData,
  validateDataPostflight,
} from '../run-package-types-migration.mjs';

const PROJECT_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
);
const DATA_SQL_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'migrations',
  '2026-08-19_package_types_data.sql',
);
const RUNNER_PATH = join(
  PROJECT_ROOT,
  'scripts',
  'run-package-types-migration.mjs',
);

const EXPECTED_PACKAGE_TYPES = [
  'CRT',
  'PKGS',
  'CAS',
  'BAL',
  'CTNS',
  'BAG(S)',
  'BALE(S)',
  'BOX(S)',
  'BULK(S)',
  'BUNDLE(S)',
  'CARTON(S)',
  'CASE(S)',
  'COIL(S)',
  'CRATE(S)',
  'CYLINDER(S)',
  'DRUM(S)',
  'JUMBO BAG(S)',
  'LINE DETENTION',
  'PACKAGE(S)',
  'PACKING CARTON(S)',
  'PALLET(S)',
  'PIECES',
  'WOODEN BOX(S)',
  'WOODEN CRATES',
  'WOODEN CASE(S)',
  'ROLL(S)',
  'SET(S)',
  'UNIT(S)',
  'STEEL DRUMS',
  'CLEATED PLYWOOD BOXES',
  'FIBREBOARD BOXES',
  'CARDBOARD BOXES',
  'DOZEN',
  'PAIR',
  'PAIL',
  'CASKS',
  'KEGS',
  'SLAB(S)',
  'SACK',
  'SKIDS',
  'BARRELS',
  'BLISTER',
  'CAN',
  'CUP',
  'CAPSULE',
  'FOIL',
  'PACKET',
  'TABLET',
  'TANK',
  'TOTE',
  'BOTTLE',
  'FLOWPACK',
  'JAR',
  'TRAY',
  'CAGE',
  'ROLL CAGE',
  'SLIT BOX',
  'PRESSURIZED CONTAINER',
  'BA',
  'BE',
  'BG',
  'BK',
  'BASKET(S)',
  'BL',
  'BN',
  'BR',
  'BX',
  'CA',
  'CG',
  'CK',
  'CL',
  'CN',
  'CO',
  'CP',
  'CR',
  'CS',
  'CT',
  'CX',
  'CY',
  'DR',
  'KG',
  'LG',
  'LZ',
  'MST',
  'MT',
  'NE',
  'NT',
  'PA',
  'PC',
  'PE',
  'PG',
  'PI',
  'PK',
  'PL',
  'PP',
  'PLTS',
  'PS',
  'PU',
  'RL',
  'TY',
  'ZZ',
];

function dataSql() {
  return readFileSync(DATA_SQL_PATH, 'utf8');
}

function canonicalValues(sql) {
  const block = sql.match(
    /-- CANONICAL_PACKAGE_TYPES_BEGIN([\s\S]*?)-- CANONICAL_PACKAGE_TYPES_END/,
  )?.[1];
  assert.ok(block, 'canonical seed block must be marked');
  return [...block.matchAll(/\('((?:''|[^'])*)',\s*(\d+)\)/g)].map(
    ([, value, order]) => ({
      value: value.replaceAll("''", "'"),
      order: Number(order),
    }),
  );
}

test('data migration seeds exactly the 101 dashboard values in display order', () => {
  const values = canonicalValues(dataSql());
  assert.equal(values.length, 101);
  assert.deepEqual(
    values.map((item) => item.value),
    EXPECTED_PACKAGE_TYPES,
  );
  assert.deepEqual(
    values.map((item) => item.order),
    Array.from({ length: 101 }, (_, index) => index + 1),
  );
});

test('data migration unions packageType snapshots without rewriting documents', () => {
  const sql = dataSql();
  for (const table of [
    'bill_of_lading_records',
    'arrival_notice_records',
    'delivery_order_records',
  ]) {
    assert.match(sql, new RegExp(`\\bFROM\\s+public\\.${table}\\b`, 'i'));
    assert.doesNotMatch(
      sql,
      new RegExp(
        `\\b(?:UPDATE|INSERT|DELETE|ALTER)\\s+(?:TABLE\\s+)?public\\.${table}\\b`,
        'i',
      ),
    );
  }
  assert.match(sql, /jsonb_array_elements/i);
  assert.match(sql, /container\s*->>\s*'packageType'/i);
  assert.doesNotMatch(sql, /deleted_at\s+IS\s+NULL/i);
});

test('data migration normalizes code and is idempotent', () => {
  const sql = dataSql();
  assert.match(sql, /upper\s*\(/i);
  assert.match(sql, /regexp_replace\s*\(/i);
  assert.match(sql, /\[\[:space:\]\]\+/i);
  assert.match(sql, /ON CONFLICT/i);
  assert.equal((sql.match(/ON CONFLICT/gi) ?? []).length, 2);
  assert.equal((sql.match(/DO NOTHING/gi) ?? []).length, 2);
  assert.doesNotMatch(sql, /DO UPDATE/i);
  assert.doesNotMatch(sql, /\b(?:left|substring|substr)\s*\(/i);
});

function fakeClient({ catalog, sources }) {
  return {
    async query(sql, params = []) {
      if (/to_regclass\(\$1\)/i.test(sql)) {
        return { rows: [{ exists: true }] };
      }
      if (/FROM public\.package_types/i.test(sql)) {
        return { rows: catalog };
      }
      for (const [table, rows] of Object.entries(sources)) {
        if (sql.includes(`FROM public.${table}`)) return { rows };
      }
      throw new Error(
        `Unexpected fake query: ${sql} ${JSON.stringify(params)}`,
      );
    },
  };
}

function canonicalCatalog() {
  return EXPECTED_PACKAGE_TYPES.map((displayName, index) => ({
    code: displayName,
    display_name: displayName,
    is_active: true,
    sort_order: index + 1,
  }));
}

test('fake-client postflight counts active and historical snapshots and resolves all', async () => {
  const sources = {
    bill_of_lading_records: [
      {
        normalized_code: 'CRATE(S)',
        display_name: 'CRATE(S)',
        snapshot_count: 2,
      },
    ],
    arrival_notice_records: [
      {
        normalized_code: 'CUSTOM BAG',
        display_name: 'Custom Bag',
        snapshot_count: 1,
      },
    ],
    delivery_order_records: [
      {
        normalized_code: 'CUSTOM BAG',
        display_name: 'custom bag',
        snapshot_count: 1,
      },
    ],
  };
  const catalog = [
    ...canonicalCatalog(),
    {
      code: 'CUSTOM BAG',
      display_name: 'Custom Bag',
      is_active: true,
      sort_order: 1001,
    },
  ];
  const report = await inspectPackageTypeData(
    fakeClient({ catalog, sources }),
    EXPECTED_PACKAGE_TYPES,
  );
  validateDataPostflight(report);
  assert.equal(report.sourceSnapshotCount, 4);
  assert.equal(report.sourceDistinctCount, 2);
  assert.equal(report.catalogCount, 102);
  assert.equal(report.canonicalResolvedCount, 101);
  assert.deepEqual(report.unresolved, []);
});

test('fake-client postflight rejects a stored snapshot missing from catalog', async () => {
  const report = await inspectPackageTypeData(
    fakeClient({
      catalog: canonicalCatalog(),
      sources: {
        bill_of_lading_records: [
          {
            normalized_code: 'UNKNOWN TYPE',
            display_name: 'Unknown Type',
            snapshot_count: 1,
          },
        ],
        arrival_notice_records: [],
        delivery_order_records: [],
      },
    }),
    EXPECTED_PACKAGE_TYPES,
  );
  assert.throws(
    () => validateDataPostflight(report),
    /stored Package Type snapshots do not resolve/i,
  );
});

test('postflight preserves admin-managed display, order, and active state', async () => {
  const catalog = canonicalCatalog();
  catalog[0] = {
    ...catalog[0],
    display_name: 'Admin label',
    is_active: false,
    sort_order: 9000,
  };
  const report = await inspectPackageTypeData(
    fakeClient({
      catalog,
      sources: {
        bill_of_lading_records: [],
        arrival_notice_records: [],
        delivery_order_records: [],
      },
    }),
    EXPECTED_PACKAGE_TYPES,
  );
  assert.doesNotThrow(() => validateDataPostflight(report));
});

test('apply keeps expand and data as separately confirmed phases', () => {
  const runner = readFileSync(RUNNER_PATH, 'utf8');
  assert.match(runner, /APPLY_PACKAGE_TYPES_EXPAND_20260819/);
  assert.match(runner, /APPLY_PACKAGE_TYPES_DATA_20260819/);
  assert.match(runner, /--apply cannot be combined with --phase=all/);
});
