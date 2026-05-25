import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { InquiryDocumentService } from '../services/inquiry-document.service';
import { DocumentByTypeQueryDto } from '../dto/document-by-type-query.dto';

@Controller('v1/inquiries')
export class InquiryDocumentController {
  constructor(private readonly inquiryDocumentService: InquiryDocumentService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get(':serviceSlug/:targetId/documents')
  getDocuments(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
  ) {
    return this.inquiryDocumentService.getDocuments(serviceSlug, targetId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':serviceSlug/:targetId/documents/by-type')
  getDocumentsByType(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Query() query: DocumentByTypeQueryDto,
  ) {
    return this.inquiryDocumentService.getDocumentsByType(
      serviceSlug,
      targetId,
      query.type,
    );
  }

  /** Redirect to stored file. disposition=attachment | inline (default) */
  @UseGuards(AuthGuard('jwt'))
  @Get(':serviceSlug/:targetId/documents/:documentId/content')
  async streamDocument(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Res() res: Response,
    @Query('disposition') _disposition: 'inline' | 'attachment' = 'inline',
  ) {
    const doc = await this.inquiryDocumentService.getDocumentById(documentId);
    if (
      doc.targetId !== targetId ||
      doc.serviceSlug !== this.normalizeServiceSlug(serviceSlug)
    ) {
      throw new NotFoundException(
        'Document does not belong to the specified inquiry',
      );
    }

    if (!doc.cloudinaryUrl?.trim()) {
      throw new NotFoundException('Document file not found');
    }

    res.redirect(302, this.buildCloudinaryPdfUrl(doc.cloudinaryUrl));
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

  private buildCloudinaryPdfUrl(storedUrl: string): string {
    if (!storedUrl?.trim()) {
      return storedUrl;
    }
    if (storedUrl.includes('/raw/upload/')) {
      return storedUrl;
    }
    return storedUrl.replace('/image/upload/', '/raw/upload/');
  }
}
