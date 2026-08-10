export const LEGACY_DISTRIBUTION = Object.freeze({
  total: 14,
  booking: 5,
  an: 5,
  do: 2,
  bl: 2,
  unknown: 0,
});

export const SPLIT_TABLES = Object.freeze([
  'booking_records',
  'arrival_notice_records',
  'delivery_order_records',
  'bill_of_lading_records',
]);

export const GENERATED_COLUMNS = Object.freeze({
  booking_records: ['booking_number', 'vessel_voyage'],
  arrival_notice_records: [
    'an_number',
    'mbl_number',
    'hbl_number',
    'shipment_number',
    'reference_number',
    'vessel_voyage',
  ],
  delivery_order_records: [
    'do_number',
    'mbl_number',
    'hbl_number',
    'shipment_number',
    'vessel_voyage',
  ],
  bill_of_lading_records: [
    'fbl_number',
    'ocean_vessel',
  ],
});

export const REQUIRED_CONSTRAINTS = Object.freeze([
  'ck_booking_records_flow',
  'ck_booking_records_status',
  'fk_booking_records_created_by',
  'fk_booking_records_updated_by',
  'fk_booking_records_deleted_by',
  'ck_arrival_notice_records_status',
  'fk_arrival_notice_records_booking',
  'fk_arrival_notice_records_created_by',
  'fk_arrival_notice_records_updated_by',
  'fk_arrival_notice_records_deleted_by',
  'ck_delivery_order_records_status',
  'fk_delivery_order_records_booking',
  'fk_delivery_order_records_created_by',
  'fk_delivery_order_records_updated_by',
  'fk_delivery_order_records_deleted_by',
  'ck_bill_of_lading_records_status',
  'fk_bill_of_lading_records_booking',
  'fk_bill_of_lading_records_created_by',
  'fk_bill_of_lading_records_updated_by',
  'fk_bill_of_lading_records_deleted_by',
]);

export const REQUIRED_INDEXES = Object.freeze([
  'idx_booking_records_active_created_at',
  'idx_booking_records_booking_number',
  'idx_booking_records_vessel_voyage',
  'idx_arrival_notice_records_active_created_at',
  'idx_arrival_notice_records_booking_id',
  'uq_arrival_notice_records_active_booking',
  'idx_arrival_notice_records_an_number',
  'idx_arrival_notice_records_mbl_number',
  'idx_arrival_notice_records_hbl_number',
  'idx_arrival_notice_records_shipment_number',
  'idx_arrival_notice_records_reference_number',
  'idx_arrival_notice_records_vessel_voyage',
  'idx_delivery_order_records_active_created_at',
  'idx_delivery_order_records_booking_id',
  'uq_delivery_order_records_active_booking',
  'idx_delivery_order_records_do_number',
  'idx_delivery_order_records_mbl_number',
  'idx_delivery_order_records_hbl_number',
  'idx_delivery_order_records_shipment_number',
  'idx_delivery_order_records_vessel_voyage',
  'idx_bill_of_lading_records_active_created_at',
  'idx_bill_of_lading_records_booking_id',
  'uq_bill_of_lading_records_active_booking',
  'idx_bill_of_lading_records_fbl_number',
  'idx_bill_of_lading_records_ocean_vessel',
]);

export function parseBookingDocumentSplitArgs(argv) {
  const args = {
    mode: 'dry-run',
    targetDb: null,
    confirmation: null,
  };
  for (const argument of argv) {
    if (argument === '--apply') {
      if (args.mode !== 'dry-run') throw new Error('Select exactly one mode');
      args.mode = 'apply';
      continue;
    }
    if (argument === '--inspect') {
      if (args.mode !== 'dry-run') throw new Error('Select exactly one mode');
      args.mode = 'inspect';
      continue;
    }
    if (argument === '--dry-run') continue;
    const [key, ...parts] = argument.split('=');
    const value = parts.join('=');
    if (key === '--target-db') args.targetDb = value;
    else if (key === '--confirm') args.confirmation = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

export function validateBookingDocumentSplitCli(
  args,
  configuredDatabase,
  confirmationToken,
) {
  if (!args.targetDb || args.targetDb !== configuredDatabase) {
    throw new Error(
      '--target-db must exactly match the configured database name',
    );
  }
  if (args.mode === 'apply' && args.confirmation !== confirmationToken) {
    throw new Error(`--confirm must equal ${confirmationToken}`);
  }
}

export function validateBookingDocumentSplitPreflight(report) {
  if (report.legacyTableExists !== true) {
    throw new Error('booking_document_records must exist before the split');
  }
  const existingSplitTables = SPLIT_TABLES.filter(
    (table) => report.splitTableExists?.[table] === true,
  );
  if (existingSplitTables.length > 0) {
    throw new Error(
      `split tables already exist: ${existingSplitTables.join(', ')}`,
    );
  }
  for (const [key, expected] of Object.entries(LEGACY_DISTRIBUTION)) {
    if (Number(report.distribution?.[key]) !== expected) {
      throw new Error(
        `destructive guard rejected legacy distribution: expected ${JSON.stringify(LEGACY_DISTRIBUTION)}, received ${JSON.stringify(report.distribution)}`,
      );
    }
  }
}

export function validateBookingDocumentSplitPostflight(report) {
  if (report.legacyTableExists !== false) {
    throw new Error('booking_document_records still exists after the split');
  }
  const missingTables = SPLIT_TABLES.filter(
    (table) => report.splitTableExists?.[table] !== true,
  );
  if (missingTables.length > 0) {
    throw new Error(`missing split tables: ${missingTables.join(', ')}`);
  }
  const nonEmptyTables = SPLIT_TABLES.filter(
    (table) => Number(report.splitRowCounts?.[table]) !== 0,
  );
  if (nonEmptyTables.length > 0) {
    throw new Error(`split tables are not empty: ${nonEmptyTables.join(', ')}`);
  }

  const actualGenerated = new Set(
    (report.generatedColumns ?? []).map(
      ({ tableName, columnName }) => `${tableName}.${columnName}`,
    ),
  );
  const expectedGenerated = Object.entries(GENERATED_COLUMNS).flatMap(
    ([tableName, columns]) =>
      columns.map((columnName) => `${tableName}.${columnName}`),
  );
  const missingGenerated = expectedGenerated.filter(
    (column) => !actualGenerated.has(column),
  );
  if (missingGenerated.length > 0) {
    throw new Error(`missing generated columns: ${missingGenerated.join(', ')}`);
  }

  const constraintNames = new Set(report.constraintNames ?? []);
  const missingConstraints = REQUIRED_CONSTRAINTS.filter(
    (name) => !constraintNames.has(name),
  );
  if (missingConstraints.length > 0) {
    throw new Error(`missing constraints: ${missingConstraints.join(', ')}`);
  }

  const indexNames = new Set(report.indexNames ?? []);
  const missingIndexes = REQUIRED_INDEXES.filter(
    (name) => !indexNames.has(name),
  );
  if (missingIndexes.length > 0) {
    throw new Error(`missing indexes: ${missingIndexes.join(', ')}`);
  }

  const childBookingFks = new Map(
    (report.childBookingForeignKeys ?? []).map((fk) => [fk.name, fk]),
  );
  for (const name of [
    'fk_arrival_notice_records_booking',
    'fk_delivery_order_records_booking',
    'fk_bill_of_lading_records_booking',
  ]) {
    const fk = childBookingFks.get(name);
    if (fk?.targetTable !== 'booking_records' || fk?.deleteAction !== 'c') {
      throw new Error(`${name} must reference booking_records ON DELETE CASCADE`);
    }
  }
}
