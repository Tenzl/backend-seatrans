import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvincesController } from './provinces.controller';
import { ProvincesAdminController } from './provinces-admin.controller';
import { ProvincesService } from './provinces.service';
import { Province } from './entities/province.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Province])],
  controllers: [ProvincesController, ProvincesAdminController],
  providers: [ProvincesService],
  exports: [ProvincesService],
})
export class ProvincesModule {}
