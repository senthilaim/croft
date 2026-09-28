import { describe, expect, it } from 'vitest';
import { isDocumentationRangeCidr } from '@croft/shared-types';

describe('isDocumentationRangeCidr', () => {
  it('rejects the connect form\'s own placeholder value', () => {
    expect(isDocumentationRangeCidr('203.0.113.5/32')).toBe(true);
  });

  it('rejects any address within the three RFC 5737 documentation ranges', () => {
    expect(isDocumentationRangeCidr('192.0.2.1/32')).toBe(true);
    expect(isDocumentationRangeCidr('198.51.100.200/32')).toBe(true);
    expect(isDocumentationRangeCidr('203.0.113.255/32')).toBe(true);
  });

  it('rejects a wider CIDR block that overlaps a documentation range', () => {
    expect(isDocumentationRangeCidr('203.0.113.0/24')).toBe(true);
  });

  it('allows a real-looking public IP', () => {
    expect(isDocumentationRangeCidr('98.44.12.7/32')).toBe(false);
    expect(isDocumentationRangeCidr('44.212.220.79/32')).toBe(false);
  });

  it('does not false-positive on a similar-looking but different address', () => {
    expect(isDocumentationRangeCidr('203.0.114.5/32')).toBe(false);
    expect(isDocumentationRangeCidr('192.0.3.1/32')).toBe(false);
  });

  it('returns false for a malformed CIDR rather than throwing', () => {
    expect(isDocumentationRangeCidr('not-an-ip')).toBe(false);
    expect(isDocumentationRangeCidr('')).toBe(false);
  });
});
