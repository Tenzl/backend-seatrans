import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { InquiryDocument } from '../entities/inquiry-document.entity';
import { BaseInquiry } from '../entities/base-inquiry.entity';
import { ShippingAgencyInquiryEntity } from '../entities/shipping-agency-inquiry.entity';
import { CharteringBrokerageInquiryEntity } from '../entities/chartering-brokerage-inquiry.entity';
import { FreightForwardingInquiryEntity } from '../entities/freight-forwarding-inquiry.entity';
import { TotalLogisticsInquiryEntity } from '../entities/total-logistics-inquiry.entity';
import { SpecialRequestInquiryEntity } from '../entities/special-request-inquiry.entity';
import { InquiryDocumentType } from '../enums/inquiry-document-type.enum';
import { InquiryDocumentDto } from '../dto/inquiry-document.dto';
import { CloudinaryService } from '../../../shared/services/cloudinary.service';
import { User } from '../../auth/entities/user.entity';

@Injectable()
export class InquiryDocumentService {
  /** Normalized service slug → per-service inquiry repository. */
  private readonly inquiryRepos: Record<string, Repository<BaseInquiry>>;

  constructor(
    @InjectRepository(InquiryDocument)
    private readonly inquiryDocumentRepository: Repository<InquiryDocument>,
    @InjectRepository(ShippingAgencyInquiryEntity)
    shippingAgencyRepo: Repository<ShippingAgencyInquiryEntity>,
    @InjectRepository(CharteringBrokerageInquiryEntity)
    charteringRepo: Repository<CharteringBrokerageInquiryEntity>,
    @InjectRepository(FreightForwardingInquiryEntity)
    freightRepo: Repository<FreightForwardingInquiryEntity>,
    @InjectRepository(TotalLogisticsInquiryEntity)
    totalLogisticsRepo: Repository<TotalLogisticsInquiryEntity>,
    @InjectRepository(SpecialRequestInquiryEntity)
    specialRequestRepo: Repository<SpecialRequestInquiryEntity>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly cloudinaryService: CloudinaryService,
  ) {
    this.inquiryRepos = {
      'shipping-agency': shippingAgencyRepo,
      chartering: charteringRepo,
      'freight-forwarding': freightRepo,
      'total-logistic': totalLogisticsRepo,
      'special-request': specialRequestRepo,
    };
  }

