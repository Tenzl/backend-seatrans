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
import { CreateInternalUserDto } from './dto/create-internal-user.dto';

@Injectable()
export class AdminUsersService {
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
      order: { roleGroup: 'ASC' as any, name: 'ASC' as any },
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

  async listUsers(params: {
    q?: string;
    roleGroup?: RoleGroup;
    roleName?: string;
    limit?: number;
  }): Promise<AdminUserRowDto[]> {
    const limit = Math.min(Math.max(params.limit ?? 100, 1), 200);

    const qb = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .orderBy('user.createdAt', 'DESC')
      .take(limit);

    const term = params.q?.trim();
    if (term) {
      qb.andWhere(
        '(LOWER(user.email) LIKE :term OR LOWER(COALESCE(user.fullName, \'\')) LIKE :term OR LOWER(COALESCE(user.company, \'\')) LIKE :term)',
        { term: `%${term.toLowerCase()}%` },
      );
    }

    if (params.roleGroup) {
      qb.andWhere('role.roleGroup = :roleGroup', { roleGroup: params.roleGroup });
    }

    if (params.roleName?.trim()) {
      qb.andWhere('role.name = :roleName', { roleName: params.roleName.trim() });
    }

    const rows = await qb.getMany();
    return rows.map((row) =>
      AdminUserRowDto.from({
        id: row.id,
        email: row.email,
        username: row.username ?? null,
        fullName: row.fullName ?? null,
        phone: row.phone ?? null,
        company: row.company ?? null,
        isActive: row.isActive,
        createdAt: row.createdAt,
        role: row.role ? { id: row.role.id, name: row.role.name, roleGroup: row.role.roleGroup } : null,
      }),
    );
  }

  async createInternalUser(dto: CreateInternalUserDto, staffUserId: number): Promise<AdminUserRowDto> {
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
        .where('LOWER(COALESCE(user.username, \'\')) = :username', { username })
        .getOne();
      if (existingUsername) {
        throw new ConflictException('Username already exists');
      }
    }

    const role = await this.roleRepository.findOne({ where: { id: dto.roleId } });
    if (!role) {
      throw new BadRequestException('Role not found');
    }
    if (role.roleGroup !== RoleGroup.INTERNAL) {
      throw new BadRequestException('Only INTERNAL roles can be created here');
    }

    const saltRounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'));
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
      role,
      isActive: true,
      emailVerified: false,
      createdByUserId: staffUserId,
    });

    const saved = await this.userRepository.save(row);
    return AdminUserRowDto.from({
      id: saved.id,
      email: saved.email,
      username: saved.username ?? null,
      fullName: saved.fullName ?? null,
      phone: saved.phone ?? null,
      company: saved.company ?? null,
      isActive: saved.isActive,
      createdAt: saved.createdAt,
      role: saved.role ? { id: saved.role.id, name: saved.role.name, roleGroup: saved.role.roleGroup } : null,
    });
  }

  /** Admin sets a new password for any user. */
  async resetPassword(userId: number, newPassword: string): Promise<{ id: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const saltRounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'));
    user.password = await bcrypt.hash(
      newPassword,
      Number.isFinite(saltRounds) && saltRounds >= 10 ? saltRounds : 12,
    );
    await this.userRepository.save(user);
    return { id: user.id };
  }

  /**
   * Admin deactivates a user (soft delete; cannot deactivate own account).
   *
   * We never hard-delete: users own linked records (inquiries, quotes, uploaded
   * documents, audit logs) that must be preserved for history and referential
   * integrity. Deactivating sets `isActive = false`, which blocks login and
   * invalidates existing sessions (enforced in AuthService.validate / login).
   */
  async deleteUser(userId: number, staffUserId: number): Promise<{ id: number }> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    if (user.id === staffUserId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (user.isActive) {
      user.isActive = false;
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

