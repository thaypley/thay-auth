import { describe, it, expect } from 'vitest';
import { normalizeApp, KNOWN_APPS } from '../utils/apps.js';

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
