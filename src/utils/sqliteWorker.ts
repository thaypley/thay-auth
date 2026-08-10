import { parentPort } from 'node:worker_threads';
import { runOp } from './sqliteCore.js';

/**
 * SQLite worker — all direct-DB statements run here, never on the main
 * event loop. This matters because `PRAGMA busy_timeout = 5000` means a
 * write contended with PocketBase's own writer can block for up to 5
 * seconds; on the worker that is invisible to the rest of the service.
 */

interface SqliteMessage {
  id: number;
  op: string;
  payload?: any;
}

parentPort!.on('message', (m: SqliteMessage) => {
  if (m.op === 'ping') {
    parentPort!.postMessage({ id: m.id, pong: true });
    return;
  }
  try {
    const result = runOp(m.op, m.payload);
    parentPort!.postMessage({ id: m.id, result });
  } catch (e) {
    const err = e as Error & { field?: string };
    parentPort!.postMessage({
      id: m.id,
      error: { name: err.name, message: err.message, field: err.field },
    });
  }
});
