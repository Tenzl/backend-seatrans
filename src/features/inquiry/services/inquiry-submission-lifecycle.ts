import { Injectable, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BaseInquiry } from '../entities/base-inquiry.entity';
import { InquiryCodeAllocator } from './inquiry-code-allocator';
import { InquiryRepositoryRegistry } from './inquiry-repository.registry';

/**
 * Thin helpers around inquiry create/compensate. Keeps code allocation and
 * attachment-failure cleanup out of ServiceInquiryService without rewriting
 * the large createForSlug / status / form paths.
 */
@Injectable()
export class InquirySubmissionLifecycle {
  private readonly logger = new Logger(InquirySubmissionLifecycle.name);

  constructor(
    private readonly repositories: InquiryRepositoryRegistry,
    private readonly codeAllocator: InquiryCodeAllocator,
  ) {}

  /**
   * Serializes code allocation per service/year and runs `create` on the same
   * database connection under the advisory lock.
   */
  async createWithAllocatedCode(
    slug: string,
    serviceName: string,
    create: (
      manager: EntityManager,
      code: string,
    ) => Promise<BaseInquiry>,
  ): Promise<BaseInquiry> {
    const owningRepository = this.repositories.forSlug(slug);
    const prefix = this.repositories.codePrefix(serviceName);

    return owningRepository.manager.transaction(async (manager) => {
      const code = await this.codeAllocator.allocate(
        manager,
        this.repositories.forSlug(slug, manager),
        prefix,
      );
      return create(manager, code);
    });
  }

  async compensateFailedSubmission(
    slug: string,
    inquiryId: number,
    attachmentError: unknown,
  ): Promise<void> {
    try {
      await this.repositories.forSlug(slug).delete(inquiryId);
    } catch (cleanupError) {
      this.logger.error(
        `Attachment persistence failed and inquiry ${inquiryId} could not be removed`,
        cleanupError instanceof Error
          ? cleanupError.stack
          : String(cleanupError),
      );
    }

    this.logger.error(
      `Attachment persistence failed for inquiry ${inquiryId}; submission was not accepted`,
      attachmentError instanceof Error
        ? attachmentError.stack
        : String(attachmentError),
    );
  }
}
