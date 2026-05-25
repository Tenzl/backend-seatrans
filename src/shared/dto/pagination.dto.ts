import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { API_MAX_PAGE_SIZE } from './list-query.dto';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(API_MAX_PAGE_SIZE)
  size?: number = 20;
}

/** Standard paginated collection inside ApiResponse.data */
export class PaginatedResponseDto<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  last: boolean;
  hasNext: boolean;
  pageable: {
    pageNumber: number;
    pageSize: number;
  };

  constructor(content: T[], totalElements: number, page: number, size: number) {
    this.content = content;
    this.totalElements = totalElements;
    this.totalPages = size > 0 ? Math.ceil(totalElements / size) : 0;
    this.page = page;
    this.size = size;
    this.last = page >= this.totalPages - 1 || this.totalPages === 0;
    this.hasNext = (page + 1) * size < totalElements;
    this.pageable = {
      pageNumber: page,
      pageSize: size,
    };
  }
}

export function buildPaginatedResponse<T>(
  content: T[],
  totalElements: number,
  page: number,
  size: number,
): PaginatedResponseDto<T> {
  return new PaginatedResponseDto(content, totalElements, page, size);
}
