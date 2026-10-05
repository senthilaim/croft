# Vendor risk management policy (DRAFT)

See [README.md](README.md) for status.

## Current subprocessors (as of 2026-10-06, confirmed against the code, not assumed)

| Vendor | Purpose | Customer data exposed | Required? |
|---|---|---|---|
| AWS (customer's own account) | Runs the customer's Buildfarm (EC2/ElastiCache/NLB/S3) | Customer's own build traffic, within their own account -- not Croft's AWS account | Only if the customer chooses AWS provisioning; Docker-local has no AWS involvement |
| Stripe | Billing | Payment/billing contact info | No -- billing is disabled entirely if `STRIPE_SECRET_KEY` is unset (`docker-compose.yml:40-44`) |
| GitHub (customer-supplied PAT) | Repo analysis feature | Repo metadata + whatever the PAT's scopes allow; the PAT itself is AES-256-GCM encrypted at rest (see access-control-policy.md) | Only if the customer connects a repo for analysis |
| OIDC provider (customer's own choice of IdP) | SSO login | Whatever the IdP sends back in the OIDC flow (email, name) | Only if the deployment operator configures OIDC |

**Not a subprocessor**: MongoDB is self-hosted (`docker-compose.yml:10-19`, a plain `mongo:7`
container on a local Docker volume) -- no managed database vendor has access to this data today.
No email-sending service exists in the codebase (no nodemailer/SendGrid/SES/Resend/Postmark
reference found) -- there is currently no outbound transactional email at all, which also means no
vendor risk from one, but is itself worth knowing (e.g. no email verification or password-reset
email flow exists to evaluate).

## Data this actually involves (for classifying what a new vendor would touch)

- **Not stored**: customer source code, build artifact bytes (the `builds` collection references
  CAS objects by URI, never the bytes themselves -- `backend/src/builds/schemas/build.schema.ts`
  comment at the relevant field confirms this is deliberate).
- **Stored**: build command lines, inlined stdout/stderr, and trace/waterfall spans
  (`build.schema.ts`) -- these can incidentally contain customer-specific paths, flags, or (if a
  customer's own build leaks one into its output) secrets. Treat build-log data with the same care
  as the credentials it could incidentally contain, not as inert metadata.
- **Stored, encrypted**: GitHub PATs, AWS bootstrap secret access keys (see
  access-control-policy.md).
- **Stored, plaintext**: AWS role ARNs and External IDs (not secrets by design -- the External ID's
  entire purpose is to be known to both sides of the trust relationship), repo/branch names,
  workspace/build metadata.

## Framework for evaluating a new vendor

Before adding any new third-party service (most immediately relevant: the SOC2 compliance
automation tool itself -- Vanta/Drata/Secureframe -- which is a real, near-term decision this
framework should be applied to):

1. **What data would it touch?** Use the classification above -- does it need access to build
   logs (which can carry incidental secrets), encrypted-credential plaintext, or just account/billing
   metadata? Scope its access to the minimum that does its job.
2. **Does it have its own compliance posture?** SOC2 Type II report or equivalent, reviewed before
   signing, not after.
3. **What's the blast radius if it's compromised?** A compliance-automation tool that gets
   read-only access to infrastructure config is lower risk than one asking for write access or
   credentials it doesn't need to do its job.
4. **Is it actually required, or a nice-to-have?** Every vendor is a new dependency and a new
   subprocessor disclosure obligation -- the bar should be "this genuinely can't be done without
   it," not "this would be convenient."
5. **Record it here.** Update the subprocessor table above the same day it's added, not
   retroactively when someone asks.

## Review cadence

Review the subprocessor table whenever a new vendor is added (immediately, per above) and
otherwise on the same cadence as [access-control-policy.md](access-control-policy.md).
