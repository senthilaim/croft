import { Body, Controller, Get, Post } from '@nestjs/common';
import type { AuthResponse, OidcAuthorizeUrlResponse, OidcConfigResponse } from '@croft/shared-types';
import { OidcService } from './oidc.service.js';
import { OidcCallbackDto } from './dto/oidc-callback.dto.js';

// All three routes are unauthenticated (no JwtAuthGuard) -- no Croft session exists yet at any
// point in this flow. Deliberately outside workspaces/:id, same reasoning as auth.controller.ts.
@Controller('auth/oidc')
export class OidcController {
  constructor(private readonly oidcService: OidcService) {}

  /** Public capability probe -- lets the frontend decide whether to render the "Continue with
   * SSO" button without ever holding a copy of the backend's OIDC env vars itself. */
  @Get('config')
  config(): OidcConfigResponse {
    return this.oidcService.config;
  }

  @Get('authorize-url')
  async authorizeUrl(): Promise<OidcAuthorizeUrlResponse & { state: string; nonce: string; codeVerifier: string }> {
    return this.oidcService.buildAuthorizationRequest();
  }

  @Post('callback')
  callback(@Body() dto: OidcCallbackDto): Promise<AuthResponse> {
    return this.oidcService.handleCallback(dto);
  }
}
