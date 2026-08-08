-- Commodity groups: Group contains Commodities (shipping-agency + freight-forwarding).
-- Idempotent. synchronize remains false — apply explicitly.
--
-- Run: psql "$DB_URL" -f docs/sql/2026-08-07_commodity_groups_postgres.sql
-- Also mirrored at backend2.0/scripts/migrations/2026-08-07_commodity_groups_postgres.sql

CREATE TABLE IF NOT EXISTS commodity_groups (
  id              SERIAL PRIMARY KEY,
  service_type_id INTEGER NOT NULL REFERENCES service_types (id),
  name            VARCHAR(200) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_commodity_groups_service_name UNIQUE (service_type_id, name)
);

CREATE INDEX IF NOT EXISTS idx_commodity_groups_service_type_id
  ON commodity_groups (service_type_id);

ALTER TABLE commodities
  ADD COLUMN IF NOT EXISTS group_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_commodities_group_id'
      AND conrelid = 'public.commodities'::regclass
  ) THEN
    ALTER TABLE commodities
      ADD CONSTRAINT fk_commodities_group_id
      FOREIGN KEY (group_id) REFERENCES commodity_groups (id)
      ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_commodities_group_id
  ON commodities (group_id);

-- Backfill: one group per (service_type_id, cargo_type) for ungrouped rows.
INSERT INTO commodity_groups (service_type_id, name, created_at, updated_at)
SELECT DISTINCT
  c.service_type_id,
  CASE UPPER(TRIM(COALESCE(c.cargo_type, '')))
    WHEN 'IN_BULK' THEN 'BULK'
    WHEN 'IN_BAG_PACK' THEN 'BAG PACK'
    WHEN 'IN_EQUIPMENT' THEN 'EQUIPMENT'
    WHEN '' THEN 'Ungrouped'
    ELSE REPLACE(UPPER(TRIM(c.cargo_type)), '_', ' ')
  END AS group_name,
  NOW(),
  NOW()
FROM commodities c
WHERE c.group_id IS NULL
ON CONFLICT (service_type_id, name) DO NOTHING;

UPDATE commodities c
SET group_id = g.id
FROM commodity_groups g
WHERE c.group_id IS NULL
  AND g.service_type_id = c.service_type_id
  AND g.name = CASE UPPER(TRIM(COALESCE(c.cargo_type, '')))
    WHEN 'IN_BULK' THEN 'BULK'
    WHEN 'IN_BAG_PACK' THEN 'BAG PACK'
    WHEN 'IN_EQUIPMENT' THEN 'EQUIPMENT'
    WHEN '' THEN 'Ungrouped'
    ELSE REPLACE(UPPER(TRIM(c.cargo_type)), '_', ' ')
  END;

-- Prefer uniqueness within a group; keep a partial unique for any legacy ungrouped rows.
DROP INDEX IF EXISTS public.uq_commodities_service_cargo_name;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commodities_group_name
  ON commodities (group_id, name)
  WHERE group_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_commodities_ungrouped_service_cargo_name
  ON commodities (service_type_id, cargo_type, name)
  WHERE group_id IS NULL;
