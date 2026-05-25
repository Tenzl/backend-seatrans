import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import { InquiryDocument } from '../entities/inquiry-document.entity';
import { ServiceInquiry } from '../entities/service-inquiry.entity';
import { InquiryDocumentType } from '../enums/inquiry-document-type.enum';
import { InquiryDocumentDto } from '../dto/inquiry-document.dto';
import { CloudinaryService } from '../../../shared/services/cloudinary.service';
import { User } from '../../auth/entities/user.entity';

@Injectable()
export class InquiryDocumentService {
  constructor(
    @InjectRepository(InquiryDocument)
    private readonly inquiryDocumentRepository: Repository<InquiryDocument>,
    @InjectRepository(ServiceInquiry)
    private readonly inquiryRepository: Repository<ServiceInquiry>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

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

    const inquiry = await this.requireInquiry(targetId);
    const normalizedRequestedSlug = this.normalizeServiceSlug(serviceSlug);
    const inquirySlug = this.toServiceSlug(inquiry.serviceType?.name);

    if (normalizedRequestedSlug !== inquirySlug) {
      throw new BadRequestException('Document does not belong to the specified inquiry');
    }

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
    inquiry: ServiceInquiry,
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
    const inquiry = await this.requireInquiry(targetId);
    this.ensureServiceSlugMatches(serviceSlug, inquiry);

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

  async getDocumentsByType(
    serviceSlug: string,
    targetId: number,
    type: InquiryDocumentType,
  ): Promise<InquiryDocumentDto[]> {
    const inquiry = await this.requireInquiry(targetId);
    this.ensureServiceSlugMatches(serviceSlug, inquiry);

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
    const inquiry = await this.requireInquiry(targetId);
    this.ensureServiceSlugMatches(serviceSlug, inquiry);
    await this.hardDeleteByInquiry(targetId);
  }

  private async requireInquiry(inquiryId: number): Promise<ServiceInquiry> {
    const inquiry = await this.inquiryRepository.findOne({
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

  private ensureServiceSlugMatches(serviceSlug: string, inquiry: ServiceInquiry): void {
    const normalizedRequestedSlug = this.normalizeServiceSlug(serviceSlug);
    const inquirySlug = this.toServiceSlug(inquiry.serviceType?.name);
    if (normalizedRequestedSlug !== inquirySlug) {
      throw new BadRequestException('Document does not belong to the specified inquiry');
    }
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
