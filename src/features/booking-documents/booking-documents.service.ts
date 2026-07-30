import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFImage, PDFPage, rgb } from 'pdf-lib';
import { Repository } from 'typeorm';
import {
  BOOKING_DOCUMENT_FILENAMES,
  BOOKING_DOCUMENT_TEMPLATES,
} from './constants/booking-document.constants';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { CargoRowDto } from './dto/cargo-row.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { BookingDocumentRecord } from './entities/booking-document-record.entity';
import { BookingDocumentType } from './enums/booking-document-type.enum';

type PreviewDto =
  | ArrivalNoticePreviewDto
  | BookingConfirmationPreviewDto
  | DeliveryOrderPreviewDto;

type PreviewDtoClass = new () => PreviewDto;

interface TextBox {
  x: number;
  y: number;
  width: number;
  height: number;
  size?: number;
  maxLines?: number;
  bold?: boolean;
  color?: ReturnType<typeof rgb>;
}

interface PreviewResult {
  data: Buffer;
  filename: string;
}

const DTO_BY_TYPE: Record<BookingDocumentType, PreviewDtoClass> = {
  [BookingDocumentType.ARRIVAL_NOTICE]: ArrivalNoticePreviewDto,
  [BookingDocumentType.BOOKING_CONFIRMATION]: BookingConfirmationPreviewDto,
  [BookingDocumentType.DELIVERY_ORDER]: DeliveryOrderPreviewDto,
};

const PAGE_WIDTH = 595.276;
const PAGE_HEIGHT = 841.89;
const BLACK = rgb(0, 0, 0);

@Injectable()
export class BookingDocumentsService {
  constructor(
    @InjectRepository(BookingDocumentRecord)
    private readonly recordRepository: Repository<BookingDocumentRecord>,
  ) {}

  async createRecord(
    type: BookingDocumentType,
    payload: unknown,
    createdByUserId: number,
  ) {
    const dto = await this.validatePayload(type, payload);
    const snapshot = JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;
    const record = this.recordRepository.create({
      documentType: type,
      referenceNumber: this.referenceNumber(type, dto),
      payload: snapshot,
      createdByUserId,
    });
    return this.toRecordResponse(await this.recordRepository.save(record));
  }

