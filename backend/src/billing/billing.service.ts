import { BadRequestException, Injectable } from '@nestjs/common';
import type Stripe from 'stripe';
import type { BillingInfo } from '@croft/shared-types';
import { FREE_PLAN_MEMBER_LIMIT, getPlan, WorkspacesService } from '../workspaces/workspaces.service.js';
import { WorkspaceDocument } from '../workspaces/schemas/workspace.schema.js';
import { StripeClientService } from './stripe-client.service.js';

// A subscription in either of these statuses is what "on the team plan" means -- everything else
// (past_due, canceled, unpaid, incomplete_expired, ...) downgrades the workspace back to 'free'.
const ACTIVE_SUBSCRIPTION_STATUSES = new Set<Stripe.Subscription.Status>(['active', 'trialing']);

@Injectable()
export class BillingService {
  constructor(
    private readonly stripeClient: StripeClientService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  getBillingInfo(workspace: WorkspaceDocument): BillingInfo {
    const plan = getPlan(workspace);
    return {
      plan,
      subscriptionStatus: workspace.stripeSubscriptionStatus,
      memberCount: 1 + workspace.members.length,
      memberLimit: plan === 'free' ? FREE_PLAN_MEMBER_LIMIT : null,
      billingConfigured: this.stripeClient.isConfigured,
    };
  }

  async createCheckoutSession(workspace: WorkspaceDocument, successUrl: string, cancelUrl: string): Promise<string> {
    const stripe = this.stripeClient.requireClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: this.stripeClient.teamPriceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: workspace.id,
      metadata: { workspaceId: workspace.id },
      customer: workspace.stripeCustomerId ?? undefined,
    });
    if (!session.url) {
      throw new BadRequestException('Stripe did not return a checkout URL -- please try again.');
    }
    return session.url;
  }

  async createPortalSession(workspace: WorkspaceDocument, returnUrl: string): Promise<string> {
    const stripe = this.stripeClient.requireClient();
    if (!workspace.stripeCustomerId) {
      throw new BadRequestException('This workspace has no billing account yet -- upgrade to Team first.');
    }
    const session = await stripe.billingPortal.sessions.create({
      customer: workspace.stripeCustomerId,
      return_url: returnUrl,
    });
    return session.url;
  }

  /** `rawBody` must be the untouched request body Stripe signed -- a re-serialized JSON object
   * will never verify, even if the contents are byte-identical, since JSON.stringify's key order/
   * spacing isn't guaranteed to match what Stripe originally sent. */
  async handleWebhookEvent(rawBody: Buffer, signature: string): Promise<void> {
    const stripe = this.stripeClient.requireClient();
    const event = stripe.webhooks.constructEvent(rawBody, signature, this.stripeClient.webhookSecret);

    switch (event.type) {
      case 'checkout.session.completed':
        await this.onCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        await this.onSubscriptionChanged(event.data.object as Stripe.Subscription);
        break;
      default:
        break; // unhandled event types are intentionally ignored, not an error
    }
  }

  private async onCheckoutSessionCompleted(session: Stripe.Checkout.Session): Promise<void> {
    const workspaceId = session.metadata?.workspaceId ?? session.client_reference_id;
    const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
    if (!workspaceId || !customerId || !subscriptionId) return; // not a subscription checkout we recognize

    await this.workspacesService.activateTeamPlan(workspaceId, {
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscriptionId,
      stripeSubscriptionStatus: 'active',
    });
  }

  private async onSubscriptionChanged(subscription: Stripe.Subscription): Promise<void> {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const workspace = await this.workspacesService.findByStripeCustomerId(customerId);
    if (!workspace) return; // no workspace maps to this customer (e.g. a test event) -- nothing to sync

    const isActive = ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status);
    await this.workspacesService.syncSubscriptionStatus(workspace, subscription.status, isActive);
  }
}
