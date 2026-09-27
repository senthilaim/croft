import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * The one place `STRIPE_SECRET_KEY` is read. Unlike every other secret in this app
 * (JWT_ACCESS_SECRET, AUTOMATION_INTERNAL_TOKEN, ...), Stripe is genuinely optional -- a
 * self-hoster who never wants to charge anyone should still get a fully working Croft. So this
 * uses `configService.get()` (no default, may be undefined), not `.getOrThrow()`, and the app
 * boots fine either way. Every billing operation calls `requireClient()` first and gets a clear,
 * typed 503 instead of a null-pointer crash if billing was never configured.
 */
@Injectable()
export class StripeClientService {
  private readonly client: Stripe | null;

  constructor(private readonly configService: ConfigService) {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.client = secretKey ? new Stripe(secretKey) : null;
  }

  get isConfigured(): boolean {
    return this.client !== null;
  }

  requireClient(): Stripe {
    if (!this.client) {
      throw new ServiceUnavailableException("Billing isn't configured on this Croft instance.");
    }
    return this.client;
  }

  get webhookSecret(): string {
    return this.configService.getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  }

  get teamPriceId(): string {
    return this.configService.getOrThrow<string>('STRIPE_TEAM_PRICE_ID');
  }
}
