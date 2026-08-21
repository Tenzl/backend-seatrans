import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const { Client } = pg;
const outputPath =
  'D:/University/Seatrans-website/seatrans/tmp/shipment_filter/db-bookings.json';
const sslEnabled = ['true', '1', 'require', 'verify-ca', 'verify-full'].includes(
  process.env.DB_SSL?.trim().toLowerCase() ?? '',
);
const client = new Client({
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  user: process.env.DB_USERNAME ?? 'postgres',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_DATABASE ?? 'seatrans',
  ssl: sslEnabled
    ? {
        rejectUnauthorized:
          process.env.DB_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() ===
          'true',
      }
    : undefined,
  connectionTimeoutMillis: 15_000,
});

try {
  await client.connect();
  await client.query('BEGIN READ ONLY');
  const databaseResult = await client.query(
    'SELECT current_database() AS database, inet_server_addr()::text AS host',
  );
  const bookingResult = await client.query(`
    SELECT id::text,
           booking_number,
           payload ->> 'bookingNumber' AS payload_booking_number,
           payload ->> 'shipmentId' AS shipment_id,
           created_at
      FROM booking_records
     WHERE deleted_at IS NULL
     ORDER BY created_at, id
  `);
  await client.query('ROLLBACK');
  const payload = {
    target: databaseResult.rows[0],
    count: bookingResult.rowCount,
    rows: bookingResult.rows,
  };
  await fs.writeFile(outputPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(
    JSON.stringify({ target: payload.target, count: payload.count, outputPath }),
  );
} finally {
  await client.end().catch(() => undefined);
}
