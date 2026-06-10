import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EpdaParameterSet } from './entities/epda-parameter-set.entity';
import { EpdaParameterChangeLog } from './entities/epda-parameter-change-log.entity';
import { Port } from '../ports/entities/port.entity';
import { EpdaParametersService } from './epda-parameters.service';
import { EpdaParametersAdminController } from './epda-parameters-admin.controller';

@Module({
  imports: [TypeOrmModule.forFeature([EpdaParameterSet, EpdaParameterChangeLog, Port])],
  controllers: [EpdaParametersAdminController],
  providers: [EpdaParametersService],
  exports: [EpdaParametersService],
})
export class EpdaParametersModule {}
