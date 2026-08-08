import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { PermanentDelete } from '../../shared/decorators/permanent-delete.decorator';
import { PostsService } from './posts.service';
import { AdminPostsQueryDto } from './dto/admin-posts-query.dto';
import { PostRequestDto } from './dto/post-request.dto';

@AdminSection('content-posts')
@Controller('v1/admin/posts')
export class PostsAdminController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  getAll(@Query() query: AdminPostsQueryDto) {
    return this.postsService.listAdmin(query);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.postsService.getAdminById(Number(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() dto: PostRequestDto,
    @Req() req: { user?: { email?: string } },
  ) {
    return this.postsService.create(dto, req.user?.email);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: PostRequestDto) {
    return this.postsService.update(Number(id), dto);
  }

  @Delete(':id')
  @PermanentDelete({
    resourceType: 'post',
    idSource: { kind: 'param', key: 'id' },
  })
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.postsService.delete(Number(id));
  }
}
