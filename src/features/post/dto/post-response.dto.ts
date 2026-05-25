import { CategoryResponseDto } from './category-response.dto';

export class PostResponseDto {
  id!: number;
  title!: string;
  content!: string;
  summary!: string | null;
  authorId!: number;
  authorName!: string;
  categories!: CategoryResponseDto[];
  thumbnailUrl!: string | null;
  thumbnailPublicId!: string | null;
  publishedAt!: Date | null;
  isPublished!: boolean;
  viewCount!: number;
  createdAt!: Date;
  updatedAt!: Date;
}
