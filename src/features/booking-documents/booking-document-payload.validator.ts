import { BadRequestException, Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { BookingDocumentPayload } from './booking-document.types';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BillOfLadingPreviewDto } from './dto/bill-of-lading-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { BookingDocumentType } from './enums/booking-document-type.enum';

type PayloadClass = new () => BookingDocumentPayload;

const DTO_BY_TYPE: Record<BookingDocumentType, PayloadClass> = {
  [BookingDocumentType.ARRIVAL_NOTICE]: ArrivalNoticePreviewDto,
  [BookingDocumentType.BOOKING_CONFIRMATION]: BookingConfirmationPreviewDto,
  [BookingDocumentType.DELIVERY_ORDER]: DeliveryOrderPreviewDto,
  [BookingDocumentType.BILL_OF_LADING]: BillOfLadingPreviewDto,
};

@Injectable()
export class BookingDocumentPayloadValidator {
  async validate(
    type: BookingDocumentType,
    payload: unknown,
  ): Promise<BookingDocumentPayload> {
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
        details: this.flattenErrors(errors),
      });
    }
    return dto;
  }

  private flattenErrors(
    errors: ValidationError[],
    parent = '',
  ): Array<{ field: string; message: string }> {
    return errors.flatMap((error) => {
      const field = parent ? `${parent}.${error.property}` : error.property;
      const own = error.constraints
        ? [{ field, message: Object.values(error.constraints)[0] }]
        : [];
      return [...own, ...this.flattenErrors(error.children ?? [], field)];
    });
  }
}
