export class GalleryImageDto {
  id!: number;
  imageUrl!: string;
  cloudinaryPublicId!: string | null;
  uploadedAt!: Date;
  uploadedById!: number;
  serviceTypeId!: number;
  commodityId!: number;
  commodityName!: string;
  provinceId!: number | null;
  provinceName!: string | null;
  portId!: number | null;
  portName!: string | null;
  provinceCode!: string | null;
  createdAt!: Date;
  updatedAt!: Date;
}
