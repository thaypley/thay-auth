import { describe, it, expect } from 'vitest';
import {
  validateEmail,
  validatePassword,
  validateUsername,
  validateBirthday,
  validateAccountType,
  validateInviteCode,
  sanitizeUsername,
} from '../utils/validate.js';

describe('validateEmail', () => {
  it('accepts valid emails', () => {
    expect(validateEmail('user@example.com')).toBeNull();
    expect(validateEmail('a@b.co')).toBeNull();
    expect(validateEmail('test+tag@domain.org')).toBeNull();
  });

  it('rejects missing or empty', () => {
    expect(validateEmail('')).toBe('Email is required');
    expect(validateEmail('  ')).toBe('Email is required');
    expect(validateEmail(undefined)).toBe('Email is required');
    expect(validateEmail(null)).toBe('Email is required');
  });

  it('rejects invalid formats', () => {
    expect(validateEmail('notanemail')).toBe('Invalid email format');
    expect(validateEmail('@no-local')).toBe('Invalid email format');
    expect(validateEmail('no-domain@')).toBe('Invalid email format');
    expect(validateEmail('')).toBe('Email is required');
  });
});

describe('validatePassword', () => {
  it('accepts valid passwords (8+ chars)', () => {
    expect(validatePassword('password123')).toBeNull();
    expect(validatePassword('a'.repeat(8))).toBeNull();
    expect(validatePassword('a'.repeat(128))).toBeNull();
  });

  it('rejects short passwords', () => {
    expect(validatePassword('short1')).toBe('Password must be at least 8 characters');
    expect(validatePassword('')).toBe('Password is required');
  });

  it('rejects overly long passwords', () => {
    expect(validatePassword('a'.repeat(129))).toBe('Password must be at most 128 characters');
  });

  it('rejects non-string input', () => {
    expect(validatePassword(undefined)).toBe('Password is required');
    expect(validatePassword(null)).toBe('Password is required');
  });
});

describe('validateUsername', () => {
  it('accepts valid usernames', () => {
    expect(validateUsername('user_123')).toBeNull();
    expect(validateUsername('abc')).toBeNull();
    expect(validateUsername('a_valid_username')).toBeNull();
  });

  it('rejects short or long', () => {
    const msg = 'Username must be 3-20 characters and contain only letters, numbers, and underscores';
    expect(validateUsername('ab')).toBe(msg);
    expect(validateUsername('a'.repeat(21))).toBe(msg);
  });

  it('rejects special characters or spaces', () => {
    const msg = 'Username must be 3-20 characters and contain only letters, numbers, and underscores';
    expect(validateUsername('user name')).toBe(msg);
    expect(validateUsername('user-name')).toBe(msg);
    expect(validateUsername('user.name')).toBe(msg);
  });
});

describe('sanitizeUsername', () => {
  it('lowercases and trims', () => {
    expect(sanitizeUsername('  UserName  ')).toBe('username');
    expect(sanitizeUsername('ABC_DEF')).toBe('abc_def');
  });
});

describe('validateBirthday', () => {
  it('accepts 18+ birthdays', () => {
    const oldEnough = `${new Date().getFullYear() - 25}-01-01`;
    expect(validateBirthday(oldEnough)).toBeNull();
  });

  it('rejects under-18', () => {
    const tooYoung = `${new Date().getFullYear() - 15}-01-01`;
    expect(validateBirthday(tooYoung)).toBe('thaypley is an 18+ platform');
  });

  it('rejects invalid dates', () => {
    expect(validateBirthday('not-a-date')).toBe('Invalid birthday format. Use YYYY-MM-DD');
    expect(validateBirthday('')).toBe('Birthday is required');
  });

  it('rejects >120 years old', () => {
    const ancient = `${new Date().getFullYear() - 150}-01-01`;
    expect(validateBirthday(ancient)).toBe('Invalid birthday');
  });
});

describe('validateAccountType', () => {
  it('accepts valid types', () => {
    expect(validateAccountType('lover')).toBeNull();
    expect(validateAccountType('musician')).toBeNull();
    expect(validateAccountType('artist')).toBeNull();
    expect(validateAccountType('studio')).toBeNull();
  });

  it('rejects invalid types', () => {
    const result = validateAccountType('admin');
    expect(result).toContain('Invalid accountType');
    expect(result).toContain('lover');
  });
});

describe('validateInviteCode', () => {
  it('accepts valid invite code format', () => {
    expect(validateInviteCode('TP-ABCD')).toBeNull();
    expect(validateInviteCode('TP-1234')).toBeNull();
  });

  it('rejects invalid formats', () => {
    expect(validateInviteCode('')).toBe('Invite code is required');
    expect(validateInviteCode('invalid')).toBe('Invalid invite code format');
    expect(validateInviteCode('ABCDEFGHIJ-KLMNOPQRSTUVWXYZ')).toBe('Invalid invite code format');
  });
});
