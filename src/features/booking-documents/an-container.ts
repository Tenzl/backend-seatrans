import {
  BOOKING_CARGO_VOLUME_TYPES,
  formatBookingCargoVolumes,
  formatVolumeForBlPdf,
  type BookingCargoVolumeType,
  type BookingCargoVolumes,
} from './cargo-volume';
import { CargoRowDto } from './dto/cargo-row.dto';

export const AN_CONTAINER_MAX_ROWS = 20;

export type AnContainerType = BookingCargoVolumeType | '';

export type AnContainer = {
  type: AnContainerType;
  containerNo: string;
  sealNo: string;
  grossWeight: string;
  measurement: string;
  tare: string;
  packageType: string;
  noOfPkgs: string;
  note: string;
  method: string;
};

const TYPE_SET = new Set<string>(BOOKING_CARGO_VOLUME_TYPES);

function asTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function emptyAnContainer(): AnContainer {
  return {
    type: '',
    containerNo: '',
    sealNo: '',
    grossWeight: '',
    measurement: '',
    tare: '',
    packageType: '',
    noOfPkgs: '',
    note: '',
    method: '',
  };
}

export function normalizeAnContainer(raw: unknown): AnContainer {
  const row =
    typeof raw === 'object' && raw !== null
      ? (raw as Record<string, unknown>)
      : {};
  const typeRaw = asTrimmedString(row.type);
  return {
    type: TYPE_SET.has(typeRaw) ? (typeRaw as BookingCargoVolumeType) : '',
    containerNo: asTrimmedString(row.containerNo),
    sealNo: asTrimmedString(row.sealNo),
    grossWeight: asTrimmedString(row.grossWeight),
    measurement: asTrimmedString(row.measurement),
    tare: asTrimmedString(row.tare),
    packageType: asTrimmedString(row.packageType),
    noOfPkgs: asTrimmedString(row.noOfPkgs),
    note: asTrimmedString(row.note),
    method: asTrimmedString(row.method),
  };
}

