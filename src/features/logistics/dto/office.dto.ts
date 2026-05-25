export class OfficeDto {
  id!: number;
  provinceId!: number | null;
  name!: string;
  city!: string | null;
  region!: string | null;
  address!: string;
  mapUrl!: string | null;
  latitude!: string | null;
  longitude!: string | null;
  manager!: {
    name: string | null;
    title: string | null;
    mobile: string | null;
    email: string | null;
  };
  coordinates!: { lat: string | null; lng: string | null };
  isHeadquarter!: boolean;
  isActive!: boolean;
}
