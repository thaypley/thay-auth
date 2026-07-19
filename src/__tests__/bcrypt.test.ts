import { describe, it, expect } from 'vitest';
import { hashPasswordBcrypt } from '../utils/bcrypt.js';

describe('hashPasswordBcrypt', () => {
  it('returns a valid bcrypt hash', async () => {
    const hash = await hashPasswordBcrypt('test-password');
    expect(hash).toMatch(/^\$2[abyx]\$\d+\$/);
  });

  it('is 60 characters long with $2b$ prefix from bcryptjs', async () => {
    const hash = await hashPasswordBcrypt('test-password');
    expect(hash.length).toBe(60);
  });

  it('produces different hashes for the same password', async () => {
    const h1 = await hashPasswordBcrypt('same-password');
    const h2 = await hashPasswordBcrypt('same-password');
    expect(h1).not.toBe(h2);
  });

  it('throws on empty password', async () => {
    await expect(hashPasswordBcrypt('')).rejects.toThrow('empty password');
  });
});

