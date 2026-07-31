import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CategoryRequestDto } from './dto/category-request.dto';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';
import { PermanentDelete } from '../../shared/decorators/permanent-delete.decorator';

@AdminSection('content-categories')
@Controller('v1/admin/categories')
export class CategoriesAdminController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  getAll(@Query('limit') limit?: string) {
    return this.categoriesService.getAll(limit ? Number(limit) : undefined);
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.categoriesService.getById(Number(id));
  }

  @Post()
  create(@Body() dto: CategoryRequestDto) {
    return this.categoriesService.create(dto);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() dto: CategoryRequestDto) {
    return this.categoriesService.update(Number(id), dto);
  }

  @Delete(':id')
  @PermanentDelete({
    resourceType: 'post_category',
    idSource: { kind: 'param', key: 'id' },
  })
  remove(@Param('id') id: string) {
    return this.categoriesService.delete(Number(id));
  }
}
