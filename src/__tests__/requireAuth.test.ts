import { describe, it, expect, vi, beforeEach } from 'vitest';
import type PocketBase from 'pocketbase';
import { isSessionRevoked, requireUser, requireUserForApp, markSessionRevoked } from '../middleware/requireAuth.js';

vi.mock('../providers/pocketbase.js', () => ({
  verifyUserToken: vi.fn(),
}));

import { verifyUserToken } from '../providers/pocketbase.js';
import { signUserToken, signDeviceToken } from '../providers/jwt.js';

// ─── isSessionRevoked (the logic that regressed in a646e72) ─────────

function mockPb(rows: Array<{ revoked?: boolean }>): PocketBase {
  return {
    collection: () => ({
      getList: async () => ({ items: rows }),
    }),
  } as unknown as PocketBase;
}

describe('isSessionRevoked', () => {
  it('returns false when no session row exists (fail open)', async () => {
    expect(await isSessionRevoked(mockPb([]), 'token-no-row')).toBe(false);
  });

  it('returns false when the matching row is active (revoked=false)', async () => {
    expect(await isSessionRevoked(mockPb([{ revoked: false }]), 'token-active')).toBe(false);
  });

  it('returns true when the matching row is revoked (revoked=true)', async () => {
    expect(await isSessionRevoked(mockPb([{ revoked: true }]), 'token-revoked')).toBe(true);
  });

  it('caches the result per token (single lookup)', async () => {
    let calls = 0;
    const pb = {
      collection: () => ({
        getList: async () => {
          calls += 1;
          return { items: [{ revoked: false }] };
        },
      }),
    } as unknown as PocketBase;
    expect(await isSessionRevoked(pb, 'token-cached')).toBe(false);
    expect(await isSessionRevoked(pb, 'token-cached')).toBe(false);
    expect(calls).toBe(1);
  });

  it('fails closed when the lookup throws', async () => {
    const pb = {
      collection: () => ({
        getList: async () => { throw new Error('boom'); },
      }),
    } as unknown as PocketBase;
    expect(await isSessionRevoked(pb, 'token-error')).toBe(true);
  });

  it('markSessionRevoked takes effect immediately without a PB call', async () => {
    const pb = mockPb([{ revoked: false }]);
    const token = 'token-fast-revoke';
    expect(await isSessionRevoked(pb, token)).toBe(false);

    // Logout fast-path: flips the cache so the next check is a local hit.
    markSessionRevoked(token);

    let calls = 0;
    const spyPb = {
      collection: () => ({
        getList: async () => { calls += 1; return { items: [{ revoked: false }] }; },
      }),
    } as unknown as PocketBase;
    expect(await isSessionRevoked(spyPb, token)).toBe(true);
    expect(calls).toBe(0);
  });
});

// ─── requireUser composition ─────────────────────────────────────────

const next = vi.fn();

function mockRequest(authHeader?: string) {
  return { headers: { authorization: authHeader } } as any;
}

function mockResponse() {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    res.json = (body: unknown) => { res.body = body; return res; };
    return res;
  };
  return res;
}

const activeUser = { id: 'u1', email: 'a@b.co', username: 'u1' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireUser', () => {
  it('rejects when no Authorization header is present', async () => {
    const res = mockResponse();
    await requireUser(mockRequest(), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an invalid token', async () => {
    (verifyUserToken as any).mockResolvedValue(null);
    const res = mockResponse();
    await requireUser(mockRequest('Bearer bad'), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a valid token with a live session row', async () => {
    (verifyUserToken as any).mockResolvedValue({ user: activeUser, pb: mockPb([{ revoked: false }]) });
    const req = mockRequest('Bearer tok-valid');
    const res = mockResponse();
    await requireUser(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('u1');
  });

  it('accepts a valid token with no session row (pre-rollout fail open)', async () => {
    (verifyUserToken as any).mockResolvedValue({ user: activeUser, pb: mockPb([]) });
    const req = mockRequest('Bearer tok-no-row');
    const res = mockResponse();
    await requireUser(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('rejects a token whose session is revoked', async () => {
    (verifyUserToken as any).mockResolvedValue({ user: activeUser, pb: mockPb([{ revoked: true }]) });
    const res = mockResponse();
    await requireUser(mockRequest('Bearer tok-revoked'), res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Session revoked' });
    expect(next).not.toHaveBeenCalled();
  });
});

// ─── wrapped (aud-scoped) token path ────────────────────────────────

describe('requireUser (wrapped token)', () => {
  it('accepts a wrapped token and verifies the inner PB token', async () => {
    (verifyUserToken as any).mockResolvedValue({ user: activeUser, pb: mockPb([{ revoked: false }]) });
    const wrapped = signUserToken('u1', 'tunes', 'inner-pb-token');
    const req = mockRequest(`Bearer ${wrapped}`);
    const res = mockResponse();
    await requireUser(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('u1');
    expect(req.user.aud).toBe('tunes');
  });

  it('rejects a wrapped token whose inner PB token is invalid', async () => {
    (verifyUserToken as any).mockResolvedValue(null);
    const wrapped = signUserToken('u1', 'tunes', 'bad-inner');
    const res = mockResponse();
    await requireUser(mockRequest(`Bearer ${wrapped}`), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects a wrapped token whose session is revoked', async () => {
    (verifyUserToken as any).mockResolvedValue({ user: activeUser, pb: mockPb([{ revoked: true }]) });
    const wrapped = signUserToken('u1', 'tunes', 'inner-pb-token-revoked');
    const res = mockResponse();
    await requireUser(mockRequest(`Bearer ${wrapped}`), res, next);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Session revoked' });
    expect(next).not.toHaveBeenCalled();
  });

  it('treats a device token as invalid for requireUser', async () => {
    const deviceTok = signDeviceToken('dev1', 'u1', ['relay:chat']);
    (verifyUserToken as any).mockResolvedValue(null);
    const res = mockResponse();
    await requireUser(mockRequest(`Bearer ${deviceTok}`), res, next);
    expect(res.statusCode).toBe(401);
  });
});

// ─── requireUserForApp (aud enforcement) ────────────────────────────

describe('requireUserForApp', () => {
  it('rejects a wrapped token minted for a different app', async () => {
    const wrapped = signUserToken('u1', 'tunes', 'inner-pb-token');
    const res = mockResponse();
    await requireUserForApp(['homebase'])(mockRequest(`Bearer ${wrapped}`), res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Token not valid for this app' });
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a wrapped token for an allowed app', async () => {
    (verifyUserToken as any).mockResolvedValue({ user: activeUser, pb: mockPb([{ revoked: false }]) });
    const wrapped = signUserToken('u1', 'tunes', 'inner-pb-token');
    const req = mockRequest(`Bearer ${wrapped}`);
    const res = mockResponse();
    await requireUserForApp(['tunes', 'studio'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.aud).toBe('tunes');
  });

  it('allows a legacy raw PB token through (no aud claim, homebase compat)', async () => {
    (verifyUserToken as any).mockResolvedValue({ user: activeUser, pb: mockPb([{ revoked: false }]) });
    const req = mockRequest('Bearer raw-pb-token');
    const res = mockResponse();
    await requireUserForApp(['homebase'])(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.user.aud).toBeUndefined();
  });
});
