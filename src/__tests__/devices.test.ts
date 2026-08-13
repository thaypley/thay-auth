import { describe, it, expect } from 'vitest';
import { pbUnavailable, PAIRING_UNAVAILABLE } from '../routes/devices.js';

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

  it('leaves programming/client-validation errors as 500', () => {
    expect(pbUnavailable({ status: 422 })).toBe(0);
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
