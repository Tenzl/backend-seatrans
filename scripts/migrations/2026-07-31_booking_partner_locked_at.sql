-- Freeze partner edits after staff lock (EPDA-style; no unlock).
ALTER TABLE booking_partners
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

COMMENT ON COLUMN booking_partners.locked_at IS
  'When set, partner create/update is rejected. Unlock is not supported.';
