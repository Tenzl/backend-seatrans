-- EPDA parameter hardening: expand-only schema changes.
-- Safe to re-run. This file does not backfill, normalize, or drop business data.

CREATE TABLE IF NOT EXISTS app_data_migrations (
  id              TEXT PRIMARY KEY,
  checksum        TEXT NOT NULL,
  status          TEXT NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

ALTER TABLE epda_parameter_set
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE epda_parameter_change_logs
  ADD COLUMN IF NOT EXISTS port_name VARCHAR(100),
  ADD COLUMN IF NOT EXISTS changed_by_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS changed_by_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS details JSONB;

CREATE TABLE IF NOT EXISTS epda_parameter_group_members (
  group_id    INTEGER NOT NULL
    REFERENCES epda_parameter_set(id) ON DELETE CASCADE,
  port_id     INTEGER NOT NULL
    REFERENCES ports(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, port_id),
  UNIQUE (port_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_epda_parameter_scope'
      AND conrelid = 'epda_parameter_set'::regclass
  ) THEN
    ALTER TABLE epda_parameter_set
      ADD CONSTRAINT ck_epda_parameter_scope
      CHECK (scope IN ('AREA', 'GROUP', 'PORT')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_epda_parameter_values_object'
      AND conrelid = 'epda_parameter_set'::regclass
  ) THEN
    ALTER TABLE epda_parameter_set
      ADD CONSTRAINT ck_epda_parameter_values_object
      CHECK (jsonb_typeof(values) = 'object') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_epda_parameter_version_positive'
      AND conrelid = 'epda_parameter_set'::regclass
  ) THEN
    ALTER TABLE epda_parameter_set
      ADD CONSTRAINT ck_epda_parameter_version_positive
      CHECK (version >= 1) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_epda_parameter_scope_shape'
      AND conrelid = 'epda_parameter_set'::regclass
  ) THEN
    ALTER TABLE epda_parameter_set
      ADD CONSTRAINT ck_epda_parameter_scope_shape
      CHECK (
        (
          scope = 'AREA'
          AND port_id IS NULL
          AND name IS NULL
        )
        OR
        (
          scope = 'PORT'
          AND port_id IS NOT NULL
          AND name IS NULL
        )
        OR
        (
          scope = 'GROUP'
          AND port_id IS NULL
          AND name IS NOT NULL
          AND btrim(name) <> ''
        )
      ) NOT VALID;
  END IF;

  -- During rolling deployment PORT rows may still contain their legacy area.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_epda_parameter_area_expand'
      AND conrelid = 'epda_parameter_set'::regclass
  ) THEN
    ALTER TABLE epda_parameter_set
      ADD CONSTRAINT ck_epda_parameter_area_expand
      CHECK (
        (scope IN ('AREA', 'GROUP') AND area IN ('1', '2', '3'))
        OR
        (scope = 'PORT' AND (area IS NULL OR area IN ('1', '2', '3')))
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_epda_parameter_logs_changed_by'
      AND conrelid = 'epda_parameter_change_logs'::regclass
  ) THEN
    ALTER TABLE epda_parameter_change_logs
      ADD CONSTRAINT fk_epda_parameter_logs_changed_by
      FOREIGN KEY (changed_by_user_id)
      REFERENCES users(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_epda_parameter_logs_port'
      AND conrelid = 'epda_parameter_change_logs'::regclass
  ) THEN
    ALTER TABLE epda_parameter_change_logs
      ADD CONSTRAINT fk_epda_parameter_logs_port
      FOREIGN KEY (port_id)
      REFERENCES ports(id)
      ON DELETE SET NULL
      NOT VALID;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.set_epda_parameter_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_epda_parameter_updated_at
  ON epda_parameter_set;
CREATE TRIGGER trg_epda_parameter_updated_at
BEFORE UPDATE ON epda_parameter_set
FOR EACH ROW
EXECUTE FUNCTION set_epda_parameter_updated_at();

CREATE OR REPLACE FUNCTION public.validate_epda_group_member()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  target_scope VARCHAR(10);
  target_area VARCHAR(50);
  member_area INTEGER;
BEGIN
  SELECT scope, area
  INTO target_scope, target_area
  FROM public.epda_parameter_set
  WHERE id = NEW.group_id;

  IF target_scope IS DISTINCT FROM 'GROUP' THEN
    RAISE EXCEPTION 'EPDA membership group_id % is not a GROUP parameter set', NEW.group_id;
  END IF;

  SELECT province.area
  INTO member_area
  FROM public.ports AS port
  LEFT JOIN public.provinces AS province ON province.id = port.province_id
  WHERE port.id = NEW.port_id;

  IF member_area IS NULL OR target_area IS DISTINCT FROM member_area::text THEN
    RAISE EXCEPTION
      'EPDA membership port % area % does not match group % area %',
      NEW.port_id,
      member_area,
      NEW.group_id,
      target_area;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_epda_group_member
  ON epda_parameter_group_members;
CREATE TRIGGER trg_validate_epda_group_member
BEFORE INSERT OR UPDATE ON epda_parameter_group_members
FOR EACH ROW
EXECUTE FUNCTION validate_epda_group_member();

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_epda_param_group_name_ci
  ON epda_parameter_set (area, lower(btrim(name)))
  WHERE scope = 'GROUP';

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_epda_logs_port_created
  ON epda_parameter_change_logs (port_id, created_at DESC, id DESC)
  WHERE port_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_epda_logs_area_created
  ON epda_parameter_change_logs (area, created_at DESC, id DESC)
  WHERE area IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_epda_logs_user_created
  ON epda_parameter_change_logs
    (changed_by_user_id, created_at DESC, id DESC)
  WHERE changed_by_user_id IS NOT NULL;
