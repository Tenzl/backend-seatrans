import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { GalleryImage } from './entities/gallery-image.entity';
import { Commodity } from '../commodities/entities/commodity.entity';
import { CommodityType } from '../commodities/entities/commodity-type.entity';
import { Province } from '../provinces/entities/province.entity';
import { Port } from '../ports/entities/port.entity';
import {
  CreateGalleryImageWithTypeDto,
  GalleryImageDto,
  GalleryListWithTypeQueryDto,
  UpdateGalleryImageWithTypeDto,
} from './dto/gallery-image.dto';
import { GalleryCountsQueryDto } from './dto/gallery-counts-query.dto';
import { GalleryCommodityCountDto } from './dto/gallery-commodity-count.dto';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { buildPaginatedResponse } from '../../shared/dto/pagination.dto';
import { mapWithConcurrency } from '../../shared/utils/map-with-concurrency';
import { buildContainsLikePattern } from '../../shared/utils/like-pattern';

/** Parallel Cloudinary uploads per batch request (beyond PERF-01 request gate). */
const GALLERY_UPLOAD_CONCURRENCY = 3;

@Injectable()
export class GalleryService {
  private static readonly DEFAULT_LIMIT = 100;

  /** List projection — avoid selecting unrelated uploader columns. */
  private static readonly LIST_SELECT = [
    'gallery.id',
    'gallery.imageUrl',
    'gallery.cloudinaryPublicId',
    'gallery.uploadedAt',
    'gallery.uploadedById',
    'gallery.serviceTypeId',
    'gallery.commodityId',
    'gallery.commodityTypeId',
    'gallery.provinceCode',
    'gallery.createdAt',
    'gallery.updatedAt',
    'commodity.id',
    'commodity.displayName',
    'commodity.name',
    'commodityType.id',
    'commodityType.name',
    'province.id',
    'province.displayName',
    'province.name',
    'province.code',
    'port.id',
    'port.name',
  ] as const;

  constructor(
    @InjectRepository(GalleryImage)
    private readonly galleryRepository: Repository<GalleryImage>,
    @InjectRepository(Commodity)
    private readonly commodityRepository: Repository<Commodity>,
    @InjectRepository(Province)
    private readonly provinceRepository: Repository<Province>,
    @InjectRepository(Port)
    private readonly portRepository: Repository<Port>,
    private readonly cloudinaryService: CloudinaryService,
    private readonly dataSource: DataSource,
  ) {}

  async getPublicPaged(query: GalleryListWithTypeQueryDto) {
    const page = Math.max(0, Number(query.page ?? 0));
    const size = this.sanitizeLimit(
      Number(query.size ?? GalleryService.DEFAULT_LIMIT),
    );

    const qb = this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoin('gallery.commodity', 'commodity')
      .leftJoin('gallery.commodityType', 'commodityType')
      .leftJoin('gallery.province', 'province')
      .leftJoin('gallery.port', 'port')
      .select([...GalleryService.LIST_SELECT])
      .orderBy('gallery.uploadedAt', 'DESC')
      .addOrderBy('gallery.id', 'DESC');

    if (query.serviceTypeId) {
      qb.andWhere('gallery.service_type_id = :serviceTypeId', {
        serviceTypeId: query.serviceTypeId,
      });
    }
    if (query.commodityId) {
      qb.andWhere('commodity.id = :commodityId', {
        commodityId: query.commodityId,
      });
    }
    if (query.commodityTypeId) {
      qb.andWhere('gallery.commodity_type_id = :commodityTypeId', {
        commodityTypeId: query.commodityTypeId,
      });
    }
    if (query.provinceId) {
      qb.andWhere('province.id = :provinceId', {
        provinceId: query.provinceId,
      });
    }
    if (query.portId) {
      qb.andWhere('port.id = :portId', { portId: query.portId });
    }

    const normalizedQuery = query.q?.trim();
    if (normalizedQuery) {
      qb.andWhere(
        "(LOWER(commodity.display_name) LIKE :q ESCAPE E'\\\\' OR LOWER(port.name) LIKE :q ESCAPE E'\\\\' OR LOWER(province.name) LIKE :q ESCAPE E'\\\\')",
        { q: buildContainsLikePattern(normalizedQuery) },
      );
    }

    qb.skip(page * size).take(size);
    const [rows, total] = await qb.getManyAndCount();
    const content = rows.map((item) => this.toDto(item));
    return buildPaginatedResponse(content, total, page, size);
  }

  async getPublicImages(
    limit = GalleryService.DEFAULT_LIMIT,
  ): Promise<GalleryImageDto[]> {
    const rows = await this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoin('gallery.commodity', 'commodity')
      .leftJoin('gallery.commodityType', 'commodityType')
      .leftJoin('gallery.province', 'province')
      .leftJoin('gallery.port', 'port')
      .select([...GalleryService.LIST_SELECT])
      .orderBy('gallery.uploadedAt', 'DESC')
      .take(this.sanitizeLimit(limit))
      .getMany();

    return rows.map((item) => this.toDto(item));
  }

  async getAdminImages(query: GalleryListWithTypeQueryDto) {
    return this.getPublicPaged(query);
  }

