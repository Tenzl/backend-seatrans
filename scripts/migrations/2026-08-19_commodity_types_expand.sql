CREATE TABLE IF NOT EXISTS public.commodity_types (
  id SERIAL PRIMARY KEY,
  service_type_id INTEGER NOT NULL,
  code VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_commodity_types_service_type
    FOREIGN KEY (service_type_id)
    REFERENCES public.service_types (id)
    ON DELETE RESTRICT,
  CONSTRAINT ck_commodity_types_code_nonblank
    CHECK (btrim(code) <> ''),
  CONSTRAINT ck_commodity_types_name_nonblank
    CHECK (btrim(name) <> '')
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.commodity_types'::regclass
       AND conname = 'fk_commodity_types_service_type'
  ) THEN
    ALTER TABLE public.commodity_types
      ADD CONSTRAINT fk_commodity_types_service_type
      FOREIGN KEY (service_type_id)
      REFERENCES public.service_types (id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.commodity_types'::regclass
       AND conname = 'ck_commodity_types_code_nonblank'
  ) THEN
    ALTER TABLE public.commodity_types
      ADD CONSTRAINT ck_commodity_types_code_nonblank
      CHECK (btrim(code) <> '')
      NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.commodity_types'::regclass
       AND conname = 'ck_commodity_types_name_nonblank'
  ) THEN
    ALTER TABLE public.commodity_types
      ADD CONSTRAINT ck_commodity_types_name_nonblank
      CHECK (btrim(name) <> '')
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.commodity_types
  VALIDATE CONSTRAINT fk_commodity_types_service_type,
  VALIDATE CONSTRAINT ck_commodity_types_code_nonblank,
  VALIDATE CONSTRAINT ck_commodity_types_name_nonblank;

CREATE INDEX IF NOT EXISTS idx_commodity_types_service_type_id
  ON public.commodity_types (service_type_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_commodity_types_service_code_normalized
  ON public.commodity_types (service_type_id, lower(btrim(code)));

CREATE UNIQUE INDEX IF NOT EXISTS uq_commodity_types_service_name_normalized
  ON public.commodity_types (service_type_id, lower(btrim(name)));
