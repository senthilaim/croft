import { Injectable } from '@nestjs/common';
import type { AuthResponse, OidcConfigResponse } from '@croft/shared-types';
import { AuthService } from '../auth.service.js';
import { UsersService } from '../../users/users.service.js';
import { OidcClientService, type OidcAuthorizationRequest } from './oidc-client.service.js';

@Injectable()
export class OidcService {
  constructor(
    private readonly oidcClientService: OidcClientService,
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  get config(): OidcConfigResponse {
    return { enabled: this.oidcClientService.isConfigured, displayName: this.oidcClientService.displayName };
  }

  buildAuthorizationRequest(): Promise<OidcAuthorizationRequest> {
    return this.oidcClientService.buildAuthorizationRequest();
  }

  async handleCallback(params: { code: string; state: string; codeVerifier: string; nonce: string }): Promise<AuthResponse> {
    const { email, name, subject } = await this.oidcClientService.exchangeCode(params);

    // Resolve to the same User an existing password (or earlier OIDC) signup under this email
    // would have produced -- workspace invites (WorkspacesService.inviteMember) are keyed by
    // email, so this is what keeps an invited SSO user landing in the workspace they were
    // actually invited into, whichever way they first signed up.
    let user = await this.usersService.findByEmail(email);
    if (!user) {
      user = await this.usersService.createFromOidc(email, name, subject);
    }

    return this.authService.buildAuthResponse(user);
  }
}
