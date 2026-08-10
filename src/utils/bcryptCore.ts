import { createRequire } from 'node:module';

/**
 * bcrypt hashing core — shared by the worker entry (real hashing) and
 * the in-process fallback bridge, so both paths run identical logic.
 *
 * Prefers the native `bcrypt` package when present (its async API
 * offloads to the libuv threadpool and is ~4x faster than pure JS), and
 * falls back to bcryptjs. bcrypt is NOT a dependency — the require
 * fails cleanly and bcryptjs is used, so adding it later is a
 * zero-code-change speedup.
 */

const require = createRequire(import.meta.url);

let native: ((pw: string, cost: number) => Promise<string>) | null = null;
let triedNative = false;

async function getHasher(): Promise<(pw: string, cost: number) => Promise<string>> {
  if (!triedNative) {
    triedNative = true;
    try {
      const bcrypt = require('bcrypt');
      native = (pw, cost) => bcrypt.hash(pw, cost);
    } catch {
      native = null;
    }
  }
  if (native) return native;
  const bcryptjs = await import('bcryptjs');
  return (pw, cost) => bcryptjs.hash(pw, cost);
}

export async function hashPasswordCore(pw: string, cost: number): Promise<string> {
  const hasher = await getHasher();
  return hasher(pw, cost);
}
