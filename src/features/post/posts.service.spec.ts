import { PostsService } from './posts.service';
import { NotFoundException } from '@nestjs/common';
import type { Repository } from 'typeorm';
import { PostEntity } from './entities/post.entity';
import { Category } from './entities/category.entity';
import { User } from '../auth/entities/user.entity';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

describe('PostsService search pagination (DB-03)', () => {
  it('always applies take/skip and omits content for ?q=', async () => {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 1,
            title: 'Hello',
            summary: 'Sum',
            content: undefined,
            author: { id: 2, fullName: 'Ada' },
            categories: [],
            publishedAt: new Date(),
            isPublished: true,
            viewCount: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        25,
      ]),
    };
    const postRepository = {
      createQueryBuilder: jest.fn(() => qb),
    };

    const service = new PostsService(
      postRepository as unknown as Repository<PostEntity>,
      {} as Repository<Category>,
      {} as Repository<User>,
      {} as CloudinaryService,
    );

    const page = await service.listPublished({ q: '100%_raw', page: 1, size: 10 });

    expect(qb.skip).toHaveBeenCalledWith(10);
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining("ESCAPE E'\\\\'"),
      { q: '%100\\%\\_raw%' },
    );
    expect(page.content[0]?.content).toBe('');
    expect(page.totalElements).toBe(25);
    expect(page.page).toBe(1);
    expect(page.size).toBe(10);
  });
});

describe('PostsService listAdmin pagination', () => {
  it('paginates and searches titles server-side', async () => {
    const qb = {
      leftJoin: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      getManyAndCount: jest.fn().mockResolvedValue([
        [
          {
            id: 101,
            title: 'Deep page',
            summary: '',
            author: { id: 2, fullName: 'Ada' },
            categories: [],
            publishedAt: null,
            isPublished: false,
            viewCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        120,
      ]),
    };
    const service = new PostsService(
      { createQueryBuilder: jest.fn(() => qb) } as unknown as Repository<PostEntity>,
      {} as Repository<Category>,
      {} as Repository<User>,
      {} as CloudinaryService,
    );

    const page = await service.listAdmin({ page: 10, size: 10, q: 'Deep' });

    expect(qb.skip).toHaveBeenCalledWith(100);
    expect(qb.take).toHaveBeenCalledWith(10);
    expect(qb.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('post.title'),
      { q: '%deep%' },
    );
    expect(page.totalElements).toBe(120);
    expect(page.content[0]?.id).toBe(101);
    expect(page.content[0]?.content).toBe('');
  });
});

describe('PostsService recordView (DB-05)', () => {
  it('increments view_count atomically with UPDATE ... RETURNING', async () => {
    const query = jest.fn().mockResolvedValue([{ view_count: 42 }]);
    const postRepository = {
      query,
      findOne: jest.fn(),
      save: jest.fn(),
    };

    const service = new PostsService(
      postRepository as unknown as Repository<PostEntity>,
      {} as Repository<Category>,
      {} as Repository<User>,
      {} as CloudinaryService,
    );

    await expect(service.recordView(9)).resolves.toEqual({ viewCount: 42 });

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /UPDATE posts[\s\S]*SET view_count = view_count \+ 1[\s\S]*RETURNING view_count/,
      ),
      [9],
    );
    expect(postRepository.findOne).not.toHaveBeenCalled();
    expect(postRepository.save).not.toHaveBeenCalled();
  });

  it('fails closed when the published post is missing', async () => {
    const service = new PostsService(
      {
        query: jest.fn().mockResolvedValue([]),
        findOne: jest.fn(),
        save: jest.fn(),
      } as unknown as Repository<PostEntity>,
      {} as Repository<Category>,
      {} as Repository<User>,
      {} as CloudinaryService,
    );

    await expect(service.recordView(404)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
