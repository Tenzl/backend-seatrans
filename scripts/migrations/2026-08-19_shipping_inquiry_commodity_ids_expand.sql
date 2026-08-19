ALTER TABLE public.shipping_agency_inquiries
  ADD COLUMN IF NOT EXISTS commodity_type_id INTEGER,
  ADD COLUMN IF NOT EXISTS commodity_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.shipping_agency_inquiries'::regclass
       AND conname = 'fk_shipping_agency_inquiries_commodity_type'
  ) THEN
    ALTER TABLE public.shipping_agency_inquiries
      ADD CONSTRAINT fk_shipping_agency_inquiries_commodity_type
      FOREIGN KEY (commodity_type_id)
      REFERENCES public.commodity_types (id)
      ON DELETE RESTRICT NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.shipping_agency_inquiries'::regclass
       AND conname = 'fk_shipping_agency_inquiries_commodity'
  ) THEN
    ALTER TABLE public.shipping_agency_inquiries
      ADD CONSTRAINT fk_shipping_agency_inquiries_commodity
      FOREIGN KEY (commodity_id)
      REFERENCES public.commodities (id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.shipping_agency_inquiries
  VALIDATE CONSTRAINT fk_shipping_agency_inquiries_commodity_type,
  VALIDATE CONSTRAINT fk_shipping_agency_inquiries_commodity;

CREATE INDEX IF NOT EXISTS idx_shipping_agency_inquiries_commodity_type_id
  ON public.shipping_agency_inquiries (commodity_type_id);

CREATE INDEX IF NOT EXISTS idx_shipping_agency_inquiries_commodity_id
  ON public.shipping_agency_inquiries (commodity_id);
