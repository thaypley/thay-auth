import { describe, it, expect } from 'vitest';
import { OFFICIAL_PLATFORMS } from '../utils/platforms.js';

describe('OFFICIAL_PLATFORMS (platform hub registry)', () => {
  it('lists the five core web platforms incl. thaypley(tunes) and thaypley(tv)', () => {
    const slugs = OFFICIAL_PLATFORMS.map((p) => p.slug);
    expect(slugs).toEqual(expect.arrayContaining(['thaypley', 'tunes', 'tv', 'fam', 'werk']));
    expect(slugs).toHaveLength(5);
  });

  it('has unique slugs and unique URLs', () => {
    const slugs = OFFICIAL_PLATFORMS.map((p) => p.slug);
    const urls = OFFICIAL_PLATFORMS.map((p) => p.url);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('every platform URL lives on the thaypley.com domain', () => {
    for (const p of OFFICIAL_PLATFORMS) {
      expect(p.url.startsWith('https://')).toBe(true);
      expect(p.url.endsWith('.thaypley.com') || p.url === 'https://thaypley.com').toBe(true);
    }
  });

  it('tunes and tv are web platforms pointing at their hosted surfaces', () => {
    const tunes = OFFICIAL_PLATFORMS.find((p) => p.slug === 'tunes');
    const tv = OFFICIAL_PLATFORMS.find((p) => p.slug === 'tv');
    expect(tunes?.type).toBe('web');
    expect(tunes?.url).toBe('https://tunes.thaypley.com');
    expect(tv?.type).toBe('web');
    expect(tv?.url).toBe('https://tv.thaypley.com');
  });
});