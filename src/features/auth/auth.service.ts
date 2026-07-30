import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'node:crypto';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ConfigService } from '@nestjs/config';
import { UpdateMeDto } from './dto/update-me.dto';
import { OAuthUserProfile } from './dto/oauth-profile.dto';
import {
  loadSessionPolicyFromEnv,
  remainingAbsoluteSeconds,
  resolveAbsoluteSeconds,
  shouldSlideSession,
  toJwtExpiresIn,
  type SessionJwtClaims,
  type SessionPolicyConfig,
} from './session-policy';

export type AuthUserPayload = {
  id: number;
  email: string;
  username: string | null;
  fullName: string | null;
  phone: string | null;
  company: string | null;
  role: string | undefined;
  roleGroup: string | null | undefined;
  oauthProvider: string | null;
  emailVerified: boolean;
};

export type AuthSessionResponse = {
  token: string;
  type: 'Bearer';
  user: AuthUserPayload;
  cookieMaxAgeMs: number;
};

@Injectable()
export class AuthService {
  private readonly sessionPolicy: SessionPolicyConfig;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.sessionPolicy = loadSessionPolicyFromEnv({
      get: (key, defaultValue) =>
        defaultValue === undefined
          ? this.configService.get<string>(key)
          : this.configService.get<string>(key, defaultValue),
    });
  }

  async register(registerDto: RegisterDto) {
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const usernameRaw = registerDto.username?.trim();
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

    const saltRounds = Number(
      this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'),
    );
    const hashedPassword = await bcrypt.hash(
      registerDto.password,
      Number.isFinite(saltRounds) && saltRounds >= 10 ? saltRounds : 12,
    );

    const newUser = this.userRepository.create({
      ...registerDto,
      username,
      password: hashedPassword,
    });

    // Handle role lookup, etc.
    const defaultRoleName = this.configService.get<string>(
      'DEFAULT_USER_ROLE',
      'ROLE_USER',
    );
    const defaultRole = await this.roleRepository.findOne({
      where: { name: defaultRoleName },
    });
    if (defaultRole) {
      newUser.role = defaultRole;
    }

    await this.userRepository.save(newUser);

    return this.login({
      identifier: registerDto.email,
      password: registerDto.password, // Raw password needed here to get the token
    });
  }

  async login(loginDto: LoginDto) {
    const raw = loginDto.identifier.trim();
    const identifier = raw.toLowerCase();

    const user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .where('LOWER(user.email) = :identifier', { identifier })
      .orWhere("LOWER(COALESCE(user.username, '')) = :identifier", {
        identifier,
      })
      .getOne();

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(loginDto.password, user.password);

    if (!isMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account disabled');
    }

    user.lastLogin = new Date();
    await this.userRepository.save(user);

    return this.buildAuthResponse(user, {
      remember: loginDto.remember === true,
    });
  }

  /**
   * Issue a cookie JWT. `auth_time` is fixed at login; sliding refresh reuses it.
   * Token TTL = min(idle, remaining absolute) so activity cannot exceed the ceiling.
   */
  buildAuthResponse(
    user: User,
    options?: { remember?: boolean; authTime?: number },
  ): AuthSessionResponse {
    const now = Math.floor(Date.now() / 1000);
    const remember = options?.remember === true;
    const auth_time = options?.authTime ?? now;
    const absoluteSeconds = resolveAbsoluteSeconds(this.sessionPolicy, {
      remember,
      roleGroup: user.role?.roleGroup,
    });
    const remainingAbsolute = remainingAbsoluteSeconds(
      auth_time,
      absoluteSeconds,
      now,
    );
    if (remainingAbsolute <= 0) {
      throw new UnauthorizedException('Session expired — please sign in again');
    }

    const expiresInSeconds = Math.min(
      this.sessionPolicy.idleSeconds,
      remainingAbsolute,
    );
    const roles = [user.role?.name].filter(
      (name): name is string => typeof name === 'string' && name.length > 0,
    );
    const payload: SessionJwtClaims = {
      sub: user.id,
      email: user.email,
      roleGroup: user.role?.roleGroup,
      roles,
      auth_time,
      remember,
    };

    return {
      token: this.jwtService.sign(payload, {
        expiresIn: toJwtExpiresIn(expiresInSeconds),
      }),
      type: 'Bearer',
      user: this.toAuthUserPayload(user),
      cookieMaxAgeMs: expiresInSeconds * 1000,
    };
  }

  isAbsoluteSessionExpired(claims: SessionJwtClaims, user: User): boolean {
    const absoluteSeconds = resolveAbsoluteSeconds(this.sessionPolicy, {
      remember: claims.remember,
      roleGroup: user.role?.roleGroup ?? claims.roleGroup,
    });
    return remainingAbsoluteSeconds(claims.auth_time, absoluteSeconds) <= 0;
  }

  /**
   * Sliding refresh: when idle expiry is within slide-before window, re-sign
   * with the same auth_time/remember (absolute ceiling unchanged).
   */
  maybeSlideSession(
    user: User,
    claims: SessionJwtClaims,
  ): AuthSessionResponse | null {
    if (this.isAbsoluteSessionExpired(claims, user)) {
      return null;
    }
    if (
      !shouldSlideSession(claims.exp, this.sessionPolicy.slideBeforeSeconds)
    ) {
      return null;
    }
    return this.buildAuthResponse(user, {
      remember: claims.remember,
      authTime: claims.auth_time,
    });
  }

  private toAuthUserPayload(user: User): AuthUserPayload {
    return {
      id: user.id,
      email: user.email,
      username: user.username ?? null,
      fullName: user.fullName ?? null,
      phone: user.phone ?? null,
      company: user.company ?? null,
      role: user.role?.name,
      roleGroup: user.role?.roleGroup,
      oauthProvider: user.oauthProvider ?? null,
      emailVerified: user.emailVerified ?? false,
    };
  }

  toPublicUser(user: User) {
    return this.toAuthUserPayload(user);
  }

  async findOrCreateOAuthUser(profile: OAuthUserProfile): Promise<User> {
    const normalizedEmail = profile.email.trim().toLowerCase();
    const fullName = profile.fullName?.trim() || normalizedEmail.split('@')[0];

    let user = await this.userRepository.findOne({
      where: {
        oauthProvider: profile.provider,
        oauthProviderId: profile.providerId,
      },
      relations: ['role'],
    });

    if (user) {
      return this.applyOAuthLogin(user, profile, normalizedEmail, fullName);
    }

    user = await this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect('user.role', 'role')
      .where('LOWER(user.email) = :email', { email: normalizedEmail })
      .getOne();

    if (user) {
      user.oauthProvider = profile.provider;
      user.oauthProviderId = profile.providerId;
      return this.applyOAuthLogin(user, profile, normalizedEmail, fullName);
    }

    const saltRounds = Number(
      this.configService.get<string>('BCRYPT_SALT_ROUNDS', '12'),
    );
    const hashedPassword = await bcrypt.hash(
      randomUUID(),
      Number.isFinite(saltRounds) && saltRounds >= 10 ? saltRounds : 12,
    );

    const oauthRoleName =
      this.configService.get<string>('DEFAULT_OAUTH_ROLE', 'ROLE_CUSTOMER') ||
      this.configService.get<string>('DEFAULT_USER_ROLE', 'ROLE_USER');
    const oauthRole = await this.roleRepository.findOne({
      where: { name: oauthRoleName },
    });

    const newUser = this.userRepository.create({
      email: normalizedEmail,
      fullName,
      password: hashedPassword,
      isActive: true,
      emailVerified: profile.emailVerified,
      oauthProvider: profile.provider,
      oauthProviderId: profile.providerId,
      role: oauthRole ?? undefined,
    });

    return this.saveOAuthUser(newUser, normalizedEmail);
  }

  private applyOAuthLogin(
    user: User,
    profile: OAuthUserProfile,
    normalizedEmail: string,
    fullName: string,
  ): Promise<User> {
    user.emailVerified = profile.emailVerified || user.emailVerified;
    user.lastLogin = new Date();
    if (!user.fullName?.trim() && fullName) {
      user.fullName = fullName;
    }
    if (user.email.toLowerCase() !== normalizedEmail) {
      user.email = normalizedEmail;
    }
    return this.userRepository.save(user);
  }

  private async saveOAuthUser(
    user: User,
    normalizedEmail: string,
  ): Promise<User> {
    try {
      return await this.userRepository.save(user);
    } catch (error) {
      if (this.isUsersPrimaryKeyConflict(error)) {
        await this.syncUsersIdSequence();
        return this.userRepository.save(user);
      }

      if (this.isUsersEmailConflict(error)) {
        const existing = await this.userRepository
          .createQueryBuilder('user')
          .leftJoinAndSelect('user.role', 'role')
          .where('LOWER(user.email) = :email', { email: normalizedEmail })
          .getOne();

        if (existing) {
          existing.oauthProvider = user.oauthProvider;
          existing.oauthProviderId = user.oauthProviderId;
          existing.emailVerified = user.emailVerified || existing.emailVerified;
          existing.lastLogin = new Date();
          if (!existing.fullName?.trim() && user.fullName) {
            existing.fullName = user.fullName;
          }
          return this.userRepository.save(existing);
        }
      }

      throw error;
    }
  }

  private isUsersPrimaryKeyConflict(error: unknown): boolean {
    return this.isPostgresUniqueViolation(
      error,
      'PK_a3ffb1c0c8416b9fc6f907b7433',
    );
  }

  private isUsersEmailConflict(error: unknown): boolean {
    const pgError = error as { constraint?: string; detail?: string };
    return (
      this.isPostgresUniqueViolation(error) &&
      (pgError.constraint?.includes('email') === true ||
        pgError.detail?.includes('(email)') === true)
    );
  }

  private isPostgresUniqueViolation(
    error: unknown,
    constraint?: string,
  ): boolean {
    const pgError = error as { code?: string; constraint?: string };
    if (pgError.code !== '23505') return false;
    if (!constraint) return true;
    return pgError.constraint === constraint;
  }

  private async syncUsersIdSequence(): Promise<void> {
    await this.userRepository.query(
      `SELECT setval(
        pg_get_serial_sequence('users', 'id'),
        COALESCE((SELECT MAX(id) FROM users), 1)
      )`,
    );
  }

  async validateUserContext(userId: number) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!user) return null;
    // Never attach password hash to req.user (defense in depth)
    delete user.password;
    return user;
  }

  async updateMe(userId: number, dto: UpdateMeDto) {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (typeof dto.fullName === 'string') {
      user.fullName = dto.fullName.trim();
    }
    if (typeof dto.phone === 'string') {
      user.phone = dto.phone.trim();
    }
    if (typeof dto.company === 'string') {
      user.company = dto.company.trim();
    }

    await this.userRepository.save(user);
    const saved = await this.userRepository.findOne({
      where: { id: userId },
      relations: ['role'],
    });
    if (!saved) throw new NotFoundException('User not found');

    // Return plain user payload; global ResponseInterceptor wraps it once.
    return this.toAuthUserPayload(saved);
  }
}
