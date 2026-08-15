/**
 * Entitlement computation — the single source of truth for "who may use
 * what" across the thay family.
 *
 * Model (2026-08 pivot):
 *   - architect accounts: god-mode, bypass every gate.
 *   - base membership ($5/mo, 14-day trial first) gates thaypley.com.
 *   - app add-ons (à la carte, per catalog slug) unlock other thay apps.
 *   - legacy users.tier != 'free' counts as an active base membership
 *     transitionally, until the old ladder is retired — no backfill.
 *
 * Pure functions: rows in, verdict out. Routes stay thin; tests cover
 * every status transition without a running PocketBase.
 */

export const BASE_TRIAL_DAYS = 14;
export const BASE_MONTHLY_CENTS = 500;

export interface SubscriptionRow {
  kind?: string;
  appKey?: string;
  status?: string;
  trialEnd?: string;
  currentPeriodEnd?: string;
}

export interface EntitlementStatus {
  status: 'active' | 'trialing' | 'past_due' | 'none';
  trialEnd?: string;
  currentPeriodEnd?: string;
  /** Whole days left in the trial (ceil), null when not trialing. */
  trialDaysLeft?: number;
  /** Legacy tier paying for base, or explicit base row. */
  source?: 'subscription' | 'legacy_tier';
}

export interface Entitlements {
  architect: boolean;
  base: EntitlementStatus;
  apps: Record<string, EntitlementStatus>;
}

function isActiveOrTrialing(status: string, now: number, row: SubscriptionRow): boolean {
  if (status === 'active') return true;
  if (status === 'trialing') {
    if (!row.trialEnd) return true;
    return new Date(row.trialEnd).getTime() > now;
  }
  return false;
}

function toStatus(row: SubscriptionRow, now: number): EntitlementStatus {
  const status = String(row.status || 'none');
  let resolved: EntitlementStatus['status'] = 'none';
  if (status === 'trialing') {
    const expired = row.trialEnd ? new Date(row.trialEnd).getTime() <= now : false;
    resolved = expired ? 'none' : 'trialing';
  } else if (status === 'active' || status === 'past_due') {
    resolved = status;
  }
  // canceled/incomplete/expired-trial all read as 'none' — the caller
  // decides whether past_due gets a grace banner; the gate itself only
  // passes active|trialing.
  const out: EntitlementStatus = { status: resolved };
  if (resolved === 'trialing' && row.trialEnd) {
    out.trialEnd = row.trialEnd;
    out.trialDaysLeft = Math.max(
      0,
      Math.ceil((new Date(row.trialEnd).getTime() - now) / 86_400_000),
    );
  }
  if (row.currentPeriodEnd) out.currentPeriodEnd = row.currentPeriodEnd;
  return out;
}

export function summarizeEntitlements(
  rows: SubscriptionRow[],
  opts: { isArchitect?: boolean; legacyTier?: string; now?: number } = {},
): Entitlements {
  const now = opts.now ?? Date.now();
  const architect = Boolean(opts.isArchitect);

  if (architect) {
    // God-mode: coherent shape for clients — every surface reads active
    // without needing to special-case the architect flag.
    return { architect: true, base: { status: 'active' as const }, apps: {} };
  }

  let base: EntitlementStatus = { status: 'none' };
  const apps: Record<string, EntitlementStatus> = {};

  {
    for (const row of rows) {
      if (row.kind === 'base') {
        const s = toStatus(row, now);
        if (s.status !== 'none') base = { ...s, source: 'subscription' };
      } else if (row.kind === 'app') {
        const key = String(row.appKey || '');
        if (!key) continue;
        const s = toStatus(row, now);
        if (s.status !== 'none') apps[key] = { ...s, source: 'subscription' };
      }
    }
    // Transitional: a paid legacy tier pays for the house.
    if (base.status === 'none' && isLegacyPaidTier(opts.legacyTier)) {
      base = { status: 'active', source: 'legacy_tier' };
    }
  }

  return { architect, base, apps };
}

/**
 * Legacy ladder tiers that paid for the house. `creator` and any other
 * value are NOT billing states (users.tier mixes in content-creator
 * labels) — only these four ever count as paid.
 */
const LEGACY_PAID_TIERS = new Set(['core', 'plus', 'pro', 'enterprise']);

export function isLegacyPaidTier(tier: string | undefined): boolean {
  return Boolean(tier && LEGACY_PAID_TIERS.has(tier));
}

/** The gate verdict for thaypley.com itself. */
export function baseEntitled(e: Entitlements): boolean {
  return e.architect || e.base.status === 'active' || e.base.status === 'trialing';
}

/** Verdict for an à-la-carte app add-on. */
export function appEntitled(e: Entitlements, appKey: string): boolean {
  if (e.architect) return true;
  const app = e.apps[appKey];
  return Boolean(app && (app.status === 'active' || app.status === 'trialing'));
}

/** Valid catalog-ish app keys for checkout (slugs, lowercase, hyphens). */
export function isValidAppKey(appKey: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,99}$/.test(appKey);
}
