/**
 * Official thaypley platform registry — every place authenticated by
 * thay-auth. This is the single source of truth surfaced by the
 * platform hub (GET /auth/platforms) on auth.thaypley.com and wired
 * into the cross-app system menu.
 *
 * Each entry has a slug, human name, URL, one-liner, and a `type` so
 * the UI can group the web platform family (thaypley.com, tunes, tv,
 * fam, werk) separately from desktop/CLI/cloud downloads.
 */

export interface PlatformInfo {
  slug: string;
  name: string;
  url: string;
  tagline: string;
  type: 'web' | 'desktop' | 'cli' | 'cloud' | 'mobile' | 'docs';
}

/** Everything a signed-in thay-auth account unlocks. */
export const OFFICIAL_PLATFORMS: PlatformInfo[] = [
  // ── The web platform family (thay(portal)) ────────────────────────
  {
    slug: 'thaypley',
    name: 'thaypley.com',
    url: 'https://thaypley.com',
    tagline: 'the portal — your creator home base',
    type: 'web',
  },
  {
    slug: 'tunes',
    name: 'thaypley(tunes)',
    url: 'https://tunes.thaypley.com',
    tagline: 'the whole world\'s music, curated for creators',
    type: 'web',
  },
  {
    slug: 'tv',
    name: 'thaypley(tv)',
    url: 'https://tv.thaypley.com',
    tagline: 'television for the multiverse',
    type: 'web',
  },
  {
    slug: 'fam',
    name: 'fam.thaypley.com',
    url: 'https://fam.thaypley.com',
    tagline: 'family & inner circle — the private side',
    type: 'web',
  },
  {
    slug: 'werk',
    name: 'werk.thaypley.com',
    url: 'https://werk.thaypley.com',
    tagline: 'work & studio operations',
    type: 'web',
  },
];
