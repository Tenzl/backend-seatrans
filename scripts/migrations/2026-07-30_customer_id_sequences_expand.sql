CREATE TABLE IF NOT EXISTS customer_id_sequences (
  sequence_date CHAR(6) NOT NULL,
  current_value BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT customer_id_sequences_pkey PRIMARY KEY (sequence_date),
  CONSTRAINT ck_customer_id_sequences_date
    CHECK (btrim(sequence_date) ~ '^[0-9]{6}$'),
  CONSTRAINT ck_customer_id_sequences_value_nonnegative
    CHECK (current_value >= 0)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'customer_id_sequences'::regclass
       AND contype = 'p'
  ) THEN
    ALTER TABLE customer_id_sequences
      ADD CONSTRAINT customer_id_sequences_pkey PRIMARY KEY (sequence_date);
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'customer_id_sequences'::regclass
       AND conname = 'ck_customer_id_sequences_date'
  ) THEN
    ALTER TABLE customer_id_sequences
      ADD CONSTRAINT ck_customer_id_sequences_date
      CHECK (btrim(sequence_date) ~ '^[0-9]{6}$') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conrelid = 'customer_id_sequences'::regclass
       AND conname = 'ck_customer_id_sequences_value_nonnegative'
  ) THEN
    ALTER TABLE customer_id_sequences
      ADD CONSTRAINT ck_customer_id_sequences_value_nonnegative
      CHECK (current_value >= 0) NOT VALID;
  END IF;
END
$$;

ALTER TABLE customer_id_sequences
  ALTER COLUMN current_value SET DEFAULT 0,
  VALIDATE CONSTRAINT ck_customer_id_sequences_date,
  VALIDATE CONSTRAINT ck_customer_id_sequences_value_nonnegative;
