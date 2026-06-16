import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CategoriesService } from './categories.service';
import { CategoryRequestDto } from './dto/category-request.dto';
import { AdminSection } from '../../shared/decorators/admin-section.decorator';

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
  remove(@Param('id') id: string) {
    return this.categoriesService.delete(Number(id));
  }
}
