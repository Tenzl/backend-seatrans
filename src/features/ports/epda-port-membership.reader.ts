export const EPDA_PORT_MEMBERSHIP_READER = Symbol(
  'EPDA_PORT_MEMBERSHIP_READER',
);

/**
 * Application port: whether a port is a member of an EPDA parameter group
 * (membership table or legacy JSONB). PortsService depends on this instead of
 * EPDA repositories directly.
 */
export interface EpdaPortMembershipReader {
  /** Human-readable group label, or null when the port is not in any group. */
  findGroupLabel(portId: number): Promise<string | null>;
}
