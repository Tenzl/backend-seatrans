import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { In, IsNull, Repository } from 'typeorm';
import { BookingPartner } from '../booking/entities/booking-partner.entity';
import { CustomerType } from '../booking/enums/customer-type.enum';
import { PartnerAdditionType } from '../booking/enums/partner-addition-type.enum';
import { CommodityTypesService } from '../commodities/commodity-types.service';
import { validationFailedException } from '../../shared/utils/validate-dto.util';
import {
  anContainersToBlCargoTextFields,
  anContainersToCargoRows,
  anContainersToVolumeText,
  containerRowHasCargo,
  legacyBlCargoTextToContainers,
  normalizeAnContainersPayload,
  resolveBlShippingMark,
  resolveDescriptionOfGoods,
} from './an-container';
import { BookingDocumentPayload } from './booking-document.types';
import { normalizeBookingCargoVolumePayload } from './cargo-volume';
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
  notifyPartySameAsConsignee?: boolean;
  deliverTo?: string;
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
    @Optional()
    private readonly commodityTypesService?: CommodityTypesService,
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

    const body =
      type === BookingDocumentType.BILL_OF_LADING
        ? this.foldLegacyBillOfLadingVoyage(payload as Record<string, unknown>)
        : payload;

    const dto = plainToInstance(DTO_BY_TYPE[type], body, {
      enableImplicitConversion: false,
    });
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      validationError: { target: false, value: false },
    });
    if (errors.length > 0) {
      throw validationFailedException(errors);
    }
    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      await this.resolveBookingCommodityLabel(dto);
      this.normalizeBookingVolumes(dto);
    }
    if (type === BookingDocumentType.ARRIVAL_NOTICE) {
      await this.resolveArrivalNoticeDescriptionFromCommodity(dto);
      this.normalizeArrivalNoticeContainers(dto);
    }
    if (type === BookingDocumentType.BILL_OF_LADING) {
      this.normalizeBillOfLadingContainers(dto);
    }
    if (type === BookingDocumentType.DELIVERY_ORDER) {
      this.normalizeDeliveryOrderContainers(dto);
    }
    await this.validateAndNormalizeParties(type, dto);
    return dto;
  }

  private normalizeBookingVolumes(dto: BookingConfirmationPreviewDto): void {
    const normalized = normalizeBookingCargoVolumePayload({
      cargoVolumes: dto.cargoVolumes,
      volume: dto.volume,
    });
    dto.cargoVolumes = normalized.cargoVolumes;
    dto.volume = normalized.volume;
  }

  /** Resolve each FF catalog ID independently and persist stable text snapshots. */
  private async resolveBookingCommodityLabel(
    dto: BookingConfirmationPreviewDto,
  ): Promise<void> {
    if (this.commodityTypesService) {
      const selection =
        await this.commodityTypesService.resolveFreightForwardingSelection(
          dto.commodityTypeId,
          dto.commodityId,
        );
      dto.commodityType =
        this.trimmed(dto.commodityType) ??
        selection.commodityTypeName ??
        undefined;
      dto.commodityName =
        this.trimmed(dto.commodityName) ?? selection.commodityName ?? undefined;
      if (!this.trimmed(dto.commodity)) {
        dto.commodity = this.formatCommodityDescription(
          dto.commodityName,
          dto.commodityType,
        );
      }
      return;
    }
    if (dto.commodityTypeId != null || dto.commodityId != null) {
      throw new BadRequestException(
        'Freight Forwarding Commodity catalogs are not configured',
      );
    }
  }

  /** Preserve stored descriptions; generate only when the snapshot is empty. */
  private async resolveArrivalNoticeDescriptionFromCommodity(
    dto: ArrivalNoticePreviewDto,
  ): Promise<void> {
    if (this.commodityTypesService) {
      const selection =
        await this.commodityTypesService.resolveFreightForwardingSelection(
          dto.commodityTypeId,
          dto.commodityId,
        );
      dto.commodityType =
        this.trimmed(dto.commodityType) ??
        selection.commodityTypeName ??
        undefined;
      dto.commodityName =
        this.trimmed(dto.commodityName) ?? selection.commodityName ?? undefined;
      if (!this.trimmed(dto.descriptionOfGoods)) {
        dto.descriptionOfGoods = this.formatCommodityDescription(
          dto.commodityName,
          dto.commodityType,
        );
      }
      return;
    }
    if (dto.commodityTypeId != null || dto.commodityId != null) {
      throw new BadRequestException(
        'Freight Forwarding Commodity catalogs are not configured',
      );
    }
  }

  private formatCommodityDescription(
    commodityName?: string,
    commodityType?: string,
  ): string | undefined {
    const commodity = this.trimmed(commodityName);
    const type = this.trimmed(commodityType);
    if (commodity && type) return `${commodity} IN ${type}`;
    return commodity ?? type;
  }

  private trimmed(value?: string): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }

  /** Prefer containers; migrate legacy cargoRows; derive cargoRows + volume for PDF. */
  private normalizeArrivalNoticeContainers(dto: ArrivalNoticePreviewDto): void {
    const containers = normalizeAnContainersPayload({
      containers: dto.containers,
      cargoRows: dto.cargoRows,
    });
    dto.containers = containers;
    dto.descriptionOfGoods = resolveDescriptionOfGoods({
      descriptionOfGoods: dto.descriptionOfGoods,
      containers,
    });
    dto.cargoRows = anContainersToCargoRows(containers, dto.descriptionOfGoods);
    const derivedVolume = anContainersToVolumeText(containers);
    if (derivedVolume) {
      dto.volume = derivedVolume;
    }
  }

  /**
   * Prefer containers; migrate legacy free-text cargo into rows; derive
   * blank-form GW / measurement from structured containers. Keep shipment
   * descriptionOfGoods as free-text (legacy fill from container note).
   * Migrate legacy `marksAndNumbers` → `shippingMark`.
   */
  private normalizeBillOfLadingContainers(dto: BillOfLadingPreviewDto): void {
    let containers = normalizeAnContainersPayload({
      containers: dto.containers,
    });
    if (containers.length === 0) {
      containers = legacyBlCargoTextToContainers({
        descriptionOfGoods: dto.descriptionOfGoods,
        grossWeight: dto.grossWeight,
        measurement: dto.measurement,
        numberAndKindOfPackages: dto.numberAndKindOfPackages,
      });
    }
    dto.containers = containers;
    dto.descriptionOfGoods = resolveDescriptionOfGoods({
      descriptionOfGoods: dto.descriptionOfGoods,
      containers,
    });
    dto.shippingMark = resolveBlShippingMark(dto);
    delete dto.marksAndNumbers;
    if (containers.some(containerRowHasCargo)) {
      const derived = anContainersToBlCargoTextFields(
        containers,
        dto.descriptionOfGoods,
      );
      dto.grossWeight = derived.grossWeight;
      dto.measurement = derived.measurement;
      dto.numberAndKindOfPackages = derived.numberAndKindOfPackages;
    }
  }

  /**
   * Drop removed `voyageNumber` before DTO whitelist validation. Fold any
   * leftover value into `oceanVessel` so old clients/payloads still load.
   */
  private foldLegacyBillOfLadingVoyage(
    payload: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!Object.prototype.hasOwnProperty.call(payload, 'voyageNumber')) {
      return payload;
    }
    const next = { ...payload };
    const vessel =
      typeof next.oceanVessel === 'string' ? next.oceanVessel.trim() : '';
    const voyage =
      typeof next.voyageNumber === 'string' ? next.voyageNumber.trim() : '';
    delete next.voyageNumber;
    if (
      vessel &&
      voyage &&
      !vessel.toLowerCase().includes(voyage.toLowerCase())
    ) {
      next.oceanVessel = `${vessel} / ${voyage}`;
    } else if (!vessel && voyage) {
      next.oceanVessel = voyage;
    } else if (vessel) {
      next.oceanVessel = vessel;
    }
    return next;
  }

  /**
   * DO cargo/container rows mirror BL: prefer `containers`; migrate legacy
   * `cargoRows`; re-derive `cargoRows` (PDF table input) from containers and
   * the (AN-synced) shipment `descriptionOfGoods`.
   */
  private normalizeDeliveryOrderContainers(dto: DeliveryOrderPreviewDto): void {
    const containers = normalizeAnContainersPayload({
      containers: dto.containers,
      cargoRows: dto.cargoRows,
    });
    dto.containers = containers;
    dto.descriptionOfGoods = (dto.descriptionOfGoods ?? '').trim();
    dto.cargoRows = anContainersToCargoRows(containers, dto.descriptionOfGoods);
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
        this.normalizeSameAsAn(payload);
      } else if (type === BookingDocumentType.BILL_OF_LADING) {
        this.normalizeSameAsBl(payload);
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
      /** Booking Confirmation To: name only. AN Agent stores full block; PDF trims. */
      nameOnly = false,
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
      (payload[textKey] as string | undefined) = nameOnly
        ? this.formatPartyName(partner)
        : this.formatParty(partner);
    };

    if (type === BookingDocumentType.BOOKING_CONFIRMATION) {
      normalize(
        payload.clientPartyId,
        'Client',
        'to',
        PartnerAdditionType.CUSTOMER,
        undefined,
        true,
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
      if (!payload.notifyPartySameAsConsignee) {
        normalize(
          payload.notifyPartyId,
          'Notify Party',
          'notifyAddress',
          PartnerAdditionType.NOTIFY_PARTY,
        );
      }
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
      this.normalizeSameAsAn(payload);
    } else if (type === BookingDocumentType.BILL_OF_LADING) {
      this.normalizeSameAsBl(payload);
    }
  }

  private normalizeSameAsAn(payload: PartyPayload): void {
    if (!payload.notifyPartySameAsConsignee) return;

    const consigneeId =
      typeof payload.consigneePartyId === 'number'
        ? payload.consigneePartyId
        : undefined;
    const consigneeText = (payload.consignee ?? '').trim();

    // Partner-linked: mirror id + (already normalized) address block.
    if (consigneeId != null) {
      payload.notifyPartyId = consigneeId;
      payload.notifyParty = payload.consignee ?? '';
      return;
    }

    // Free-text Consignee (no partner id): keep the flag and copy text.
    // Frontend allows Same as Consignee with text-only Consignee; clearing
    // the flag here made Save appear to uncheck the box after applyRecord.
    if (consigneeText.length > 0) {
      payload.notifyPartyId = undefined;
      payload.notifyParty = payload.consignee ?? '';
      return;
    }

    payload.notifyPartySameAsConsignee = false;
    payload.notifyPartyId = undefined;
    payload.notifyParty = '';
  }

  private normalizeSameAsBl(payload: PartyPayload): void {
    if (!payload.notifyPartySameAsConsignee) return;

    const consignedId =
      typeof payload.consigneePartyId === 'number'
        ? payload.consigneePartyId
        : undefined;
    const consignedText = (payload.consignedToOrderOf ?? '').trim();

    if (consignedId != null) {
      payload.notifyPartyId = consignedId;
      payload.notifyAddress = payload.consignedToOrderOf ?? '';
      return;
    }

    if (consignedText.length > 0) {
      payload.notifyPartyId = undefined;
      payload.notifyAddress = payload.consignedToOrderOf ?? '';
      return;
    }

    payload.notifyPartySameAsConsignee = false;
    payload.notifyPartyId = undefined;
    payload.notifyAddress = '';
  }

  private formatPartyName(partner: BookingPartner): string {
    return partner.name?.replace(/\s+/g, ' ').trim() ?? '';
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
}
