import { describe, it, expect } from 'vitest';
import { normalizeApp, KNOWN_APPS } from '../utils/apps.js';

describe('KNOWN_APPS', () => {
  it('includes the full thay-auth fleet (tunes, tv, jot, chronometer, dabba, studio)', () => {
    expect(KNOWN_APPS).toEqual(expect.arrayContaining([
      'homebase', 'tunes', 'tv', 'studio', 'jot', 'chronometer', 'dabba',
    ]));
  });

  it('includes the new 2026 fleet (locker, slashcat, dabba-root, gab, tabbi family, creative suite)', () => {
    expect(KNOWN_APPS).toEqual(expect.arrayContaining([
      'locker', 'slashcat', 'dabba-root', 'gab', 'tabbi', 'webiverse',
      'webispectral', 'design', 'photo', 'video', 'effect', 'pattern',
    ]));
  });
});

describe('normalizeApp', () => {
  it('returns known app slugs as-is', () => {
    for (const app of KNOWN_APPS) {
      expect(normalizeApp(app)).toBe(app);
    }
  });

  it('defaults to homebase for unknown values', () => {
    expect(normalizeApp('unknown-app')).toBe('homebase');
    expect(normalizeApp('')).toBe('homebase');
    expect(normalizeApp(undefined)).toBe('homebase');
    expect(normalizeApp(null)).toBe('homebase');
    expect(normalizeApp(123)).toBe('homebase');
  });
});
