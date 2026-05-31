import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = join(root, '.env')

function loadEnvFile(path) {
  const content = readFileSync(path, 'utf8')
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = value
    }
  }
}

loadEnvFile(envPath)

const connectionString =
  process.env.DB_URL ||
  `postgresql://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_DATABASE}`

const sql = `
ALTER TABLE shipping_agency_inquiries
  ADD COLUMN IF NOT EXISTS garbage_usd_rate NUMERIC(15, 4);

UPDATE shipping_agency_inquiries
SET garbage_usd_rate = CASE
  WHEN UPPER(COALESCE(quote_form, '')) = 'QN' THEN 17
  ELSE 54
END
WHERE garbage_usd_rate IS NULL;

UPDATE shipping_agency_inquiries
SET garbage_cbm_amount = 1
WHERE garbage_cbm_amount IS NULL;
`

const client = new pg.Client({
  connectionString,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
})

try {
  await client.connect()
  await client.query(sql)
  console.log('Migration applied: garbage_usd_rate column + backfill defaults')
} catch (error) {
  console.error('Migration failed:', error.message)
  process.exit(1)
} finally {
  await client.end()
}
