import { randomBytes } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import { TokenCipherService } from './token-cipher.service.js';

function serviceWithKey(key: string | undefined): TokenCipherService {
  const config = { getOrThrow: () => key ?? throwMissing() } as unknown as ConfigService;
  return new TokenCipherService(config);
}
function throwMissing(): never {
  throw new Error('TOKEN_ENCRYPTION_KEY is not set');
}

const KEY = randomBytes(32).toString('base64');
const OTHER_KEY = randomBytes(32).toString('base64');

describe('TokenCipherService', () => {
  it('round-trips a plaintext through encrypt/decrypt', () => {
    const cipher = serviceWithKey(KEY);
    const encrypted = cipher.encrypt('ghp_super_secret_token');
    expect(cipher.decrypt(encrypted)).toBe('ghp_super_secret_token');
  });

  it('produces a different ciphertext and IV on every call (no IV reuse)', () => {
    const cipher = serviceWithKey(KEY);
    const a = cipher.encrypt('same-plaintext');
    const b = cipher.encrypt('same-plaintext');
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('fails to decrypt with the wrong key', () => {
    const encrypted = serviceWithKey(KEY).encrypt('secret');
    expect(() => serviceWithKey(OTHER_KEY).decrypt(encrypted)).toThrow();
  });

  it('fails to decrypt a tampered ciphertext (GCM integrity check)', () => {
    const cipher = serviceWithKey(KEY);
    const encrypted = cipher.encrypt('secret');
    const tampered = { ...encrypted, ciphertext: cipher.encrypt('different').ciphertext };
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('fails to decrypt a tampered auth tag', () => {
    const cipher = serviceWithKey(KEY);
    const encrypted = cipher.encrypt('secret');
    const tamperedTag = Buffer.from(encrypted.authTag, 'base64');
    tamperedTag[0] ^= 0xff;
    expect(() => cipher.decrypt({ ...encrypted, authTag: tamperedTag.toString('base64') })).toThrow();
  });

  it('throws at construction when the key is missing', () => {
    expect(() => serviceWithKey(undefined)).toThrow('TOKEN_ENCRYPTION_KEY is not set');
  });

  it('throws at construction when the key is the wrong length', () => {
    expect(() => serviceWithKey(Buffer.from('too-short').toString('base64'))).toThrow(/32 bytes/);
  });

  it('throws at construction when the key is not valid base64 content of the right size', () => {
    expect(() => serviceWithKey('not-base64-!!!@@@')).toThrow(/32 bytes/);
  });
});
