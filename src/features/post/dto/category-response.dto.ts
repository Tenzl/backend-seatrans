export class CategoryResponseDto {
  id!: number;
  name!: string;
  slug!: string;
  description!: string | null;
  createdAt!: string;
  postCount!: number;
}
