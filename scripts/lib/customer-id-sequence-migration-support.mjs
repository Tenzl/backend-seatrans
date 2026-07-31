const REQUIRED_COLUMNS = new Map([
  [
    'sequence_date',
    {
      dataType: 'character',
      length: 6,
      nullable: 'NO',
    },
  ],
  [
    'current_value',
    {
      dataType: 'bigint',
      length: null,
      nullable: 'NO',
    },
  ],
]);

export function validateCustomerIdSequencePreflight(report) {
  if (!report.tableExists) return;

  for (const [name, expected] of REQUIRED_COLUMNS) {
    const actual = report.columns.find((column) => column.name === name);
    if (
      !actual ||
      actual.dataType !== expected.dataType ||
      actual.length !== expected.length ||
      actual.nullable !== expected.nullable
    ) {
      throw new Error(
        `customer_id_sequences.${name} has an incompatible schema`,
      );
    }
  }

  if (report.unexpectedColumns.length > 0) {
    throw new Error(
      `customer_id_sequences has unexpected columns: ${report.unexpectedColumns.join(', ')}`,
    );
  }
  if (report.invalidRows.length > 0) {
    throw new Error(
      `customer_id_sequences has invalid rows: ${report.invalidRows.join(', ')}`,
    );
  }
  if (report.duplicateDates.length > 0) {
    throw new Error(
      `customer_id_sequences has duplicate dates: ${report.duplicateDates.join(', ')}`,
    );
  }
  if (report.constraintConflicts.length > 0) {
    throw new Error(
      `customer_id_sequences has conflicting named constraints: ${report.constraintConflicts.join(', ')}`,
    );
  }
}

export function validateCustomerIdSequencePostflight(before, after) {
  if (!after.tableExists) {
    throw new Error('customer_id_sequences was not created');
  }
  validateCustomerIdSequencePreflight(after);

  if (!after.primaryKeyCovered) {
    throw new Error(
      'customer_id_sequences is missing a primary key on sequence_date',
    );
  }
  if (!after.dateConstraintCovered || !after.valueConstraintCovered) {
    throw new Error(
      'customer_id_sequences is missing validated domain constraints',
    );
  }
  if (before.rowCount !== after.rowCount) {
    throw new Error('customer_id_sequences row count changed during expand');
  }
  if (before.rowChecksum !== after.rowChecksum) {
    throw new Error('customer_id_sequences checksum changed during expand');
  }
}
