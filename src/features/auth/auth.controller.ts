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
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { AuthGuard } from '@nestjs/passport';
import type { Request, Response } from 'express';
import { SessionExchangeDto } from './dto/session-exchange.dto';
import { SectionAccessService } from '../roles/section-access.service';
import { User } from './entities/user.entity';
import { clearAuthCookie, setAuthCookie } from './auth-cookie';

type AuthenticatedRequest = Request & { user: User };

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sectionAccess: SectionAccessService,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = await this.authService.register(registerDto);
    setAuthCookie(res, auth.token);
    return auth;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = await this.authService.login(loginDto);
    setAuthCookie(res, auth.token);
    return auth;
  }

  /**
   * Transitional endpoint: exchange a Bearer JWT for an HttpOnly cookie session.
   * Used to support legacy OAuth callback flows that returned `?token=...` in the URL.
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  async exchangeSession(
    @Body() dto: SessionExchangeDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const auth = await this.authService.issueSessionFromToken(dto.token);
    if (!auth) {
      throw new UnauthorizedException('Invalid token');
    }
    setAuthCookie(res, auth.token);
    return auth;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    clearAuthCookie(res);
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