  /**
   * One GROUP BY query for cargo-filter badges — replaces N×(list + size=1) fan-out.
   */
  async getCommodityCounts(
    query: GalleryCountsQueryDto,
  ): Promise<GalleryCommodityCountDto[]> {
    const qb = this.galleryRepository
      .createQueryBuilder('gallery')
      .select('gallery.commodity_id', 'commodityId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('gallery.commodity_id');

    if (query.serviceTypeId) {
      qb.andWhere('gallery.service_type_id = :serviceTypeId', {
        serviceTypeId: query.serviceTypeId,
      });
    }
    if (query.provinceId) {
      qb.andWhere('gallery.province_id = :provinceId', {
        provinceId: query.provinceId,
      });
    }
    if (query.portId) {
      qb.andWhere('gallery.port_id = :portId', { portId: query.portId });
    }

    const rows = await qb.getRawMany<{
      commodityId: string | number;
      count: string | number;
    }>();

    return rows.map((row) => ({
      commodityId: Number(row.commodityId),
      count: Number(row.count),
    }));
  }

  async getAdminImagesAll(
    limit = GalleryService.DEFAULT_LIMIT,
  ): Promise<GalleryImageDto[]> {
    return this.getPublicImages(limit);
  }

  async getById(id: number): Promise<GalleryImageDto> {
    const image = await this.galleryRepository.findOne({
      where: { id },
      relations: {
        commodity: true,
        commodityType: true,
        province: true,
        port: true,
      },
    });
    if (!image) {
      throw new NotFoundException('Gallery image not found');
    }
    return this.toDto(image);
  }

  async saveImageFromUrl(
    dto: CreateGalleryImageWithTypeDto,
    uploadedById: number,
  ): Promise<GalleryImageDto> {
    if (!dto.imageUrl?.trim()) {
      throw new BadRequestException('imageUrl is required');
    }

    const image = await this.createRecord(
      dto.imageUrl.trim(),
      null,
      uploadedById,
      dto.serviceTypeId,
      dto.commodityId,
      dto.commodityTypeId ?? null,
      dto.provinceId,
      dto.portId,
    );

    return this.toDto(image);
  }

  async uploadSingle(
    file: Express.Multer.File | { buffer?: Buffer; path?: string },
    payload: CreateGalleryImageWithTypeDto,
    uploadedById: number,
  ): Promise<GalleryImageDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const refs = await this.resolveUploadRefs(payload);
    const upload = await this.cloudinaryService.uploadImage(file, 'gallery');
    const image = await this.createRecordWithRefs(
      upload.secureUrl,
      upload.publicId,
      uploadedById,
      payload.serviceTypeId,
      refs,
    );

    return this.toDto(image);
  }

  async uploadMultiple(
    files: Array<Express.Multer.File | { buffer?: Buffer; path?: string }>,
    payload: CreateGalleryImageWithTypeDto,
    uploadedById: number,
  ): Promise<GalleryImageDto[]> {
    if (!files?.length) {
      throw new BadRequestException('files are required');
    }

    // Resolve FK metadata once for the whole batch (PERF-02).
    const refs = await this.resolveUploadRefs(payload);

    return mapWithConcurrency(
      files,
      GALLERY_UPLOAD_CONCURRENCY,
      async (file) => {
        const upload = await this.cloudinaryService.uploadImage(
          file,
          'gallery',
        );
        const image = await this.createRecordWithRefs(
          upload.secureUrl,
          upload.publicId,
          uploadedById,
          payload.serviceTypeId,
          refs,
        );
        return this.toDto(image);
      },
    );
  }

  async update(
    id: number,
    dto: UpdateGalleryImageWithTypeDto,
  ): Promise<GalleryImageDto> {
    const image = await this.galleryRepository.findOne({
      where: { id },
      relations: {
        commodity: true,
        commodityType: true,
        province: true,
        port: true,
      },
    });
    if (!image) {
      throw new NotFoundException('Gallery image not found');
    }

    const serviceTypeId = dto.serviceTypeId ?? image.serviceTypeId;
    if (dto.serviceTypeId !== undefined || dto.commodityId !== undefined) {
      image.commodity = await this.requireCommodity(
        dto.commodityId ?? image.commodityId,
        serviceTypeId,
      );
      image.commodityId = image.commodity.id;
    }
    if (dto.serviceTypeId !== undefined || dto.commodityTypeId !== undefined) {
      const commodityTypeId =
        dto.commodityTypeId === undefined
          ? image.commodityTypeId
          : dto.commodityTypeId;
      image.commodityType =
        commodityTypeId == null
          ? null
          : await this.requireCommodityType(commodityTypeId, serviceTypeId);
      image.commodityTypeId = image.commodityType?.id ?? null;
    }
    image.serviceTypeId = serviceTypeId;
    if (dto.provinceId !== undefined) {
      image.province = await this.requireProvince(dto.provinceId);
    }
    if (dto.portId !== undefined) {
      image.port = await this.requirePort(dto.portId);
    }

    const updated = await this.galleryRepository.save(image);
    return this.toDto(updated);
  }

