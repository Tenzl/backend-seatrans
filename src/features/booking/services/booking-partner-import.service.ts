import { Injectable, BadRequestException } from '@nestjs/common';
import { BookingPartnerService } from './booking-partner.service';
import { UpsertBookingPartnerDto } from '../dto/upsert-booking-partner.dto';
import { PartnerAdditionType } from '../enums/partner-addition-type.enum';
import { CustomerStatus } from '../enums/customer-status.enum';
import { CustomerType } from '../enums/customer-type.enum';
import csvParser from 'csv-parser';
import { Readable } from 'stream';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export interface ImportPreviewRow {
  index: number;
  data: UpsertBookingPartnerDto;
  isValid: boolean;
  errors: string[];
}

@Injectable()
export class BookingPartnerImportService {
  constructor(private readonly partnerService: BookingPartnerService) {}

  public getTemplate(): string {
    const headers = [
      'Name*',
      'Addition_Types*',
      'Country',
      'City',
      'Contact_Email',
      'Phone',
      'Fax',
      'Address',
      'Customer_Status',
      'Customer_Type',
      'Tax_Number',
      'Tracking_Url'
    ];
    return '\uFEFF' + headers.join(','); // BOM for Excel UTF-8 support
  }

  public async parseCsv(buffer: Buffer): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const results: any[] = [];
      const stream = Readable.from(buffer);
      stream
        .pipe(csvParser())
        .on('data', (data: any) => results.push(data))
        .on('error', (err: any) => reject(err))
        .on('end', () => resolve(results));
    });
  }

  public async mapAndValidateRow(index: number, row: any): Promise<ImportPreviewRow> {
    const defaultData = new UpsertBookingPartnerDto();
    defaultData.name = row['Name*']?.trim();
    
    const typeStrs = row['Addition_Types*'] 
        ? row['Addition_Types*'].split(',').map((s: string) => s.trim()).filter(Boolean) 
        : [];
    defaultData.additionTypes = typeStrs as PartnerAdditionType[];
    
    defaultData.country = row['Country']?.trim() || undefined;
    defaultData.city = row['City']?.trim() || undefined;
    defaultData.contactEmail = row['Contact_Email']?.trim() || undefined;
    defaultData.phone = row['Phone']?.trim() || undefined;
    defaultData.fax = row['Fax']?.trim() || undefined;
    defaultData.address = row['Address']?.trim() || undefined;
    defaultData.customerStatus = (row['Customer_Status']?.trim() as CustomerStatus) || undefined;
    defaultData.customerType = (row['Customer_Type']?.trim() as CustomerType) || undefined;
    defaultData.taxNumber = row['Tax_Number']?.trim() || undefined;
    defaultData.trackingUrl = row['Tracking_Url']?.trim() || undefined;

    const instance = plainToInstance(UpsertBookingPartnerDto, defaultData);
    const errors = await validate(instance);
    const errorMessages = errors.map(e => Object.values(e.constraints || {}).join(', '));
    
    return {
      index,
      data: instance,
      isValid: errors.length === 0,
      errors: errorMessages,
    };
  }

  public async preview(buffer: Buffer): Promise<any> {
    const rawRows = await this.parseCsv(buffer);
    const results = await Promise.all(
      rawRows.map((row, i) => this.mapAndValidateRow(i + 1, row))
    );
    const invalidCount = results.filter(r => !r.isValid).length;
    return {
      total: results.length,
      valid: results.length - invalidCount,
      invalid: invalidCount,
      rows: results
    };
  }

  public async commit(buffer: Buffer, actor: string): Promise<any> {
    const previewResult = await this.preview(buffer);
    if (previewResult.invalid > 0) {
      throw new BadRequestException('Validation failed for one or more rows. Please resolve errors in preview mode.');
    }

    const successRows = [];
    const errorRows = [];
    
    for (const row of previewResult.rows) {
      try {
        await this.partnerService.createPartner(row.data, actor);
        successRows.push(row.index);
      } catch (err: any) {
        errorRows.push({ index: row.index, message: err.message });
      }
    }
    
    return {
      totalInput: previewResult.rows.length,
      successCount: successRows.length,
      errorCount: errorRows.length,
      successIndexes: successRows,
      errorDetails: errorRows
    };
  }
}
