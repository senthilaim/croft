# Incident response plan (DRAFT)

See [README.md](README.md) for status. No real incident has happened yet -- that's expected this
early (Phase 3 of the enterprise-RBE-parity roadmap is specifically "a real incident history,"
which by definition only accumulates by operating for real over time). This is the plan for when
one does, not a record of past ones. It should be revised the first time it's actually used --
a plan that survives contact with a real incident unchanged either got lucky or wasn't read closely.

## What counts as an incident

Any of: unauthorized access to a customer's data or AWS resources, a credential (ours or a
customer's, stored per [access-control-policy.md](access-control-policy.md)) suspected
compromised, a service outage affecting customer-provisioned Buildfarms, data loss, or a
vulnerability under active exploitation. When in doubt, treat it as one -- the cost of a false
alarm is far lower than the cost of a slow response to a real one.

## Severity (used to set response urgency, not to gatekeep whether to respond at all)

- **Critical**: active data breach, credential compromise with confirmed misuse, or an outage
  affecting all customers.
- **High**: a confirmed vulnerability with a known exploitation path, even if not yet exploited; an
  outage affecting a subset of customers.
- **Medium/Low**: a vulnerability found via scanning (see `.github/workflows/security-scan.yml`)
  with no known active exploitation; a degraded-but-functioning state.

## Response steps

1. **Contain.** Stop the bleeding first, understand it fully second. For a suspected compromised
   AWS credential: revoke/rotate it immediately (a customer's own `CloudCredential` can be
   disconnected via the existing Settings > Cloud flow; Croft's own secrets rotate via
   `TOKEN_ENCRYPTION_KEY` + the relevant third-party console). For a code-level vulnerability:
   the fix ships as any other change would (see this repo's own git/PR discipline), expedited.
2. **Assess scope.** What was actually accessed/affected, which workspaces/customers, over what
   window. Given the audit-logging gap documented in
   [access-control-policy.md](access-control-policy.md), this step is currently harder than it
   should be -- expect to lean on whatever operational logs exist, AWS CloudTrail on the
   customer's own account (since Croft provisions into the customer's AWS account, not its own),
   and direct database inspection, not a clean audit trail. This gap is exactly why closing it is
   flagged as a priority there, not a nice-to-have.
3. **Notify.** Affected customers, as soon as there's something concrete and accurate to tell
   them -- not before scope is understood well enough to avoid contradicting yourself later, but
   not so late that they hear about it elsewhere first. No fixed SLA defined yet (a real
   compliance tool and legal review should set one); until then, the operating assumption is "as
   soon as the facts are solid, measured in hours for Critical, not days."
4. **Remediate.** Fix the root cause, not just the symptom. Ship the fix through the normal
   change-management path (a real PR, real tests) unless the severity genuinely requires bypassing
   normal process -- and if it does, that bypass itself gets documented in the postmortem.
5. **Postmortem.** Blameless, written down, covering: timeline, root cause, what contained it, what
   would have caught it sooner, and concrete follow-up actions with owners. This is also where
   "years of production hardening" (per the roadmap) actually accumulates -- each real postmortem
   is one data point in that track record, not just paperwork.

## Standing gaps this plan depends on closing

- No audit-logging system (see access-control-policy.md) -- materially slows down step 2 for any
  real incident.
- No status page or defined customer-notification SLA yet (tracked as a Phase 1 roadmap item).
- No on-call rotation yet -- today, incident response is whoever is available, not a defined
  rotation with escalation. Fine at current scale, not fine once there's a real support function
  (Phase 3).

## Review cadence

Revise after every real use (see above), and otherwise on the same cadence as
[access-control-policy.md](access-control-policy.md).