function legacyCargoRowToAnContainer(row: CargoRowDto): AnContainer {
  const sealParts = asTrimmedString(row.containerSealNumber)
    .split(/\s*\/\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  let type: AnContainerType = '';
  const last = sealParts[sealParts.length - 1];
  if (last && TYPE_SET.has(last)) {
    type = last as BookingCargoVolumeType;
    sealParts.pop();
  }
  return {
    ...emptyAnContainer(),
    type,
    containerNo: sealParts[0] ?? '',
    sealNo: sealParts.slice(1).join(' / '),
    grossWeight: asTrimmedString(row.grossWeight),
    measurement: asTrimmedString(row.measurement),
    noOfPkgs: asTrimmedString(row.quantity),
    note: asTrimmedString(row.descriptionOfGoods),
  };
}

/**
 * Prefer `containers`; else migrate legacy `cargoRows`.
 * Does not cap length — DTO ArrayMaxSize rejects >20 before normalize.
 */
export function normalizeAnContainersPayload(payload: {
  containers?: unknown;
  cargoRows?: unknown;
}): AnContainer[] {
  if (Array.isArray(payload.containers)) {
    return payload.containers.map(normalizeAnContainer);
  }
  if (Array.isArray(payload.cargoRows)) {
    return payload.cargoRows.map((row) =>
      legacyCargoRowToAnContainer(row as CargoRowDto),
    );
  }
  return [];
}

/**
 * One PDF/DO cargo table row per container.
 * Shipment `descriptionOfGoods` goes on the first row’s description cell.
 * Per-container `note` is not mapped into the description column.
 */
export function anContainersToCargoRows(
  containers: AnContainer[],
  descriptionOfGoods = '',
): CargoRowDto[] {
  const shipmentDescription = descriptionOfGoods.trim();
  return containers.map((container, index) => ({
    containerSealNumber: [container.containerNo, container.sealNo, container.type]
      .filter(Boolean)
      .join(' / '),
    quantity: [container.noOfPkgs, container.packageType]
      .filter(Boolean)
      .join(' '),
    descriptionOfGoods: [
      container.tare ? `Tare: ${container.tare}` : '',
      index === 0 ? shipmentDescription : '',
      container.method ? `Method: ${container.method}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    grossWeight: container.grossWeight,
    measurement: container.measurement,
  }));
}

/** One container's packages cell: `noOfPkgs` + `packageType` (e.g. `21 CRATE(S)`). */
export function formatAnContainerPackages(container: AnContainer): string {
  return [container.noOfPkgs.trim(), container.packageType.trim()]
    .filter(Boolean)
    .join(' ');
}

/** Append a cargo unit when the value is non-empty and does not already include it. */
function withBlCargoUnit(value: string, unit: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const unitRe = new RegExp(`\\b${unit}\\b`, 'i');
  if (unitRe.test(trimmed)) {
    return trimmed.replace(unitRe, unit);
  }
  return `${trimmed} ${unit}`;
}

/** BL gross-weight cell: `20700 KGS` (idempotent if unit already present). */
export function formatBlGrossWeight(value: string): string {
  return withBlCargoUnit(value, 'KGS');
}

/** BL measurement cell: `7.45 CBM` (idempotent if unit already present). */
export function formatBlMeasurement(value: string): string {
  return withBlCargoUnit(value, 'CBM');
}

/** One container's GW cell for the BL PDF. */
export function formatAnContainerGrossWeight(container: AnContainer): string {
  return formatBlGrossWeight(container.grossWeight);
}

/** One container's measurement cell for the BL PDF. */
export function formatAnContainerMeasurement(container: AnContainer): string {
  return formatBlMeasurement(container.measurement);
}

/**
 * BL "Number and kind of packages" as one line per container (same as GW /
 * measurement), not an aggregated total. Does not use container volume.
 */
export function anContainersToPackagesText(
  containers: AnContainer[],
): string {
  return containers
    .map(formatAnContainerPackages)
    .filter(Boolean)
    .join('\n');
}

/**
 * Flatten containers into BL blank-form GW / measurement columns.
 * Description stays the shipment-level free-text field (not derived from notes).
 * `volumeStc` is the PDF description-column first line (compact counts + STC).
 * `numberAndKindOfPackages` is per-container noOfPkgs + packageType (not volume).
 */
export function anContainersToBlCargoTextFields(
  containers: AnContainer[],
  descriptionOfGoods = '',
): {
  descriptionOfGoods: string;
  grossWeight: string;
  measurement: string;
  volumeStc: string;
  numberAndKindOfPackages: string;
} {
  const cargoRows = anContainersToCargoRows(containers, descriptionOfGoods);
  const join = (key: 'grossWeight' | 'measurement') =>
    cargoRows
      .map((row) => (row[key] ?? '').trim())
      .filter(Boolean)
      .join('\n');
  const explicit = descriptionOfGoods.trim();
  return {
    descriptionOfGoods:
      explicit ||
      cargoRows
        .map((row) => (row.descriptionOfGoods ?? '').trim())
        .filter(Boolean)
        .join('\n'),
    grossWeight: join('grossWeight'),
    measurement: join('measurement'),
    volumeStc: formatVolumeForBlPdf(anContainersToCargoVolumes(containers)),
    numberAndKindOfPackages: anContainersToPackagesText(containers),
  };
}

/**
 * Which logical block a BL cargo row belongs to. The renderer uses this
 * (not text-content heuristics) to decide where the blank-row gap between
 * blocks belongs — see `CARGO_BLOCK_GAP_LINES` in `bill-of-lading.renderer.ts`.
 */
export type BlCargoPdfRowKind = 'fclHeader' | 'container' | 'shippingMark';

/** One logical cargo line drawn across BL marks / packages / description / GW / measurement. */
export type BlCargoPdfRow = {
  marks: string;
  packages: string;
  description: string;
  grossWeight: string;
  measurement: string;
  kind: BlCargoPdfRowKind;
};

/**
 * Prefer `shippingMark`; fall back to legacy `marksAndNumbers`. Empty string
 * wins over legacy (explicit blank — never auto "N/M").
 */
export function resolveBlShippingMark(payload: {
  shippingMark?: unknown;
  marksAndNumbers?: unknown;
}): string {
  if (typeof payload.shippingMark === 'string') return payload.shippingMark;
  if (typeof payload.marksAndNumbers === 'string') {
    return payload.marksAndNumbers;
  }
  return '';
}

/**
 * BL PDF cargo body rows (aligned by line index across columns):
 * 1. serviceMode | — | volume STC
 * 2..n. containerNo / sealNo / type | noOfPkgs + packageType | — | GW KGS | measurement CBM
 * n+1. shippingMark | — | descriptionOfGoods
 *
 * Does not include freightTerms / cleanOnBoard (those stay below the cargo grid).
 */
export function buildBlCargoPdfRows(opts: {
  serviceMode?: string;
  containers: AnContainer[];
  descriptionOfGoods?: string;
  volumeStc?: string;
  /** User-entered shipping mark; empty prints blank (no auto N/M). */
  shippingMark?: string;
}): BlCargoPdfRow[] {
  const serviceMode = (opts.serviceMode ?? '').trim();
  const description = (opts.descriptionOfGoods ?? '').trim();
  const shippingMark = opts.shippingMark ?? '';
  const active = opts.containers.filter(containerRowHasCargo);
  const volumeStc =
    (opts.volumeStc ?? '').trim() ||
    formatVolumeForBlPdf(anContainersToCargoVolumes(active));

  const rows: BlCargoPdfRow[] = [];

  if (serviceMode || volumeStc) {
    rows.push({
      marks: serviceMode,
      packages: '',
      description: volumeStc,
      grossWeight: '',
      measurement: '',
      kind: 'fclHeader',
    });
  }

  for (const container of active) {
    rows.push({
      marks: [container.containerNo, container.sealNo, container.type]
        .filter(Boolean)
        .join(' / '),
      packages: formatAnContainerPackages(container),
      description: '',
      grossWeight: formatAnContainerGrossWeight(container),
      measurement: formatAnContainerMeasurement(container),
      kind: 'container',
    });
  }

  rows.push({
    marks: shippingMark,
    packages: '',
    description,
    grossWeight: '',
    measurement: '',
    kind: 'shippingMark',
  });

  return rows;
}

/** Compact BL PDF volume line from typed containers (empty when no types). */
export function anContainersToBlVolumeStcText(
  containers: AnContainer[],
): string {
  return formatVolumeForBlPdf(anContainersToCargoVolumes(containers));
}

/**
 * Best-effort shipment description when legacy payloads only stored goods
 * text on container `note` (or legacy cargoRows → note).
 */
export function resolveDescriptionOfGoods(payload: {
  descriptionOfGoods?: unknown;
  containers?: AnContainer[];
}): string {
  if (typeof payload.descriptionOfGoods === 'string') {
    const trimmed = payload.descriptionOfGoods.trim();
    if (trimmed) return trimmed;
  }
  const fromNote = (payload.containers ?? [])
    .map((row) => row.note.trim())
    .find(Boolean);
  return fromNote ?? '';
}

/**
 * Best-effort reverse of BL free-text cargo → container rows for legacy
 * payloads that never had `containers`. Keeps one row so multi-line
 * description/GW/measurement from a prior flatten stay intact.
 */
export function legacyBlCargoTextToContainers(payload: {
  descriptionOfGoods?: unknown;
  grossWeight?: unknown;
  measurement?: unknown;
  numberAndKindOfPackages?: unknown;
}): AnContainer[] {
  const description =
    typeof payload.descriptionOfGoods === 'string'
      ? payload.descriptionOfGoods.trim()
      : '';
  const grossWeight =
    typeof payload.grossWeight === 'string' ? payload.grossWeight.trim() : '';
  const measurement =
    typeof payload.measurement === 'string' ? payload.measurement.trim() : '';
  const packages =
    typeof payload.numberAndKindOfPackages === 'string'
      ? payload.numberAndKindOfPackages.trim()
      : '';
  if (!description && !grossWeight && !measurement && !packages) return [];

  const pkgParts = packages.split(/\s+/).filter(Boolean);
  return [
    {
      ...emptyAnContainer(),
      note: description,
      grossWeight,
      measurement,
      noOfPkgs: pkgParts[0] ?? '',
      packageType: pkgParts.slice(1).join(' '),
    },
  ];
}

export function containerRowHasCargo(row: AnContainer): boolean {
  return Boolean(
    row.type ||
      row.containerNo ||
      row.sealNo ||
      row.grossWeight ||
      row.measurement ||
      row.tare ||
      row.packageType ||
      row.noOfPkgs ||
      row.note ||
      row.method,
  );
}

/** Count typed container rows into a volumes map (Total Shipment style). */
export function anContainersToCargoVolumes(
  containers: AnContainer[],
): BookingCargoVolumes {
  const volumes: BookingCargoVolumes = {};
  for (const row of containers) {
    if (!row.type) continue;
    volumes[row.type] = (volumes[row.type] ?? 0) + 1;
  }
  return volumes;
}

/**
 * PDF / payload Volume text from typed container rows
 * (e.g. `1 x 20'DC`). Empty when no types set.
 */
export function anContainersToVolumeText(containers: AnContainer[]): string {
  return formatBookingCargoVolumes(anContainersToCargoVolumes(containers));
}

/**
 * DO cargo (containers) is owned by Arrival Notice, same as BL. Overwrite
 * containers + derived `cargoRows` (PDF table), plus `serviceMode` and
 * `descriptionOfGoods` (read-only mirrors of AN, not editable on DO); leave
 * all other DO fields.
 */
export function syncDeliveryOrderCargoFromArrivalNotice<
  TDo extends {
    containers?: unknown;
    cargoRows?: unknown;
    serviceMode?: string;
    descriptionOfGoods?: string;
  },
>(
  source: {
    containers?: unknown;
    serviceMode?: string;
    descriptionOfGoods?: string;
  },
  current: TDo,
): TDo {
  const containers = normalizeAnContainersPayload({
    containers: source.containers,
  }).map((row) => ({ ...row }));
  const seeded =
    containers.length > 0 ? containers : [{ ...emptyAnContainer() }];
  const descriptionOfGoods = (source.descriptionOfGoods ?? '').trim();
  return {
    ...current,
    serviceMode: (source.serviceMode ?? '').trim(),
    descriptionOfGoods,
    containers: seeded,
    cargoRows: anContainersToCargoRows(seeded, descriptionOfGoods),
  };
}

/**
 * BL Cargo is owned by Arrival Notice. Overwrite containers + description +
 * `serviceMode` + derived packages / GW / measurement; leave all other BL
 * fields (including BL-owned `shippingMark`).
 */
export function syncBillOfLadingCargoFromArrivalNotice<
  TBl extends {
    shippingMark?: string;
    numberAndKindOfPackages?: string;
    containers?: unknown;
    descriptionOfGoods?: string;
    grossWeight?: string;
    measurement?: string;
    serviceMode?: string;
  },
>(
  source: {
    volume?: string;
    containers?: unknown;
    descriptionOfGoods?: string;
    serviceMode?: string;
  },
  current: TBl,
): TBl {
  const containers = normalizeAnContainersPayload({
    containers: source.containers,
  }).map((row) => ({ ...row }));
  const seeded =
    containers.length > 0 ? containers : [{ ...emptyAnContainer() }];
  const descriptionOfGoods = (source.descriptionOfGoods ?? '').trim();
  const cargoText = anContainersToBlCargoTextFields(seeded, descriptionOfGoods);
  return {
    ...current,
    serviceMode: (source.serviceMode ?? '').trim(),
    numberAndKindOfPackages: cargoText.numberAndKindOfPackages,
    containers: seeded,
    descriptionOfGoods: cargoText.descriptionOfGoods,
    grossWeight: cargoText.grossWeight,
    measurement: cargoText.measurement,
  };
}
