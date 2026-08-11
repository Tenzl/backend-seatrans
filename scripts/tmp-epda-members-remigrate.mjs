import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const sql = readFileSync(
  join('scripts', 'migrations', '2026-08-11_epda_group_members_remigrate.sql'),
  'utf8',
);

const statusSql = `
  SELECT
    (SELECT count(*)::int FROM epda_parameter_set WHERE scope = 'GROUP') AS group_rows,
    (SELECT count(*)::int FROM epda_parameter_group_members) AS member_rows,
    (
      SELECT coalesce(sum(jsonb_array_length(coalesce(member_port_ids, '[]'::jsonb))), 0)::int
      FROM epda_parameter_set
      WHERE scope = 'GROUP'
    ) AS jsonb_member_slots
`;

const rawUrl = env.DB_URL || '';
const url = new URL(rawUrl.replace(/^postgresql:/, 'postgres:'));
url.searchParams.set('sslmode', 'require');
url.searchParams.set('uselibpqcompat', 'true');

const client = new pg.Client({
  connectionString: url.toString().replace(/^postgres:/, 'postgresql:'),
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const before = await client.query(statusSql);
  console.log('before', before.rows[0]);
  await client.query(sql);
  const after = await client.query(statusSql);
  console.log('after', after.rows[0]);
} finally {
  await client.end();
}
