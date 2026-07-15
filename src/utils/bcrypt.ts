/**
 * PB-compatible bcrypt hash for the DIRECT_SQL_USERS signup fallback.
 *
 * Why this exists:
 *   PocketBase's Go core stores `users.password` as a standard `$2a$10$...`
 *   bcrypt hash. The admin `POST /api/collections/users/records` endpoint
 *   is broken on the `hcgi/platform` instance (returns 400 {data:{}}),
 *   so we write the user row directly to `pb_data/data.db` via node:sqlite
 *   and need to produce a hash the PB auth verifier will accept.
 *
 * Strategy:
 *   Delegate to a system `python3` with the `bcrypt` module. On the VPS
 *   (Ubuntu 22.04) this is `apt install python3-bcrypt`. For local dev
 *   on macOS, point `BCRYPT_PYTHON=/path/to/venv/bin/python3` at a venv
 *   that has bcrypt installed (the production path stays python3 on PATH).
 *
 *   Falling back to a pure-JS bcrypt is intentionally avoided — the
 *   reference implementation is ~800 lines of Blowfish tables and is
 *   easy to get subtly wrong, which would silently break PB login.
 */

import { spawn } from 'node:child_process';

const BCRYPT_COST = 10;

let cachedPython: string | null = null;
let cachedChecked = false;

async function resolvePython(): Promise<string | null> {
  if (cachedChecked) return cachedPython;
  cachedChecked = true;

  const candidates: string[] = [];
  if (process.env.BCRYPT_PYTHON) candidates.push(process.env.BCRYPT_PYTHON);
  candidates.push('python3');

  for (const cmd of candidates) {
    const ok = await new Promise<boolean>((resolve) => {
      const p = spawn(cmd, ['-c', 'import bcrypt; print(bcrypt.__version__)'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d.toString(); });
      p.on('error', () => resolve(false));
      p.on('close', (code) => resolve(code === 0 && /^\d+\./.test(out.trim())));
    });
    if (ok) {
      cachedPython = cmd;
      return cmd;
    }
  }
  return null;
}

export async function hashPasswordBcrypt(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('empty password');
  const pw = plaintext.length > 72 ? plaintext.slice(0, 72) : plaintext;

  const py = await resolvePython();
  if (!py) {
    throw new Error(
      'DIRECT_SQL_USERS=1 but no python3+bcrypt runtime found. ' +
      'Install one of: `apt install python3-bcrypt` (Debian/Ubuntu), ' +
      'or set BCRYPT_PYTHON=/path/to/venv/bin/python3.'
    );
  }

  const script =
    'import sys, bcrypt; ' +
    `sys.stdout.write(bcrypt.hashpw(sys.stdin.buffer.read(), bcrypt.gensalt(${BCRYPT_COST})).decode())`;

  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(py, ['-c', script], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', (e) => reject(new Error(`bcrypt python spawn failed: ${e.message}`)));
    proc.on('close', (code) => {
      if (code === 0 && out.startsWith('$2')) resolve(out);
      else reject(new Error(`bcrypt python exited ${code}: ${err || out}`));
    });
    proc.stdin.on('error', () => {});
    proc.stdin.write(pw);
    proc.stdin.end();
  });
}
