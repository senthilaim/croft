# Compliance drafts

**Status: DRAFT, unreviewed.** Written as a starting point for Phase 0 of the enterprise-RBE-parity
roadmap ("start the SOC2 clock now, not later"), describing Croft's *actual current* controls as of
2026-10-06 -- not aspirational claims, and not generic boilerplate. Each document says plainly where
a real control exists today versus where there's a real gap.

These are **not** official policy. Before they're adopted as such:

- A real compliance-automation tool (Vanta/Drata/Secureframe) should be evaluated and likely
  replace these as the system of record -- that's a vendor/budget decision for the business to
  make, not something written into the repo.
- Someone with actual legal/compliance authority needs to review and formally approve them.
- The gaps each document flags (most importantly: **no audit-logging system exists yet**) need a
  real decision on priority and timeline, not just a mention here.

## Documents

- [`access-control-policy.md`](access-control-policy.md) -- authentication, authorization, and
  secrets handling as implemented today.
- [`incident-response-plan.md`](incident-response-plan.md) -- the process to follow when something
  goes wrong. No real incident history exists yet (that's Phase 3 of the roadmap, by definition --
  it only accumulates by operating for real over time); this is the plan for when one happens.
- [`vendor-risk-management-policy.md`](vendor-risk-management-policy.md) -- the current
  subprocessor list and the framework for evaluating new ones.

See also: the [enterprise RBE parity roadmap](https://claude.ai/code/artifact/fdcc742e-4517-4d9c-9966-74a635871aaf)
these drafts are Phase 0 of, and `automation/terraform/buildfarm-aws/VALIDATION.md` for the
infrastructure-specific (not policy-level) real-AWS validation and chaos-test runbook.
