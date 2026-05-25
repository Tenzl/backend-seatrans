import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './entities/user.entity';
import { Role } from './entities/role.entity';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const existingUser = await this.userRepository.findOne({
      where: { email: registerDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(registerDto.password, 10);

    const newUser = this.userRepository.create({
      ...registerDto,
      password: hashedPassword,
    });

    // Handle role lookup, etc.
    const defaultRoleName = this.configService.get<string>('DEFAULT_USER_ROLE', 'ROLE_USER');
    const defaultRole = await this.roleRepository.findOne({ where: { name: defaultRoleName } });
    if (defaultRole) {
         newUser.role = defaultRole;
    }

    await this.userRepository.save(newUser);

    return this.login({
      email: registerDto.email,
      password: registerDto.password, // Raw password needed here to get the token
    });
  }

  async login(loginDto: LoginDto) {
    const user = await this.userRepository.findOne({
      where: { email: loginDto.email },
      relations: ['role'],
    });

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

    const payload = { 
       sub: user.id, 
       email: user.email, 
       roleGroup: user.role?.roleGroup,
       roles: [user.role?.name].filter(Boolean) 
    };

    return {
      token: this.jwtService.sign(payload),
      type: 'Bearer',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        company: user.company,
        role: user.role?.name,
        roleGroup: user.role?.roleGroup,
      },
    };
  }

  async validateUserContext(userId: number) {
     return this.userRepository.findOne({ where: { id: userId }, relations: ['role'] });
  }
}
