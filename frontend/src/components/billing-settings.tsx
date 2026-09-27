"use client";

import { useState } from "react";
import type { BillingInfo, CheckoutSessionResponse, PortalSessionResponse, WorkspaceRole } from "@croft/shared-types";

const card = "rounded-xl border border-black/10 bg-white shadow-sm dark:border-white/10 dark:bg-zinc-900";

const planLabel: Record<BillingInfo["plan"], string> = { free: "Free", team: "Team" };

export function BillingSettings({
  workspaceId,
  myRole,
  initialBilling,
  checkoutResult,
}: {
  workspaceId: string;
  myRole: WorkspaceRole;
  initialBilling: BillingInfo;
  checkoutResult: "success" | "cancelled" | null;
}) {
  const [billing, setBilling] = useState(initialBilling);
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManageBilling = myRole === "owner";

  async function goToCheckout() {
    setRedirecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/billing/checkout-session`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? "Could not start checkout.");
        return;
      }
      window.location.href = (body as CheckoutSessionResponse).url;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRedirecting(false);
    }
  }

  async function goToPortal() {
    setRedirecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/billing/portal-session`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.message ?? "Could not open the billing portal.");
        return;
      }
      window.location.href = (body as PortalSessionResponse).url;
    } catch {
      setError("Could not reach the server.");
    } finally {
      setRedirecting(false);
    }
  }

  if (!billing.billingConfigured) {
    return (
      <div className={`${card} p-5`}>
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">Billing isn&apos;t set up</h2>
        <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          This Croft instance hasn&apos;t been configured with Stripe billing, so every workspace runs on the
          free plan. Ask whoever runs this instance to set it up if you need more than{" "}
          {billing.memberLimit ?? 3} members in a workspace.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {checkoutResult === "success" && (
        <p className="rounded-lg border border-green-600/20 bg-green-50 px-4 py-2.5 text-sm text-green-800 dark:border-green-400/20 dark:bg-green-950 dark:text-green-300">
          You&apos;re on the Team plan. It can take a few seconds for the change to show up below.
        </p>
      )}
      {checkoutResult === "cancelled" && (
        <p className="rounded-lg border border-black/10 bg-zinc-50 px-4 py-2.5 text-sm text-zinc-600 dark:border-white/10 dark:bg-zinc-900 dark:text-zinc-400">
          Checkout was cancelled -- no changes were made.
        </p>
      )}

      <div className={`${card} p-5`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
              {planLabel[billing.plan]} plan
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {billing.memberLimit === null
                ? `${billing.memberCount} member${billing.memberCount === 1 ? "" : "s"} -- no limit on the Team plan.`
                : `${billing.memberCount} of ${billing.memberLimit} members used.`}
            </p>
            {billing.plan === "team" && billing.subscriptionStatus && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
                Subscription status: {billing.subscriptionStatus}
              </p>
            )}
          </div>

          {canManageBilling ? (
            billing.plan === "free" ? (
              <button
                onClick={goToCheckout}
                disabled={redirecting}
                className="h-9 shrink-0 rounded-lg bg-brand px-4 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:opacity-50"
              >
                {redirecting ? "Redirecting…" : "Upgrade to Team"}
              </button>
            ) : (
              <button
                onClick={goToPortal}
                disabled={redirecting}
                className="h-9 shrink-0 rounded-lg border border-black/10 px-4 text-sm font-medium text-zinc-800 transition-colors hover:bg-black/[.03] disabled:opacity-50 dark:border-white/10 dark:text-zinc-100 dark:hover:bg-white/[.04]"
              >
                {redirecting ? "Redirecting…" : "Manage billing"}
              </button>
            )
          ) : (
            <p className="text-xs text-zinc-500 dark:text-zinc-500">Only the owner can manage billing.</p>
          )}
        </div>
        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </div>
  );
}
