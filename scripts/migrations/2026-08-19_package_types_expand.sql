-- Expand only: persisted BL/AN/DO packageType snapshots remain unchanged.
CREATE TABLE IF NOT EXISTS public.package_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(200) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_package_types_code_nonblank CHECK (btrim(code) <> ''),
  CONSTRAINT ck_package_types_display_name_nonblank
    CHECK (btrim(display_name) <> ''),
  CONSTRAINT ck_package_types_sort_order_nonnegative CHECK (sort_order >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.package_types'::regclass
       AND conname = 'ck_package_types_code_nonblank'
  ) THEN
    ALTER TABLE public.package_types
      ADD CONSTRAINT ck_package_types_code_nonblank
      CHECK (btrim(code) <> '') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.package_types'::regclass
       AND conname = 'ck_package_types_display_name_nonblank'
  ) THEN
    ALTER TABLE public.package_types
      ADD CONSTRAINT ck_package_types_display_name_nonblank
      CHECK (btrim(display_name) <> '') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.package_types'::regclass
       AND conname = 'ck_package_types_sort_order_nonnegative'
  ) THEN
    ALTER TABLE public.package_types
      ADD CONSTRAINT ck_package_types_sort_order_nonnegative
      CHECK (sort_order >= 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.package_types
  VALIDATE CONSTRAINT ck_package_types_code_nonblank,
  VALIDATE CONSTRAINT ck_package_types_display_name_nonblank,
  VALIDATE CONSTRAINT ck_package_types_sort_order_nonnegative;

CREATE UNIQUE INDEX IF NOT EXISTS uq_package_types_code_normalized
  ON public.package_types (
    lower(regexp_replace(btrim(code), '[[:space:]]+', ' ', 'g'))
  );

CREATE INDEX IF NOT EXISTS idx_package_types_active_sort_order
  ON public.package_types (sort_order, display_name, id)
  WHERE is_active = TRUE;

COMMENT ON TABLE public.package_types IS
  'Global Package Type catalog; document cargo rows retain text snapshots.';
