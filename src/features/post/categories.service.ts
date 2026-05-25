import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './entities/category.entity';
import { CategoryRequestDto } from './dto/category-request.dto';
import { CategoryResponseDto } from './dto/category-response.dto';

@Injectable()
export class CategoriesService {
  private static readonly DEFAULT_LIMIT = 100;

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

  async getAll(limit = CategoriesService.DEFAULT_LIMIT): Promise<CategoryResponseDto[]> {
    const rows = await this.categoryRepository.find({
      relations: { posts: true },
      order: { name: 'ASC' },
    });

    return rows.slice(0, this.sanitizeLimit(limit)).map((item) => this.toDto(item));
  }

  async getById(id: number): Promise<CategoryResponseDto> {
    const row = await this.categoryRepository.findOne({
      where: { id },
      relations: { posts: true },
    });
    if (!row) {
      throw new NotFoundException('Category not found');
    }
    return this.toDto(row);
  }

  async create(dto: CategoryRequestDto): Promise<CategoryResponseDto> {
    const name = dto.name?.trim();
    const slug = dto.slug?.trim().toLowerCase();

    const duplicateName = await this.categoryRepository.findOne({ where: { name } });
    if (duplicateName) {
      throw new ConflictException('Category name already exists');
    }

    const duplicateSlug = await this.categoryRepository.findOne({ where: { slug } });
    if (duplicateSlug) {
      throw new ConflictException('Category slug already exists');
    }

    const row = this.categoryRepository.create({
      name,
      slug,
      description: dto.description?.trim() || null,
    });

    const saved = await this.categoryRepository.save(row);
    return this.toDto(saved);
  }

  async update(id: number, dto: CategoryRequestDto): Promise<CategoryResponseDto> {
    const row = await this.categoryRepository.findOne({ where: { id }, relations: { posts: true } });
    if (!row) {
      throw new NotFoundException('Category not found');
    }

    const name = dto.name?.trim();
    const slug = dto.slug?.trim().toLowerCase();

    const duplicateName = await this.categoryRepository.findOne({ where: { name } });
    if (duplicateName && duplicateName.id !== id) {
      throw new ConflictException('Category name already exists');
    }

    const duplicateSlug = await this.categoryRepository.findOne({ where: { slug } });
    if (duplicateSlug && duplicateSlug.id !== id) {
      throw new ConflictException('Category slug already exists');
    }

    row.name = name;
    row.slug = slug;
    row.description = dto.description?.trim() || null;

    const saved = await this.categoryRepository.save(row);
    return this.toDto(saved);
  }

  async delete(id: number): Promise<void> {
    const row = await this.categoryRepository.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('Category not found');
    }
    await this.categoryRepository.delete(id);
  }

  private toDto(item: Category): CategoryResponseDto {
    return {
      id: item.id,
      name: item.name,
      slug: item.slug,
      description: item.description,
      createdAt: item.createdAt.toISOString(),
      postCount: item.posts?.length ?? 0,
    };
  }

  private sanitizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return CategoriesService.DEFAULT_LIMIT;
    }
    return Math.min(limit, CategoriesService.DEFAULT_LIMIT);
  }
}
