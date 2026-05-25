import { Controller, Get, Query } from '@nestjs/common';
import { CategoriesService } from './categories.service';

@Controller('v1/categories')
export class CategoriesPublicController {
  constructor(private readonly categoriesService: CategoriesService) {}

  @Get()
  getAll(@Query('limit') limit?: string) {
    return this.categoriesService.getAll(limit ? Number(limit) : undefined);
  }
}
