import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import bcryptjs from 'bcryptjs';
import { metrics } from './metrics.js';
import { config } from '../config.js';

/**
 * bcrypt worker pool — signup hashing runs on worker threads so the
 * ~78ms/cost-10 hash (pure JS) never saturates the main event loop.
 * Under a signup burst, every OTHER request keeps full-speed service.
 *
 * Fallbacks, in order:
 *   1. Worker pool (preferred; N lanes, one hash in flight per lane).
 *   2. Bounded queue when all lanes are busy.
 *   3. Inline bcryptjs when the queue overflows or workers can't start
 *      (e.g. Node < 22.18 without native TS support in dev) — identical
 *      behavior to the original single-threaded implementation.
 *
 * The worker core prefers native `bcrypt` when an operator installs it
 * (libuv offload + ~4x speed) — no code change needed.
 */

const BCRYPT_COST = 10;
const MAX_BYTES = 72; // bcrypt truncates beyond 72 bytes

const workerUrl = new URL(import.meta.url.endsWith('.ts') ? './bcryptWorker.ts' : './bcryptWorker.js', import.meta.url);

const WORKERS = config.bcryptWorkers > 0
  ? config.bcryptWorkers
  : Math.min(Math.max(2, (os.availableParallelism?.() ?? os.cpus().length) - 1), 4);
const MAX_QUEUE = config.bcryptMaxQueue;

interface HashRequest {
  pw: string;
  cost: number;
  resolve: (hash: string) => void;
  reject: (err: Error) => void;
}

interface Lane {
  worker: Worker;
  busy: boolean;
  pending: Map<number, HashRequest>;
  seq: number;
}

const lanes: Lane[] = [];
const queue: HashRequest[] = [];
let nextLane = 0;
let ready = false;
let readyPromise: Promise<boolean> | null = null;
let inlineFallback = false;

function ping(worker: Worker): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), 3000);
    worker.once('message', (m) => {
      clearTimeout(t);
      resolve(m?.pong === true);
    });
    worker.once('error', () => {
      clearTimeout(t);
      resolve(false);
    });
    worker.postMessage({ id: 0, op: 'ping' });
  });
}

async function ensureReady(): Promise<boolean> {
  if (ready) return true;
  if (inlineFallback) return false;
  if (!readyPromise) {
    readyPromise = (async () => {
      for (let i = 0; i < WORKERS; i++) {
        try {
          const worker = new Worker(workerUrl);
          worker.unref();
          if (!(await ping(worker))) {
            void worker.terminate();
            continue;
          }
          const lane: Lane = { worker, busy: false, pending: new Map(), seq: 0 };
          worker.on('message', (m) => {
            const req = lane.pending.get(m.id);
            if (req) {
              lane.pending.delete(m.id);
              if (m.error) req.reject(new Error(String(m.error)));
              else req.resolve(m.result as string);
            }
            lane.busy = false;
            pump();
          });
          worker.on('error', (e) => {
            metrics.inc('thay_auth_bcrypt_worker_errors_total');
            for (const req of lane.pending.values()) req.reject(e);
            lane.pending.clear();
            lane.busy = false;
          });
          lanes.push(lane);
        } catch {
          /* lane failed to construct — try next */
        }
      }
      return lanes.length > 0;
    })();
  }
  ready = await readyPromise;
  return ready;
}

function dispatch(req: HashRequest): void {
  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[(nextLane + i) % lanes.length];
    if (!lane.busy) {
      lane.busy = true;
      nextLane = (nextLane + 1) % lanes.length;
      const id = ++lane.seq;
      lane.pending.set(id, req);
      lane.worker.postMessage({ id, op: 'hash', pw: req.pw, cost: req.cost });
      return;
    }
  }
  queue.push(req); // all busy (caller checks first, but stay correct)
}

function pump(): void {
  while (queue.length > 0 && lanes.some((l) => !l.busy)) {
    dispatch(queue.shift() as HashRequest);
  }
}

async function hashInline(pw: string, cost: number): Promise<string> {
  return bcryptjs.hash(pw, cost);
}

async function runHash(pw: string, cost: number): Promise<string> {
  const t0 = performance.now();
  const ok = await ensureReady();
  if (!ok) {
    inlineFallback = true;
    metrics.inc('thay_auth_bcrypt_inline_total');
    const hash = await hashInline(pw, cost);
    metrics.observe('thay_auth_bcrypt_hash', performance.now() - t0, { backend: 'inline' });
    return hash;
  }

  const promise = new Promise<string>((resolve, reject) => {
    const req: HashRequest = { pw, cost, resolve, reject };
    if (lanes.every((l) => l.busy)) {
      if (queue.length >= MAX_QUEUE) {
        // Safety valve: never let signups pile up behind a saturated pool.
        metrics.inc('thay_auth_bcrypt_inline_total');
        bcryptjs.hash(pw, cost).then(resolve, reject);
        return;
      }
      queue.push(req);
    } else {
      dispatch(req);
    }
  });

  try {
    const hash = await promise;
    metrics.observe('thay_auth_bcrypt_hash', performance.now() - t0, { backend: 'worker' });
    return hash;
  } catch (e) {
    metrics.observe('thay_auth_bcrypt_hash', performance.now() - t0, { backend: 'error' });
    throw e;
  }
}

export async function hashPasswordBcrypt(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('empty password');
  const pw = plaintext.length > MAX_BYTES ? plaintext.slice(0, MAX_BYTES) : plaintext;
  return runHash(pw, BCRYPT_COST);
}

/** Terminate workers on graceful shutdown (best-effort; rejects queued work). */
export function closeBcryptPool(): void {
  while (queue.length > 0) {
    (queue.shift() as HashRequest).reject(new Error('shutdown'));
  }
  for (const lane of lanes) {
    void lane.worker.terminate();
  }
  lanes.length = 0;
  ready = false;
  readyPromise = null;
}
