import { readFileSync } from 'fs';
import { join } from 'path';

describe('canonical EPDA area migration', () => {
  const sql = readFileSync(
    join(process.cwd(), 'scripts', 'sql', 'normalize-epda-areas-canonical.sql'),
    'utf8',
  );

  it('deduplicates AREA and GROUP winners before canonical updates', () => {
    expect(sql).toContain('PARTITION BY canonical_area');
    expect(sql).toContain('PARTITION BY canonical_area, name');
    expect(sql).toContain('ORDER BY updated_at DESC NULLS LAST, id DESC');

    expect(sql.indexOf('DELETE FROM epda_parameter_set target')).toBeLessThan(
      sql.indexOf('UPDATE epda_parameter_set target'),
    );
  });

  it('maps every legacy direction alias and adds canonical constraints', () => {
    for (const alias of [
      "WHEN 'NORTH' THEN '1'",
      "WHEN 'NORTHERN' THEN '1'",
      "WHEN 'MIDDLE' THEN '2'",
      "WHEN 'SOUTH' THEN '3'",
      "WHEN 'SOUTHERN' THEN '3'",
    ]) {
      expect(sql).toContain(alias);
    }
    expect(sql).toContain("CHECK (area IS NULL OR area IN ('1', '2', '3'))");
  });
});
