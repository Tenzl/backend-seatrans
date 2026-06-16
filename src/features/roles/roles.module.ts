import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from '../auth/entities/role.entity';
import { User } from '../auth/entities/user.entity';
import { RoleSectionAccess } from './entities/role-section-access.entity';
import { RolesAdminController } from './roles-admin.controller';
import { RolesAdminService } from './roles-admin.service';
import { SectionAccessService } from './section-access.service';
import { SectionAccessGuard } from './guards/section-access.guard';

/**
 * Global so SectionAccessService + SectionAccessGuard are injectable in every
 * feature module that uses @AdminSection(...) on its admin controllers, and so
 * AuthController can read the current user's sections for /auth/me — without
 * importing this module everywhere (and without a circular dep on AuthModule).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Role, User, RoleSectionAccess])],
  controllers: [RolesAdminController],
  providers: [RolesAdminService, SectionAccessService, SectionAccessGuard],
  exports: [SectionAccessService, SectionAccessGuard],
})
export class RolesModule {}
