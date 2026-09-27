import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BillingInfo, CheckoutSessionResponse, PortalSessionResponse } from '@croft/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { WorkspaceMembershipGuard } from '../workspaces/workspace-membership.guard.js';
import { WorkspaceRoleGuard } from '../workspaces/workspace-role.guard.js';
import { CurrentWorkspace } from '../workspaces/current-workspace.decorator.js';
import type { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { BillingService } from './billing.service.js';

// The redirect URLs are built here from server-side config, never taken from the client -- a
// POST body letting the caller name its own successUrl/cancelUrl would be an open-redirect-shaped
// footgun for no real benefit, since there's only ever one place to send someone back to.
function frontendUrl(configService: ConfigService, path: string): string {
  const origin = configService.get<string>('FRONTEND_ORIGIN', 'http://localhost:3000');
  return `${origin}${path}`;
}

@Controller('workspaces/:id/billing')
@UseGuards(JwtAuthGuard, WorkspaceMembershipGuard)
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  @UseGuards(WorkspaceRoleGuard('owner', 'admin'))
  get(@CurrentWorkspace() workspace: WorkspaceDocument): BillingInfo {
    return this.billingService.getBillingInfo(workspace);
  }

  @Post('checkout-session')
  @UseGuards(WorkspaceRoleGuard('owner'))
  async createCheckoutSession(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<CheckoutSessionResponse> {
    const billingPath = `/workspaces/${workspace.id}/settings/billing`;
    const url = await this.billingService.createCheckoutSession(
      workspace,
      frontendUrl(this.configService, `${billingPath}?checkout=success`),
      frontendUrl(this.configService, `${billingPath}?checkout=cancelled`),
    );
    return { url };
  }

  @Post('portal-session')
  @UseGuards(WorkspaceRoleGuard('owner'))
  async createPortalSession(@CurrentWorkspace() workspace: WorkspaceDocument): Promise<PortalSessionResponse> {
    const url = await this.billingService.createPortalSession(
      workspace,
      frontendUrl(this.configService, `/workspaces/${workspace.id}/settings/billing`),
    );
    return { url };
  }
}
