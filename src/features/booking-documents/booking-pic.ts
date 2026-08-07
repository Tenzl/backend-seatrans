/**
 * Booking confirmation PIC line shown in the PDF grid (label is rendered separately).
 * Example: `Nhung Nguyen, Email: total.logistics@seatrans.com.vn`
 */
export function formatBookingPic(
  fullName?: string | null,
  email?: string | null,
): string {
  const name = fullName?.trim() ?? '';
  const mail = email?.trim() ?? '';
  if (name && mail) return `${name}, Email: ${mail}`;
  return name || mail;
}

/**
 * Prefer an explicit PIC selection (form / payload). Fall back to creator
 * fullName+email when empty (new bookings before a user is picked).
 */
export function resolveBookingPic(
  creator: { fullName?: string | null; email?: string | null } | null | undefined,
  existingPic?: string | null,
): string {
  const selected = existingPic?.trim() ?? '';
  if (selected) return selected;
  return formatBookingPic(creator?.fullName, creator?.email);
}
