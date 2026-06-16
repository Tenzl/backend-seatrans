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
import { LimitQueryDto } from '../../shared/dto/list-query.dto';
import { PostsService } from './posts.service';
import { PostRequestDto } from './dto/post-request.dto';

@AdminSection('content-posts')
@Controller('v1/admin/posts')
export class PostsAdminController {
  constructor(private readonly postsService: PostsService) {}

  @Get()
  getAll(@Query() query: LimitQueryDto) {
    return this.postsService.getAdminList(query.limit);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.postsService.getAdminById(Number(id));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: PostRequestDto, @Req() req: { user?: { email?: string } }) {
    return this.postsService.create(dto, req.user?.email);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: PostRequestDto) {
    return this.postsService.update(Number(id), dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.postsService.delete(Number(id));
  }
}
