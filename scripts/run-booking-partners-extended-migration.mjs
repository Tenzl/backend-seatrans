import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..')
const envPath = join(root, '.env')
const sqlPath = join(repoRoot, 'docs/sql/2026-06-15_booking_partners_extended_fields_postgres.sql')

function loadEnvFile(path) {
  if (!existsSync(path)) return
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

function buildSsl() {
  const dbUrl = process.env.DB_URL?.trim()
  let sslModeFromUrl = null
  if (dbUrl) {
    try {
      sslModeFromUrl = new URL(dbUrl).searchParams.get('sslmode')
    } catch {
      /* ignore malformed URL */
    }
  }

  const explicit = process.env.DB_SSL?.toLowerCase()
  const requireFromUrl =
    sslModeFromUrl && ['require', 'verify-ca', 'verify-full'].includes(sslModeFromUrl)

  const sslEnabled =
    explicit === 'true' || explicit === '1' || explicit === 'require' || Boolean(requireFromUrl)

  if (!sslEnabled) return undefined

  const rejectRaw = (process.env.DB_SSL_REJECT_UNAUTHORIZED ?? 'false').toLowerCase()
  const rejectUnauthorized = rejectRaw === 'true' || rejectRaw === '1'

  const caPath = process.env.DB_SSL_CA_PATH?.trim()
  if (caPath) {
    const absolute = isAbsolute(caPath) ? caPath : resolve(root, caPath)
    if (existsSync(absolute)) {
      return { rejectUnauthorized: true, ca: readFileSync(absolute, 'utf8') }
    }
    console.warn(`[migrate] DB_SSL_CA_PATH not found at ${absolute}, using rejectUnauthorized=${rejectUnauthorized}`)
  }

  return { rejectUnauthorized }
}

function buildClientConfig() {
  const dbUrl = process.env.DB_URL?.trim()
  const ssl = buildSsl()

  if (dbUrl) {
    const parsed = new URL(dbUrl)
    return {
      host: parsed.hostname,
      port: Number(parsed.port) || 5432,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, ''),
      ssl,
    }
  }

  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USERNAME ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
    database: process.env.DB_DATABASE ?? 'seatrans',
    ssl,
  }
}

loadEnvFile(envPath)

const sql = readFileSync(sqlPath, 'utf8')
const clientConfig = buildClientConfig()
const client = new pg.Client(clientConfig)

try {
  await client.connect()
  console.log(
    `[migrate] connected -> host=${clientConfig.host} db=${clientConfig.database} ssl=${clientConfig.ssl ? 'on' : 'off'}`,
  )
  await client.query(sql)
  console.log('[migrate] booking_partners extended fields ready')
} finally {
  await client.end()
}
