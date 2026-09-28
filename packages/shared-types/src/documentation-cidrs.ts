/**
 * Flags RFC 5737 "documentation" ranges as an allowed ingress CIDR -- these can never be a real
 * address, so any submission containing one is almost certainly someone who typed the connect
 * form's own example placeholder instead of their actual public IP. Not hypothetical: a real
 * workspace's security group ended up allowing only the example value, silently blocking every
 * real connection with a timeout and no indication why.
 *
 * Shared rather than duplicated so the backend's authoritative rejection (CloudCredentialsService)
 * and the frontend's inline warning (cloud-credentials-settings.tsx, for a credential connected
 * before this check existed) can never drift apart.
 */

const DOCUMENTATION_RANGES: Array<{ network: string; prefixLength: number }> = [
  { network: "192.0.2.0", prefixLength: 24 }, // RFC 5737 TEST-NET-1
  { network: "198.51.100.0", prefixLength: 24 }, // RFC 5737 TEST-NET-2
  { network: "203.0.113.0", prefixLength: 24 }, // RFC 5737 TEST-NET-3 -- the connect form's own placeholder
];

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function isDocumentationRangeCidr(cidr: string): boolean {
  const [ip] = cidr.split("/");
  const ipInt = ipv4ToInt(ip);
  if (ipInt === null) return false;
  return DOCUMENTATION_RANGES.some(({ network, prefixLength }) => {
    const networkInt = ipv4ToInt(network);
    if (networkInt === null) return false;
    const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
    return (ipInt & mask) === (networkInt & mask);
  });
}
