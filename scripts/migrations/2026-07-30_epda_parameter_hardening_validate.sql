-- EPDA parameter hardening: validation/final constraints.
-- Run only after the compatible backend and dashboard are deployed.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_epda_parameter_area_final'
      AND conrelid = 'epda_parameter_set'::regclass
  ) THEN
    ALTER TABLE epda_parameter_set
      ADD CONSTRAINT ck_epda_parameter_area_final
      CHECK (
        (scope IN ('AREA', 'GROUP') AND area IN ('1', '2', '3'))
        OR
        (scope = 'PORT' AND area IS NULL)
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ck_epda_port_override_not_empty'
      AND conrelid = 'epda_parameter_set'::regclass
  ) THEN
    ALTER TABLE epda_parameter_set
      ADD CONSTRAINT ck_epda_port_override_not_empty
      CHECK (scope <> 'PORT' OR values <> '{}'::jsonb) NOT VALID;
  END IF;
END $$;

ALTER TABLE epda_parameter_set
  VALIDATE CONSTRAINT ck_epda_parameter_scope,
  VALIDATE CONSTRAINT ck_epda_parameter_values_object,
  VALIDATE CONSTRAINT ck_epda_parameter_version_positive,
  VALIDATE CONSTRAINT ck_epda_parameter_scope_shape,
  VALIDATE CONSTRAINT ck_epda_parameter_area_expand,
  VALIDATE CONSTRAINT ck_epda_parameter_area_final,
  VALIDATE CONSTRAINT ck_epda_port_override_not_empty;

ALTER TABLE epda_parameter_change_logs
  VALIDATE CONSTRAINT fk_epda_parameter_logs_changed_by,
  VALIDATE CONSTRAINT fk_epda_parameter_logs_port;
