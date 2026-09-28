import { describe, expect, it } from 'vitest';
import { normalizeIngressCidr } from '@croft/shared-types';

describe('normalizeIngressCidr', () => {
  it('appends /32 to a bare IPv4 address', () => {
    expect(normalizeIngressCidr('44.212.220.79')).toBe('44.212.220.79/32');
  });

  it('trims surrounding whitespace before normalizing', () => {
    expect(normalizeIngressCidr('  44.212.220.79  ')).toBe('44.212.220.79/32');
  });

  it('leaves a value that already has a prefix untouched', () => {
    expect(normalizeIngressCidr('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(normalizeIngressCidr('44.212.220.79/32')).toBe('44.212.220.79/32');
  });

  it('leaves a malformed value untouched rather than guessing', () => {
    expect(normalizeIngressCidr('not-an-ip')).toBe('not-an-ip');
    expect(normalizeIngressCidr('999.1.2.3')).toBe('999.1.2.3');
  });
});
