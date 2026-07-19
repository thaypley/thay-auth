/**
 * Registered thaypley app slugs — see ARCHITECTURE_TOKEN_SCOPING.md.
 * Step 1: recorded on every session for visibility/future revocation,
 * not yet enforced per-route. Add new apps here as they onboard.
 */
export const KNOWN_APPS = ['homebase', 'tunes', 'tv', 'studio', 'savant', 'universe', 'portfolio'] as const;
export type AppSlug = typeof KNOWN_APPS[number];

export const DEFAULT_APP: AppSlug = 'homebase';

export function normalizeApp(value: unknown): AppSlug {
  if (typeof value === 'string' && (KNOWN_APPS as readonly string[]).includes(value)) {
    return value as AppSlug;
  }
  return DEFAULT_APP;
}
