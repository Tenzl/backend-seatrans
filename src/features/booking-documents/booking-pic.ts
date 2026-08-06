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

export function resolveBookingPic(
  creator: { fullName?: string | null; email?: string | null } | null | undefined,
  existingPic?: string | null,
): string {
  const fromCreator = formatBookingPic(creator?.fullName, creator?.email);
  if (fromCreator) return fromCreator;
  return existingPic?.trim() ?? '';
}
