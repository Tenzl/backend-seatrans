import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { EpdaParametersService } from '../../epda-parameters/epda-parameters.service';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';

const MAX_SNAPSHOT_BYTES = 256 * 1024;
const SNAPSHOT_ROW_KEYS = new Set([
  'no',
  'item',
  'details',
  'add',
  'remark',
  'amount',
  'mergeItemDetails',
]);
const SNAPSHOT_ROW_COLLECTION_KEYS = new Set(['AA_ROWS', 'BB_ROWS']);
const SNAPSHOT_TOTAL_KEYS = new Set(['total_a', 'total_b', 'grand_total']);
const SNAPSHOT_KEYS = new Set([
  'to_shipowner',
  'shipowner_nationality',
  'date',
  'ref',
  'mv',
  'dwt',
  'grt',
  'loa',
  'eta',
  'cargo_qty_mt',
  'cargo_name_upper',
  'cargo_type',
  'ship_type',
  'purpose_of_calling',
  'port_upper',
  'loading_term',
  'ocean_frt_rate_usd_per_mt',
  'garbage_usd_rate',
  'at_anchorage',
  'at_berth',
  'total_a',
  'total_b',
  'grand_total',
  'bank_name',
  'bank_address',
  'beneficiary',
  'usd_account',
  'swift',
  'berth_hours',
  'buoy_due_hours',
  'anchorage_hours',
  'transport_quarantine',
  'quarantine_cargo_trips',
  'transport_ls',
  'boat_hire_entry',
  'agency_fee_mode',
  'agency_discount_percent',
  'agency_lumpsum_amount',
  'tally_fee',
  'tug_assistance',
  'shorecrane_hire_usd_per_mt',
  'pilotage_miles',
  'pilotage_third_miles',
  'AA_ROWS',
  'BB_ROWS',
  'params',
]);

@Injectable()
export class ShippingAgencyEpdaSnapshotService {
  constructor(private readonly epdaParametersService: EpdaParametersService) {}

  /**
   * Tariff parameters are server-owned. The client must calculate its quote
   * from the same effective values the server currently resolves; otherwise
   * freezing the remaining quote fields would persist a stale calculation.
   */
  async buildAuthoritativeSnapshot(
    row: ShippingAgencyInquiryEntity,
    requestedSnapshot: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const requested = this.validateSnapshot(requestedSnapshot);
    this.validateSnapshotShape(requested);
    if (!this.isJsonObject(requested.params)) {
      throw new BadRequestException(
        'EPDA snapshot params must be a parameter object',
      );
    }

    if (row.epdaLockedAt) {
      return requested;
    }

    if (!Number.isInteger(row.portId) || (row.portId ?? 0) <= 0) {
      throw new BadRequestException(
        'A canonical portId is required to freeze EPDA tariff parameters',
      );
    }
    const effectiveParams = await this.epdaParametersService.getEffective(
      undefined,
      row.portId as number,
    );
    if (!this.jsonValuesEqual(requested.params, effectiveParams)) {
      throw new ConflictException(
        'EPDA tariff parameters are stale; refresh effective parameters and recalculate the quote',
      );
    }
    return this.validateSnapshot({
      ...requested,
      params: structuredClone(effectiveParams),
    });
  }

  snapshotsEqual(
    left: Record<string, unknown> | null,
    right: Record<string, unknown>,
  ): boolean {
    if (left === null) return false;
    return this.jsonValuesEqual(left, right);
  }

  private validateSnapshot(
    snapshot: Record<string, unknown>,
  ): Record<string, unknown> {
    let serialized: string;
    try {
      serialized = JSON.stringify(snapshot);
    } catch {
      throw new BadRequestException('epdaSnapshot must be JSON-serializable');
    }

    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
      throw new BadRequestException(
        `epdaSnapshot exceeds maximum size of ${MAX_SNAPSHOT_BYTES} bytes`,
      );
    }

    return snapshot;
  }

  private isJsonObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private jsonValuesEqual(left: unknown, right: unknown): boolean {
    return (
      JSON.stringify(this.sortSnapshot(left)) ===
      JSON.stringify(this.sortSnapshot(right))
    );
  }

  private validateSnapshotShape(snapshot: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(snapshot)) {
      if (!SNAPSHOT_KEYS.has(key)) {
        throw new BadRequestException(
          `Unsupported EPDA snapshot field: ${key}`,
        );
      }
      if (key === 'params') continue;
      if (SNAPSHOT_ROW_COLLECTION_KEYS.has(key)) {
        this.validateSnapshotRows(key, value);
        continue;
      }
      if (SNAPSHOT_TOTAL_KEYS.has(key)) {
        this.assertNonNegativeFiniteAmount(key, value);
        continue;
      }
      if (
        value !== null &&
        value !== undefined &&
        typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean'
      ) {
        throw new BadRequestException(
          `EPDA snapshot field ${key} must be a primitive value`,
        );
      }
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new BadRequestException(
          `EPDA snapshot field ${key} must be finite`,
        );
      }
    }
  }

  private validateSnapshotRows(key: string, value: unknown): void {
    if (!Array.isArray(value) || value.length > 200) {
      throw new BadRequestException(
        `EPDA snapshot field ${key} must contain at most 200 rows`,
      );
    }
    value.forEach((entry, index) => {
      if (!this.isJsonObject(entry)) {
        throw new BadRequestException(`${key}[${index}] must be an object`);
      }
      for (const [rowKey, rowValue] of Object.entries(entry)) {
        if (!SNAPSHOT_ROW_KEYS.has(rowKey)) {
          throw new BadRequestException(
            `Unsupported EPDA snapshot row field: ${key}[${index}].${rowKey}`,
          );
        }
        if (rowKey === 'amount') {
          this.assertNonNegativeFiniteAmount(
            `${key}[${index}].amount`,
            rowValue,
          );
        } else if (
          rowValue !== null &&
          rowValue !== undefined &&
          typeof rowValue !== 'string' &&
          typeof rowValue !== 'number' &&
          typeof rowValue !== 'boolean'
        ) {
          throw new BadRequestException(
            `EPDA snapshot row field ${key}[${index}].${rowKey} must be primitive`,
          );
        }
      }
    });
  }

  private assertNonNegativeFiniteAmount(path: string, value: unknown): void {
    if (value === null || value === undefined || value === '') return;
    const numeric =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value.replace(/,/g, '').trim())
          : Number.NaN;
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new BadRequestException(
        `EPDA snapshot amount ${path} must be finite and non-negative`,
      );
    }
  }

  private sortSnapshot(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((entry) => this.sortSnapshot(entry));
    }
    if (value === null || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, this.sortSnapshot(entry)]),
    );
  }
}
