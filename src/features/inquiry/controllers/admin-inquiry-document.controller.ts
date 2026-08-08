import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Req,
  ParseFilePipe,
  MaxFileSizeValidator,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { AdminSection } from '../../../shared/decorators/admin-section.decorator';
import { PermanentDelete } from '../../../shared/decorators/permanent-delete.decorator';
import { validateDto } from '../../../shared/utils/validate-dto.util';
import { InquiryDocumentService } from '../services/inquiry-document.service';
import { UploadInquiryDocumentDto } from '../dto/upload-inquiry-document.dto';
import { INQUIRY_UPLOAD_LIMITS } from '../../../shared/uploads/upload-limits';
import { buildMultipartUploadOptions } from '../../../shared/uploads/multipart-upload.options';
import { inquiryAttachmentFileFilter } from '../../../shared/uploads/inquiry-file-validation';
import { CleanupUploadedFilesInterceptor } from '../../../shared/uploads/cleanup-uploaded-files.interceptor';

@AdminSection('epda-inquiry')
@Controller('v1/admin/inquiries/:serviceSlug/:targetId/documents')
export class AdminInquiryDocumentController {
  constructor(
    private readonly inquiryDocumentService: InquiryDocumentService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    CleanupUploadedFilesInterceptor,
    FileInterceptor(
      'file',
      buildMultipartUploadOptions({
        maxFileSize: INQUIRY_UPLOAD_LIMITS.maxFileSize,
        maxFiles: 1,
        maxTotalBytes: INQUIRY_UPLOAD_LIMITS.maxFileSize,
        fileFilter: inquiryAttachmentFileFilter,
      }),
    ),
  )
  async uploadDocument(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Body() body: UploadInquiryDocumentDto,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({
            maxSize: INQUIRY_UPLOAD_LIMITS.maxFileSize,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Req() req: Request & { user?: { id?: number } },
  ) {
    const dto = await validateDto(UploadInquiryDocumentDto, body);

    const uploaderUserId = req.user?.id;
    if (!uploaderUserId) {
      throw new BadRequestException('User not authenticated');
    }

    return this.inquiryDocumentService.uploadDocument(
      serviceSlug,
      targetId,
      dto.documentType,
      file,
      dto.description,
      uploaderUserId,
    );
  }

  @Delete(':documentId')
  @PermanentDelete({
    resourceType: 'inquiry_document',
    idSource: { kind: 'param', key: 'documentId' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDocument(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
  ) {
    const doc = await this.inquiryDocumentService.getDocumentById(documentId);
    if (
      doc.targetId !== targetId ||
      doc.serviceSlug !== this.normalizeServiceSlug(serviceSlug)
    ) {
      throw new BadRequestException(
        'Document does not belong to the specified inquiry',
      );
    }

    await this.inquiryDocumentService.deleteDocument(documentId);
  }

  private normalizeServiceSlug(value: string): string {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'total-logistics') {
      return 'total-logistic';
    }
    if (normalized === 'freight forwarding') {
      return 'freight-forwarding';
    }
    if (normalized === 'shipping agency') {
      return 'shipping-agency';
    }
    if (normalized === 'special request') {
      return 'special-request';
    }
    return normalized;
  }
}
