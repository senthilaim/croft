import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { OidcController } from './oidc/oidc.controller.js';
import { OidcService } from './oidc/oidc.service.js';
import { OidcClientService } from './oidc/oidc-client.service.js';

@Module({
  imports: [UsersModule, JwtModule.register({})],
  controllers: [AuthController, OidcController],
  providers: [AuthService, JwtAuthGuard, OidcService, OidcClientService],
  exports: [JwtModule, JwtAuthGuard],
})
export class AuthModule {}
