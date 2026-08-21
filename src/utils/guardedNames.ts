// ─── Guarded Names (UaZit lockdown) ─────────────────────────────────
// Permanently reserved identities, locked by order of UaZit (2026).
// These names can NEVER open a thaypley account through any public
// surface — signup, username change, or login — without gated, explicit
// approval from UaZit directly (uazit@thaypley.com).
//
// Enforcement layers (defense in depth):
//   1. thay-auth routes  — /signup, /check-username, /change-username,
//      /login (this module, imported by routes/auth.ts)
//   2. PocketBase hooks  — pb_hooks/guard_reserved_names.pb.js blocks
//      non-superuser creates/updates on the shared users collection, so
//      EVERY thay platform that writes through PocketBase directly is
//      covered too.
//
// Approval path: UaZit creates/approves the account as a PocketBase
// superuser (hooks always allow superuser writes) and sets
// `guardApproved = true` on the users record. Only records with that
// flag may hold one of these names or log in with one.

export const GUARDED_NAMES: readonly string[] = [
  // ── tech/identity lockdown (2026) ──
  'x',
  'grok',
  'grokbot',
  'xmoney',
  'spacex',
  'spacexai',
  'starlink',
  'elon',
  'elonmusk',
  // ── government/nation-state lockdown ──
  'thewhitehouse',
  'donaldtrump',
  'trump',
  'unitedstatesofamerica',
  'usa',
  'unitedstates',
  'america',
];

export const GUARD_CONTACT_EMAIL = 'uazit@thaypley.com';

export const GUARD_NOTICE =
  'AUTHENTICATION NOTICE: this identity is permanently reserved on thaypley. ' +
  `To request gated approval, email ${GUARD_CONTACT_EMAIL} directly from the account owner. ` +
  'Any attempt to register it is logged.';

const GUARDED_SET = new Set(GUARDED_NAMES);

/**
 * Normalizes a candidate name for comparison: lowercases, strips any
 * leading @ handles, and removes separators (underscores, dots, hyphens,
 * spaces) so "Elon", "@elon", "elon_musk", "X_" and "grok.bot" all
 * resolve to their canonical blocked form. Usernames in thaypley are
 * [a-z0-9_] only, but normalization keeps the guard robust against
 * future charset changes and email local-parts.
 */
export function normalizeGuardedName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9]/g, '');
}

/** True if the name (username or email local-part) is guarded. */
export function isGuardedName(raw: unknown): boolean {
  const normalized = normalizeGuardedName(raw);
  if (!normalized) return false;
  return GUARDED_SET.has(normalized);
}

/**
 * True if an email address is guarded (checks the local part, so
 * "elon@anything.com" is guarded — the identity itself is reserved).
 */
export function isGuardedEmail(email: unknown): boolean {
  if (typeof email !== 'string' || !email.includes('@')) return false;
  return isGuardedName(email.slice(0, email.indexOf('@')));
}

/**
 * Full gate check for a candidate identity pair. Returns true when the
 * attempt must be blocked (name or email is guarded AND the record is
 * not explicitly approved by UaZit).
 */
export function mustGuard(opts: {
  username?: unknown;
  email?: unknown;
  guardApproved?: unknown;
}): boolean {
  if (opts.guardApproved === true) return false;
  return isGuardedName(opts.username) || isGuardedEmail(opts.email);
}
