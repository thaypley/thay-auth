const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;
const INVITE_CODE_REGEX = /^[A-Z0-9]{2,10}-[A-Z0-9]{4,8}$/;

export function validateEmail(email: unknown): string | null {
  if (typeof email !== 'string' || !email.trim()) return 'Email is required';
  if (!EMAIL_REGEX.test(email)) return 'Invalid email format';
  return null;
}

export function validatePassword(password: unknown): string | null {
  if (typeof password !== 'string' || !password) return 'Password is required';
  if (password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 128) return 'Password must be at most 128 characters';
  return null;
}

export function validateUsername(username: unknown): string | null {
  if (typeof username !== 'string' || !username.trim()) return 'Username is required';
  const cleaned = username.trim().toLowerCase();
  if (!USERNAME_REGEX.test(cleaned)) {
    return 'Username must be 3-20 characters and contain only letters, numbers, and underscores';
  }
  return null;
}

export function validateBirthday(birthday: unknown): string | null {
  if (typeof birthday !== 'string' || !birthday) return 'Birthday is required';
  const date = new Date(birthday);
  if (isNaN(date.getTime())) return 'Invalid birthday format. Use YYYY-MM-DD';
  const today = new Date();
  let age = today.getFullYear() - date.getFullYear();
  const monthDiff = today.getMonth() - date.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < date.getDate())) age--;
  if (age < 18) return 'thaypley is an 18+ platform';
  if (age > 120) return 'Invalid birthday';
  return null;
}

export function validateAccountType(type: unknown): string | null {
  const valid = ['lover', 'musician', 'artist', 'content_creator', 'brand', 'vintage_reseller', 'label', 'studio'];
  if (typeof type !== 'string' || !valid.includes(type)) {
    return `Invalid accountType. Must be one of: ${valid.join(', ')}`;
  }
  return null;
}

export function validateInviteCode(code: unknown): string | null {
  if (typeof code !== 'string' || !code.trim()) return 'Invite code is required';
  if (!INVITE_CODE_REGEX.test(code.trim().toUpperCase())) return 'Invalid invite code format';
  return null;
}

export function sanitizeUsername(username: string): string {
  return username.trim().toLowerCase();
}
