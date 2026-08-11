-- Remigrate EPDA group membership from JSONB member_port_ids into
-- epda_parameter_group_members (canonical source going forward).
-- Safe to re-run. Does not drop member_port_ids yet (contract cleanup later).

BEGIN;

-- Rebuild membership from the JSONB that operators have been editing.
DELETE FROM epda_parameter_group_members;

INSERT INTO epda_parameter_group_members (group_id, port_id)
SELECT
  parameter_set.id,
  member.value::text::integer
FROM epda_parameter_set parameter_set
CROSS JOIN LATERAL jsonb_array_elements(
  COALESCE(parameter_set.member_port_ids, '[]'::jsonb)
) AS member(value)
WHERE parameter_set.scope = 'GROUP'
  AND jsonb_typeof(COALESCE(parameter_set.member_port_ids, '[]'::jsonb)) = 'array'
ON CONFLICT (group_id, port_id) DO NOTHING;

-- Fail if any GROUP JSONB port is missing from the normalized table.
DO $$
DECLARE
  missing integer;
BEGIN
  SELECT count(*)::integer INTO missing
  FROM epda_parameter_set parameter_set
  CROSS JOIN LATERAL jsonb_array_elements_text(
    COALESCE(parameter_set.member_port_ids, '[]'::jsonb)
  ) AS member(value)
  WHERE parameter_set.scope = 'GROUP'
    AND NOT EXISTS (
      SELECT 1
      FROM epda_parameter_group_members membership
      WHERE membership.group_id = parameter_set.id
        AND membership.port_id = member.value::integer
    );

  IF missing > 0 THEN
    RAISE EXCEPTION
      'epda membership remigration incomplete: % JSONB member(s) missing from epda_parameter_group_members',
      missing;
  END IF;
END
$$;

COMMIT;
