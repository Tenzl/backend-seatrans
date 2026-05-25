import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BookingShipping } from '../entities/booking-shipping.entity';
import { BookingPartner } from '../entities/booking-partner.entity';
import { Port } from '../../ports/entities/port.entity';
import {
  BookingShippingResponseDto,
  BookingTransitLegResponseDto,
} from '../dto/booking-shipping-response.dto';
import {
  BookingTransitLegRequestDto,
  UpsertBookingShippingDto,
} from '../dto/upsert-booking-shipping.dto';
import { BookingTransitPort } from '../entities/booking-transit-port.entity';

@Injectable()
export class BookingShippingService {
  constructor(
    @InjectRepository(BookingShipping)
    private readonly shippingRepository: Repository<BookingShipping>,
    @InjectRepository(BookingPartner)
    private readonly partnerRepository: Repository<BookingPartner>,
    @InjectRepository(Port)
    private readonly portRepository: Repository<Port>,
  ) {}

  async getByPartnerId(partnerId: number): Promise<BookingShippingResponseDto> {
    await this.requirePartner(partnerId);

    const row = await this.getShippingByPartnerId(partnerId);
    if (!row) {
      return {
        bookingPartnerId: partnerId,
        bookingNo: null,
        bookingTo: null,
        bookingNumberReference: null,
        bookingNote: null,
        serviceMode: null,
        placeOfReceiptPortId: null,
        portOfLoadingPortId: null,
        pickUp: null,
        etd: null,
        dateOfPickUp: null,
        dropOffWarehouse: null,
        feederVessel: null,
        feederVoyage: null,
        motherVessel: null,
        motherVoyage: null,
        provider: null,
        carrier: null,
        cyCutOff: null,
        siCutOff: null,
        vgmCutOff: null,
        gateIn: null,
        temp: null,
        vent: null,
        freightTerms: null,
        portOfDischargePortId: null,
        placeOfDeliveryPortId: null,
        finalDestinationPortId: null,
        eta: null,
        volume: null,
        cargoType: null,
        cargoName: null,
        grossWeightKgs: null,
        measurementCbm: null,
        contact: null,
        specialRemark: null,
        dateOfCreation: null,
        termsAndConditions: null,
        transitLegs: [],
      };
    }

    return this.toResponse(row);
  }

  async upsert(
    partnerId: number,
    dto: UpsertBookingShippingDto,
  ): Promise<BookingShippingResponseDto> {
    this.validateRequired(dto);

    const partner = await this.requirePartner(partnerId);
    const row =
      (await this.getShippingByPartnerId(partnerId)) ??
      this.shippingRepository.create({
        bookingPartner: partner,
        transitPorts: [],
      });

    row.bookingPartner = partner;

    await this.applyScalars(row, dto);
    await this.replaceTransitLegs(row, dto.transitLegs ?? []);

    await this.shippingRepository.save(row);

    const saved = await this.getShippingByPartnerId(partnerId);
    if (!saved) {
      throw new BadRequestException('Failed to save booking shipping');
    }

    return this.toResponse(saved);
  }

  private async getShippingByPartnerId(partnerId: number): Promise<BookingShipping | null> {
    return this.shippingRepository.findOne({
      where: { bookingPartner: { id: partnerId } },
      relations: {
        bookingPartner: true,
        transitPorts: {
          port: true,
        },
        placeOfReceiptPort: true,
        portOfLoadingPort: true,
        portOfDischargePort: true,
        placeOfDeliveryPort: true,
        finalDestinationPort: true,
      },
      order: {
        transitPorts: {
          sortOrder: 'ASC',
        },
      },
    });
  }

  private async requirePartner(partnerId: number): Promise<BookingPartner> {
    const partner = await this.partnerRepository.findOne({ where: { id: partnerId } });
    if (!partner) {
      throw new NotFoundException('Partner not found');
    }
    return partner;
  }

  private validateRequired(dto: UpsertBookingShippingDto): void {
    if (!dto.bookingNo?.trim()) {
      throw new BadRequestException('Booking No. is required');
    }
    if (dto.placeOfReceiptPortId == null) {
      throw new BadRequestException('Place of receipt port is required');
    }
    if (dto.placeOfDeliveryPortId == null) {
      throw new BadRequestException('Place of delivery port is required');
    }
  }

