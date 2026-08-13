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

  it('leaves real server errors as 500', () => {
    expect(pbUnavailable({ status: 500 })).toBe(0);
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
