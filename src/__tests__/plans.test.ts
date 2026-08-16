import { describe, it, expect } from 'vitest';
import { SUBSCRIPTION_PLANS } from '../routes/auth.js';

describe('thay-sub plan model (2026-08 pivot)', () => {
  it('has no free tier', () => {
    const ids = SUBSCRIPTION_PLANS.map((p) => p.id);
    expect(ids).not.toContain('free');
  });

  it('base membership starts at $5/mo', () => {
    const base = SUBSCRIPTION_PLANS.find((p) => p.id === 'base');
    expect(base?.monthly).toBe(5);
  });

  it('architect is unrestricted access across every platform & app', () => {
    const arch = SUBSCRIPTION_PLANS.find((p) => p.id === 'architect');
    expect(arch?.architect).toBe(true);
    expect(arch?.deviceLimit).toBe(-1);
    expect(arch?.monthly).toBe(-1);
    expect(arch?.blurb).toMatch(/every platform & app/i);
  });

  it('publishes exactly base + architect (details TBD is fine)', () => {
    expect(SUBSCRIPTION_PLANS.map((p) => p.id).sort()).toEqual(['architect', 'base']);
  });
});