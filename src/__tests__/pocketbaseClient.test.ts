// Load .env BEFORE importing providers/pocketbase.js so config.ts finds
// THAY_AUTH_JWT_SECRET (ESM import order matters here).
import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import type PocketBase from 'pocketbase';
import { createClient } from '../providers/pocketbase.js';

describe('PocketBase client UA pinning', () => {
  it('injects a browser-compatible User-Agent into every request', () => {
    const client = createClient('http://pocketbase.invalid') as unknown as PocketBase & {
      beforeSend?: (url: string, options: RequestInit & { headers?: Record<string, string> }) => { url: string; options: RequestInit & { headers?: Record<string, string> } };
    };
    expect(client.beforeSend).toBeTypeOf('function');
    const { options } = client.beforeSend!('http://pocketbase.invalid/api/health', {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    } as RequestInit & { headers?: Record<string, string> });
    const headers = options.headers as Record<string, string>;
    expect(headers['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(headers['User-Agent']).toMatch(/Chrome\//);
    // Existing headers are preserved, not replaced.
    expect(headers['Content-Type']).toBe('application/json');
  });
});
