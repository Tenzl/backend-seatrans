-- Strip leading "IN " from commodity group display names created by the
-- cargo_type backfill (IN BULK / IN BAG PACK / IN EQUIPMENT).
-- Does not change cargo_type codes (IN_BULK, etc.) or the booking/AN
-- display format `{commodity} IN {group}`.
--
-- Idempotent. Safe to re-run.
--
-- Run: psql "$DB_URL" -f docs/sql/2026-08-07_rename_commodity_group_in_prefix_postgres.sql
-- Also mirrored at backend2.0/scripts/migrations/2026-08-07_rename_commodity_group_in_prefix_postgres.sql

UPDATE commodity_groups AS cg
SET
  name = CASE UPPER(TRIM(cg.name))
    WHEN 'IN BAG PACK' THEN 'BAG PACK'
    WHEN 'IN BULK' THEN 'BULK'
    WHEN 'IN EQUIPMENT' THEN 'EQUIPMENT'
    ELSE cg.name
  END,
  updated_at = NOW()
WHERE UPPER(TRIM(cg.name)) IN ('IN BAG PACK', 'IN BULK', 'IN EQUIPMENT')
  AND NOT EXISTS (
    SELECT 1
    FROM commodity_groups AS other
    WHERE other.service_type_id = cg.service_type_id
      AND other.id <> cg.id
      AND UPPER(TRIM(other.name)) = CASE UPPER(TRIM(cg.name))
        WHEN 'IN BAG PACK' THEN 'BAG PACK'
        WHEN 'IN BULK' THEN 'BULK'
        WHEN 'IN EQUIPMENT' THEN 'EQUIPMENT'
      END
  );
