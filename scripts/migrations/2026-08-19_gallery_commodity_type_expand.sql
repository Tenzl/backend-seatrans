ALTER TABLE public.gallery_images
  ADD COLUMN IF NOT EXISTS commodity_type_id INTEGER;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'public.gallery_images'::regclass
       AND conname = 'fk_gallery_images_commodity_type'
  ) THEN
    ALTER TABLE public.gallery_images
      ADD CONSTRAINT fk_gallery_images_commodity_type
      FOREIGN KEY (commodity_type_id)
      REFERENCES public.commodity_types (id)
      ON DELETE RESTRICT
      NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.gallery_images
  VALIDATE CONSTRAINT fk_gallery_images_commodity_type;

CREATE INDEX IF NOT EXISTS idx_gallery_images_commodity_type_id
  ON public.gallery_images (commodity_type_id);
