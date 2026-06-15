/**
 * A single contact person for a booking partner. Partners may have zero or many,
 * stored as a JSONB array on `booking_partners.contacts`.
 */
export interface PartnerContact {
  person?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
  /** ISO date (YYYY-MM-DD). */
  dateOfBirth?: string | null;
}
