import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { In, IsNull, Repository } from 'typeorm';
import { BookingPartner } from '../booking/entities/booking-partner.entity';
import { CustomerType } from '../booking/enums/customer-type.enum';
import { PartnerAdditionType } from '../booking/enums/partner-addition-type.enum';
import { BookingDocumentPayload } from './booking-document.types';
import { ArrivalNoticePreviewDto } from './dto/arrival-notice-preview.dto';
import { BillOfLadingPreviewDto } from './dto/bill-of-lading-preview.dto';
import { BookingConfirmationPreviewDto } from './dto/booking-confirmation-preview.dto';
import { DeliveryOrderPreviewDto } from './dto/delivery-order-preview.dto';
import { BookingDocumentType } from './enums/booking-document-type.enum';

type PayloadClass = new () => BookingDocumentPayload;

type PartyPayload = BookingDocumentPayload & {
  clientPartyId?: number | null;
  agent?: string;
  agentPartyId?: number | null;
  shipper?: string;
  shipperPartyId?: number | null;
  consignee?: string;
  consigneePartyId?: number | null;
  notifyParty?: string;
  notifyPartyId?: number | null;
  consignor?: string;
  consignedToOrderOf?: string;
  notifyAddress?: string;
  deliverTo?: string;
  notifyPartySameAsConsignee?: boolean;
  to?: string;
};

const DTO_BY_TYPE: Record<BookingDocumentType, PayloadClass> = {
  [BookingDocumentType.ARRIVAL_NOTICE]: ArrivalNoticePreviewDto,
  [BookingDocumentType.BOOKING_CONFIRMATION]: BookingConfirmationPreviewDto,
  [BookingDocumentType.DELIVERY_ORDER]: DeliveryOrderPreviewDto,
  [BookingDocumentType.BILL_OF_LADING]: BillOfLadingPreviewDto,
};

@Injectable()
export class BookingDocumentPayloadValidator {
  constructor(
    @Optional()
    @InjectRepository(BookingPartner)
    private readonly partnerRepository?: Repository<BookingPartner>,
  ) {}

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
    await this.validateAndNormalizeParties(type, dto);
    return dto;
  }

  private async validateAndNormalizeParties(
    type: BookingDocumentType,
    payload: PartyPayload,
  ): Promise<void> {
    if (!this.partnerRepository) return;

    const ids = [
      payload.clientPartyId,
      payload.agentPartyId,
      payload.shipperPartyId,
      payload.consigneePartyId,
      payload.notifyPartyId,
    ].filter((id): id is number => typeof id === 'number');
    if (ids.length === 0) {
      if (type === BookingDocumentType.ARRIVAL_NOTICE) {
        this.normalizeSameAs(payload);
      }
      return;
    }

    const partners = await this.partnerRepository.find({
      where: { id: In([...new Set(ids)]), deletedAt: IsNull() },
    });
    const byId = new Map(partners.map((partner) => [partner.id, partner]));

    const normalize = (
      id: number | null | undefined,
      label: string,
      textKey: keyof PartyPayload,
      additionType?: PartnerAdditionType,
      customerType?: CustomerType,
    ) => {
      if (id == null) return;
      const partner = byId.get(id);
      if (!partner) {
        throw new BadRequestException(
          `${label} Party does not exist or was deleted`,
        );
      }
      if (
        additionType &&
        !partner.additionTypeRows?.some(
          (row) => row.additionType === additionType,
        )
      ) {
        throw new BadRequestException(
          `${label} Party must have addition type ${additionType}`,
        );
      }
      if (customerType && partner.customerType !== customerType) {
        throw new BadRequestException(
          `${label} Party must have customer type ${customerType}`,
        );
      }
      (payload[textKey] as string | undefined) = this.formatParty(partner);
    };

    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      normalize(
        payload.clientPartyId,
        'Client',
        'to',
        PartnerAdditionType.CUSTOMER,
      );
    } else if (type === BookingDocumentType.ARRIVAL_NOTICE) {
      normalize(
        payload.agentPartyId,
        'Agent',
        'agent',
        undefined,
        CustomerType.AGENT,
      );
      normalize(
        payload.shipperPartyId,
        'Shipper',
        'shipper',
        PartnerAdditionType.SHIPPER,
      );
      normalize(
        payload.consigneePartyId,
        'Consignee',
        'consignee',
        PartnerAdditionType.CONSIGNEE,
      );
      if (!payload.notifyPartySameAsConsignee) {
        normalize(
          payload.notifyPartyId,
          'Notify Party',
          'notifyParty',
          PartnerAdditionType.NOTIFY_PARTY,
        );
      }
    } else if (type === BookingDocumentType.BILL_OF_LADING) {
      normalize(
        payload.shipperPartyId,
        'Shipper',
        'consignor',
        PartnerAdditionType.SHIPPER,
      );
      normalize(
        payload.consigneePartyId,
        'Consignee',
        'consignedToOrderOf',
        PartnerAdditionType.CONSIGNEE,
      );
      normalize(
        payload.notifyPartyId,
        'Notify Party',
        'notifyAddress',
        PartnerAdditionType.NOTIFY_PARTY,
      );
    } else if (type === BookingDocumentType.DELIVERY_ORDER) {
      normalize(
        payload.consigneePartyId,
        'Consignee',
        'deliverTo',
        PartnerAdditionType.CONSIGNEE,
      );
      normalize(
        payload.notifyPartyId,
        'Notify Party',
        'notifyParty',
        PartnerAdditionType.NOTIFY_PARTY,
      );
    }

    if (type === BookingDocumentType.ARRIVAL_NOTICE) {
      this.normalizeSameAs(payload);
    }
  }

  private normalizeSameAs(payload: PartyPayload): void {
    if (payload.notifyPartySameAsConsignee) {
      if (typeof payload.consigneePartyId === 'number') {
        payload.notifyPartyId = payload.consigneePartyId;
        payload.notifyParty = payload.consignee ?? '';
      } else {
        payload.notifyPartySameAsConsignee = false;
        payload.notifyPartyId = undefined;
        payload.notifyParty = '';
      }
    }
  }

  private formatParty(partner: BookingPartner): string {
    const clean = (value: string | null | undefined) =>
      value?.replace(/\s+/g, ' ').trim() ?? '';
    const address = clean(partner.address);
    const location = [clean(partner.city), clean(partner.country)]
      .filter(
        (part) =>
          part.length > 0 &&
          !address.toLowerCase().includes(part.toLowerCase()),
      )
      .join(', ');
    const contact = [
      partner.phone ? `TEL: ${clean(partner.phone)}` : '',
      partner.fax ? `FAX: ${clean(partner.fax)}` : '',
    ]
      .filter(Boolean)
      .join('  ');
    return [clean(partner.name), address, location, contact]
      .filter(Boolean)
      .join('\n');
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
