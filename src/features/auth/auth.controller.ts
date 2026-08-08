import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  Req,
  UseGuards,
  Patch,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { SectionAccessService } from '../roles/section-access.service';
import { User } from './entities/user.entity';
import {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  setAuthCookie,
} from './auth-cookie';
import {
  LoginThrottleService,
  sleep,
} from './login-throttle.service';

type AuthenticatedRequest = Request & { user: User };

function extractPresentedAuthToken(req: Request): string | null {
  const cookies = (
    req as Request & { cookies?: Record<string, unknown> }
  ).cookies;
  const cookieToken = cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken;
  }
  const header = req.headers?.authorization;
  if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
    const token = header.slice(7).trim();
    return token || null;
  }
  return null;
}

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sectionAccess: SectionAccessService,
    private readonly loginThrottle: LoginThrottleService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = await this.authService.register(registerDto);
    setAuthCookie(res, auth.token, auth.cookieMaxAgeMs);
    return { user: auth.user };
  }

  /**
   * SEC-04: IP+identifier throttle/lockout (in-memory) plus a tighter per-IP
   * Nest throttler ceiling so burst floods fail closed before bcrypt.
   */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.loginThrottle.assertAllowed(req, loginDto.identifier);
    const delayMs = this.loginThrottle.delayMsFor(req, loginDto.identifier);
    if (delayMs > 0) {
      await sleep(delayMs);
    }

    try {
      const auth = await this.authService.login(loginDto);
      this.loginThrottle.recordSuccess(req, loginDto.identifier);
      setAuthCookie(res, auth.token, auth.cookieMaxAgeMs);
      return { user: auth.user };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.loginThrottle.recordFailure(req, loginDto.identifier);
      }
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = extractPresentedAuthToken(req);
    clearAuthCookie(res);
    await this.authService.revokeSessionFromToken(token);
    return { ok: true };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(['me', 'current-user'])
  async getProfile(@Req() req: AuthenticatedRequest) {
    const user = this.authService.toPublicUser(req.user);
    // Dashboard section keys this user's role may access — drives nav + route
    // gating on the frontend (admins implicitly get the whole catalog).
    const sections = await this.sectionAccess.getSectionsForUser(req.user);
    return { ...user, sections };
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('me')
  async updateMe(@Req() req: AuthenticatedRequest, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(req.user.id, dto);
  }
}
