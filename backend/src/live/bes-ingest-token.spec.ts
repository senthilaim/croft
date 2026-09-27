import { describe, expect, it } from 'vitest';
import { computeBesIngestToken } from './bes-ingest-token.js';

describe('computeBesIngestToken', () => {
  it('is deterministic for the same workspace id and secret', () => {
    expect(computeBesIngestToken('ws1', 'secret')).toBe(computeBesIngestToken('ws1', 'secret'));
  });

  it('differs across workspace ids and across secrets', () => {
    expect(computeBesIngestToken('ws1', 'secret')).not.toBe(computeBesIngestToken('ws2', 'secret'));
    expect(computeBesIngestToken('ws1', 'secret')).not.toBe(computeBesIngestToken('ws1', 'other-secret'));
  });

  it('is a hex string (matches what a --bes_header value needs to be)', () => {
    expect(computeBesIngestToken('ws1', 'secret')).toMatch(/^[0-9a-f]{64}$/);
  });
});
