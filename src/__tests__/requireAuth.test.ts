import { describe, it, expect, vi, beforeEach } from 'vitest';
import type PocketBase from 'pocketbase';
import { isSessionRevoked, requireUser } from '../middleware/requireAuth.js';

vi.mock('../providers/pocketbase.js', () => ({
  verifyUserToken: vi.fn(),
}));

import { verifyUserToken } from '../providers/pocketbase.js';

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
