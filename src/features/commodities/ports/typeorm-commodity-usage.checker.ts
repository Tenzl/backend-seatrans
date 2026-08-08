import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GalleryImage } from '../../gallery/entities/gallery-image.entity';
import { FreightForwardingInquiryEntity } from '../../inquiry/entities/freight-forwarding-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../../inquiry/entities/shipping-agency-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../../inquiry/entities/total-logistics-inquiry.entity';
import { formatCommodityInGroupLabel } from '../commodity-display-label';
import type {
  CommodityUsageChecker,
  CommodityUsageIdentity,
} from './commodity-usage.checker';

/**
 * Tables that may store commodity id / display strings in JSON payload.
 * Keep in sync with booking-document entity table names.
 */
const BOOKING_PAYLOAD_TABLES = [
  'booking_records',
  'arrival_notice_records',
  'delivery_order_records',
  'bill_of_lading_records',
] as const;

@Injectable()
export class TypeOrmCommodityUsageChecker implements CommodityUsageChecker {
  constructor(
    @InjectRepository(GalleryImage)
    private readonly galleryImageRepository: Repository<GalleryImage>,
    @InjectRepository(ShippingAgencyInquiryEntity)
    private readonly shippingAgencyInquiryRepository: Repository<ShippingAgencyInquiryEntity>,
    @InjectRepository(FreightForwardingInquiryEntity)
    private readonly freightForwardingInquiryRepository: Repository<FreightForwardingInquiryEntity>,
    @InjectRepository(TotalLogisticsInquiryEntity)
    private readonly totalLogisticsInquiryRepository: Repository<TotalLogisticsInquiryEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async isInUse(commodity: CommodityUsageIdentity): Promise<boolean> {
    const galleryCount = await this.galleryImageRepository.count({
      where: { commodityId: commodity.id },
    });
    if (galleryCount > 0) {
      return true;
    }

    if (await this.isReferencedInBookingPayloads(commodity)) {
      return true;
    }

    const nameKeys = this.usageNameKeys(commodity);
    if (nameKeys.length === 0) {
      return false;
    }

    const shippingCount = await this.shippingAgencyInquiryRepository
      .createQueryBuilder('inquiry')
      .where('LOWER(inquiry.cargo_name) IN (:...names)', { names: nameKeys })
      .getCount();
    if (shippingCount > 0) {
      return true;
    }

    const freightCount = await this.freightForwardingInquiryRepository
      .createQueryBuilder('inquiry')
      .where('LOWER(inquiry.cargo_name) IN (:...names)', { names: nameKeys })
      .getCount();
    if (freightCount > 0) {
      return true;
    }

    const logisticsCount = await this.totalLogisticsInquiryRepository
      .createQueryBuilder('inquiry')
      .where('LOWER(inquiry.cargo_name) IN (:...names)', { names: nameKeys })
      .getCount();
    return logisticsCount > 0;
  }

  private async isReferencedInBookingPayloads(
    commodity: CommodityUsageIdentity,
  ): Promise<boolean> {
    const nameKeys = this.usageNameKeys(commodity);
    const commodityLabel = commodity.displayName || commodity.name;
    const displayLabel = commodity.groupName
      ? formatCommodityInGroupLabel(
          commodityLabel,
          commodity.groupName,
        ).toLowerCase()
      : '';

    for (const table of BOOKING_PAYLOAD_TABLES) {
      const rows = await this.dataSource.query(
        `
        SELECT 1
        FROM ${table}
        WHERE deleted_at IS NULL
          AND (
            (payload->>'commodityId') ~ '^[0-9]+$'
              AND (payload->>'commodityId')::int = $1
            OR (
              cardinality($2::text[]) > 0
              AND LOWER(COALESCE(payload->>'commodity', '')) = ANY($2::text[])
            )
            OR (
              cardinality($2::text[]) > 0
              AND LOWER(COALESCE(payload->>'descriptionOfGoods', '')) = ANY($2::text[])
            )
            OR (
              $3 <> ''
              AND LOWER(COALESCE(payload->>'commodity', '')) = $3
            )
            OR (
              $3 <> ''
              AND LOWER(COALESCE(payload->>'descriptionOfGoods', '')) = $3
            )
          )
        LIMIT 1
        `,
        [commodity.id, nameKeys, displayLabel],
      );
      if (Array.isArray(rows) && rows.length > 0) {
        return true;
      }
    }
    return false;
  }

  private usageNameKeys(commodity: CommodityUsageIdentity): string[] {
    return [...new Set([commodity.name, commodity.displayName])]
      .map((value) => value?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value));
  }
}
