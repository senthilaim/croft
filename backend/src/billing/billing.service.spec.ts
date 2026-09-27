import { describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { BillingService } from './billing.service.js';
import { StripeClientService } from './stripe-client.service.js';

// Real signing secret + real Stripe SDK helper (`generateTestHeaderString`) -- this produces the
// exact same `Stripe-Signature` header format a live webhook delivery would carry, so verifying
// against it is a real test of `constructEvent`, not a hand-rolled fake of Stripe's HMAC scheme.
const WEBHOOK_SECRET = 'whsec_test_secret';

function stripeClientWith(secret: string): StripeClientService {
  const configValues: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test_dummy',
    STRIPE_WEBHOOK_SECRET: secret,
    STRIPE_TEAM_PRICE_ID: 'price_dummy',
  };
  const configService = { get: (key: string) => configValues[key], getOrThrow: (key: string) => configValues[key] };
  return new StripeClientService(configService as never);
}

function signedPayload(payload: string, secret: string) {
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
  return { payload, header };
}

describe('BillingService.handleWebhookEvent -- signature verification', () => {
  const payload = JSON.stringify({
    id: 'evt_test',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: { object: { id: 'sub_test', object: 'subscription', customer: 'cus_test', status: 'canceled' } },
  });

  it('accepts a payload signed with the configured webhook secret', async () => {
    const workspacesService = { findByStripeCustomerId: () => Promise.resolve(null) };
    const service = new BillingService(stripeClientWith(WEBHOOK_SECRET), workspacesService as never);
    const { header } = signedPayload(payload, WEBHOOK_SECRET);

    // No workspace maps to 'sub_test' here, so onSubscriptionChanged is a no-op -- the point of
    // this assertion is that constructEvent's signature check did not throw.
    await expect(service.handleWebhookEvent(Buffer.from(payload), header)).resolves.toBeUndefined();
  });

  it('rejects a payload whose signature was generated with the wrong secret', async () => {
    const service = new BillingService(stripeClientWith(WEBHOOK_SECRET), {} as never);
    const { header } = signedPayload(payload, 'whsec_a_different_secret');

    await expect(service.handleWebhookEvent(Buffer.from(payload), header)).rejects.toThrow(
      /signature/i,
    );
  });

  it('rejects a payload that was tampered with after signing', async () => {
    const service = new BillingService(stripeClientWith(WEBHOOK_SECRET), {} as never);
    const { header } = signedPayload(payload, WEBHOOK_SECRET);
    const tamperedPayload = payload.replace('sub_test', 'sub_attacker_controlled');

    await expect(service.handleWebhookEvent(Buffer.from(tamperedPayload), header)).rejects.toThrow(
      /signature/i,
    );
  });

  it('ignores an unhandled event type without touching WorkspacesService', async () => {
    const workspacesService = {
      findByStripeCustomerId: () => {
        throw new Error('should not be called for an unhandled event type');
      },
    };
    const service = new BillingService(stripeClientWith(WEBHOOK_SECRET), workspacesService as never);
    const unhandledPayload = JSON.stringify({
      id: 'evt_test_2',
      object: 'event',
      type: 'invoice.paid',
      data: { object: { id: 'in_test', object: 'invoice' } },
    });
    const { header } = signedPayload(unhandledPayload, WEBHOOK_SECRET);

    await expect(service.handleWebhookEvent(Buffer.from(unhandledPayload), header)).resolves.toBeUndefined();
  });
});

describe('BillingService.handleWebhookEvent -- event handling', () => {
  it('checkout.session.completed activates the team plan with the session\'s customer/subscription ids', async () => {
    const calls: unknown[] = [];
    const workspacesService = {
      activateTeamPlan: (workspaceId: string, fields: unknown) => {
        calls.push([workspaceId, fields]);
        return Promise.resolve();
      },
    };
    const service = new BillingService(stripeClientWith(WEBHOOK_SECRET), workspacesService as never);
    const payload = JSON.stringify({
      id: 'evt_checkout',
      object: 'event',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test',
          object: 'checkout.session',
          client_reference_id: 'workspace-123',
          metadata: { workspaceId: 'workspace-123' },
          customer: 'cus_test',
          subscription: 'sub_test',
        },
      },
    });
    const { header } = signedPayload(payload, WEBHOOK_SECRET);

    await service.handleWebhookEvent(Buffer.from(payload), header);

    expect(calls).toEqual([
      [
        'workspace-123',
        { stripeCustomerId: 'cus_test', stripeSubscriptionId: 'sub_test', stripeSubscriptionStatus: 'active' },
      ],
    ]);
  });

  it('customer.subscription.deleted downgrades the matching workspace to free', async () => {
    const calls: unknown[] = [];
    const workspace = { id: 'workspace-456' };
    const workspacesService = {
      findByStripeCustomerId: (customerId: string) => (customerId === 'cus_test' ? Promise.resolve(workspace) : Promise.resolve(null)),
      syncSubscriptionStatus: (ws: unknown, status: string, isActive: boolean) => {
        calls.push([ws, status, isActive]);
        return Promise.resolve();
      },
    };
    const service = new BillingService(stripeClientWith(WEBHOOK_SECRET), workspacesService as never);
    const payload = JSON.stringify({
      id: 'evt_sub_deleted',
      object: 'event',
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_test', object: 'subscription', customer: 'cus_test', status: 'canceled' } },
    });
    const { header } = signedPayload(payload, WEBHOOK_SECRET);

    await service.handleWebhookEvent(Buffer.from(payload), header);

    expect(calls).toEqual([[workspace, 'canceled', false]]);
  });
});
