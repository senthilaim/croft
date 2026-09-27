import { BadRequestException, Controller, Headers, HttpException, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BillingService } from './billing.service.js';

// Deliberately outside workspaces/:id -- Stripe calls this directly with no bearer token, and
// deliberately no JwtAuthGuard here: authenticity comes entirely from the signature check inside
// BillingService.handleWebhookEvent, not from Nest's normal auth pipeline.
@Controller('billing/webhook')
export class WebhookController {
  constructor(private readonly billingService: BillingService) {}

  @Post()
  async handle(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') signature?: string): Promise<{ received: true }> {
    if (!req.rawBody || !signature) {
      throw new BadRequestException('Missing raw body or Stripe-Signature header');
    }
    try {
      await this.billingService.handleWebhookEvent(req.rawBody, signature);
    } catch (err) {
      if (err instanceof HttpException) throw err; // e.g. billing not configured -- keep its own status
      // constructEvent throws a plain Error (Stripe's own SignatureVerificationError) on a bad
      // signature or tampered payload -- surfaced as 400, not Nest's default 500, since this is a
      // client (Stripe-the-caller) error, not a server bug.
      throw new BadRequestException(err instanceof Error ? err.message : 'Webhook verification failed');
    }
    return { received: true };
  }
}
