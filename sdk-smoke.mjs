// sdk-smoke.mjs — runs the built SDK against a live thay-auth instance.
// Usage: PB_URL=... node sdk-smoke.mjs
import { ThayAuth } from './sdk/dist/index.js';

const base = process.env.THAY_AUTH_URL || 'http://127.0.0.1:3749';
const auth = new ThayAuth({ baseUrl: base });

try {
  const h = await auth.healthCheck();
  console.log('healthCheck OK:', h);
} catch (e) {
  console.log('healthCheck FAIL (expected if server not running):', e.message);
}
