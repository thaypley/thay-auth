// Load .env BEFORE importing routes/auth.js so config.ts finds
// THAY_AUTH_JWT_SECRET (ESM import order matters here).
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { pbErrorStatus } from '../routes/auth.js';

describe('auth route PB error classification (pbErrorStatus)', () => {
  it('maps PB 400 (admin-auth rejection / schema drift) to 503', () => {
    expect(pbErrorStatus({ status: 400 })).toBe(503);
  });

  it('maps PB auth/session failures (401/403) and missing collection (404) to 503', () => {
    expect(pbErrorStatus({ status: 401 })).toBe(503);
    expect(pbErrorStatus({ status: 403 })).toBe(503);
    expect(pbErrorStatus({ status: 404 })).toBe(503);
  });

  it('maps PB transport errors (status 0) and upstream 5xx to 503', () => {
    // The PocketBase SDK always gives ClientResponseError a numeric status;
    // 0 is its signature for network-level failures (ECONNREFUSED, DNS,
    // timeout). A bare Error is NOT a PB failure and stays a real 500.
    expect(pbErrorStatus({ status: 0 })).toBe(503);
    expect(pbErrorStatus({ status: 502 })).toBe(503);
    expect(pbErrorStatus({ status: 503 })).toBe(503);
  });

  it('leaves programming/client-validation errors as 500', () => {
    expect(pbErrorStatus({ status: 422 })).toBe(500);
    expect(pbErrorStatus({ status: 409 })).toBe(500);
    expect(pbErrorStatus(new Error('boom'))).toBe(500);
    expect(pbErrorStatus(null)).toBe(500);
  });
});
