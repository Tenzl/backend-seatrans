import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
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
import {
  hasUploadedContent,
  hashUploadedFile,
} from '../../../shared/uploads/uploaded-file.util';
import { assertInquiryAttachmentSafe } from '../../../shared/uploads/inquiry-file-validation';
import { mapWithConcurrency } from '../../../shared/utils/map-with-concurrency';

/** Parallel Cloudinary uploads for multi-attachment inquiry submits. */
const INQUIRY_UPLOAD_CONCURRENCY = 3;

@Injectable()
export class InquiryDocumentService {
  private readonly logger = new Logger(InquiryDocumentService.name);

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
    if (!hasUploadedContent(file)) {
      throw new BadRequestException('file is required');
    }

    const inquiry = await this.requireInquiry(serviceSlug, targetId);
    const inquirySlug = this.toServiceSlug(inquiry.serviceType?.name);
    const uploader = await this.requireUploader(uploaderUserId);

    return this.uploadResolved(
      inquirySlug,
      targetId,
      documentType,
      file,
      description,
      uploader,
    );
  }

  async saveAttachmentsForInquiry(
    inquiry: BaseInquiry,
    files: Express.Multer.File[],
    uploaderUserId: number,
  ): Promise<void> {
    if (!files?.length) {
      return;
    }

    const inquirySlug = this.toServiceSlug(inquiry.serviceType.name);
    const uploader = await this.requireUploader(uploaderUserId);
    const persistedDocumentIds: number[] = [];

    try {
      // Resolve inquiry + uploader once; upload with bounded concurrency (PERF-02).
      await mapWithConcurrency(files, INQUIRY_UPLOAD_CONCURRENCY, async (file) => {
        const saved = await this.uploadResolved(
          inquirySlug,
          inquiry.id,
          InquiryDocumentType.OTHER,
          file,
          undefined,
          uploader,
        );
        persistedDocumentIds.push(saved.id);
        return saved;
      });
    } catch (error) {
      // Treat the submitted attachment set as one unit from the customer's
      // perspective: if one file fails, remove every earlier file in the set.
      for (const documentId of persistedDocumentIds.reverse()) {
        try {
          await this.deleteDocument(documentId);
        } catch (cleanupError) {
          this.logger.error(
            `Could not roll back inquiry document ${documentId}`,
            cleanupError instanceof Error
              ? cleanupError.stack
              : String(cleanupError),
          );
        }
      }
      throw error;
    }
  }

  private async uploadResolved(
    inquirySlug: string,
    targetId: number,
    documentType: InquiryDocumentType,
    file: Express.Multer.File,
    description: string | undefined,
    uploader: User,
  ): Promise<InquiryDocumentDto> {
    if (!hasUploadedContent(file)) {
      throw new BadRequestException('file is required');
    }

    // SEC-03: extension + magic bytes; never trust client Content-Type alone.
    const detected = await assertInquiryAttachmentSafe(file);

    const upload = await this.cloudinaryService.uploadRaw(
      file,
      `inquiries/${inquirySlug}`,
    );

    try {
      const checksum = await hashUploadedFile(file);
      const row = this.inquiryDocumentRepository.create({
        serviceSlug: inquirySlug,
        targetId,
        documentType,
        fileName: upload.publicId,
        originalFileName: file.originalname,
        filePath: upload.secureUrl,
        fileSize: String(file.size),
        mimeType: detected.mimeType,
        description: this.trimToNull(description),
        cloudinaryUrl: upload.secureUrl,
        cloudinaryPublicId: upload.publicId,
        uploadedBy: uploader,
        version: 1,
        checksum,
        isActive: true,
      });

      const saved = await this.inquiryDocumentRepository.save(row);
      return this.toDto(saved);
    } catch (error) {
      // The object exists before its metadata row is written. Compensate the
      // external side effect so a database error does not leak stored files.
      try {
        await this.cloudinaryService.deleteByPublicId(upload.publicId, 'raw');
      } catch (cleanupError) {
        this.logger.error(
          `Could not remove orphaned inquiry upload ${upload.publicId}`,
          cleanupError instanceof Error
            ? cleanupError.stack
            : String(cleanupError),
        );
      }
      throw error;
    }
  }

  private async requireUploader(uploaderUserId: number): Promise<User> {
    const uploader = await this.userRepository.findOne({
      where: { id: uploaderUserId },
    });
    if (!uploader) {
      throw new BadRequestException('User not found');
    }
    return uploader;
  }

  async getDocuments(
    serviceSlug: string,
    targetId: number,
  ): Promise<InquiryDocumentDto[]> {
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
  async getInquiryOwnerId(
    serviceSlug: string,
    targetId: number,
  ): Promise<number> {
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

    await this.cloudinaryService.deleteByPublicId(
      row.cloudinaryPublicId ?? '',
      'raw',
    );
    await this.inquiryDocumentRepository.remove(row);
  }

  /**
   * Delete all documents for an inquiry scoped by service slug.
   * Different service tables can reuse the same numeric id, so target_id alone
   * is not safe.
   */
  async hardDeleteByInquiry(
    serviceSlug: string,
    inquiryId: number,
  ): Promise<void> {
    const publicIds = await this.inquiryDocumentRepository.manager.transaction(
      (manager) =>
        this.removeMetadataByInquiry(serviceSlug, inquiryId, manager),
    );
    await this.deleteStoredObjectsBestEffort(publicIds);
  }

  /**
   * Remove document metadata inside the caller's database transaction.
   * External object deletion deliberately happens only after that transaction
   * commits, because Cloudinary cannot participate in a PostgreSQL rollback.
   */
  async removeMetadataByInquiry(
    serviceSlug: string,
    inquiryId: number,
    manager: EntityManager,
  ): Promise<string[]> {
    return this.removeMetadataByInquiryIds(serviceSlug, [inquiryId], manager);
  }

  /**
   * Set-based document metadata delete for batch hard-delete.
   * Must filter by service_slug: inquiry ids are only unique within a service.
   * External object cleanup stays post-commit (see deleteStoredObjectsBestEffort).
   */
  async removeMetadataByInquiryIds(
    serviceSlug: string,
    inquiryIds: number[],
    manager: EntityManager,
  ): Promise<string[]> {
    if (!inquiryIds.length) return [];
    const slug = this.normalizeServiceSlug(serviceSlug);
    const rows: Array<{ cloudinary_public_id: string | null }> =
      await manager.query(
        `DELETE FROM inquiry_documents
         WHERE target_id = ANY($1::bigint[])
           AND service_slug = $2
         RETURNING cloudinary_public_id`,
        [inquiryIds, slug],
      );
    return rows
      .map((row) => row.cloudinary_public_id?.trim())
      .filter((publicId): publicId is string => Boolean(publicId));
  }

  /**
   * Best-effort post-commit cleanup. Database integrity wins over storage
   * cleanup; failures are visible in logs and the delete operation stays
   * idempotent so an operational retry can safely remove leftover objects.
   */
  async deleteStoredObjectsBestEffort(publicIds: string[]): Promise<void> {
    for (const publicId of new Set(publicIds)) {
      try {
        await this.cloudinaryService.deleteByPublicId(publicId, 'raw');
      } catch (error) {
        this.logger.error(
          `Could not remove deleted inquiry object ${publicId}`,
          error instanceof Error ? error.stack : String(error),
        );
      }
    }
  }

  async hardDeleteByServiceAndTarget(
    serviceSlug: string,
    targetId: number,
  ): Promise<void> {
    await this.requireInquiry(serviceSlug, targetId);
    await this.hardDeleteByInquiry(serviceSlug, targetId);
  }

  private async requireInquiry(
    serviceSlug: string,
    inquiryId: number,
  ): Promise<BaseInquiry> {
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
    if (
      normalized === 'freight forwarding' ||
      normalized === 'freight-forwarding'
    ) {
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
