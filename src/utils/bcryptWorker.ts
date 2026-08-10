import { parentPort } from 'node:worker_threads';
import { hashPasswordCore } from './bcryptCore.js';

/**
 * bcrypt worker — one hash at a time per worker (the pool dispatches a
 * new request only after the previous response), so bcrypt's CPU cost
 * never touches the main event loop.
 */

interface BcryptMessage {
  id: number;
  op: 'ping' | 'hash';
  pw?: string;
  cost?: number;
}

parentPort!.on('message', async (m: BcryptMessage) => {
  if (m.op === 'ping') {
    parentPort!.postMessage({ id: m.id, pong: true });
    return;
  }
  try {
    const hash = await hashPasswordCore(m.pw!, m.cost!);
    parentPort!.postMessage({ id: m.id, result: hash });
  } catch (e) {
    parentPort!.postMessage({ id: m.id, error: String((e as Error)?.message || e) });
  }
});
