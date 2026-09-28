/**
 * A bare IPv4 address (e.g. copied straight from an IP-lookup site, which is exactly what the
 * connect form's own "check your IP" link produces) isn't valid CIDR notation on its own --
 * Terraform's aws_security_group rejects it outright ("is not a valid CIDR block"). The
 * overwhelmingly common intent for a bare address is "just this one host," so it's normalized to
 * a /32 rather than surfaced as a confusing Terraform error for something the UI itself
 * encourages (paste your IP here). Anything already containing a "/" is left untouched.
 */
const IPV4_ADDRESS_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function normalizeIngressCidr(cidr: string): string {
  const trimmed = cidr.trim();
  if (trimmed.includes("/")) return trimmed;
  const match = trimmed.match(IPV4_ADDRESS_RE);
  if (!match) return trimmed;
  const octetsValid = match.slice(1).every((octet) => Number(octet) >= 0 && Number(octet) <= 255);
  return octetsValid ? `${trimmed}/32` : trimmed;
}
