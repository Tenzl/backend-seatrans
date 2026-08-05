export type PartnerOptionDto = {
  id: number;
  name: string;
  customerId: string;
  address: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  fax: string | null;
};

export type PartnerOptionPageDto = {
  content: PartnerOptionDto[];
  page: number;
  size: number;
  hasNext: boolean;
};
