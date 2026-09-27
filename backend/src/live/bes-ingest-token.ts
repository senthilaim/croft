import { createHmac } from 'node:crypto';

/**
 * Deterministic per-workspace token embedded as a second --bes_header in every generated
 * .bazelrc, gating the BES gRPC ingest port (automation/app/bes_server.py's own
 * _expected_workspace_token computes the exact same value independently from the same shared
 * BES_INGEST_SECRET) -- no per-workspace generation or storage needed, both sides just derive it.
 */
export function computeBesIngestToken(workspaceId: string, secret: string): string {
  return createHmac('sha256', secret).update(workspaceId).digest('hex');
}
