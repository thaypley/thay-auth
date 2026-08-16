import { describe, it, expect } from 'vitest';
import { pbUnavailable, PAIRING_UNAVAILABLE, mapDeviceItems, ownsDevice } from '../routes/devices.js';

describe('devices route resilience', () => {
  it('maps a missing collection (PB 404) to 503', () => {
    expect(pbUnavailable({ status: 404 })).toBe(503);
  });

  it('maps transient PB auth failures (401/403) to 503', () => {
    expect(pbUnavailable({ status: 401 })).toBe(503);
    expect(pbUnavailable({ status: 403 })).toBe(503);
  });

  it('maps PB 400 (admin-auth rejection / schema drift) to 503', () => {
    expect(pbUnavailable({ status: 400 })).toBe(503);
  });

  it('maps PB transport errors (status 0) and upstream 5xx to 503', () => {
    // The PocketBase SDK always gives ClientResponseError a numeric status;
    // 0 is its signature for network-level failures (ECONNREFUSED, DNS,
    // timeout). A bare Error is NOT a PB failure and stays a real 500.
    expect(pbUnavailable({ status: 0 })).toBe(503);
    expect(pbUnavailable({ status: 502 })).toBe(503);
    expect(pbUnavailable({ status: 503 })).toBe(503);
  });

  it('maps PB 422 (schema drift / invalid filter) to 503', () => {
    // PB 422 = the filter/sort references a field the running schema does
    // not have. The list handler degrades it to an empty list after a
    // fallback query; everywhere else it is retryable infrastructure.
    expect(pbUnavailable({ status: 422 })).toBe(503);
  });

  it('classifies a bare circuit-open Error as a 503, not a 500', () => {
    // getAdminPb's fail-fast circuit throws a plain Error when PB has been
    // unreachable for <5s. Attaching status 0 makes pbUnavailable map it to
    // a retryable 503 instead of a confusing real 500.
    const circuit = new Error('PB admin auth failing (circuit open)');
    (circuit as Error & { status?: number }).status = 0;
    expect(pbUnavailable(circuit)).toBe(503);
  });

  it('leaves programming/client-validation errors as 500', () => {
    expect(pbUnavailable({ status: 418 })).toBe(0);
    expect(pbUnavailable(new Error('boom'))).toBe(0);
    expect(pbUnavailable(null)).toBe(0);
  });

  it('exposes a stable client code in the 503 payload', () => {
    expect(PAIRING_UNAVAILABLE).toEqual({
      error: 'Device pairing is temporarily unavailable',
      code: 'DEVICE_PAIRING_UNAVAILABLE',
    });
  });
});

describe('ownsDevice (DELETE /devices/:id ownership gate)', () => {
  it('returns true when the device belongs to the user', () => {
    expect(ownsDevice({ id: 'd1', userId: 'u1' }, 'u1')).toBe(true);
  });

  it('returns false when the device belongs to another user', () => {
    expect(ownsDevice({ id: 'd1', userId: 'u2' }, 'u1')).toBe(false);
  });

  it('returns false when the device row is missing', () => {
    expect(ownsDevice(null, 'u1')).toBe(false);
    expect(ownsDevice(undefined, 'u1')).toBe(false);
  });
});

describe('mapDeviceItems (GET /devices regression)', () => {
  it('maps a PocketBase ListResult items array to the client device shape', () => {
    // Regression: the first shipping of GET /devices cast the whole
    // ListResult object ({ items, page, perPage, totalItems, totalPages })
    // to an array and called .map directly — `devices.map is not a function`
    // 500'd the dashboard panel in production the moment PB auth worked.
    const listResult = {
      items: [
        { id: 'dev1', label: 'phone', scopes: ['relay:chat'], lastSeenAt: '2026-08-14T00:00:00Z', expiresAt: '2026-08-20T00:00:00Z', revoked: false, created: '2026-08-13T00:00:00Z' },
        { id: 'dev2', label: 'laptop', scopes: [], lastSeenAt: null, expiresAt: null, revoked: true, created: '2026-08-12T00:00:00Z' },
      ],
      page: 1,
      perPage: 20,
      totalItems: 2,
      totalPages: 1,
    };

    expect(mapDeviceItems(listResult.items)).toEqual([
      { id: 'dev1', label: 'phone', scopes: ['relay:chat'], lastSeenAt: '2026-08-14T00:00:00Z', expiresAt: '2026-08-20T00:00:00Z', revoked: false, createdAt: '2026-08-13T00:00:00Z' },
      { id: 'dev2', label: 'laptop', scopes: [], lastSeenAt: null, expiresAt: null, revoked: true, createdAt: '2026-08-12T00:00:00Z' },
    ]);
  });

  it('returns an empty array for a missing items property (never crashes the panel)', () => {
    expect(mapDeviceItems(undefined as unknown as Record<string, unknown>[])).toEqual([]);
  });
});
