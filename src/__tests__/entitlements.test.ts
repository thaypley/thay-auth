import { describe, it, expect } from 'vitest';
import {
  summarizeEntitlements,
  baseEntitled,
  appEntitled,
  isValidAppKey,
  BASE_TRIAL_DAYS,
  type SubscriptionRow,
} from '../utils/entitlements.js';

const NOW = new Date('2026-08-15T12:00:00Z').getTime();
const inDays = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

describe('summarizeEntitlements', () => {
  it('architect bypasses every gate regardless of rows', () => {
    const e = summarizeEntitlements([], { isArchitect: true, legacyTier: 'free', now: NOW });
    expect(e.architect).toBe(true);
    expect(e.base.status).toBe('active');
    expect(baseEntitled(e)).toBe(true);
    expect(appEntitled(e, 'tunes')).toBe(true);
  });

  it('no rows and free legacy tier = not entitled', () => {
    const e = summarizeEntitlements([], { legacyTier: 'free', now: NOW });
    expect(e.base.status).toBe('none');
    expect(baseEntitled(e)).toBe(false);
  });

  it('active base row passes the gate', () => {
    const rows: SubscriptionRow[] = [{ kind: 'base', appKey: '', status: 'active', currentPeriodEnd: inDays(20) }];
    const e = summarizeEntitlements(rows, { legacyTier: 'free', now: NOW });
    expect(e.base).toMatchObject({ status: 'active', source: 'subscription' });
    expect(baseEntitled(e)).toBe(true);
  });

  it('live trial passes; expired trial reads as none', () => {
    const live: SubscriptionRow[] = [{ kind: 'base', status: 'trialing', trialEnd: inDays(9) }];
    const eLive = summarizeEntitlements(live, { legacyTier: 'free', now: NOW });
    expect(eLive.base.status).toBe('trialing');
    expect(eLive.base.trialDaysLeft).toBe(9);
    expect(baseEntitled(eLive)).toBe(true);

    const expired: SubscriptionRow[] = [{ kind: 'base', status: 'trialing', trialEnd: inDays(-1) }];
    const eExp = summarizeEntitlements(expired, { legacyTier: 'free', now: NOW });
    expect(eExp.base.status).toBe('none');
    expect(baseEntitled(eExp)).toBe(false);
  });

  it('the 14-day trial is the free test point — it spreads across ALL platforms AND apps', () => {
    const live: SubscriptionRow[] = [{ kind: 'base', status: 'trialing', trialEnd: inDays(10) }];
    const e = summarizeEntitlements(live, { legacyTier: 'free', now: NOW });
    expect(e.trialCoversAll).toBe(true);
    expect(baseEntitled(e)).toBe(true);
    expect(appEntitled(e, 'tunes')).toBe(true);
    expect(appEntitled(e, 'tv')).toBe(true);
    expect(appEntitled(e, 'studio')).toBe(true);
    expect(Object.keys(e.apps)).toEqual([]);

    // Once the trial ends, add-on gates return — nothing is unlocked.
    const expired: SubscriptionRow[] = [{ kind: 'base', status: 'trialing', trialEnd: inDays(-1) }];
    const eExp = summarizeEntitlements(expired, { legacyTier: 'free', now: NOW });
    expect(eExp.trialCoversAll).toBeUndefined();
    expect(baseEntitled(eExp)).toBe(false);
    expect(appEntitled(eExp, 'tunes')).toBe(false);
  });

  it('trial ending today still has hours left', () => {
    const rows: SubscriptionRow[] = [{ kind: 'base', status: 'trialing', trialEnd: new Date(NOW + 3_600_000).toISOString() }];
    const e = summarizeEntitlements(rows, { legacyTier: 'free', now: NOW });
    expect(e.base.status).toBe('trialing');
    expect(e.base.trialDaysLeft).toBe(1);
  });

  it('past_due reads as past_due and does not pass the gate', () => {
    const rows: SubscriptionRow[] = [{ kind: 'base', status: 'past_due' }];
    const e = summarizeEntitlements(rows, { legacyTier: 'free', now: NOW });
    expect(e.base.status).toBe('past_due');
    expect(baseEntitled(e)).toBe(false);
  });

  it('canceled and incomplete read as none', () => {
    for (const status of ['canceled', 'incomplete']) {
      const e = summarizeEntitlements([{ kind: 'base', status }], { legacyTier: 'free', now: NOW });
      expect(e.base.status).toBe('none');
      expect(baseEntitled(e)).toBe(false);
    }
  });

  it('legacy paid tier counts as active base (transitional)', () => {
    const e = summarizeEntitlements([], { legacyTier: 'pro', now: NOW });
    expect(e.base).toMatchObject({ status: 'active', source: 'legacy_tier' });
    expect(baseEntitled(e)).toBe(true);
  });

  it("legacy 'creator' tier is NOT a paid state — creators pay too", () => {
    const e = summarizeEntitlements([], { legacyTier: 'creator', now: NOW });
    expect(e.base.status).toBe('none');
    expect(baseEntitled(e)).toBe(false);
  });

  it('an explicit subscription row wins over legacy tier', () => {
    const rows: SubscriptionRow[] = [{ kind: 'base', status: 'trialing', trialEnd: inDays(5) }];
    const e = summarizeEntitlements(rows, { legacyTier: 'pro', now: NOW });
    expect(e.base.source).toBe('subscription');
    expect(e.base.status).toBe('trialing');
  });

  it('app add-on rows map by appKey and never leak into base', () => {
    const rows: SubscriptionRow[] = [
      { kind: 'base', status: 'active' },
      { kind: 'app', appKey: 'tunes', status: 'active', currentPeriodEnd: inDays(12) },
      { kind: 'app', appKey: 'tv', status: 'canceled' },
    ];
    const e = summarizeEntitlements(rows, { legacyTier: 'free', now: NOW });
    expect(appEntitled(e, 'tunes')).toBe(true);
    expect(appEntitled(e, 'tv')).toBe(false);
    expect(appEntitled(e, 'studio')).toBe(false);
    expect(Object.keys(e.apps)).toEqual(['tunes']);
  });

  it('active base membership alone does not unlock app add-ons', () => {
    const rows: SubscriptionRow[] = [{ kind: 'base', status: 'active' }];
    const e = summarizeEntitlements(rows, { legacyTier: 'free', now: NOW });
    expect(baseEntitled(e)).toBe(true);
    expect(appEntitled(e, 'tunes')).toBe(false);
    expect(e.trialCoversAll).toBeUndefined();
  });

  it('app rows without an appKey are ignored', () => {
    const e = summarizeEntitlements([{ kind: 'app', status: 'active' }], { legacyTier: 'free', now: NOW });
    expect(e.apps).toEqual({});
  });

  it('trial length is 14 days per the pivot decision', () => {
    expect(BASE_TRIAL_DAYS).toBe(14);
  });
});

describe('isValidAppKey', () => {
  it('accepts catalog slugs', () => {
    expect(isValidAppKey('tunes')).toBe(true);
    expect(isValidAppKey('thay-jot')).toBe(true);
    expect(isValidAppKey('chronometer2')).toBe(true);
  });
  it('rejects hostile keys', () => {
    expect(isValidAppKey('')).toBe(false);
    expect(isValidAppKey('Tunes')).toBe(false);
    expect(isValidAppKey('a b')).toBe(false);
    expect(isValidAppKey('x'.repeat(101))).toBe(false);
    expect(isValidAppKey('-lead')).toBe(false);
  });
});
