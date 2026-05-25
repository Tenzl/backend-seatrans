import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GalleryImage } from './entities/gallery-image.entity';
import { Commodity } from '../commodities/entities/commodity.entity';
import { Province } from '../provinces/entities/province.entity';
import { Port } from '../ports/entities/port.entity';
import { GalleryImageDto } from './dto/gallery-image.dto';
import { CreateGalleryImageDto } from './dto/create-gallery-image.dto';
import { UpdateGalleryImageDto } from './dto/update-gallery-image.dto';
import { GalleryListQueryDto } from './dto/gallery-list-query.dto';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { buildPaginatedResponse } from '../../shared/dto/pagination.dto';

@Injectable()
export class GalleryService {
  private static readonly DEFAULT_LIMIT = 100;

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
  ) {}

  async getPublicPaged(query: GalleryListQueryDto) {
    const page = Math.max(0, Number(query.page ?? 0));
    const size = this.sanitizeLimit(Number(query.size ?? GalleryService.DEFAULT_LIMIT));

    const qb = this.galleryRepository
      .createQueryBuilder('gallery')
      .leftJoinAndSelect('gallery.commodity', 'commodity')
      .leftJoinAndSelect('gallery.province', 'province')
      .leftJoinAndSelect('gallery.port', 'port')
      .orderBy('gallery.uploadedAt', 'DESC');

    if (query.serviceTypeId) {
      qb.andWhere('gallery.service_type_id = :serviceTypeId', { serviceTypeId: query.serviceTypeId });
    }
    if (query.commodityId) {
      qb.andWhere('commodity.id = :commodityId', { commodityId: query.commodityId });
    }
    if (query.provinceId) {
      qb.andWhere('province.id = :provinceId', { provinceId: query.provinceId });
    }
    if (query.portId) {
      qb.andWhere('port.id = :portId', { portId: query.portId });
    }

    const normalizedQuery = query.q?.trim();
    if (normalizedQuery) {
      qb.andWhere(
        '(LOWER(commodity.display_name) LIKE :q OR LOWER(port.name) LIKE :q OR LOWER(province.name) LIKE :q)',
        { q: `%${normalizedQuery.toLowerCase()}%` },
      );
      const rows = await qb.getMany();
      const content = rows.map((item) => this.toDto(item));
      return buildPaginatedResponse(content, content.length, 0, content.length || 1);
    }

    qb.skip(page * size).take(size);
    const [rows, total] = await qb.getManyAndCount();
    const content = rows.map((item) => this.toDto(item));
    return buildPaginatedResponse(content, total, page, size);
  }

  async getPublicImages(limit = GalleryService.DEFAULT_LIMIT): Promise<GalleryImageDto[]> {
    const rows = await this.galleryRepository.find({
      relations: { commodity: true, province: true, port: true },
      order: { uploadedAt: 'DESC' },
      take: this.sanitizeLimit(limit),
    });

    return rows.map((item) => this.toDto(item));
  }

  async getAdminImages(query: GalleryListQueryDto) {
    return this.getPublicPaged(query);
  }

  async getAdminImagesAll(limit = GalleryService.DEFAULT_LIMIT): Promise<GalleryImageDto[]> {
    return this.getPublicImages(limit);
  }

  async getById(id: number): Promise<GalleryImageDto> {
    const image = await this.galleryRepository.findOne({
      where: { id },
      relations: { commodity: true, province: true, port: true },
    });
    if (!image) {
      throw new NotFoundException('Gallery image not found');
    }
    return this.toDto(image);
  }

  async saveImageFromUrl(dto: CreateGalleryImageDto, uploadedById: number): Promise<GalleryImageDto> {
    if (!dto.imageUrl?.trim()) {
      throw new BadRequestException('imageUrl is required');
    }

    const image = await this.createRecord(
      dto.imageUrl.trim(),
      null,
      uploadedById,
      dto.serviceTypeId,
      dto.commodityId,
      dto.provinceId,
      dto.portId,
    );

    return this.toDto(image);
  }

  async uploadSingle(
    file: { buffer: Buffer },
    payload: CreateGalleryImageDto,
    uploadedById: number,
  ): Promise<GalleryImageDto> {
    if (!file) {
      throw new BadRequestException('file is required');
    }

    const upload = await this.cloudinaryService.uploadBuffer(file.buffer, 'gallery');
    const image = await this.createRecord(
      upload.secureUrl,
      upload.publicId,
      uploadedById,
      payload.serviceTypeId,
      payload.commodityId,
      payload.provinceId,
      payload.portId,
    );

    return this.toDto(image);
  }

  async uploadMultiple(
    files: Array<{ buffer: Buffer }>,
    payload: CreateGalleryImageDto,
    uploadedById: number,
  ): Promise<GalleryImageDto[]> {
    if (!files?.length) {
      throw new BadRequestException('files are required');
    }

    const results: GalleryImageDto[] = [];
    for (const file of files) {
      const upload = await this.cloudinaryService.uploadBuffer(file.buffer, 'gallery');
      const image = await this.createRecord(
        upload.secureUrl,
        upload.publicId,
        uploadedById,
        payload.serviceTypeId,
        payload.commodityId,
        payload.provinceId,
        payload.portId,
      );
      results.push(this.toDto(image));
    }

    return results;
  }

  async update(id: number, dto: UpdateGalleryImageDto): Promise<GalleryImageDto> {
    const image = await this.galleryRepository.findOne({
      where: { id },
      relations: { commodity: true, province: true, port: true },
    });
    if (!image) {
      throw new NotFoundException('Gallery image not found');
    }

    if (dto.serviceTypeId !== undefined) {
      image.serviceTypeId = dto.serviceTypeId;
    }
    if (dto.commodityId !== undefined) {
      image.commodity = await this.requireCommodity(dto.commodityId);
      image.commodityId = image.commodity.id;
    }
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

    await this.cloudinaryService.deleteByPublicId(image.cloudinaryPublicId ?? '');
    await this.galleryRepository.delete(id);
  }

  private async createRecord(
    imageUrl: string,
    cloudinaryPublicId: string | null,
    uploadedById: number,
    serviceTypeId: number,
    commodityId: number,
    provinceId: number,
    portId: number,
  ): Promise<GalleryImage> {
    const commodity = await this.requireCommodity(commodityId);
    const province = await this.requireProvince(provinceId);
    const port = await this.requirePort(portId);

    const image = this.galleryRepository.create({
      imageUrl,
      cloudinaryPublicId,
      uploadedById,
      serviceTypeId,
      commodity,
      commodityId: commodity.id,
      province,
      port,
      provinceCode: province.code != null ? String(province.code) : null,
    });

    return this.galleryRepository.save(image);
  }

  private async requireCommodity(id: number): Promise<Commodity> {
    const commodity = await this.commodityRepository.findOne({ where: { id, isActive: true } });
    if (!commodity) {
      throw new BadRequestException('Commodity not found');
    }
    return commodity;
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
      commodityName: item.commodity?.displayName ?? item.commodity?.name ?? 'Unknown',
      provinceId: item.province?.id ?? null,
      provinceName: item.province?.displayName ?? item.province?.name ?? null,
      portId: item.port?.id ?? null,
      portName: item.port?.name ?? null,
      provinceCode:
        item.provinceCode ?? (item.province?.code != null ? String(item.province.code) : null),
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
