import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { signUserToken, verifyUserToken, signDeviceToken, verifyDeviceToken } from '../providers/jwt.js';
import { config } from '../config.js';

// Build a raw HS256 token locally (jwt.ts is dependency-free by design —
// jsonwebtoken is no longer in the dependency tree).
function signRaw(payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.jwtSecret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${sig}`;
}

describe('user session token (aud-scoped wrapper)', () => {
  it('round-trips sub, aud and pbToken', () => {
    const inner = 'pb-inner-token';
    const t = signUserToken('u1', 'tunes', inner);
    const payload = verifyUserToken(t);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe('user');
    expect(payload!.sub).toBe('u1');
    expect(payload!.aud).toBe('tunes');
    expect(payload!.pbToken).toBe(inner);
  });

  it('rejects a device token (type mismatch)', () => {
    const d = signDeviceToken('dev1', 'u1', ['relay:chat']);
    expect(verifyUserToken(d)).toBeNull();
  });

  it('rejects a token missing pbToken', () => {
    const t = signRaw({ type: 'user', sub: 'u1', aud: 'homebase', iat: 1, exp: 4102444800 });
    expect(verifyUserToken(t)).toBeNull();
  });

  it('rejects an expired token', () => {
    const t = signRaw({ type: 'user', sub: 'u1', aud: 'homebase', pbToken: 'x', iat: 1, exp: 1 });
    expect(verifyUserToken(t)).toBeNull();
  });

  it('rejects a token with a tampered signature', () => {
    const t = signUserToken('u1', 'tunes', 'inner');
    // Deterministic tamper: flip the first payload char so the HMAC over
    // `header.payload` can never match (a naive last-char replace was a
    // no-op 1/64 of the time).
    const parts = t.split('.');
    const payload = parts[1];
    const flipped = payload[0] === 'A' ? 'B' : 'A';
    const tampered = `${parts[0]}.${flipped}${payload.slice(1)}.${parts[2]}`;
    expect(verifyUserToken(tampered)).toBeNull();
  });

  it('rejects garbage', () => {
    expect(verifyUserToken('not-a-token')).toBeNull();
  });
});

describe('device token (unchanged behavior)', () => {
  it('round-trips device claims', () => {
    const t = signDeviceToken('dev1', 'u1', ['relay:chat', 'relay:du']);
    const payload = verifyDeviceToken(t);
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe('device');
    expect(payload!.deviceId).toBe('dev1');
    expect(payload!.userId).toBe('u1');
    expect(payload!.scopes).toEqual(['relay:chat', 'relay:du']);
  });

  it('rejects a user token', () => {
    const u = signUserToken('u1', 'homebase', 'inner');
    expect(verifyDeviceToken(u)).toBeNull();
  });
});
