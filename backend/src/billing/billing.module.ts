import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WorkspacesModule } from '../workspaces/workspaces.module.js';
import { BillingController } from './billing.controller.js';
import { WebhookController } from './webhook.controller.js';
import { BillingService } from './billing.service.js';
import { StripeClientService } from './stripe-client.service.js';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [BillingController, WebhookController],
  providers: [BillingService, StripeClientService],
})
export class BillingModule {}
