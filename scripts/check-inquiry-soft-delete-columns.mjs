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
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile(envPath)

const tables = [
  'shipping_agency_inquiries',
  'chartering_broking_inquiries',
  'freight_forwarding_inquiries',
  'total_logistics_inquiries',
  'special_request_inquiries',
]

const client = new pg.Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
for (const table of tables) {
  const exists = await client.query(
    `SELECT to_regclass($1) AS reg`,
    [`public.${table}`],
  )
  if (!exists.rows[0]?.reg) {
    console.log(`${table}: TABLE MISSING`)
    continue
  }
  const cols = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
       AND column_name IN ('deleted_at', 'deleted_by')
     ORDER BY column_name`,
    [table],
  )
  console.log(`${table}:`, cols.rows.map((r) => r.column_name).join(', ') || 'NO SOFT DELETE COLUMNS')
}
await client.end()
