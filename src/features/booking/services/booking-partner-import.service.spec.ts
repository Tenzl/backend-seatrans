import { Workbook } from 'exceljs';
import { BookingPartnerImportService } from './booking-partner-import.service';
import { BookingPartnerService } from './booking-partner.service';
import { BOOKING_PARTNER_IMPORT_MAX_COLUMNS } from '../constants/booking-partner-import.limits';

describe('BookingPartnerImportService workbook parsing', () => {
  const service = new BookingPartnerImportService({} as BookingPartnerService);

  it('parses UTF-8 CSV uploads and removes the BOM from the first header', async () => {
    const rows = await service.parseWorkbook(
      Buffer.from('\uFEFFName*,Customer_ID\nACME Shipping,C-001\n', 'utf8'),
    );

    expect(rows).toEqual([
      {
        'Name*': 'ACME Shipping',
        Customer_ID: 'C-001',
      },
    ]);
  });

  it('parses the first worksheet from XLSX uploads', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Partners');
    sheet.addRow(['Name*', 'Payment_Due_Days']);
    sheet.addRow(['Ocean Partner', 30]);
    const bytes = await workbook.xlsx.writeBuffer();

    const rows = await service.parseWorkbook(Buffer.from(bytes));

    expect(rows).toEqual([
      {
        'Name*': 'Ocean Partner',
        Payment_Due_Days: 30,
      },
    ]);
  });

  it('rejects workbooks that exceed the column limit', async () => {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Partners');
    const headers = Array.from(
      { length: BOOKING_PARTNER_IMPORT_MAX_COLUMNS + 1 },
      (_, i) => `Col_${i}`,
    );
    sheet.addRow(headers);
    sheet.addRow(headers.map(() => 'x'));
    const bytes = await workbook.xlsx.writeBuffer();

    await expect(service.parseWorkbook(Buffer.from(bytes))).rejects.toThrow(
      /column limit/i,
    );
  });

  it('commitValidatedRows rejects an empty payload', async () => {
    await expect(service.commitValidatedRows([], 'tester')).rejects.toThrow(
      /No rows/i,
    );
  });
});
