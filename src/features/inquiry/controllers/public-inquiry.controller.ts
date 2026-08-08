import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { ServiceInquiryService } from '../services/service-inquiry.service';
import { ListInquiriesQueryDto } from '../dto/list-inquiries-query.dto';
import { PublicInquiryRequestDto } from '../dto/public-inquiry-request.dto';
import { DeleteInquiriesDto } from '../dto/delete-inquiries.dto';
import { PublicDeleteInquiriesQueryDto } from '../dto/delete-inquiries-query.dto';
import { validateDto } from '../../../shared/utils/validate-dto.util';
import { INQUIRY_UPLOAD_LIMITS } from '../../../shared/uploads/upload-limits';
import { buildMultipartUploadOptions } from '../../../shared/uploads/multipart-upload.options';
import { UploadConcurrencyInterceptor } from '../../../shared/uploads/upload-concurrency.interceptor';
import { CleanupUploadedFilesInterceptor } from '../../../shared/uploads/cleanup-uploaded-files.interceptor';
import { readUploadedFileBuffer } from '../../../shared/uploads/uploaded-file.util';
import { inquiryAttachmentFileFilter } from '../../../shared/uploads/inquiry-file-validation';

type AuthenticatedRequest = Request & {
  user?: {
    id?: number;
  };
};

@Controller('v1/inquiries')
export class PublicInquiryController {
  constructor(private readonly inquiryService: ServiceInquiryService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('user/:userId')
  async getInquiriesByUser(
    @Param('userId', ParseIntPipe) userId: number,
    @Query() query: ListInquiriesQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const currentUserId = req.user?.id;
    if (!currentUserId || currentUserId !== userId) {
      throw new ForbiddenException('You can only view your own inquiries');
    }

    return this.inquiryService.listByUser(userId, query);
  }

  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(
    UploadConcurrencyInterceptor,
    CleanupUploadedFilesInterceptor,
    FileFieldsInterceptor(
      [
        { name: 'inquiry', maxCount: 1 },
        { name: 'files', maxCount: INQUIRY_UPLOAD_LIMITS.maxAttachmentFiles },
      ],
      buildMultipartUploadOptions({
        maxFileSize: INQUIRY_UPLOAD_LIMITS.maxFileSize,
        maxFiles: INQUIRY_UPLOAD_LIMITS.maxFiles,
        maxTotalBytes: INQUIRY_UPLOAD_LIMITS.maxTotalBytes,
        fileFilter: inquiryAttachmentFileFilter,
      }),
    ),
  )
  @Post()
  async submitInquiry(
    @UploadedFiles()
    filesByField:
      | {
          inquiry?: Express.Multer.File[];
          files?: Express.Multer.File[];
        }
      | undefined,
    @Body() body: Record<string, unknown>,
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      throw new ForbiddenException('Please log in to submit an inquiry.');
    }

    const uploads = filesByField ?? {};
    const parsedInquiry = await this.parseInquiryPayload(
      body,
      uploads.inquiry?.[0],
    );
    const payload = await validateDto(PublicInquiryRequestDto, parsedInquiry);

    return this.inquiryService.submitInquiry(
      payload,
      uploads.files ?? [],
      currentUserId,
      idempotencyKey,
    );
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('batch')
  async deleteMyInquiries(
    @Body() dto: DeleteInquiriesDto,
    @Query() query: PublicDeleteInquiriesQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      throw new ForbiddenException('Please log in to delete inquiries.');
    }

    return this.inquiryService.softDeleteBatchByUser(
      currentUserId,
      dto.ids,
      query.serviceSlug,
    );
  }

  private async parseInquiryPayload(
    body: Record<string, unknown>,
    inquiryFile?: Express.Multer.File,
  ): Promise<Record<string, unknown>> {
    if (inquiryFile) {
      try {
        const buffer = await readUploadedFileBuffer(inquiryFile);
        return JSON.parse(buffer.toString('utf-8')) as Record<string, unknown>;
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        throw new BadRequestException('Invalid inquiry payload format');
      }
    }

    const inquiryField = body.inquiry;
    if (typeof inquiryField === 'string' && inquiryField.trim().length > 0) {
      try {
        return JSON.parse(inquiryField) as Record<string, unknown>;
      } catch {
        throw new BadRequestException('Invalid inquiry payload format');
      }
    }

    return body;
  }
}
