export type CloudProvider = "aws";

/** This release only accepts "staging" -- "production" is a real, visible field (not hidden) so
 * the schema doesn't need to change when it's supported, but every write path rejects it for now.
 * See backend/src/cloud-credentials/. */
export type CloudEnvironment = "staging" | "production";

/** Shown to the customer before they create their IAM role, so the External ID is known when they
 * write the trust policy. Stable per workspace -- refreshing the setup page shows the same value. */
export interface CloudCredentialSetupInfo {
  externalId: string;
  trustPolicyJson: string;
  rolePolicyJson: string;
}

/** What the workspace owner submits to connect an AWS account. Every field here is a real,
 * user-facing form input -- none of this is a deployment-level/.env setting. */
export interface ConnectCloudCredentialRequest {
  roleArn: string;
  bootstrapAccessKeyId: string;
  /** Plaintext, only ever sent on this one request -- never stored as-is, never echoed back. */
  bootstrapSecretAccessKey: string;
  environment: CloudEnvironment;
  region: string;
  /** Platform-enforced min/max applied server-side; see cloud-credentials.service.ts. */
  idleTimeoutMinutes: number;
  /** Pre-filled with the requester's own detected IP/32 by the frontend; user-editable.
   * "0.0.0.0/0" is rejected server-side. */
  allowedIngressCidrs: string[];
}

/** Safe to send to the frontend -- no secret material. */
export interface CloudCredential {
  workspaceId: string;
  provider: CloudProvider;
  environment: CloudEnvironment;
  roleArn: string;
  externalId: string;
  bootstrapAccessKeyId: string;
  bootstrapKeyLast4: string;
  region: string;
  idleTimeoutMinutes: number;
  allowedIngressCidrs: string[];
  connectedBy: string;
  createdAt: string;
  updatedAt: string;
}
