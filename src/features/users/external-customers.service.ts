import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { User } from '../auth/entities/user.entity';
import { Role } from '../auth/entities/role.entity';
import { RoleGroup } from '../auth/enums/role-group.enum';
import { ExternalCustomerOptionDto } from './dto/external-customer-option.dto';
import { CreateExternalCustomerDto } from './dto/create-external-customer.dto';

@Injectable()
export class ExternalCustomersService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly configService: ConfigService,
  ) {}

  async listOptions(q?: string, limit = 100): Promise<ExternalCustomerOptionDto[]> {
    const cappedLimit = Math.min(Math.max(limit, 1), 200);
    const query = this.userRepository
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.role', 'role')
      .where('role.roleGroup = :roleGroup', { roleGroup: RoleGroup.EXTERNAL })
      .andWhere('user.isActive = :isActive', { isActive: true })
      .orderBy('user.fullName', 'ASC', 'NULLS LAST')
      .take(cappedLimit);

    const term = q?.trim();
    if (term) {
      query.andWhere(
        '(LOWER(user.fullName) LIKE :term OR LOWER(user.email) LIKE :term OR LOWER(COALESCE(user.company, \'\')) LIKE :term)',
        { term: `%${term.toLowerCase()}%` },
      );
    }

    const rows = await query.getMany();
    return rows.map((row) =>
      ExternalCustomerOptionDto.from({
        id: row.id,
        fullName: row.fullName,
        email: row.email,
        company: row.company,
      }),
    );
  }

  async createForStaff(
    dto: CreateExternalCustomerDto,
    staffUserId: number,
  ): Promise<ExternalCustomerOptionDto> {
    const staff = await this.userRepository.findOne({
      where: { id: staffUserId },
      relations: ['role'],
    });
    if (!staff) {
      throw new BadRequestException('Authenticated staff user not found');
    }
    if (!staff.isInternal()) {
      throw new BadRequestException('Only internal staff can create customer accounts');
    }

    const role = await this.resolveExternalCustomerRole();
    const fullName = dto.fullName.trim();
    const email = await this.allocatePlaceholderEmail(fullName);
    const saltRounds = Number(this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'));
    const password = await bcrypt.hash(
      randomBytes(32).toString('hex'),
      Number.isFinite(saltRounds) && saltRounds >= 10 ? saltRounds : 12,
    );

    const row = this.userRepository.create({
      email,
      password,
      fullName,
      role,
      isActive: true,
      emailVerified: false,
      createdByUserId: staff.id,
    });

    try {
      const saved = await this.userRepository.save(row);
      return ExternalCustomerOptionDto.from({
        id: saved.id,
        fullName: saved.fullName,
        email: saved.email,
        company: saved.company,
      });
    } catch (error: unknown) {
      const code = (error as { code?: string })?.code;
      if (code === '23505') {
        throw new ConflictException('A user with this email already exists');
      }
      throw error;
    }
  }

  private async resolveExternalCustomerRole(): Promise<Role> {
    const configuredId = Number(
      this.configService.get<string>('EXTERNAL_CUSTOMER_ROLE_ID', '4'),
    );
    if (Number.isFinite(configuredId) && configuredId > 0) {
      const byId = await this.roleRepository.findOne({ where: { id: configuredId } });
      if (byId) {
        if (byId.roleGroup !== RoleGroup.EXTERNAL) {
          throw new BadRequestException(
            `Configured role id ${configuredId} is not an EXTERNAL role`,
          );
        }
        return byId;
      }
    }

    const defaultRoleName = this.configService.get<string>(
      'DEFAULT_USER_ROLE',
      'ROLE_USER',
    );
    const byName = await this.roleRepository.findOne({
      where: { name: defaultRoleName, roleGroup: RoleGroup.EXTERNAL },
    });
    if (byName) {
      return byName;
    }

    throw new NotFoundException('External customer role is not configured');
  }

  /** Login not expected; unique placeholder satisfies DB constraint. */
  private async allocatePlaceholderEmail(fullName: string): Promise<string> {
    const domain = this.configService
      .get<string>('EXTERNAL_CUSTOMER_PLACEHOLDER_EMAIL_DOMAIN', 'customers.seatrans.local')
      .trim()
      .toLowerCase();
    const slug = fullName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 24);

    for (let attempt = 0; attempt < 5; attempt++) {
      const token = randomBytes(8).toString('hex');
      const local = slug ? `${slug}.${token}` : `customer.${token}`;
      const email = `${local}@${domain}`;
      const existing = await this.userRepository.findOne({ where: { email } });
      if (!existing) {
        return email;
      }
    }

    throw new ConflictException('Could not allocate a unique placeholder email');
  }
}
