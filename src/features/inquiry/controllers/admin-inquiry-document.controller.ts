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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request } from 'express';
import { ApiAdmin } from '../../../shared/decorators/api-admin.decorator';
import { validateDto } from '../../../shared/utils/validate-dto.util';
import { InquiryDocumentService } from '../services/inquiry-document.service';
import { UploadInquiryDocumentDto } from '../dto/upload-inquiry-document.dto';

@ApiAdmin()
@Controller('v1/admin/inquiries/:serviceSlug/:targetId/documents')
export class AdminInquiryDocumentController {
  constructor(private readonly inquiryDocumentService: InquiryDocumentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async uploadDocument(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Body() body: UploadInquiryDocumentDto,
    @UploadedFile() file: Express.Multer.File,
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
