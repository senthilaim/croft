import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { AuthResponse, AuthTokens, User as UserDto } from '@croft/shared-types';
import { UsersService } from '../users/users.service.js';
import type { UserDocument } from '../users/schemas/user.schema.js';

interface JwtPayload {
  sub: string;
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL = '7d';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async signup(email: string, password: string, name: string): Promise<AuthResponse> {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.usersService.create(email, passwordHash, name);
    return this.buildAuthResponse(user);
  }

  async signin(email: string, password: string): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid email or password');

    // An OIDC-only account has no passwordHash -- reject with the exact same generic message as
    // a wrong password or a nonexistent account, rather than throwing on a null bcrypt.compare
    // argument. Never surfaces "this account uses SSO" to an unauthenticated caller.
    if (!user.passwordHash) throw new UnauthorizedException('Invalid email or password');

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) throw new UnauthorizedException('Invalid email or password');

    return this.buildAuthResponse(user);
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(refreshToken, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException('Invalid or expired refresh token');

    return this.issueTokens(user.id);
  }

  async validateUserId(userId: string): Promise<UserDocument | null> {
    return this.usersService.findById(userId);
  }

  /** Public so the OIDC callback path (backend/src/auth/oidc/oidc.service.ts) can mint the same
   * Croft-native JWT pair a password signin/signup would, for a User it resolved itself. */
  async buildAuthResponse(user: UserDocument): Promise<AuthResponse> {
    const tokens = await this.issueTokens(user.id);
    return { ...tokens, user: toUserDto(user) };
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: ACCESS_TOKEN_TTL,
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: REFRESH_TOKEN_TTL,
      }),
    ]);
    return { accessToken, refreshToken };
  }
}

export function toUserDto(user: UserDocument): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: (user as UserDocument & { createdAt: Date }).createdAt.toISOString(),
  };
}
