/**
 * Canonical booking / Arrival Notice display for a commodity in its group.
 * Exact format: `{commodityName} IN {groupName}` (spaces around uppercase `IN`).
 */
export function formatCommodityInGroupLabel(
  commodityName: string,
  groupName: string,
): string {
  const commodity = commodityName.trim();
  const group = groupName.trim();
  if (!commodity) return group;
  if (!group) return commodity;
  return `${commodity} IN ${group}`;
}
