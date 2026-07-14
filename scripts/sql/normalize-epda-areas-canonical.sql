BEGIN;

-- Rank every canonical/legacy AREA candidate before changing keys. The newest
-- tariff document wins deterministically; losers are deleted before the winner
-- is renamed, so the partial unique index can never collide.
CREATE TEMP TABLE epda_area_winners ON COMMIT DROP AS
SELECT
  id,
  canonical_area,
  ROW_NUMBER() OVER (
    PARTITION BY canonical_area
    ORDER BY updated_at DESC NULLS LAST, id DESC
  ) AS winner_rank
FROM (
  SELECT
    id,
    updated_at,
    CASE UPPER(TRIM(area))
      WHEN 'NORTH' THEN '1'
      WHEN 'NORTHERN' THEN '1'
      WHEN '1' THEN '1'
      WHEN 'MIDDLE' THEN '2'
      WHEN '2' THEN '2'
      WHEN 'SOUTH' THEN '3'
      WHEN 'SOUTHERN' THEN '3'
      WHEN '3' THEN '3'
    END AS canonical_area
  FROM epda_parameter_set
  WHERE scope = 'AREA'
) candidates
WHERE canonical_area IS NOT NULL;

DELETE FROM epda_parameter_set target
USING epda_area_winners ranked
WHERE target.id = ranked.id
  AND ranked.winner_rank > 1;

UPDATE epda_parameter_set target
SET area = ranked.canonical_area
FROM epda_area_winners ranked
WHERE target.id = ranked.id
  AND ranked.winner_rank = 1;

-- GROUP has a unique (area, name) key. Resolve collisions with the same newest
-- updated_at/id rule before converting aliases.
CREATE TEMP TABLE epda_group_winners ON COMMIT DROP AS
SELECT
  id,
  canonical_area,
  ROW_NUMBER() OVER (
    PARTITION BY canonical_area, name
    ORDER BY updated_at DESC NULLS LAST, id DESC
  ) AS winner_rank
FROM (
  SELECT
    id,
    name,
    updated_at,
    CASE UPPER(TRIM(area))
      WHEN 'NORTH' THEN '1'
      WHEN 'NORTHERN' THEN '1'
      WHEN '1' THEN '1'
      WHEN 'MIDDLE' THEN '2'
      WHEN '2' THEN '2'
      WHEN 'SOUTH' THEN '3'
      WHEN 'SOUTHERN' THEN '3'
      WHEN '3' THEN '3'
    END AS canonical_area
  FROM epda_parameter_set
  WHERE scope = 'GROUP'
) candidates
WHERE canonical_area IS NOT NULL;

DELETE FROM epda_parameter_set target
USING epda_group_winners ranked
WHERE target.id = ranked.id
  AND ranked.winner_rank > 1;

UPDATE epda_parameter_set target
SET area = ranked.canonical_area
FROM epda_group_winners ranked
WHERE target.id = ranked.id
  AND ranked.winner_rank = 1;

-- PORT uniqueness is based on port_id, so area conversion cannot collide.
UPDATE epda_parameter_set
SET area = CASE UPPER(TRIM(area))
  WHEN 'NORTH' THEN '1'
  WHEN 'NORTHERN' THEN '1'
  WHEN 'MIDDLE' THEN '2'
  WHEN 'SOUTH' THEN '3'
  WHEN 'SOUTHERN' THEN '3'
  ELSE TRIM(area)
END
WHERE scope = 'PORT'
  AND area IS NOT NULL;

UPDATE epda_parameter_change_logs
SET area = CASE UPPER(TRIM(area))
  WHEN 'NORTH' THEN '1'
  WHEN 'NORTHERN' THEN '1'
  WHEN 'MIDDLE' THEN '2'
  WHEN 'SOUTH' THEN '3'
  WHEN 'SOUTHERN' THEN '3'
  ELSE TRIM(area)
END
WHERE area IS NOT NULL;

ALTER TABLE epda_parameter_set
  DROP CONSTRAINT IF EXISTS ck_epda_parameter_set_canonical_area;
ALTER TABLE epda_parameter_set
  ADD CONSTRAINT ck_epda_parameter_set_canonical_area
  CHECK (area IS NULL OR area IN ('1', '2', '3'));

ALTER TABLE epda_parameter_change_logs
  DROP CONSTRAINT IF EXISTS ck_epda_parameter_log_canonical_area;
ALTER TABLE epda_parameter_change_logs
  ADD CONSTRAINT ck_epda_parameter_log_canonical_area
  CHECK (area IS NULL OR area IN ('1', '2', '3'));

COMMIT;
