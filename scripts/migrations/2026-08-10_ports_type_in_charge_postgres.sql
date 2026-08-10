-- Add ports.type + ports.in_charge with backfill.
-- Safe to re-run (idempotent).
--
-- type: VARCHAR NOT NULL DEFAULT 'PORT', CHECK IN ('PORT','DEPORT')
-- in_charge: BOOLEAN NOT NULL DEFAULT false;
--   true when province_id is set AND provinces.area IN (1, 2, 3)

BEGIN;

ALTER TABLE ports
  ADD COLUMN IF NOT EXISTS type VARCHAR NOT NULL DEFAULT 'PORT';

ALTER TABLE ports
  ADD COLUMN IF NOT EXISTS in_charge BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ports_type'
      AND conrelid = 'public.ports'::regclass
  ) THEN
    ALTER TABLE ports
      ADD CONSTRAINT chk_ports_type
      CHECK (type IN ('PORT', 'DEPORT'));
  END IF;
END
$$;

-- Backfill: every row is PORT (covers rows inserted before CHECK / default).
UPDATE ports
SET type = 'PORT'
WHERE type IS DISTINCT FROM 'PORT';

-- Backfill: in charge when linked province is area 1, 2, or 3 (integer codes).
UPDATE ports p
SET in_charge = EXISTS (
  SELECT 1
  FROM provinces pr
  WHERE pr.id = p.province_id
    AND pr.area IN (1, 2, 3)
);

COMMIT;
