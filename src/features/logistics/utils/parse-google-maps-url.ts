/**
 * Parse latitude/longitude out of a Google Maps URL.
 *
 * Priority order (matches what Google actually uses):
 *   1. `!3d<lat>!4d<lng>` — the canonical place pin (most accurate)
 *   2. `@<lat>,<lng>,<zoom>z` — the map viewport center
 *   3. `?q=<lat>,<lng>` / `?ll=<lat>,<lng>` / `?query=<lat>,<lng>` — simple share URL
 *
 * Short links (goo.gl/maps, maps.app.goo.gl) are intentionally NOT supported here
 * because they require following an HTTP redirect; we reject them with a clear
 * error so the caller can prompt the user to paste the expanded URL.
 */
export interface ParsedMapsCoordinates {
  lat: number;
  lng: number;
}

const LAT_BOUNDS = 90;
const LNG_BOUNDS = 180;

function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= LAT_BOUNDS &&
    Math.abs(lng) <= LNG_BOUNDS
  );
}

export function isShortGoogleMapsUrl(url: string): boolean {
  const trimmed = url.trim().toLowerCase();
  return (
    trimmed.startsWith('https://goo.gl/maps/') ||
    trimmed.startsWith('http://goo.gl/maps/') ||
    trimmed.startsWith('https://maps.app.goo.gl/') ||
    trimmed.startsWith('http://maps.app.goo.gl/')
  );
}

export function parseGoogleMapsUrl(input: string | undefined | null): ParsedMapsCoordinates | null {
  if (!input) return null;
  const url = input.trim();
  if (!url) return null;

  const pinMatch = url.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pinMatch) {
    const lat = parseFloat(pinMatch[1]);
    const lng = parseFloat(pinMatch[2]);
    if (isValidCoordinate(lat, lng)) return { lat, lng };
  }

  const atMatch = url.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (atMatch) {
    const lat = parseFloat(atMatch[1]);
    const lng = parseFloat(atMatch[2]);
    if (isValidCoordinate(lat, lng)) return { lat, lng };
  }

  const queryMatch = url.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?)%2C(-?\d+(?:\.\d+)?)/i);
  if (queryMatch) {
    const lat = parseFloat(queryMatch[1]);
    const lng = parseFloat(queryMatch[2]);
    if (isValidCoordinate(lat, lng)) return { lat, lng };
  }

  const plainQueryMatch = url.match(/[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (plainQueryMatch) {
    const lat = parseFloat(plainQueryMatch[1]);
    const lng = parseFloat(plainQueryMatch[2]);
    if (isValidCoordinate(lat, lng)) return { lat, lng };
  }

  return null;
}

const COORD_DECIMALS = 8;

export function formatCoordinate(value: number): string {
  return value.toFixed(COORD_DECIMALS);
}
