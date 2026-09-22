import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit IV, the size GCM is designed for.
const KEY_BYTES = 32; // AES-256.

export interface Encrypted {
  ciphertext: string;
  iv: string;
  authTag: string;
}

/**
 * Encrypts secrets (currently: a connected repo's GitHub PAT) before they reach Mongo -- this
 * app's first secret-in-a-database case, so there is no existing convention to follow. The key is
 * read once at construction via getOrThrow, matching how JWT_ACCESS_SECRET/JWT_REFRESH_SECRET are
 * read: a missing or malformed key fails the backend's boot rather than silently storing plaintext.
 */
@Injectable()
export class TokenCipherService {
  private readonly key: Buffer;

  constructor(configService: ConfigService) {
    const raw = configService.getOrThrow<string>('TOKEN_ENCRYPTION_KEY');
    let key: Buffer;
    try {
      key = Buffer.from(raw, 'base64');
    } catch {
      throw new Error('TOKEN_ENCRYPTION_KEY must be base64-encoded');
    }
    if (key.length !== KEY_BYTES) {
      throw new Error(
        `TOKEN_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes (got ${key.length}). ` +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      );
    }
    this.key = key;
  }

  encrypt(plaintext: string): Encrypted {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
    };
  }

  /** Throws if the key is wrong or the ciphertext/authTag was tampered with or corrupted --
   * GCM's integrity check, deliberately not swallowed. */
  decrypt(encrypted: Encrypted): string {
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(encrypted.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return plaintext.toString('utf8');
  }
}
