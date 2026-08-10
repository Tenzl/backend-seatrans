import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { RoleGroup } from '../auth/enums/role-group.enum';
import { AdminUserRowDto } from './dto/admin-user-row.dto';
import { AdminRoleOptionDto } from './dto/admin-role-option.dto';
import { AdminPicOptionDto } from './dto/admin-pic-option.dto';
import { CreateInternalUserDto } from './dto/create-internal-user.dto';
import { buildPaginatedResponse } from '../../shared/dto/pagination.dto';
import { API_MAX_PAGE_SIZE } from '../../shared/dto/list-query.dto';
import { buildContainsLikePattern } from '../../shared/utils/like-pattern';

@Injectable()
export class AdminUsersService {
  private static readonly DEFAULT_PAGE_SIZE = 20;
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly configService: ConfigService,
  ) {}

  async listRoles(roleGroup?: RoleGroup): Promise<AdminRoleOptionDto[]> {
    const roles = await this.roleRepository.find({
      where: roleGroup ? { roleGroup } : undefined,
      order: { roleGroup: 'ASC', name: 'ASC' },
    });
    return roles.map((r) =>
      AdminRoleOptionDto.from({
        id: r.id,
        name: r.name,
        roleGroup: r.roleGroup,
        description: r.description,
      }),
    );
  }

  /**
   * Lightweight INTERNAL + active users for booking Person In Charge pickers.
   * Selects only display fields (never password) and filters isActive in SQL.
   */
  async listPicOptions(params: {
    q?: string;
    limit?: number;
  }): Promise<AdminPicOptionDto[]> {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);

    const qb = this.userRepository
      .createQueryBuilder('user')
      .innerJoin('user.role', 'role')
      .select([
        'user.id',
        'user.email',
        'user.companyEmail',
        'user.fullName',
        'role.id',
        'role.name',
      ])
      .where('user.isActive = true')
      .andWhere('role.roleGroup = :roleGroup', {
        roleGroup: RoleGroup.INTERNAL,
      })
      .orderBy('user.fullName', 'ASC')
      .addOrderBy('user.email', 'ASC')
      .take(limit);

    const term = params.q?.trim();
    if (term) {
      qb.andWhere(
        "(LOWER(user.email) LIKE :term OR LOWER(COALESCE(user.companyEmail, '')) LIKE :term OR LOWER(COALESCE(user.fullName, '')) LIKE :term)",
        { term: `%${term.toLowerCase()}%` },
      );
    }

    const rows = await qb.getMany();
    return rows.map((row) =>
      AdminPicOptionDto.from({
        id: row.id,
        email: row.email,
        companyEmail: row.companyEmail ?? null,
        fullName: row.fullName ?? null,
        roleName: row.role?.name ?? null,
      }),
    );
  }

  async listUsers(params: {
    q?: string;
    roleGroup?: RoleGroup;
    roleName?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(0, Number(params.page ?? 0));
    const limit = Math.min(
      Math.max(
        Number(params.limit ?? AdminUsersService.DEFAULT_PAGE_SIZE),
        1,
      ),
      API_MAX_PAGE_SIZE,
    );

    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .orderBy('user.createdAt', 'DESC')
      .skip(page * limit)
      .take(limit);

    const term = params.q?.trim();
    if (term) {
      qb.andWhere(
        `(LOWER(user.email) LIKE :term ESCAPE E'\\\\'
          OR LOWER(COALESCE(user.companyEmail, '')) LIKE :term ESCAPE E'\\\\'
          OR LOWER(COALESCE(user.fullName, '')) LIKE :term ESCAPE E'\\\\'
          OR LOWER(COALESCE(user.company, '')) LIKE :term ESCAPE E'\\\\')`,
        { term: buildContainsLikePattern(term) },
      );
    }

    if (params.roleGroup) {
      qb.andWhere('role.roleGroup = :roleGroup', {
        roleGroup: params.roleGroup,
      });
    }

    if (params.roleName?.trim()) {
      qb.andWhere('role.name = :roleName', {
        roleName: params.roleName.trim(),
      });
    }

    const [rows, total] = await qb.getManyAndCount();
    const content = rows.map((row) =>
      AdminUserRowDto.from({
        id: row.id,
        email: row.email,
        username: row.username ?? null,
        fullName: row.fullName ?? null,
        phone: row.phone ?? null,
        company: row.company ?? null,
        companyEmail: row.companyEmail ?? null,
        isActive: row.isActive,
        createdAt: row.createdAt,
        role: row.role
          ? {
              id: row.role.id,
              name: row.role.name,
              roleGroup: row.role.roleGroup,
            }
          : null,
      }),
    );
    return buildPaginatedResponse(content, total, page, limit);
  }

  async createInternalUser(
    dto: CreateInternalUserDto,
    staffUserId: number,
  ): Promise<AdminUserRowDto> {
    const email = dto.email.trim().toLowerCase();
    const existing = await this.userRepository.findOne({ where: { email } });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const usernameRaw = dto.username?.trim();
    const username = usernameRaw ? usernameRaw.toLowerCase() : null;
    if (username) {
      const existingUsername = await this.userRepository
        .createQueryBuilder('user')
        .where("LOWER(COALESCE(user.username, '')) = :username", { username })
        .getOne();
      if (existingUsername) {
        throw new ConflictException('Username already exists');
      }
    }

    const role = await this.roleRepository.findOne({
      where: { id: dto.roleId },
    });
    if (!role) {
      throw new BadRequestException('Role not found');
    }
    if (role.roleGroup !== RoleGroup.INTERNAL) {
      throw new BadRequestException('Only INTERNAL roles can be created here');
    }

    const saltRounds = Number(
      this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'),
    );
    const hashed = await bcrypt.hash(
      dto.password,
      Number.isFinite(saltRounds) && saltRounds >= 10 ? saltRounds : 12,
    );
    const row: User = this.userRepository.create({
      email,
      username,
      password: hashed,
      // User.fullName is nullable in DB but typed as string in entity
      // (legacy typing). Keep an empty string when not provided.
      fullName: dto.fullName?.trim() ? dto.fullName.trim() : '',
      companyEmail: dto.companyEmail?.trim()
        ? dto.companyEmail.trim().toLowerCase()
        : null,
      role,
      isActive: true,
      sessionVersion: 1,
      emailVerified: false,
      createdByUserId: staffUserId,
    });

    let saved: User;
    try {
      saved = await this.userRepository.save(row);
    } catch (error) {
      const pgError = error as {
        code?: string;
        constraint?: string;
        detail?: string;
      };
      if (pgError.code === '23505') {
        const identity =
          `${pgError.constraint ?? ''} ${pgError.detail ?? ''}`.toLowerCase();
        if (identity.includes('username')) {
          throw new ConflictException('Username already exists');
        }
        if (identity.includes('email')) {
          throw new ConflictException('Email already exists');
        }
      }
      throw error;
    }
    return AdminUserRowDto.from({
      id: saved.id,
      email: saved.email,
      username: saved.username ?? null,
      fullName: saved.fullName ?? null,
      phone: saved.phone ?? null,
      company: saved.company ?? null,
      companyEmail: saved.companyEmail ?? null,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
      role: saved.role
        ? {
            id: saved.role.id,
            name: saved.role.name,
            roleGroup: saved.role.roleGroup,
          }
        : null,
    });
  }

  /**
   * Admin changes a user's role. The new role must belong to the same role group
   * as the user's current role (we never move a user between INTERNAL/EXTERNAL —
   * that would change their whole access scope). Admins cannot change their own
   * role (anti-lockout, mirrors deactivate).
   */
  async updateUserRole(
    userId: number,
    roleId: number,
    staffUserId: number,
  ): Promise<AdminUserRowDto> {
    if (userId === staffUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { role: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const role = await this.roleRepository.findOne({ where: { id: roleId } });
    if (!role) {
      throw new BadRequestException('Role not found');
    }

    if (user.role && role.roleGroup !== user.role.roleGroup) {
      throw new BadRequestException(
        'The new role must be in the same group as the user’s current role',
      );
    }

    user.role = role;
    user.sessionVersion = (user.sessionVersion ?? 1) + 1;
    const saved = await this.userRepository.save(user);
    return AdminUserRowDto.from({
      id: saved.id,
      email: saved.email,
      username: saved.username ?? null,
      fullName: saved.fullName ?? null,
      phone: saved.phone ?? null,
      company: saved.company ?? null,
      companyEmail: saved.companyEmail ?? null,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
      role: { id: role.id, name: role.name, roleGroup: role.roleGroup },
    });
  }

  /**
   * Update display + login identity fields.
   * Email/username uniqueness enforced; companyEmail may duplicate.
   * Identity changes bump sessionVersion so existing JWTs fail closed.
   */
  async updateProfile(
    userId: number,
    dto: {
      email: string;
      username?: string | null;
      fullName?: string | null;
      companyEmail?: string | null;
    },
  ): Promise<AdminUserRowDto> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: { role: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const email = dto.email.trim().toLowerCase();
    if (!email) {
      throw new BadRequestException('Email is required');
    }
    if (email !== user.email) {
      const existing = await this.userRepository.findOne({ where: { email } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Email already exists');
      }
    }

    const usernameRaw =
      typeof dto.username === 'string' ? dto.username.trim() : '';
    const username = usernameRaw ? usernameRaw.toLowerCase() : null;
    if (username && username !== (user.username ?? null)) {
      const existingUsername = await this.userRepository
        .createQueryBuilder('user')
        .where("LOWER(COALESCE(user.username, '')) = :username", { username })
        .andWhere('user.id != :userId', { userId })
        .getOne();
      if (existingUsername) {
        throw new ConflictException('Username already exists');
      }
    }

    const companyEmailRaw =
      typeof dto.companyEmail === 'string' ? dto.companyEmail.trim() : '';
    const companyEmail = companyEmailRaw
      ? companyEmailRaw.toLowerCase()
      : null;

    const identityChanged =
      email !== user.email || username !== (user.username ?? null);

    user.email = email;
    user.username = username;
    user.fullName =
      typeof dto.fullName === 'string' ? dto.fullName.trim() : user.fullName;
    user.companyEmail = companyEmail;
    if (identityChanged) {
      user.sessionVersion = (user.sessionVersion ?? 1) + 1;
    }

    let saved: User;
    try {
      saved = await this.userRepository.save(user);
    } catch (error) {
      const pgError = error as {
        code?: string;
        constraint?: string;
        detail?: string;
      };
      if (pgError.code === '23505') {
        const identity =
          `${pgError.constraint ?? ''} ${pgError.detail ?? ''}`.toLowerCase();
        if (identity.includes('username')) {
          throw new ConflictException('Username already exists');
        }
        if (identity.includes('email')) {
          throw new ConflictException('Email already exists');
        }
      }
      throw error;
    }

    return AdminUserRowDto.from({
      id: saved.id,
      email: saved.email,
      username: saved.username ?? null,
      fullName: saved.fullName ?? null,
      phone: saved.phone ?? null,
      company: saved.company ?? null,
      companyEmail: saved.companyEmail ?? null,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
      role: saved.role
        ? {
            id: saved.role.id,
            name: saved.role.name,
            roleGroup: saved.role.roleGroup,
          }
        : null,
    });
  }

  /** Admin sets a new password for any user. */
  async resetPassword(
    userId: number,
    newPassword: string,
  ): Promise<{ id: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const saltRounds = Number(
      this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'),
    );
    user.password = await bcrypt.hash(
      newPassword,
      Number.isFinite(saltRounds) && saltRounds >= 10 ? saltRounds : 12,
    );
    user.sessionVersion = (user.sessionVersion ?? 1) + 1;
    await this.userRepository.save(user);
    return { id: user.id };
  }

  /**
   * Admin deactivates a user (soft delete; cannot deactivate own account).
   *
   * We never hard-delete: users own linked records (inquiries, quotes, uploaded
   * documents, audit logs) that must be preserved for history and referential
   * integrity. Deactivating sets `isActive = false` and bumps `sessionVersion`,
   * which blocks login and invalidates existing JWTs (AuthService / JwtStrategy).
   */
  async deleteUser(
    userId: number,
    staffUserId: number,
  ): Promise<{ id: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.id === staffUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (user.isActive) {
      user.isActive = false;
      user.sessionVersion = (user.sessionVersion ?? 1) + 1;
      await this.userRepository.save(user);
    }
    return { id: userId };
  }

  /** Admin reactivates a previously deactivated user (re-enables login). */
  async reactivateUser(userId: number): Promise<{ id: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (!user.isActive) {
      user.isActive = true;
      await this.userRepository.save(user);
    }
    return { id: userId };
  }
}
