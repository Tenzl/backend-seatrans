import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Office } from './entities/office.entity';
import { Province } from '../provinces/entities/province.entity';
import { CreateOfficeDto } from './dto/create-office.dto';
import { OfficeDto } from './dto/office.dto';
import {
  formatCoordinate,
  isShortGoogleMapsUrl,
  parseGoogleMapsUrl,
} from './utils/parse-google-maps-url';

@Injectable()
export class OfficesService {
  private static readonly DEFAULT_LIMIT = 100;

  constructor(
    @InjectRepository(Office)
    private readonly officeRepository: Repository<Office>,
    @InjectRepository(Province)
    private readonly provinceRepository: Repository<Province>,
  ) {}

  async getAll(limit = OfficesService.DEFAULT_LIMIT): Promise<OfficeDto[]> {
    const rows = await this.officeRepository.find({
      relations: { province: true },
      order: { createdAt: 'DESC' },
    });

    return rows.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
  }

  async getActive(limit = OfficesService.DEFAULT_LIMIT): Promise<OfficeDto[]> {
    const rows = await this.officeRepository.find({
      where: { isActive: true },
      relations: { province: true },
      order: { createdAt: 'DESC' },
    });

    return rows.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
  }

  async create(dto: CreateOfficeDto): Promise<OfficeDto> {
    const province = await this.requireProvince(dto.provinceId);
    const name = dto.name?.trim();
    const address = dto.address?.trim();
    if (!name || !address) {
      throw new BadRequestException('name and address are required');
    }

    const { mapUrl, latitude, longitude } = this.resolveMapLocation(dto.mapUrl);

    const row = this.officeRepository.create({
      province,
      name,
      address,
      mapUrl,
      latitude,
      longitude,
      managerName: dto.managerName?.trim() || null,
      managerTitle: dto.managerTitle?.trim() || null,
      managerMobile: dto.managerMobile?.trim() || null,
      managerEmail: dto.managerEmail?.trim() || null,
      isHeadquarter: dto.isHeadquarter ?? false,
      isActive: dto.isActive ?? true,
    });

    const saved = await this.officeRepository.save(row);
    return this.toDto(saved);
  }

  async update(id: number, dto: CreateOfficeDto): Promise<OfficeDto> {
    const row = await this.officeRepository.findOne({ where: { id }, relations: { province: true } });
    if (!row) {
      throw new NotFoundException('Office not found');
    }

    const province = await this.requireProvince(dto.provinceId);
    const name = dto.name?.trim();
    const address = dto.address?.trim();
    if (!name || !address) {
      throw new BadRequestException('name and address are required');
    }

    const { mapUrl, latitude, longitude } = this.resolveMapLocation(dto.mapUrl);

    row.province = province;
    row.name = name;
    row.address = address;
    row.mapUrl = mapUrl;
    row.latitude = latitude;
    row.longitude = longitude;
    row.managerName = dto.managerName?.trim() || null;
    row.managerTitle = dto.managerTitle?.trim() || null;
    row.managerMobile = dto.managerMobile?.trim() || null;
    row.managerEmail = dto.managerEmail?.trim() || null;
    row.isHeadquarter = dto.isHeadquarter ?? false;
    row.isActive = dto.isActive ?? true;

    const saved = await this.officeRepository.save(row);
    return this.toDto(saved);
  }

  private resolveMapLocation(rawUrl: string): {
    mapUrl: string;
    latitude: string;
    longitude: string;
  } {
    const mapUrl = rawUrl?.trim();
    if (!mapUrl) {
      throw new BadRequestException('mapUrl is required');
    }

    if (isShortGoogleMapsUrl(mapUrl)) {
      throw new BadRequestException(
        'Short Google Maps links are not supported. Open the location in Google Maps, then copy the full URL from the address bar.',
      );
    }

    const coords = parseGoogleMapsUrl(mapUrl);
    if (!coords) {
      throw new BadRequestException(
        'Could not extract coordinates from the Google Maps URL. Make sure you pasted the full link copied from the browser address bar.',
      );
    }

    return {
      mapUrl,
      latitude: formatCoordinate(coords.lat),
      longitude: formatCoordinate(coords.lng),
    };
  }

  async delete(id: number): Promise<void> {
    const row = await this.officeRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Office not found');
    }

    await this.officeRepository.delete(id);
  }

  private async requireProvince(id: number): Promise<Province> {
    const province = await this.provinceRepository.findOne({ where: { id } });
    if (!province) {
      throw new BadRequestException('Province not found');
    }
    return province;
  }

  private toDto(item: Office): OfficeDto {
    return {
      id: item.id,
      provinceId: item.province?.id ?? null,
      name: item.name,
      city: item.province?.displayName ?? item.province?.name ?? null,
      region: item.province?.area ?? null,
      address: item.address,
      mapUrl: item.mapUrl,
      latitude: item.latitude,
      longitude: item.longitude,
      manager: {
        name: item.managerName,
        title: item.managerTitle,
        mobile: item.managerMobile,
        email: item.managerEmail,
      },
      coordinates: {
        lat: item.latitude,
        lng: item.longitude,
      },
      isHeadquarter: item.isHeadquarter,
      isActive: item.isActive,
    };
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return OfficesService.DEFAULT_LIMIT;
    }
    return Math.min(limit, OfficesService.DEFAULT_LIMIT);
  }
}
