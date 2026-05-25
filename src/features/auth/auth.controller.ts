import { Controller, Post, Body, HttpCode, HttpStatus, Get, Request, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { AuthGuard } from '@nestjs/passport';

@Controller('v1/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get(['me', 'current-user'])
  getProfile(@Request() req: any) {
    const user = req.user;
    return {
       id: user.id,
       email: user.email,
       fullName: user.fullName,
       role: user.role?.name,
       roleGroup: user.role?.roleGroup,
       company: user.company
    };
  }
}
