import { Controller, Post, Body, HttpCode, HttpStatus, Get, Request, UseGuards, Patch, Res, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { SessionExchangeDto } from './dto/session-exchange.dto';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const auth = await this.authService.register(registerDto);
    this.setAuthCookie(res, auth.token);
    return auth;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const auth = await this.authService.login(loginDto);
    this.setAuthCookie(res, auth.token);
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
    this.setAuthCookie(res, auth.token);
    return auth;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('auth_token', this.cookieOptions());
    return { ok: true };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(['me', 'current-user'])
  getProfile(@Request() req: any) {
    return this.authService.toPublicUser(req.user);
  }

  @UseGuards(AuthGuard('jwt'))
  @Patch('me')
  async updateMe(@Request() req: any, @Body() dto: UpdateMeDto) {
    return this.authService.updateMe(req.user.id, dto);
  }

  private setAuthCookie(res: Response, token: string) {
    res.cookie('auth_token', token, this.cookieOptions());
  }

  private cookieOptions() {
    const isProd = process.env.NODE_ENV === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: (isProd ? 'none' : 'lax') as 'none' | 'lax',
      path: '/',
      maxAge: 1000 * 60 * 60 * 24, // 1 day
    };
  }
}
