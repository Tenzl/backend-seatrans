import { Injectable, BadRequestException } from '@nestjs/common';
import { BookingPartnerService } from './booking-partner.service';
import {
  PartnerContactDto,
  UpsertBookingPartnerDto,
} from '../dto/upsert-booking-partner.dto';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import { ApproveStatus } from '../enums/approve-status.enum';
import { Workbook } from 'exceljs';
import { Readable } from 'node:stream';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export interface ImportPreviewRow {
  index: number;
  data: UpsertBookingPartnerDto;
  isValid: boolean;
  errors: string[];
}

export interface ImportPreviewResult {
  total: number;
  valid: number;
  invalid: number;
  rows: ImportPreviewRow[];
}

export interface ImportCommitResult {
  totalInput: number;
  successCount: number;
  errorCount: number;
  successIndexes: number[];
  errorDetails: Array<{ index: number; message: string }>;
}

@Injectable()
export class BookingPartnerImportService {
  constructor(private readonly partnerService: BookingPartnerService) {}

  /**
   * Canonical CSV headers (in column order). Header matching at import time is
   * case/format-insensitive (see {@link normalizeKey}), so a file exported
   * straight from the legacy system — with spaces, dashes or different casing —
   * imports without renaming columns.
   */
  public getTemplate(): string {
    const headers = [
      'Name*',
      'Customer_ID',
      'Addition_Types*',
      'Approve_Status',
      'Approve_By',
      'Customer_Status',
      'Customer_Type',
      'Contact_Person',
      'Contact_First_Name',
      'Contact_Last_Name',
      'Contact_Title',
      'Contact_Email',
      'Contact_Phone',
      'Phone',
      'Fax',
      'Tracking_Url',
      'Country',
      'City',
      'Address',
      'Company_Establishment_Date',
      'Date_Of_Birth',
      'Payment_Due_Days',
      'Contract_No',
      'Tax_Number',
      'Invoice_Company_Name',
      'Invoice_Company_Address',
      'Invoice_Company_Phone',
      'Invoice_Company_Email',
      'Invoice_Bank_Name',
      'Invoice_Bank_Branch',
      'Invoice_Bank_Account',
    ];
    return '\uFEFF' + headers.join(','); // BOM for Excel UTF-8 support
  }

  /** Parse an uploaded buffer (.xlsx or .csv) into row objects keyed by header. */
  public async parseWorkbook(
    buffer: Buffer,
  ): Promise<Record<string, unknown>[]> {
    const workbook = new Workbook();
    const isXlsxZip =
      buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;

    if (isXlsxZip) {
      await workbook.xlsx.read(Readable.from(buffer));
    } else {
      await workbook.csv.read(Readable.from(buffer));
    }

    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount < 2) return [];

