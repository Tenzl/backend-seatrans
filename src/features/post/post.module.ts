import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PostEntity } from './entities/post.entity';
import { PostImageEntity } from './entities/post-image.entity';
import { Category } from './entities/category.entity';
import { User } from '../auth/entities/user.entity';
import { PostsService } from './posts.service';
import { CategoriesService } from './categories.service';
import { PostsPublicController } from './posts-public.controller';
import { PostsAdminController } from './posts-admin.controller';
import { CategoriesPublicController } from './categories-public.controller';
import { CategoriesAdminController } from './categories-admin.controller';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CloudinaryService } from '../../shared/services/cloudinary.service';

@Module({
  imports: [TypeOrmModule.forFeature([PostEntity, PostImageEntity, Category, User])],
  providers: [PostsService, CategoriesService, RolesGuard, CloudinaryService],
  controllers: [
    PostsPublicController,
    PostsAdminController,
    CategoriesPublicController,
    CategoriesAdminController,
  ],
})
export class PostModule {}
