import { IsEnum } from 'class-validator';
import { InquiryDocumentType } from '../enums/inquiry-document-type.enum';

export class DocumentByTypeQueryDto {
  @IsEnum(InquiryDocumentType)
  type!: InquiryDocumentType;
}
