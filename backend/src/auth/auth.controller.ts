import { Body, Controller, Get, NotFoundException, Post, UseGuards } from '@nestjs/common';
import type { AuthResponse, AuthTokens, User } from '@croft/shared-types';
import { AuthService, toUserDto } from './auth.service.js';
import { SignupDto } from './dto/signup.dto.js';
import { SigninDto } from './dto/signin.dto.js';
import { RefreshDto } from './dto/refresh.dto.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { CurrentUserId } from './current-user-id.decorator.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('signup')
  signup(@Body() dto: SignupDto): Promise<AuthResponse> {
    return this.authService.signup(dto.email, dto.password, dto.name);
  }

  @Post('signin')
  signin(@Body() dto: SigninDto): Promise<AuthResponse> {
    return this.authService.signin(dto.email, dto.password);
  }

  @Post('refresh')
  refresh(@Body() dto: RefreshDto): Promise<AuthTokens> {
    return this.authService.refresh(dto.refreshToken);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUserId() userId: string): Promise<User> {
    const user = await this.authService.validateUserId(userId);
    if (!user) throw new NotFoundException('User not found');
    return toUserDto(user);
  }
}
