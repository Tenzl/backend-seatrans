import { IsEnum, IsOptional, IsString } from 'class-validator';
import { InquiryDocumentType } from '../enums/inquiry-document-type.enum';

export class UploadInquiryDocumentDto {
  @IsEnum(InquiryDocumentType)
  documentType!: InquiryDocumentType;

  @IsOptional()
  @IsString()
  description?: string;
}
