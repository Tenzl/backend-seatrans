import { Workbook } from 'exceljs';
import { BookingPartnerImportService } from './booking-partner-import.service';
import { BookingPartnerService } from './booking-partner.service';

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
});
