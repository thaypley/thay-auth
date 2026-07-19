import crypto from 'crypto';

/** SHA-256 hex digest — used to store a lookup-able fingerprint of a
 * bearer token (session tracking, device pairing) without persisting the
 * token itself. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
