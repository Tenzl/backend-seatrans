import { Controller, Get, Param, Query } from '@nestjs/common';
import { LimitQueryDto } from '../../shared/dto/list-query.dto';
import { PostsService } from './posts.service';
import { PublishedPostsQueryDto } from './dto/published-posts-query.dto';

@Controller('v1/posts')
export class PostsPublicController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  listPublished(@Query() query: PublishedPostsQueryDto) {
    return this.postsService.listPublished(query);
  }

  @Get('latest')
  getLatest(@Query() query: LimitQueryDto) {
    return this.postsService.getLatest(query.limit ?? 5);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.postsService.getPublicById(Number(id));
  }
}