  async uploadDocument(
    serviceSlug: string,
    targetId: number,
    documentType: InquiryDocumentType,
    file: Express.Multer.File,
    description: string | undefined,
    uploaderUserId: number,
  ): Promise<InquiryDocumentDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }

    const inquiry = await this.requireInquiry(serviceSlug, targetId);
    const inquirySlug = this.toServiceSlug(inquiry.serviceType?.name);

    const uploader = await this.userRepository.findOne({ where: { id: uploaderUserId } });
    if (!uploader) {
      throw new BadRequestException('User not found');
    }
    const upload = await this.cloudinaryService.uploadRawBuffer(
      file.buffer,
      `inquiries/${inquirySlug}`,
    );

    const row = this.inquiryDocumentRepository.create({
      serviceSlug: inquirySlug,
      targetId,
      documentType,
      fileName: upload.publicId,
      originalFileName: file.originalname,
      filePath: upload.secureUrl,
      fileSize: String(file.size),
      mimeType: file.mimetype || null,
      description: this.trimToNull(description),
      cloudinaryUrl: upload.secureUrl,
      cloudinaryPublicId: upload.publicId,
      uploadedBy: uploader,
      version: 1,
      checksum: createHash('sha256').update(file.buffer).digest('hex'),
      isActive: true,
    });

    const saved = await this.inquiryDocumentRepository.save(row);
    return this.toDto(saved);
  }

  async saveAttachmentsForInquiry(
    inquiry: BaseInquiry,
    files: Express.Multer.File[],
    uploaderUserId: number,
  ): Promise<void> {
    for (const file of files) {
      await this.uploadDocument(
        this.toServiceSlug(inquiry.serviceType.name),
        inquiry.id,
        InquiryDocumentType.OTHER,
        file,
        undefined,
        uploaderUserId,
      );
    }
  }

  async getDocuments(serviceSlug: string, targetId: number): Promise<InquiryDocumentDto[]> {
    // Ensure inquiry exists + matches service slug (legacy safety check)
    await this.requireInquiry(serviceSlug, targetId);

    const rows = await this.inquiryDocumentRepository.find({
      where: {
        serviceSlug: this.normalizeServiceSlug(serviceSlug),
        targetId,
        isActive: true,
      },
      order: { uploadedAt: 'DESC' },
      relations: { uploadedBy: true },
    });

    return rows.map((row) => this.toDto(row));
  }

  /**
   * Returns inquiry owner id after validating the serviceSlug matches the inquiry service type.
   * Used to enforce ownership checks on customer-facing document routes.
   */
  async getInquiryOwnerId(serviceSlug: string, targetId: number): Promise<number> {
    const inquiry = await this.requireInquiry(serviceSlug, targetId);
    return inquiry.userId;
  }

  async getDocumentsByType(
    serviceSlug: string,
    targetId: number,
    type: InquiryDocumentType,
  ): Promise<InquiryDocumentDto[]> {
    await this.requireInquiry(serviceSlug, targetId);

    const rows = await this.inquiryDocumentRepository.find({
      where: {
        serviceSlug: this.normalizeServiceSlug(serviceSlug),
        targetId,
        documentType: type,
        isActive: true,
      },
      order: { uploadedAt: 'DESC' },
      relations: { uploadedBy: true },
    });

    return rows.map((row) => this.toDto(row));
  }

  async getDocumentById(documentId: number): Promise<InquiryDocument> {
    const row = await this.inquiryDocumentRepository.findOne({
      where: { id: documentId },
      relations: { uploadedBy: true },
    });

    if (!row) {
      throw new NotFoundException('Document not found');
    }

    return row;
  }

  async deleteDocument(documentId: number): Promise<void> {
    const row = await this.getDocumentById(documentId);

    await this.cloudinaryService.deleteByPublicId(row.cloudinaryPublicId ?? '');
    await this.inquiryDocumentRepository.remove(row);
  }

  /**
   * Delete all documents for an inquiry by its (globally-unique) id. Inquiry ids
   * are unique across every service table (shared sequence), so the bare
   * targetId match is safe.
   */
  async hardDeleteByInquiry(inquiryId: number): Promise<void> {
    const rows = await this.inquiryDocumentRepository.find({
      where: { targetId: inquiryId },
    });

    for (const row of rows) {
      await this.cloudinaryService.deleteByPublicId(row.cloudinaryPublicId ?? '');
      await this.inquiryDocumentRepository.remove(row);
    }
  }

  async hardDeleteByServiceAndTarget(serviceSlug: string, targetId: number): Promise<void> {
    await this.requireInquiry(serviceSlug, targetId);
    await this.hardDeleteByInquiry(targetId);
  }

  private async requireInquiry(serviceSlug: string, inquiryId: number): Promise<BaseInquiry> {
    const slug = this.normalizeServiceSlug(serviceSlug);
    const repo = this.inquiryRepos[slug];
    if (!repo) {
      throw new BadRequestException(`Unsupported service type: ${serviceSlug}`);
    }

    const inquiry = await repo.findOne({
      where: { id: inquiryId },
      relations: {
        serviceType: true,
      },
    });

    if (!inquiry) {
      throw new NotFoundException('Inquiry not found');
    }

    return inquiry;
  }

  private toDto(row: InquiryDocument): InquiryDocumentDto {
    return {
      id: row.id,
      serviceSlug: row.serviceSlug,
      targetId: row.targetId,
      documentType: row.documentType,
      fileName: row.fileName,
      originalFileName: row.originalFileName,
      fileSize: Number(row.fileSize),
      mimeType: row.mimeType ?? 'application/pdf',
      description: row.description,
      uploadedAt: row.uploadedAt,
      uploadedByName: row.uploadedBy?.fullName ?? null,
      uploadedByEmail: row.uploadedBy?.email ?? null,
      version: row.version,
      checksum: row.checksum,
      isActive: row.isActive,
      cloudinaryUrl: row.cloudinaryUrl,
      cloudinaryPublicId: row.cloudinaryPublicId,
    };
  }

  private normalizeServiceSlug(value: string): string {
    const normalized = value.trim().toLowerCase();

    if (normalized === 'shipping agency' || normalized === 'shipping-agency') {
      return 'shipping-agency';
    }
    if (
      normalized === 'chartering' ||
      normalized === 'chartering-ship-broking' ||
      normalized === 'chartering-broking'
    ) {
      return 'chartering';
    }
    if (normalized === 'freight forwarding' || normalized === 'freight-forwarding') {
      return 'freight-forwarding';
    }
    if (
      normalized === 'logistics' ||
      normalized === 'total-logistic' ||
      normalized === 'total-logistics'
    ) {
      return 'total-logistic';
    }
    if (normalized === 'special request' || normalized === 'special-request') {
      return 'special-request';
    }

    return normalized;
  }

  private toServiceSlug(serviceTypeName: string): string {
    return this.normalizeServiceSlug(serviceTypeName);
  }

  private trimToNull(value?: string | null): string | null {
    if (value == null) {
      return null;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }
}
