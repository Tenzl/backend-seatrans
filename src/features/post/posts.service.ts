import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import sanitizeHtml from 'sanitize-html';
import { PostEntity } from './entities/post.entity';
import { Category } from './entities/category.entity';
import { User } from '../auth/entities/user.entity';
import { PostRequestDto } from './dto/post-request.dto';
import { PostResponseDto } from './dto/post-response.dto';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CloudinaryService } from '../../shared/services/cloudinary.service';
import { buildPaginatedResponse } from '../../shared/dto/pagination.dto';
import { PublishedPostsQueryDto } from './dto/published-posts-query.dto';

@Injectable()
export class PostsService {
  private static readonly DEFAULT_LIMIT = 100;

  constructor(
    @InjectRepository(PostEntity)
    private readonly postRepository: Repository<PostEntity>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly cloudinaryService: CloudinaryService,
  ) {}

  async getPublishedList(
    categorySlug?: string,
    search?: string,
    limit = PostsService.DEFAULT_LIMIT,
  ): Promise<PostResponseDto[]> {
    const qb = this.postRepository
      .createQueryBuilder('post')
      .leftJoinAndSelect('post.categories', 'category')
      .leftJoinAndSelect('post.author', 'author')
      .where('post.is_published = :published', { published: true })
      .orderBy('post.published_at', 'DESC');

    if (categorySlug?.trim()) {
      qb.andWhere('LOWER(category.slug) = :slug', { slug: categorySlug.trim().toLowerCase() });
    }

    const normalizedSearch = search?.trim();
    if (normalizedSearch) {
      qb.andWhere('(LOWER(post.title) LIKE :q OR LOWER(post.content) LIKE :q)', {
        q: `%${normalizedSearch.toLowerCase()}%`,
      });
      // Search requests can return full matching records.
      const rows = await qb.getMany();
      return rows.map((item) => this.toDto(item));
    }

    const rows = await qb.take(this.sanitizeLimit(limit)).getMany();
    return rows.map((item) => this.toDto(item));
  }

  async listPublished(query: PublishedPostsQueryDto) {
    const search = (query.q ?? query.search)?.trim();
    const page = Math.max(0, Number(query.page ?? 0));
    const size = this.sanitizeLimit(Number(query.size ?? 20));

    if (search) {
      const rows = await this.getPublishedList(query.category, search);
      return buildPaginatedResponse(rows, rows.length, 0, rows.length || 1);
    }

    const [rows, total] = await this.postRepository.findAndCount({
      where: { isPublished: true },
      order: { publishedAt: 'DESC' },
      skip: page * size,
      take: size,
      relations: { categories: true, author: true },
    });

    const content = rows.map((item) => this.toDto(item));
    return buildPaginatedResponse(content, total, page, size);
  }

  async getLatest(limit = 5): Promise<PostResponseDto[]> {
    const rows = await this.postRepository.find({
      where: { isPublished: true },
      order: { publishedAt: 'DESC' },
      take: this.sanitizeLimit(limit),
      relations: { categories: true, author: true },
    });

    return rows.map((item) => this.toDto(item));
  }

  async getPublicById(id: number): Promise<PostResponseDto> {
    const row = await this.findPublishedPost(id);
    return this.toDto(row);
  }

  async recordView(id: number): Promise<{ viewCount: number }> {
    const row = await this.findPublishedPost(id);
    row.viewCount = (row.viewCount ?? 0) + 1;
    const saved = await this.postRepository.save(row);
    return { viewCount: saved.viewCount ?? 0 };
  }

  private async findPublishedPost(id: number): Promise<PostEntity> {
    const row = await this.postRepository.findOne({
      where: { id, isPublished: true },
      relations: { categories: true, author: true },
    });

    if (!row) {
      throw new NotFoundException('Post not found');
    }

    return row;
  }

  async getAdminList(limit = PostsService.DEFAULT_LIMIT): Promise<PostResponseDto[]> {
    const rows = await this.postRepository.find({
      order: { updatedAt: 'DESC' },
      take: this.sanitizeLimit(limit),
      relations: { categories: true, author: true },
    });

    return rows.map((item) => this.toDto(item));
  }

  async getAdminById(id: number): Promise<PostResponseDto> {
    const row = await this.postRepository.findOne({
      where: { id },
      relations: { categories: true, author: true },
    });

    if (!row) {
      throw new NotFoundException('Post not found');
    }

    return this.toDto(row);
  }

