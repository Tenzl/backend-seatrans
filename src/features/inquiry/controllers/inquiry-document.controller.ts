import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import type { Request } from 'express';
import { InquiryDocumentService } from '../services/inquiry-document.service';
import { DocumentByTypeQueryDto } from '../dto/document-by-type-query.dto';
import { CloudinaryService } from '../../../shared/services/cloudinary.service';

@Controller('v1/inquiries')
export class InquiryDocumentController {
  constructor(
    private readonly inquiryDocumentService: InquiryDocumentService,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  private isPrivilegedUser(user: any): boolean {
    const roleNames: string[] = Array.isArray(user?.roles)
      ? user.roles
      : user?.role?.name
        ? [user.role.name]
        : [];
    return roleNames.some((r) =>
      ['ROLE_ADMIN', 'ROLE_EMPLOYEE', 'ROLE_INTERNAL'].includes(r),
    );
  }

  private ensureInquiryOwnerOrAdmin(inquiryOwnerId: number, user: any): void {
    const requesterId = Number(user?.id);
    if (Number.isFinite(requesterId) && requesterId === inquiryOwnerId) return;
    if (this.isPrivilegedUser(user)) return;
    throw new ForbiddenException('Forbidden');
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':serviceSlug/:targetId/documents')
  getDocuments(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Req() req: Request,
  ) {
    // Prevent IDOR: only inquiry owner or privileged roles can access documents
    return this.inquiryDocumentService
      .getInquiryOwnerId(serviceSlug, targetId)
      .then((ownerId) => {
        this.ensureInquiryOwnerOrAdmin(ownerId, (req as any).user);
        return this.inquiryDocumentService.getDocuments(serviceSlug, targetId);
      });
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(':serviceSlug/:targetId/documents/by-type')
  getDocumentsByType(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Query() query: DocumentByTypeQueryDto,
    @Req() req: Request,
  ) {
    // Prevent IDOR: only inquiry owner or privileged roles can access documents
    return this.inquiryDocumentService
      .getInquiryOwnerId(serviceSlug, targetId)
      .then((ownerId) => {
        this.ensureInquiryOwnerOrAdmin(ownerId, (req as any).user);
        return this.inquiryDocumentService.getDocumentsByType(
          serviceSlug,
          targetId,
          query.type,
        );
      });
  }

  /** Redirect to stored file. disposition=attachment | inline (default) */
  @UseGuards(AuthGuard('jwt'))
  @Get(':serviceSlug/:targetId/documents/:documentId/content')
  async streamDocument(
    @Param('serviceSlug') serviceSlug: string,
    @Param('targetId', ParseIntPipe) targetId: number,
    @Param('documentId', ParseIntPipe) documentId: number,
    @Res() res: Response,
    @Req() req: Request,
    @Query('disposition') _disposition: 'inline' | 'attachment' = 'inline',
  ) {
    // Prevent IDOR before revealing the redirect target
    const ownerId = await this.inquiryDocumentService.getInquiryOwnerId(
      serviceSlug,
      targetId,
    );
    this.ensureInquiryOwnerOrAdmin(ownerId, (req as any).user);

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

    // Prefer short-lived signed authenticated URL (prevents link sharing).
    const signed =
      doc.cloudinaryPublicId?.trim()
        ? this.cloudinaryService.buildSignedRawUrl(doc.cloudinaryPublicId, 60)
        : null;
    res.redirect(302, this.buildCloudinaryPdfUrl(signed ?? doc.cloudinaryUrl));
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
