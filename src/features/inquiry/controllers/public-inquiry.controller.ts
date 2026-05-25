import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
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
import { validateDto } from '../../../shared/utils/validate-dto.util';

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
    FileFieldsInterceptor([
      { name: 'inquiry', maxCount: 1 },
      { name: 'files', maxCount: 10 },
    ]),
  )
  @Post()
  async submitInquiry(
    @UploadedFiles()
    filesByField: {
      inquiry?: Express.Multer.File[];
      files?: Express.Multer.File[];
    },
    @Body() body: Record<string, unknown>,
    @Req() req: AuthenticatedRequest,
  ) {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      throw new ForbiddenException('Please log in to submit an inquiry.');
    }

    const parsedInquiry = this.parseInquiryPayload(body, filesByField.inquiry?.[0]);
    const payload = await validateDto(PublicInquiryRequestDto, parsedInquiry);

    return this.inquiryService.submitInquiry(payload, filesByField.files ?? [], currentUserId);
  }

  @UseGuards(AuthGuard('jwt'))
  @Delete('batch')
  async deleteMyInquiries(@Body() dto: DeleteInquiriesDto, @Req() req: AuthenticatedRequest) {
    const currentUserId = req.user?.id;
    if (!currentUserId) {
      throw new ForbiddenException('Please log in to delete inquiries.');
    }

    return this.inquiryService.deleteBatchByUser(currentUserId, dto.ids);
  }

  private parseInquiryPayload(
    body: Record<string, unknown>,
    inquiryFile?: Express.Multer.File,
  ): Record<string, unknown> {
    if (inquiryFile?.buffer?.length) {
      try {
        return JSON.parse(inquiryFile.buffer.toString('utf-8')) as Record<string, unknown>;
      } catch {
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
