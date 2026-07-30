-- EPDA parameter hardening: data-only migration.
-- The runner executes this file inside one transaction after strict preflight.

INSERT INTO epda_parameter_group_members (group_id, port_id)
SELECT
  parameter_set.id,
  member.value::text::integer
FROM epda_parameter_set parameter_set
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(parameter_set.member_port_ids, '[]'::jsonb)
) AS member(value)
WHERE parameter_set.scope = 'GROUP'
ON CONFLICT (group_id, port_id) DO NOTHING;

INSERT INTO epda_parameter_change_logs (
  scope,
  area,
  port_id,
  action,
  changed_by_user_id,
  before_values,
  after_values,
  port_name,
  details
)
SELECT
  parameter_set.scope,
  parameter_set.area,
  parameter_set.port_id,
  'DELETE_PORT',
  NULL,
  parameter_set.values,
  NULL,
  port.name,
  jsonb_build_object(
    'migration', '2026-07-30_epda_parameter_hardening_data',
    'reason', 'Removed empty PORT override'
  )
FROM epda_parameter_set parameter_set
LEFT JOIN ports port ON port.id = parameter_set.port_id
WHERE parameter_set.scope = 'PORT'
  AND parameter_set.values = '{}'::jsonb;

DELETE FROM epda_parameter_set
WHERE scope = 'PORT'
  AND values = '{}'::jsonb;

UPDATE epda_parameter_change_logs AS log
SET port_name = port.name
FROM ports AS port
WHERE
  log.port_id = port.id
  AND log.port_name IS NULL;

UPDATE epda_parameter_change_logs AS log
SET
  changed_by_name = COALESCE(log.changed_by_name, app_user.full_name),
  changed_by_email = COALESCE(log.changed_by_email, app_user.email)
FROM users AS app_user
WHERE
  log.changed_by_user_id = app_user.id
  AND (
    log.changed_by_name IS NULL
    OR log.changed_by_email IS NULL
  );

UPDATE epda_parameter_set parameter_set
SET area = NULL
FROM ports port
JOIN provinces province ON province.id = port.province_id
WHERE parameter_set.scope = 'PORT'
  AND parameter_set.port_id = port.id
  AND parameter_set.area = province.area::text;
