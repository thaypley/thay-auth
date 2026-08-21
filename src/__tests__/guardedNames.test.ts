import { describe, it, expect } from 'vitest';
import {
  GUARDED_NAMES,
  GUARD_NOTICE,
  GUARD_CONTACT_EMAIL,
  normalizeGuardedName,
  isGuardedName,
  isGuardedEmail,
  mustGuard,
} from '../utils/guardedNames.js';

describe('guardedNames', () => {
  it('contains the exact UaZit lockdown list', () => {
    expect(GUARDED_NAMES).toEqual([
      'x', 'grok', 'grokbot', 'xmoney', 'spacex', 'spacexai', 'starlink', 'elon', 'elonmusk',
      'thewhitehouse', 'donaldtrump', 'trump', 'unitedstatesofamerica',
      'usa', 'unitedstates', 'america',
    ]);
  });

  it('notice directs to uazit@thaypley.com', () => {
    expect(GUARD_NOTICE).toContain('AUTHENTICATION NOTICE');
    expect(GUARD_NOTICE).toContain(GUARD_CONTACT_EMAIL);
  });

  it('normalizes handles, case, and separators', () => {
    expect(normalizeGuardedName('@Elon')).toBe('elon');
    expect(normalizeGuardedName('ELONMUSK')).toBe('elonmusk');
    expect(normalizeGuardedName('elon_musk')).toBe('elonmusk');
    expect(normalizeGuardedName('grok.bot')).toBe('grokbot');
    expect(normalizeGuardedName(' X_ ')).toBe('x');
    expect(normalizeGuardedName('  ')).toBe('');
    expect(normalizeGuardedName(42)).toBe('');
  });

  it('flags every guarded name in any casing/format', () => {
    for (const name of GUARDED_NAMES) {
      expect(isGuardedName(name)).toBe(true);
      expect(isGuardedName(name.toUpperCase())).toBe(true);
      expect(isGuardedName(`@${name}`)).toBe(true);
      expect(isGuardedName(`${name}_`)).toBe(true);
    }
  });

  it('does not flag legitimate lookalikes that are distinct names', () => {
    expect(isGuardedName('elona')).toBe(false);
    expect(isGuardedName('xander')).toBe(false);
    expect(isGuardedName('grokky')).toBe(false);
    expect(isGuardedName('spacexfan')).toBe(false);
    expect(isGuardedName('musk')).toBe(false);
    expect(isGuardedName('usainbolt')).toBe(false);
    expect(isGuardedName('americana')).toBe(false);
    expect(isGuardedName('trumpybear')).toBe(false);
  });

  it('guards email local parts regardless of domain', () => {
    expect(isGuardedEmail('elon@anything.com')).toBe(true);
    expect(isGuardedEmail('grok@x.ai')).toBe(true);
    expect(isGuardedEmail('wazuaz@thaypley.com')).toBe(false);
    expect(isGuardedEmail('not-an-email')).toBe(false);
  });

  it('mustGuard blocks unless explicitly approved by UaZit', () => {
    expect(mustGuard({ username: 'elon' })).toBe(true);
    expect(mustGuard({ email: 'elon@x.com' })).toBe(true);
    expect(mustGuard({ username: 'elon', guardApproved: true })).toBe(false);
    expect(mustGuard({ username: 'wazuaz', email: 'u@thaypley.com' })).toBe(false);
    // truthy-but-not-true does NOT count as approval
    expect(mustGuard({ username: 'elon', guardApproved: 'yes' })).toBe(true);
  });
});