  async delete(id: number): Promise<void> {
    const image = await this.galleryRepository.findOne({ where: { id } });
    if (!image) {
      throw new NotFoundException('Gallery image not found');
    }

    await this.cloudinaryService.deleteByPublicId(
      image.cloudinaryPublicId ?? '',
    );
    await this.galleryRepository.delete(id);
  }

  private async createRecord(
    imageUrl: string,
    cloudinaryPublicId: string | null,
    uploadedById: number,
    serviceTypeId: number,
    commodityId: number,
    commodityTypeId: number | null,
    provinceId: number,
    portId: number,
  ): Promise<GalleryImage> {
    const refs = await this.resolveUploadRefs({
      commodityId,
      commodityTypeId,
      provinceId,
      portId,
      serviceTypeId,
    });
    return this.createRecordWithRefs(
      imageUrl,
      cloudinaryPublicId,
      uploadedById,
      serviceTypeId,
      refs,
    );
  }

  private async resolveUploadRefs(payload: {
    commodityId: number;
    commodityTypeId?: number | null;
    provinceId: number;
    portId: number;
    serviceTypeId: number;
  }): Promise<{
    commodity: Commodity;
    commodityType: CommodityType | null;
    province: Province;
    port: Port;
  }> {
    const [commodity, commodityType, province, port] = await Promise.all([
      this.requireCommodity(payload.commodityId, payload.serviceTypeId),
      payload.commodityTypeId == null
        ? null
        : this.requireCommodityType(
            payload.commodityTypeId,
            payload.serviceTypeId,
          ),
      this.requireProvince(payload.provinceId),
      this.requirePort(payload.portId),
    ]);
    return { commodity, commodityType, province, port };
  }

  private async createRecordWithRefs(
    imageUrl: string,
    cloudinaryPublicId: string | null,
    uploadedById: number,
    serviceTypeId: number,
    refs: {
      commodity: Commodity;
      commodityType: CommodityType | null;
      province: Province;
      port: Port;
    },
  ): Promise<GalleryImage> {
    const image = this.galleryRepository.create({
      imageUrl,
      cloudinaryPublicId,
      uploadedById,
      serviceTypeId,
      commodity: refs.commodity,
      commodityId: refs.commodity.id,
      commodityType: refs.commodityType,
      commodityTypeId: refs.commodityType?.id ?? null,
      province: refs.province,
      port: refs.port,
      provinceCode:
        refs.province.code != null ? String(refs.province.code) : null,
    });

    return this.galleryRepository.save(image);
  }

  private async requireCommodity(
    id: number,
    serviceTypeId: number,
  ): Promise<Commodity> {
    const commodity = await this.commodityRepository.findOne({
      where: { id },
    });
    if (!commodity) {
      throw new BadRequestException('Commodity not found');
    }
    if (commodity.serviceTypeId !== serviceTypeId) {
      throw new BadRequestException(
        'Commodity does not belong to the submitted Service',
      );
    }
    return commodity;
  }

  private async requireCommodityType(
    id: number,
    serviceTypeId: number,
  ): Promise<CommodityType> {
    const commodityType = await this.dataSource
      .getRepository(CommodityType)
      .findOne({ where: { id } });
    if (!commodityType) {
      throw new BadRequestException('Commodity Type not found');
    }
    if (commodityType.serviceTypeId !== serviceTypeId) {
      throw new BadRequestException(
        'Commodity Type does not belong to the submitted Service',
      );
    }
    return commodityType;
  }

  private async requireProvince(id: number): Promise<Province> {
    const province = await this.provinceRepository.findOne({ where: { id } });
    if (!province) {
      throw new BadRequestException('Province not found');
    }
    return province;
  }

  private async requirePort(id: number): Promise<Port> {
    const port = await this.portRepository.findOne({ where: { id } });
    if (!port) {
      throw new BadRequestException('Port not found');
    }
    return port;
  }

  private toDto(item: GalleryImage): GalleryImageDto {
    return {
      id: item.id,
      imageUrl: item.imageUrl,
      cloudinaryPublicId: item.cloudinaryPublicId,
      uploadedAt: item.uploadedAt,
      uploadedById: item.uploadedById,
      serviceTypeId: item.serviceTypeId,
      commodityId: item.commodity?.id ?? item.commodityId ?? 0,
      commodityName:
        item.commodity?.displayName ?? item.commodity?.name ?? 'Unknown',
      commodityTypeId: item.commodityType?.id ?? item.commodityTypeId ?? null,
      commodityTypeName: item.commodityType?.name ?? null,
      provinceId: item.province?.id ?? null,
      provinceName: item.province?.displayName ?? item.province?.name ?? null,
      portId: item.port?.id ?? null,
      portName: item.port?.name ?? null,
      provinceCode:
        item.provinceCode ??
        (item.province?.code != null ? String(item.province.code) : null),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
  }

  private sanitizeLimit(size: number): number {
    if (!Number.isFinite(size) || size <= 0) {
      return GalleryService.DEFAULT_LIMIT;
    }
    return Math.min(size, GalleryService.DEFAULT_LIMIT);
  }
}
