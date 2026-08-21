export const BOOKING_PORT_FIELDS = [
  'placeOfReceipt',
  'portOfLoading',
  'portOfDischarge',
  'placeOfDelivery',
  'transitPort',
  'pickupPlace',
  'dropoffPlace',
  'placeOfIssue',
];

export const MAX_PORT_SUB_NAME_LENGTH = 100;

function normalizeName(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

function identity(value) {
  return normalizeName(value).toLocaleLowerCase();
}

export function extractBookingPortIdentity(value) {
  const normalized = normalizeName(value);
  const match = normalized.match(
    /^(.*?)(?:,\s*[A-Z]{2})?\s*\(([A-Z0-9]{5})\)$/i,
  );
  if (!match) return null;

  const name = normalizeName(match[1]);
  const code = match[2].toUpperCase();
  return name && code ? { code, name } : null;
}

export function planPortSubNames({ ports, bookingValues }) {
  const portsByCode = new Map();
  for (const port of ports) {
    const code = normalizeName(port.code).toUpperCase();
    if (!code) continue;
    const matches = portsByCode.get(code) ?? [];
    matches.push(port);
    portsByCode.set(code, matches);
  }

  const aliasesByCode = new Map();
  const encounteredCodes = new Set();
  for (const value of bookingValues) {
    const parsed = extractBookingPortIdentity(value);
    if (!parsed) continue;
    encounteredCodes.add(parsed.code);
    const counts = aliasesByCode.get(parsed.code) ?? new Map();
    const key = identity(parsed.name);
    const current = counts.get(key);
    counts.set(key, {
      name: current?.name ?? parsed.name,
      count: (current?.count ?? 0) + 1,
    });
    aliasesByCode.set(parsed.code, counts);
  }

  const updates = [];
  const ambiguousCodes = [];
  const missingCodes = [];
  const rejectedAliases = [];

  for (const code of [...encounteredCodes].sort()) {
    const matches = portsByCode.get(code) ?? [];
    if (matches.length === 0) {
      missingCodes.push(code);
      continue;
    }
    if (matches.length > 1) {
      ambiguousCodes.push({
        code,
        portIds: matches.map((port) => Number(port.id)).sort((a, b) => a - b),
      });
      continue;
    }

    const port = matches[0];
    const mainIdentity = identity(port.name);
    const aliases = [port.subName1, port.subName2]
      .map(normalizeName)
      .filter(Boolean);
    const known = new Set([mainIdentity, ...aliases.map(identity)]);
    const unseenCandidates = [
      ...(aliasesByCode.get(code)?.values() ?? []),
    ].filter((candidate) => !known.has(identity(candidate.name)));
    const rankedCandidates = unseenCandidates
      .filter((candidate) => {
        if (candidate.name.length <= MAX_PORT_SUB_NAME_LENGTH) return true;
        rejectedAliases.push({
          code,
          name: candidate.name,
          length: candidate.name.length,
          reason: 'MAX_LENGTH',
        });
        return false;
      })
      .sort(
        (first, second) =>
          second.count - first.count || first.name.localeCompare(second.name),
      );
    const added = [];
    for (const candidate of rankedCandidates) {
      if (aliases.length >= 2) break;
      aliases.push(candidate.name);
      known.add(identity(candidate.name));
      added.push(candidate.name);
    }

    if (added.length > 0) {
      updates.push({
        id: Number(port.id),
        code,
        name: port.name,
        subName1: aliases[0] ?? null,
        subName2: aliases[1] ?? null,
        added,
      });
    }
  }

  return { updates, ambiguousCodes, missingCodes, rejectedAliases };
}