    const headers: string[] = [];
    sheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => {
      headers[column] = cell.text.replace(/^\uFEFF/, '').trim();
    });

    const rows: Record<string, unknown>[] = [];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const source = sheet.getRow(rowNumber);
      const row: Record<string, unknown> = {};
      let hasValue = false;

      for (let column = 1; column < headers.length; column += 1) {
        const header = headers[column];
        if (!header) continue;
        const cell = source.getCell(column);
        const value = this.normalizeWorkbookCell(cell.value, cell.text);
        row[header] = value;
        hasValue ||= this.stringifyCell(value).trim().length > 0;
      }

      if (hasValue) rows.push(row);
    }
    return rows;
  }

  /** Collapse a header to a comparison key: lowercase, alphanumerics only. */
  private normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Map every cell to a normalized header key (first non-empty value wins). */
  private buildNormalizedRow(
    row: Record<string, unknown>,
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (value == null) continue;
      const normKey = this.normalizeKey(key);
      const text = this.stringifyCell(value).trim();
      if (text.length > 0 && out[normKey] == null) {
        out[normKey] = text;
      }
    }
    return out;
  }

  /** First non-empty value among any of the accepted header spellings. */
  private pick(
    norm: Record<string, string>,
    ...keys: string[]
  ): string | undefined {
    for (const key of keys) {
      const value = norm[this.normalizeKey(key)];
      if (value != null && value.length > 0) return value;
    }
    return undefined;
  }

  /** Normalize a date-ish cell to ISO `YYYY-MM-DD`; returns undefined if unparseable. */
  private toIsoDate(value?: string): string | undefined {
    if (!value) return undefined;
    const raw = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    // DD/MM/YYYY or D/M/YYYY (and dash/dot separators) -> ISO
    const dmy = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (dmy) {
      const [, d, m, y] = dmy;
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }

    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
    return undefined;
  }

  /** Coerce a cell to an enum member (case-insensitive); undefined if no match. */
  private toEnum<T extends Record<string, string>>(
    enumObj: T,
    value?: string,
  ): T[keyof T] | undefined {
    if (!value) return undefined;
    const upper = value.trim().toUpperCase();
    const match = Object.values(enumObj).find((v) => v.toUpperCase() === upper);
    return match as T[keyof T] | undefined;
  }

  /** Parse a non-negative integer cell; returns undefined if not a valid int. */
  private toInt(value?: string): number | undefined {
    if (!value) return undefined;
    const n = Number(value.replace(/[^\d.-]/g, ''));
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }

  public async mapAndValidateRow(
    index: number,
    row: Record<string, unknown>,
  ): Promise<ImportPreviewRow> {
    const norm = this.buildNormalizedRow(row);
    const data = new UpsertBookingPartnerDto();

    data.name = this.pick(norm, 'Name') ?? '';
    data.customerId = this.pick(norm, 'Customer_ID', 'CustomerID');

    // additionTypes is optional (0 or many). Each token is normalized
    // (uppercase, spaces/dashes -> underscore) and unrecognized values are
    // dropped rather than failing the whole row.
    const validTypes = new Set<string>(Object.values(PartnerAdditionType));
    const typeStr = this.pick(norm, 'Addition_Types', 'Types');
    data.additionTypes = (typeStr ? typeStr.split(',') : [])
      .map((s) =>
        s
          .trim()
          .toUpperCase()
          .replace(/[\s-]+/g, '_'),
      )
      .filter((s) => validTypes.has(s)) as PartnerAdditionType[];

    data.country = this.pick(norm, 'Country');
    data.city = this.pick(norm, 'City');

    // Fold the single contact-person columns into one contact entry (the JSON
    // array supports many; import files carry one per row).
    const contact: PartnerContactDto = {
      person: this.pick(norm, 'Contact_Person'),
      firstName: this.pick(norm, 'Contact_First_Name'),
      lastName: this.pick(norm, 'Contact_Last_Name'),
      email: this.pick(norm, 'Contact_Email'),
      phone: this.pick(norm, 'Contact_Phone'),
      title: this.pick(norm, 'Contact_Title'),
      dateOfBirth: this.toIsoDate(this.pick(norm, 'Date_Of_Birth')),
    };
    data.contacts = Object.values(contact).some((v) => v != null)
      ? [contact]
      : [];

    data.phone = this.pick(norm, 'Phone');
    data.fax = this.pick(norm, 'Fax');
    data.address = this.pick(norm, 'Address');
    data.trackingUrl = this.pick(norm, 'Tracking_Url');
    data.approveBy = this.pick(norm, 'Approve_By');
    data.contractNo = this.pick(norm, 'Contract_No');
    data.taxNumber = this.pick(norm, 'Tax_Number', 'Invoice_Tax_Number');

    data.invoiceCompanyName = this.pick(norm, 'Invoice_Company_Name');
    data.invoiceCompanyAddress = this.pick(norm, 'Invoice_Company_Address');
    data.invoiceCompanyPhone = this.pick(norm, 'Invoice_Company_Phone');
    data.invoiceCompanyEmail = this.pick(norm, 'Invoice_Company_Email');
    data.invoiceBankName = this.pick(norm, 'Invoice_Bank_Name');
    data.invoiceBankBranch = this.pick(norm, 'Invoice_Bank_Branch');
    data.invoiceBankAccount = this.pick(norm, 'Invoice_Bank_Account');

    // Enum cells: keep only recognized values; unknowns become null/undefined
    // so a non-matching value never fails the whole row.
    data.customerStatus = this.toEnum(
      CustomerStatus,
      this.pick(norm, 'Customer_Status'),
    );
    data.customerType = this.toEnum(
      CustomerType,
      this.pick(norm, 'Customer_Type'),
    );
    data.approveStatus = this.toEnum(
      ApproveStatus,
      this.pick(norm, 'Approve_Status'),
    );

    data.companyEstablishmentDate = this.toIsoDate(
      this.pick(norm, 'Company_Establishment_Date'),
    );
    data.paymentDueDays = this.toInt(
      this.pick(norm, 'Payment_Due_Days', 'Payment_Due'),
    );

    const instance = plainToInstance(UpsertBookingPartnerDto, data);
    const errors = await validate(instance);
    const errorMessages = errors.map((e) =>
      Object.values(e.constraints || {}).join(', '),
    );

    return {
      index,
      data: instance,
      isValid: errors.length === 0,
      errors: errorMessages,
    };
  }

  public async preview(buffer: Buffer): Promise<ImportPreviewResult> {
    const rawRows = await this.parseWorkbook(buffer);
    const results = await Promise.all(
      rawRows.map((row, i) => this.mapAndValidateRow(i + 1, row)),
    );
    const invalidCount = results.filter((r) => !r.isValid).length;
    return {
      total: results.length,
      valid: results.length - invalidCount,
      invalid: invalidCount,
      rows: results,
    };
  }

  public async commit(
    buffer: Buffer,
    actor: string,
  ): Promise<ImportCommitResult> {
    const previewResult = await this.preview(buffer);
    if (previewResult.invalid > 0) {
      throw new BadRequestException(
        'Validation failed for one or more rows. Please resolve errors in preview mode.',
      );
    }

    // Single-transaction bulk insert (fast: one connection, one reserved id
    // block, chunked save) instead of one transaction per row.
    const dtos = previewResult.rows.map((row: ImportPreviewRow) => row.data);
    const result = await this.partnerService.createPartnersBulk(dtos, actor);

    return {
      totalInput: previewResult.rows.length,
      successCount: result.successCount,
      errorCount: result.errorCount,
      successIndexes: [],
      errorDetails: result.errors,
    };
  }

  private stringifyCell(value: unknown): string {
    if (typeof value === 'string') return value;
    if (
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return String(value);
    }
    if (value instanceof Date) return value.toString();
    return '';
  }

  private normalizeWorkbookCell(value: unknown, displayText: string): unknown {
    if (
      value == null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint' ||
      value instanceof Date
    ) {
      return value ?? '';
    }

    if (typeof value === 'object' && 'result' in value) {
      return this.normalizeWorkbookCell(
        (value as { result?: unknown }).result,
        displayText,
      );
    }

    return displayText;
  }
}
