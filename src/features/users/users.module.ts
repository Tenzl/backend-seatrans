import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { ExternalCustomersService } from './external-customers.service';
import { AdminExternalCustomersController } from './controllers/admin-external-customers.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { AdminUsersService } from './admin-users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role])],
  controllers: [AdminExternalCustomersController, AdminUsersController],
  providers: [ExternalCustomersService, AdminUsersService],
  exports: [ExternalCustomersService],
})
export class UsersModule {}
