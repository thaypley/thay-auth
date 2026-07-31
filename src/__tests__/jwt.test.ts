import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { signUserToken, verifyUserToken, signDeviceToken, verifyDeviceToken } from '../providers/jwt.js';
import { config } from '../config.js';

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
    const t = jwt.sign({ type: 'user', sub: 'u1', aud: 'homebase' }, config.jwtSecret, { expiresIn: '30d' });
    expect(verifyUserToken(t)).toBeNull();
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
