import { describe, it, expect } from 'vitest';
import { hashToken } from '../utils/hashToken.js';

describe('hashToken', () => {
  it('returns a 64-char hex string (SHA-256)', () => {
    const hash = hashToken('some-token-value');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('produces different hashes for different inputs', () => {
    expect(hashToken('abc')).not.toBe(hashToken('xyz'));
  });

  it('handles empty string', () => {
    expect(hashToken('')).toMatch(/^[a-f0-9]{64}$/);
  });
});