  async listRecords(type?: BookingDocumentType, page = 0, size = 10) {
    const safePage = Math.max(0, page);
    const safeSize = Math.min(50, Math.max(1, size));
    const [records, totalElements] = await this.recordRepository.findAndCount({
      where: type ? { documentType: type } : {},
      relations: { createdBy: true },
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: safePage * safeSize,
      take: safeSize,
    });

    return {
      content: records.map((record) => this.toRecordResponse(record)),
      totalElements,
      totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / safeSize),
      size: safeSize,
      number: safePage,
    };
  }

  async createPreview(
    type: BookingDocumentType,
    payload: unknown,
  ): Promise<PreviewResult> {
    const dto = await this.validatePayload(type, payload);
    const pdf = await this.openTemplate(type);
    pdf.registerFontkit(fontkit);

    const [regularBytes, boldBytes] = await Promise.all([
      this.readAsset('fonts', 'DejaVuSans.ttf'),
      this.readAsset('fonts', 'DejaVuSans-Bold.ttf'),
    ]);
    // pdf-lib mutates the document context while allocating embedded objects;
    // keep these sequential so concurrent HTTP previews cannot corrupt refs.
    const regular = await pdf.embedFont(regularBytes, { subset: true });
    const bold = await pdf.embedFont(boldBytes, { subset: true });

    switch (type) {
      case BookingDocumentType.ARRIVAL_NOTICE:
        await this.renderArrivalNotice(
          pdf,
          dto as ArrivalNoticePreviewDto,
          regular,
          bold,
        );
        break;
      case BookingDocumentType.BOOKING_CONFIRMATION:
        await this.renderBookingConfirmation(
          pdf,
          dto as BookingConfirmationPreviewDto,
          regular,
          bold,
        );
        break;
      case BookingDocumentType.DELIVERY_ORDER:
        await this.renderDeliveryOrder(
          pdf,
          dto as DeliveryOrderPreviewDto,
          regular,
          bold,
        );
        break;
    }

    const bytes = await pdf.save({ useObjectStreams: false });
    return {
      data: Buffer.from(bytes),
      filename: BOOKING_DOCUMENT_FILENAMES[type],
    };
  }

  private async validatePayload(
    type: BookingDocumentType,
    payload: unknown,
  ): Promise<PreviewDto> {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      Array.isArray(payload)
    ) {
      throw new BadRequestException('Request body must be an object');
    }

    const dto = plainToInstance(DTO_BY_TYPE[type], payload, {
      enableImplicitConversion: false,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      validationError: { target: false, value: false },
    });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Request validation failed',
        details: this.flattenValidationErrors(errors),
      });
    }
    return dto;
  }

  private referenceNumber(
    type: BookingDocumentType,
    dto: PreviewDto,
  ): string | null {
    let value: string | undefined;
    switch (type) {
      case BookingDocumentType.ARRIVAL_NOTICE:
        value = (dto as ArrivalNoticePreviewDto).anNumber;
        break;
      case BookingDocumentType.BOOKING_CONFIRMATION:
        value = (dto as BookingConfirmationPreviewDto).bookingNumber;
        break;
      case BookingDocumentType.DELIVERY_ORDER:
        value = (dto as DeliveryOrderPreviewDto).doNumber;
        break;
    }
    return value?.trim() || null;
  }

  private toRecordResponse(record: BookingDocumentRecord) {
    return {
      id: record.id,
      documentType: record.documentType,
      referenceNumber: record.referenceNumber,
      payload: record.payload,
      createdByUserId: record.createdByUserId,
      createdAt: record.createdAt.toISOString(),
      createdBy: record.createdBy
        ? {
            id: record.createdBy.id,
            fullName: record.createdBy.fullName ?? null,
            email: record.createdBy.email ?? null,
          }
        : null,
    };
  }

  private flattenValidationErrors(
    errors: ValidationError[],
    parent = '',
  ): Array<{ field: string; message: string }> {
    return errors.flatMap((error) => {
      const field = parent ? `${parent}.${error.property}` : error.property;
      const own = error.constraints
        ? [{ field, message: Object.values(error.constraints)[0] }]
        : [];
      return [
        ...own,
        ...this.flattenValidationErrors(error.children ?? [], field),
      ];
    });
  }

  private async openTemplate(type: BookingDocumentType): Promise<PDFDocument> {
    const bytes = await this.readAsset(
      'templates',
      BOOKING_DOCUMENT_TEMPLATES[type],
    );
    return PDFDocument.load(bytes);
  }

  private readAsset(...parts: string[]): Promise<Buffer> {
    return readFile(join(__dirname, 'assets', ...parts));
  }

  private async embedHeader(pdf: PDFDocument): Promise<PDFImage> {
    return pdf.embedPng(await this.readAsset('author-header.png'));
  }

  /** Replaces the legacy text letterhead with the exact EPDA heading artwork. */
  private drawLetterhead(
    page: PDFPage,
    image: PDFImage,
    bold: PDFFont,
    title: string,
    options: { clearBottom: number; titleY: number },
  ): void {
    page.drawRectangle({
      x: 0,
      y: options.clearBottom,
      width: PAGE_WIDTH,
      height: PAGE_HEIGHT - options.clearBottom,
      color: rgb(1, 1, 1),
    });

    const width = 565;
    const height = width / (image.width / image.height);
    page.drawImage(image, {
      x: (PAGE_WIDTH - width) / 2,
      y: PAGE_HEIGHT - height - 1,
      width,
      height,
    });

    const titleSize = title.length > 22 ? 22 : 25;
    page.drawText(title, {
      x: (PAGE_WIDTH - bold.widthOfTextAtSize(title, titleSize)) / 2,
      y: options.titleY,
      size: titleSize,
      font: bold,
      color: BLACK,
    });
    page.drawLine({
      start: { x: 6, y: options.clearBottom },
      end: { x: PAGE_WIDTH - 6, y: options.clearBottom },
      thickness: 0.8,
      color: BLACK,
    });
  }

  private async renderArrivalNotice(
    pdf: PDFDocument,
    dto: ArrivalNoticePreviewDto,
    regular: PDFFont,
    bold: PDFFont,
  ): Promise<void> {
    const page = pdf.getPage(0);
    this.drawLetterhead(
      page,
      await this.embedHeader(pdf),
      bold,
      'ARRIVAL NOTICE',
      { clearBottom: 698, titleY: 708 },
    );

    this.text(page, regular, bold, dto.agent, {
      x: 42,
      y: 680,
      width: 248,
      height: 10,
    });
    this.text(page, regular, bold, dto.date, {
      x: 329,
      y: 680,
      width: 105,
      height: 10,
    });
    this.text(page, regular, bold, dto.anNumber, {
      x: 484,
      y: 680,
      width: 105,
      height: 10,
    });
    this.text(page, regular, bold, dto.shipper, {
      x: 10,
      y: 566,
      width: 282,
      height: 94,
      maxLines: 9,
    });
    this.text(page, regular, bold, dto.consignee, {
      x: 10,
      y: 454,
      width: 282,
      height: 91,
      maxLines: 8,
    });
    this.text(page, regular, bold, dto.notifyParty, {
      x: 10,
      y: 374,
      width: 282,
      height: 60,
      maxLines: 6,
    });

    this.text(page, regular, bold, dto.mblNumber, {
      x: 347,
      y: 636,
      width: 239,
      height: 10,
    });
    this.text(page, regular, bold, dto.hblNumber, {
      x: 347,
      y: 624,
      width: 239,
      height: 10,
    });
    const rightUpper: Array<[string | undefined, number]> = [
      [dto.vesselVoyage, 598],
      [dto.etdEta, 586],
      [dto.cfsTerminal, 574],
      [dto.shipmentNumber, 562],
      [dto.referenceNumber, 550],
      [dto.billOfLadingType, 538],
    ];
    rightUpper.forEach(([value, y]) =>
      this.text(page, regular, bold, value, {
        x: 392,
        y,
        width: 194,
        height: 10,
      }),
    );
    const rightLower: Array<[string | undefined, number]> = [
      [dto.placeOfReceipt, 512],
      [dto.portOfLoading, 500],
      [dto.portOfDischarge, 488],
      [dto.placeOfDelivery, 476],
      [dto.finalDestination, 464],
      [dto.serviceMode, 452],
    ];
    rightLower.forEach(([value, y]) =>
      this.text(page, regular, bold, value, {
        x: 392,
        y,
        width: 194,
        height: 10,
      }),
    );
    this.text(page, regular, bold, dto.note, {
      x: 302,
      y: 374,
      width: 284,
      height: 58,
      maxLines: 6,
    });
    this.text(page, regular, bold, dto.marks, {
      x: 10,
      y: 321,
      width: 282,
      height: 38,
      maxLines: 4,
    });
    this.text(page, regular, bold, dto.volume, {
      x: 302,
      y: 321,
      width: 284,
      height: 38,
      maxLines: 4,
    });

    page.drawRectangle({
      x: 6,
      y: 72,
      width: 583,
      height: 232,
      color: rgb(1, 1, 1),
    });
    const remaining = this.drawCargoRows(
      page,
      dto.cargoRows ?? [],
      regular,
      bold,
      {
        top: 304,
        bottom: 220,
        maxRows: 4,
      },
    );
    page.drawText("For customer's attention:", {
      x: 9,
      y: 204,
      size: 7.5,
      font: bold,
    });
    this.text(page, regular, bold, dto.customerAttention, {
      x: 9,
      y: 82,
      width: 577,
      height: 112,
      maxLines: 13,
    });
    this.addCargoContinuationPages(
      pdf,
      remaining,
      regular,
      bold,
      'ARRIVAL NOTICE',
    );
  }

  private async renderDeliveryOrder(
    pdf: PDFDocument,
    dto: DeliveryOrderPreviewDto,
    regular: PDFFont,
    bold: PDFFont,
  ): Promise<void> {
    const page = pdf.getPage(0);
    this.drawLetterhead(
      page,
      await this.embedHeader(pdf),
      bold,
      'DELIVERY ORDER',
      { clearBottom: 698, titleY: 708 },
    );

    this.text(page, regular, bold, dto.doNumber, {
      x: 60,
      y: 680,
      width: 230,
      height: 10,
    });
    this.text(page, regular, bold, dto.date, {
      x: 42,
      y: 668,
      width: 248,
      height: 10,
    });
    this.text(page, regular, bold, dto.to, {
      x: 29,
      y: 628,
      width: 261,
      height: 27,
      maxLines: 3,
    });
    page.drawRectangle({
      x: 6,
      y: 588,
      width: 145,
      height: 20,
      color: rgb(1, 1, 1),
    });
    this.text(page, regular, bold, dto.deliverTo, {
      x: 10,
      y: 570,
      width: 282,
      height: 53,
      maxLines: 3,
    });
    page.drawText('Notify party:', {
      x: 10,
      y: 584,
      size: 7.5,
      font: bold,
      color: BLACK,
    });
    this.text(page, regular, bold, dto.notifyParty, {
      x: 10,
      y: 413,
      width: 282,
      height: 92,
      maxLines: 9,
    });

    this.text(page, regular, bold, dto.mblNumber, {
      x: 347,
      y: 680,
      width: 239,
      height: 10,
    });
    this.text(page, regular, bold, dto.hblNumber, {
      x: 347,
      y: 668,
      width: 239,
      height: 10,
    });
    this.text(page, regular, bold, dto.etd, {
      x: 334,
      y: 638,
      width: 252,
      height: 10,
    });
    this.text(page, regular, bold, dto.eta, {
      x: 334,
      y: 626,
      width: 252,
      height: 10,
    });
    this.text(page, regular, bold, dto.shipmentNumber, {
      x: 374,
      y: 614,
      width: 212,
      height: 10,
    });
    const details: Array<[string | undefined, number]> = [
      [dto.vesselVoyage, 584],
      [dto.placeOfReceipt, 572],
      [dto.portOfLoading, 560],
      [dto.portOfDischarge, 548],
      [dto.placeOfDelivery, 536],
      [dto.finalDestination, 524],
      [dto.serviceMode, 512],
      [dto.cfsTerminal, 500],
    ];
    details.forEach(([value, y]) =>
      this.text(page, regular, bold, value, {
        x: 394,
        y,
        width: 192,
        height: 10,
      }),
    );
    this.text(page, regular, bold, dto.note, {
      x: 302,
      y: 413,
      width: 284,
      height: 72,
      maxLines: 7,
    });
    this.text(page, regular, bold, dto.marks, {
      x: 10,
      y: 422,
      width: 282,
      height: 25,
      maxLines: 3,
    });
    this.text(page, regular, bold, dto.volume, {
      x: 302,
      y: 422,
      width: 284,
      height: 25,
      maxLines: 3,
    });

    const remaining = this.drawCargoRows(
      page,
      dto.cargoRows ?? [],
      regular,
      bold,
      {
        top: 398.6,
        bottom: 316.4,
        maxRows: 4,
      },
    );
    page.drawRectangle({
      x: 6,
      y: 210,
      width: 583,
      height: 100,
      color: rgb(1, 1, 1),
    });
    page.drawText("For customer's attention:", {
      x: 9,
      y: 296,
      size: 7.5,
      font: bold,
    });
    this.text(page, regular, bold, dto.customerAttention, {
      x: 9,
      y: 245,
      width: 577,
      height: 38,
      maxLines: 4,
    });
    page.drawText('For SEATRANS', { x: 9, y: 221, size: 7.5, font: bold });
    this.addCargoContinuationPages(
      pdf,
      remaining,
      regular,
      bold,
      'DELIVERY ORDER',
    );
  }

  private async renderBookingConfirmation(
    pdf: PDFDocument,
    dto: BookingConfirmationPreviewDto,
    regular: PDFFont,
    bold: PDFFont,
  ): Promise<void> {
    const page = pdf.getPage(0);
    this.drawLetterhead(
      page,
      await this.embedHeader(pdf),
      bold,
      'BOOKING CONFIRMATION',
      { clearBottom: 674, titleY: 688 },
    );

    this.text(page, regular, bold, dto.date, {
      x: 482,
      y: 662,
      width: 105,
      height: 10,
    });
    this.text(page, regular, bold, dto.bookingNumber, {
      x: 505,
      y: 650,
      width: 82,
      height: 10,
      size: 6.2,
    });
    this.text(page, regular, bold, dto.to, {
      x: 30,
      y: 625,
      width: 430,
      height: 20,
      maxLines: 2,
    });

    const boxes: Array<[string | undefined, TextBox]> = [
      [
        dto.vesselVoyage,
        { x: 10, y: 568, width: 139, height: 31, maxLines: 3 },
      ],
      [dto.etd, { x: 154, y: 568, width: 66, height: 31, maxLines: 3 }],
      [dto.eta, { x: 226, y: 568, width: 66, height: 31, maxLines: 3 }],
      [
        dto.placeOfReceipt,
        { x: 298, y: 568, width: 139, height: 31, maxLines: 3 },
      ],
      [
        dto.portOfLoading,
        { x: 448, y: 568, width: 138, height: 31, maxLines: 3 },
      ],
      [dto.pickupDate, { x: 10, y: 531, width: 139, height: 27, maxLines: 3 }],
      [
        dto.pickupPlace,
        { x: 154, y: 531, width: 139, height: 27, maxLines: 3 },
      ],
      [
        dto.portOfDischarge,
        { x: 298, y: 531, width: 139, height: 27, maxLines: 3 },
      ],
      [
        dto.placeOfDelivery,
        { x: 448, y: 531, width: 138, height: 27, maxLines: 3 },
      ],
      [
        dto.dropoffPlace,
        { x: 10, y: 486, width: 139, height: 29, maxLines: 3 },
      ],
      [
        dto.closingTime,
        { x: 154, y: 486, width: 139, height: 29, maxLines: 3 },
      ],
      [dto.siCutoff, { x: 298, y: 509, width: 139, height: 8, size: 6 }],
      [dto.vgmCutoff, { x: 298, y: 486, width: 139, height: 11 }],
      [dto.contact, { x: 448, y: 486, width: 138, height: 29, maxLines: 3 }],
      [dto.commodity, { x: 10, y: 435, width: 139, height: 27, maxLines: 3 }],
      [dto.volume, { x: 154, y: 435, width: 139, height: 27, maxLines: 3 }],
      [
        dto.grossWeight,
        { x: 298, y: 435, width: 68, height: 27, maxLines: 3, size: 6 },
      ],
      [
        dto.measurement,
        { x: 371, y: 435, width: 66, height: 27, maxLines: 3, size: 6 },
      ],
      [
        dto.transitPort,
        { x: 448, y: 435, width: 138, height: 27, maxLines: 3 },
      ],
      [
        dto.specialRemark,
        { x: 10, y: 394, width: 139, height: 26, maxLines: 3 },
      ],
      [
        dto.motherVessel,
        { x: 154, y: 394, width: 139, height: 26, maxLines: 3 },
      ],
      [
        dto.motherVoyage,
        { x: 298, y: 394, width: 288, height: 26, maxLines: 3 },
      ],
      [dto.pic, { x: 30, y: 363, width: 556, height: 18, maxLines: 2 }],
    ];
    boxes.forEach(([value, box]) => this.text(page, regular, bold, value, box));
  }

  private drawCargoRows(
    page: PDFPage,
    rows: CargoRowDto[],
    regular: PDFFont,
    bold: PDFFont,
    area: { top: number; bottom: number; maxRows: number },
  ): CargoRowDto[] {
    const shown = rows.slice(0, area.maxRows);
    const rowHeight = (area.top - area.bottom) / Math.max(area.maxRows, 1);
    const columns = [6, 179, 267, 412, 500, 589];

    for (let index = 0; index <= area.maxRows; index += 1) {
      const y = area.top - rowHeight * index;
      page.drawLine({
        start: { x: 6, y },
        end: { x: 589, y },
        thickness: 0.45,
        color: BLACK,
      });
    }
    columns.forEach((x) =>
      page.drawLine({
        start: { x, y: area.bottom },
        end: { x, y: area.top },
        thickness: 0.45,
        color: BLACK,
      }),
    );

    shown.forEach((row, index) => {
      const y = area.top - rowHeight * (index + 1) + 2;
      const height = rowHeight - 4;
      const values = [
        row.containerSealNumber,
        row.quantity,
        row.descriptionOfGoods,
        row.grossWeight,
        row.measurement,
      ];
      values.forEach((value, column) =>
        this.text(page, regular, bold, value, {
          x: columns[column] + 3,
          y,
          width: columns[column + 1] - columns[column] - 6,
          height,
          size: 5.5,
          maxLines: 2,
        }),
      );
    });
    return rows.slice(area.maxRows);
  }

  private addCargoContinuationPages(
    pdf: PDFDocument,
    rows: CargoRowDto[],
    regular: PDFFont,
    bold: PDFFont,
    title: string,
  ): void {
    let remaining = rows;
    while (remaining.length > 0) {
      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      page.drawText(`${title} - CARGO CONTINUATION`, {
        x: 28,
        y: 790,
        size: 17,
        font: bold,
        color: BLACK,
      });
      const headers = [
        'Container No./ Seal No.',
        'Quantity',
        'Description of Goods',
        'Gross Weight',
        'Measurement',
      ];
      const columns = [28, 190, 278, 430, 505, 568];
      headers.forEach((header, index) =>
        page.drawText(header, {
          x: columns[index] + 3,
          y: 752,
          size: 6.5,
          font: bold,
          color: BLACK,
        }),
      );
      const batch = remaining.slice(0, 14);
      const rowHeight = 44;
      const top = 744;
      for (let index = 0; index <= batch.length; index += 1) {
        const y = top - rowHeight * index;
        page.drawLine({
          start: { x: 28, y },
          end: { x: 568, y },
          thickness: 0.5,
          color: BLACK,
        });
      }
      columns.forEach((x) =>
        page.drawLine({
          start: { x, y: top - rowHeight * batch.length },
          end: { x, y: top },
          thickness: 0.5,
          color: BLACK,
        }),
      );
      batch.forEach((row, rowIndex) => {
        const values = [
          row.containerSealNumber,
          row.quantity,
          row.descriptionOfGoods,
          row.grossWeight,
          row.measurement,
        ];
        values.forEach((value, columnIndex) =>
          this.text(page, regular, bold, value, {
            x: columns[columnIndex] + 3,
            y: top - rowHeight * (rowIndex + 1) + 4,
            width: columns[columnIndex + 1] - columns[columnIndex] - 6,
            height: rowHeight - 8,
            size: 6,
            maxLines: 4,
          }),
        );
      });
      remaining = remaining.slice(batch.length);
    }
  }

  private text(
    page: PDFPage,
    regular: PDFFont,
    bold: PDFFont,
    value: string | undefined,
    box: TextBox,
  ): void {
    if (!value?.trim()) return;
    const font = box.bold ? bold : regular;
    const size = box.size ?? 6.8;
    const lineHeight = size * 1.2;
    const maxLines = Math.max(
      1,
      Math.min(box.maxLines ?? 100, Math.floor(box.height / lineHeight)),
    );
    const wrapped = this.wrapText(value.trim(), font, size, box.width);
    const lines = wrapped.slice(0, maxLines);
    if (wrapped.length > maxLines) {
      lines[maxLines - 1] = this.fitEllipsis(
        lines[maxLines - 1],
        font,
        size,
        box.width,
      );
    }
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: box.x,
        y: box.y + box.height - size - index * lineHeight,
        size,
        font,
        color: box.color ?? BLACK,
      });
    });
  }

  private wrapText(
    text: string,
    font: PDFFont,
    size: number,
    width: number,
  ): string[] {
    const lines: string[] = [];
    for (const paragraph of text.replace(/\r/g, '').split('\n')) {
      const words = paragraph.split(/\s+/).filter(Boolean);
      if (words.length === 0) {
        lines.push('');
        continue;
      }
      let line = '';
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= width) {
          line = candidate;
          continue;
        }
        if (line) lines.push(line);
        const chunks = this.splitLongWord(word, font, size, width);
        lines.push(...chunks.slice(0, -1));
        line = chunks.at(-1) ?? '';
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  private splitLongWord(
    word: string,
    font: PDFFont,
    size: number,
    width: number,
  ): string[] {
    const chunks: string[] = [];
    let chunk = '';
    for (const character of Array.from(word)) {
      const candidate = chunk + character;
      if (chunk && font.widthOfTextAtSize(candidate, size) > width) {
        chunks.push(chunk);
        chunk = character;
      } else {
        chunk = candidate;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  }

  private fitEllipsis(
    value: string,
    font: PDFFont,
    size: number,
    width: number,
  ): string {
    const suffix = '...';
    let text = value;
    while (
      text.length > 0 &&
      font.widthOfTextAtSize(text + suffix, size) > width
    ) {
      text = text.slice(0, -1);
    }
    return text + suffix;
  }
}
