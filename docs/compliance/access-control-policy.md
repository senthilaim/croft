# Access control policy (DRAFT)

See [README.md](README.md) for status. Describes what the code actually does today, with exact
file references so this document can be checked against reality rather than trusted blindly.

## Authentication

- **Password accounts**: bcrypt hashing, cost factor 10, hardcoded (`backend/src/auth/auth.service.ts:25`).
  No configurable cost factor via environment variable today -- a gap worth fixing before a real
  audit (cost factor should be bumpable without a code change as hardware gets faster).
- **Tokens**: JWT access tokens (15 minute TTL) + refresh tokens (7 day TTL), signed with two
  separate secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) so a leaked access token can't be
  used to mint new refresh tokens (`auth.service.ts:13-14,48-49,76-81`).
- **SSO**: optional OIDC support (`backend/src/auth/oidc/`), env-gated
  (`OIDC_ISSUER_URL`/`OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`) -- disabled entirely if unset. OIDC and
  password accounts are kept separate: a password-only account can't be logged into via SSO and
  vice versa, and the generic "Invalid email or password" response is used either way so an
  attacker can't enumerate which accounts use SSO (`auth.service.ts:34-37`).
- **Session storage (frontend)**: the access token is read from an HTTP cookie via Next.js's
  server-only `cookies()` API (`frontend/src/lib/session.ts:1,8`) -- never exposed to client-side
  JavaScript.

## Authorization

- **Model**: four workspace roles -- `owner | admin | member | viewer`
  (`packages/shared-types/src/workspace.ts:4`). Exactly one owner per workspace (implicit via
  `ownerId`, not a `members` array entry); `admin`/`member`/`viewer` are assignable
  (`backend/src/workspaces/schemas/workspace.schema.ts:14,34`).
- **Enforcement**: every workspace-scoped route composes two guards --
  `WorkspaceMembershipGuard` resolves the workspace and the caller's role, 404s if the workspace
  doesn't exist, 403s if the caller isn't a member (`workspace-membership.guard.ts:12-32`); then
  `WorkspaceRoleGuard(...roles)` 403s if the caller's role isn't in the allowed list for that route
  (`workspace-role.guard.ts:13-25`). No implicit/ambient trust -- every route that touches a
  workspace's data declares its own required roles explicitly in its controller decorator.

## Secrets at rest

- `TOKEN_ENCRYPTION_KEY` (required at boot, `docker-compose.yml:33-49`) drives AES-256-GCM
  encryption (`backend/src/crypto/token-cipher.service.ts:5`), a random 96-bit IV per encryption
  operation, and the GCM auth tag is checked (not silently ignored) on every decrypt.
- What it encrypts: a connected GitHub repo's personal access token
  (`repo-analysis/schemas/repo-connection.schema.ts:172-182`, only the last 4 characters ever
  exposed via API) and a customer's AWS bootstrap IAM secret access key
  (`cloud-credentials/schemas/cloud-credential.schema.ts:35-47`, same last-4-only exposure pattern,
  `cloud-credentials.service.ts:26-41`).
- The same key also derives a deterministic per-workspace HMAC-SHA256 "External ID"
  (`token-cipher.service.ts:73-75`) used in the AWS STS trust policy -- a standard mitigation
  against the "confused deputy" problem (preventing a third party from tricking Croft's own AWS
  role into being assumed on their behalf).
- A customer's AWS role ARN is validated as actually assumable (a real STS call via the automation
  service) *before* anything is persisted (`cloud-credentials.service.ts:172-204`) -- a workspace
  never stores a credential that was never confirmed to work.

## A real, current gap: no audit-logging system

There is **no dedicated audit-log collection or service** anywhere in the codebase today -- only
operational `Logger` calls (8 files: `idle-timeout.service.ts`, `repo-analysis.service.ts`,
`cache-check.service.ts`, `rebuild-simulation.service.ts`, `provisioning.controller.ts`,
`build-diagnostics.ts`, `live.gateway.ts`, `token-cipher.service.ts`), none of which produce a
structured, attributable, tamper-evident "who did what to which resource, when" record, and none
of which have a defined retention policy. SOC2 typically treats audit logging as a core control,
not an optional one -- this is the single most significant gap this document found, and it isn't
papered over here: there is no audit trail today, full stop. Closing it (what to log, where it's
stored, retention, who can read it) needs its own design decision, not a quick add-on.

## Review cadence

Not yet established -- this draft itself hasn't had a first review. Once adopted, standard practice
is an annual review at minimum, plus a review whenever the auth/authz code it describes changes in
a way that would make this document inaccurate.
