/**
 * Registered thaypley app slugs — see ARCHITECTURE_TOKEN_SCOPING.md.
 * Step 1: recorded on every session for visibility/future revocation,
 * not yet enforced per-route. Add new apps here as they onboard.
 *
 * 2026-08-11 fleet expansion: jot, chronometer, dabba and studio joined
 * the thay-auth universe (tunes/tv/studio were already present).
 */
export const KNOWN_APPS = ['homebase', 'tunes', 'tv', 'studio', 'savant', 'universe', 'portfolio', 'jot', 'chronometer', 'dabba', 'locker', 'slashcat', 'dabba-root', 'gab', 'tabbi', 'webiverse', 'webispectral', 'design', 'photo', 'video', 'effect', 'pattern'] as const;
export type AppSlug = typeof KNOWN_APPS[number];

export const DEFAULT_APP: AppSlug = 'homebase';

// Pre-compute a Set for O(1) membership testing (critical for hot path in recordSession)
const APP_SLUG_SET = new Set(KNOWN_APPS);

export function normalizeApp(value: unknown): AppSlug {
  if (typeof value === 'string' && (APP_SLUG_SET as Set<string>).has(value)) {
    return value as AppSlug;
  }
  return DEFAULT_APP;
}
