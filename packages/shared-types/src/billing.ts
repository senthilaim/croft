import type { WorkspacePlan } from "./workspace.js";

export interface BillingInfo {
  plan: WorkspacePlan;
  /** Stripe's own subscription status string (e.g. "active", "past_due", "canceled") -- null on
   * the free plan or if billing was never configured for this workspace. */
  subscriptionStatus: string | null;
  memberCount: number;
  /** null on the 'team' plan -- no enforced cap. */
  memberLimit: number | null;
  /** False when this Croft instance has no Stripe keys configured at all -- the frontend shows a
   * "billing isn't set up" message instead of upgrade/manage buttons. */
  billingConfigured: boolean;
}

export interface CheckoutSessionResponse {
  url: string;
}

export interface PortalSessionResponse {
  url: string;
}
