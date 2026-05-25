import { InquiryDocumentType } from '../enums/inquiry-document-type.enum';

export type InquiryDocumentDto = {
  id: number;
  serviceSlug: string;
  targetId: number;
  documentType: InquiryDocumentType;
  fileName: string;
  originalFileName: string;
  fileSize: number;
  mimeType: string;
  description: string | null;
  uploadedAt: Date;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
  version: number;
  checksum: string | null;
  isActive: boolean;
  cloudinaryUrl: string | null;
  cloudinaryPublicId: string | null;
};
