-- Field-level edit audit for booking partners (EPDA-style history).
CREATE TABLE IF NOT EXISTS booking_partner_field_change_logs (
  id BIGSERIAL PRIMARY KEY,
  partner_id BIGINT NOT NULL
    REFERENCES booking_partners(id) ON DELETE CASCADE,
  changed_by_user_id BIGINT NOT NULL REFERENCES users(id),
  action VARCHAR(32) NOT NULL,
  field_name VARCHAR(64) NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_partner_field_logs_partner_created
  ON booking_partner_field_change_logs (partner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_booking_partner_field_logs_actor_created
  ON booking_partner_field_change_logs (changed_by_user_id, created_at DESC);

COMMENT ON TABLE booking_partner_field_change_logs IS
  'Per-field audit trail for booking partner create/update (View edit history).';