  private async applyScalars(row: BookingShipping, dto: UpsertBookingShippingDto): Promise<void> {
    row.bookingNo = this.trimToNull(dto.bookingNo);
    row.bookingTo = this.trimToNull(dto.bookingTo);
    row.bookingNumberReference = this.trimToNull(dto.bookingNumberReference);
    row.bookingNote = this.trimToNull(dto.bookingNote);
    row.serviceMode = this.trimToNull(dto.serviceMode);

    row.placeOfReceiptPort = await this.resolvePort(dto.placeOfReceiptPortId);
    row.portOfLoadingPort = await this.resolvePort(dto.portOfLoadingPortId);
    row.pickUp = this.trimToNull(dto.pickUp);
    row.etd = this.toDateTime(dto.etd);
    row.dateOfPickUp = this.toDateOnly(dto.dateOfPickUp);
    row.dropOffWarehouse = this.trimToNull(dto.dropOffWarehouse);
    row.feederVessel = this.trimToNull(dto.feederVessel);
    row.feederVoyage = this.trimToNull(dto.feederVoyage);
    row.motherVessel = this.trimToNull(dto.motherVessel);
    row.motherVoyage = this.trimToNull(dto.motherVoyage);
    row.provider = this.trimToNull(dto.provider);
    row.carrier = this.trimToNull(dto.carrier);
    row.cyCutOff = this.toDateTime(dto.cyCutOff);
    row.siCutOff = this.toDateTime(dto.siCutOff);
    row.vgmCutOff = this.toDateTime(dto.vgmCutOff);
    row.gateIn = this.toDateTime(dto.gateIn);
    row.temp = this.toNumericString(dto.temp);
    row.vent = this.trimToNull(dto.vent);
    row.freightTerms = this.trimToNull(dto.freightTerms);

    row.portOfDischargePort = await this.resolvePort(dto.portOfDischargePortId);
    row.placeOfDeliveryPort = await this.resolvePort(dto.placeOfDeliveryPortId);
    row.finalDestinationPort = await this.resolvePort(dto.finalDestinationPortId);
    row.eta = this.toDateTime(dto.eta);

    row.volume = this.trimToNull(dto.volume);
    row.cargoType = this.trimToNull(dto.cargoType);
    row.cargoName = this.trimToNull(dto.cargoName);
    row.grossWeightKgs = this.toNumericString(dto.grossWeightKgs);
    row.measurementCbm = this.toNumericString(dto.measurementCbm);

    row.contact = this.trimToNull(dto.contact);
    row.specialRemark = this.trimToNull(dto.specialRemark);
    row.dateOfCreation = this.toDateOnly(dto.dateOfCreation);
    row.termsAndConditions = this.trimToNull(dto.termsAndConditions);
  }

  private async replaceTransitLegs(
    row: BookingShipping,
    transitLegs: BookingTransitLegRequestDto[],
  ): Promise<void> {
    const nextTransitPorts: BookingTransitPort[] = [];

    for (const leg of transitLegs) {
      if (leg.portId == null || leg.sortOrder == null) {
        throw new BadRequestException('Each transit leg requires portId and sortOrder');
      }

      const port = await this.resolveRequiredPort(leg.portId);
      const transitPort = new BookingTransitPort();
      transitPort.bookingShipping = row;
      transitPort.port = port;
      transitPort.sortOrder = leg.sortOrder;
      transitPort.eta = this.toDateTime(leg.eta);
      transitPort.etd = this.toDateTime(leg.etd);
      nextTransitPorts.push(transitPort);
    }

    row.transitPorts = nextTransitPorts;
  }

  private async resolvePort(id?: number): Promise<Port | null> {
    if (id == null) {
      return null;
    }

    const port = await this.portRepository.findOne({ where: { id } });
    if (!port) {
      throw new BadRequestException(`Port not found: ${id}`);
    }

    return port;
  }

  private async resolveRequiredPort(id: number): Promise<Port> {
    const port = await this.resolvePort(id);
    if (!port) {
      throw new BadRequestException(`Port not found: ${id}`);
    }
    return port;
  }

  private toResponse(row: BookingShipping): BookingShippingResponseDto {
    return {
      id: row.id,
      bookingPartnerId: row.bookingPartner.id,
      bookingNo: row.bookingNo,
      bookingTo: row.bookingTo,
      bookingNumberReference: row.bookingNumberReference,
      bookingNote: row.bookingNote,
      serviceMode: row.serviceMode,
      placeOfReceiptPortId: row.placeOfReceiptPort?.id ?? null,
      portOfLoadingPortId: row.portOfLoadingPort?.id ?? null,
      pickUp: row.pickUp,
      etd: row.etd,
      dateOfPickUp: row.dateOfPickUp,
      dropOffWarehouse: row.dropOffWarehouse,
      feederVessel: row.feederVessel,
      feederVoyage: row.feederVoyage,
      motherVessel: row.motherVessel,
      motherVoyage: row.motherVoyage,
      provider: row.provider,
      carrier: row.carrier,
      cyCutOff: row.cyCutOff,
      siCutOff: row.siCutOff,
      vgmCutOff: row.vgmCutOff,
      gateIn: row.gateIn,
      temp: row.temp,
      vent: row.vent,
      freightTerms: row.freightTerms,
      portOfDischargePortId: row.portOfDischargePort?.id ?? null,
      placeOfDeliveryPortId: row.placeOfDeliveryPort?.id ?? null,
      finalDestinationPortId: row.finalDestinationPort?.id ?? null,
      eta: row.eta,
      volume: row.volume,
      cargoType: row.cargoType,
      cargoName: row.cargoName,
      grossWeightKgs: row.grossWeightKgs,
      measurementCbm: row.measurementCbm,
      contact: row.contact,
      specialRemark: row.specialRemark,
      dateOfCreation: row.dateOfCreation,
      termsAndConditions: row.termsAndConditions,
      transitLegs: this.toTransitLegResponses(row.transitPorts),
    };
  }

  private toTransitLegResponses(rows: BookingTransitPort[]): BookingTransitLegResponseDto[] {
    return (rows ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((row) => ({
        id: row.id,
        portId: row.port.id,
        sortOrder: row.sortOrder,
        eta: row.eta,
        etd: row.etd,
      }));
  }

  private trimToNull(value?: string): string | null {
    if (value == null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toDateTime(value?: string): Date | null {
    if (!value) {
      return null;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toDateOnly(value?: string): string | null {
    if (!value) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private toNumericString(value?: number): string | null {
    if (value == null || Number.isNaN(value)) {
      return null;
    }

    return String(value);
  }
}