  async create(dto: PostRequestDto, email?: string): Promise<PostResponseDto> {
    if (!email) {
      throw new BadRequestException('Authenticated user email is required');
    }

    const author = await this.userRepository.findOne({ where: { email } });
    if (!author) {
      throw new BadRequestException('Author not found');
    }

    const categories = await this.resolveCategories(dto.categoryIds);
    const isPublished = dto.isPublished ?? false;

    const row = this.postRepository.create({
      title: dto.title.trim(),
      content: this.sanitizeContent(dto.content),
      summary: dto.summary?.trim() || null,
      author,
      categories,
      thumbnailUrl: dto.thumbnailUrl?.trim() || null,
      thumbnailPublicId: dto.thumbnailPublicId?.trim() || null,
      isPublished,
      publishedAt: isPublished ? new Date() : null,
      viewCount: isPublished ? this.generateInitialViewCount() : 0,
    });

    const saved = await this.postRepository.save(row);
    return this.toDto(saved);
  }

  async update(id: number, dto: PostRequestDto): Promise<PostResponseDto> {
    const row = await this.postRepository.findOne({
      where: { id },
      relations: { categories: true, author: true },
    });

    if (!row) {
      throw new NotFoundException('Post not found');
    }

    const categories = await this.resolveCategories(dto.categoryIds);

    const previousPublicId = row.thumbnailPublicId;
    const nextPublicId = dto.thumbnailPublicId?.trim() || null;

    row.title = dto.title.trim();
    row.content = this.sanitizeContent(dto.content);
    row.summary = dto.summary?.trim() || null;
    row.categories = categories;
    row.thumbnailUrl = dto.thumbnailUrl?.trim() || null;
    row.thumbnailPublicId = nextPublicId;

    const nextPublished = dto.isPublished ?? false;
    if (!row.isPublished && nextPublished) {
      row.publishedAt = new Date();
      if ((row.viewCount ?? 0) <= 0) {
        row.viewCount = this.generateInitialViewCount();
      }
    }
    if (row.isPublished && !nextPublished) {
      row.publishedAt = null;
    }
    row.isPublished = nextPublished;

    const saved = await this.postRepository.save(row);

    if (previousPublicId && nextPublicId && previousPublicId !== nextPublicId) {
      await this.cloudinaryService.deleteByPublicId(previousPublicId);
    }

    return this.toDto(saved);
  }

  async delete(id: number): Promise<void> {
    const row = await this.postRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Post not found');
    }

    await this.cloudinaryService.deleteByPublicId(row.thumbnailPublicId ?? '');
    await this.postRepository.delete(id);
  }

  private sanitizeContent(content: string): string {
    return sanitizeHtml(content ?? '', {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        'img',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'span',
      ]),
      allowedAttributes: {
        ...sanitizeHtml.defaults.allowedAttributes,
        img: ['src', 'alt', 'title', 'width', 'height'],
        a: ['href', 'name', 'target', 'rel'],
        // Disallow inline styles to reduce XSS gadget surface.
      },
      // Disallow `data:` URLs — they are a common XSS / content-smuggling vector.
      allowedSchemes: ['http', 'https', 'mailto'],
    });
  }

  private async resolveCategories(categoryIds?: number[]): Promise<Category[]> {
    if (!categoryIds?.length) {
      return [];
    }

    const rows = await this.categoryRepository.find({ where: { id: In(categoryIds) } });
    if (rows.length !== categoryIds.length) {
      throw new BadRequestException('Some categories were not found');
    }
    return rows;
  }

  private toDto(row: PostEntity): PostResponseDto {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      summary: row.summary,
      authorId: row.author?.id,
      authorName: row.author?.fullName ?? row.author?.email ?? 'Unknown',
      categories: (row.categories ?? []).map((c) => this.toCategoryDto(c)),
      thumbnailUrl: row.thumbnailUrl,
      thumbnailPublicId: row.thumbnailPublicId,
      publishedAt: row.publishedAt,
      isPublished: row.isPublished,
      viewCount: row.viewCount ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private toCategoryDto(category: Category): CategoryResponseDto {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      createdAt: category.createdAt.toISOString(),
      postCount: category.posts?.length ?? 0,
    };
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return PostsService.DEFAULT_LIMIT;
    }
    return Math.min(limit, PostsService.DEFAULT_LIMIT);
  }

  /** Seeded display views when a post is first published (8000–12000). */
  private generateInitialViewCount(): number {
    return 8000 + Math.floor(Math.random() * 4001);
  }
}
