import crypto from 'crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

/**
 * Per-request context via AsyncLocalStorage.
 *
 * The previous implementation stored the request id in a module-level
 * mutable (`currentRequestId`), so two interleaved requests corrupted
 * each other's log attribution after every await — under load every log
 * line carried a random request id. ALS propagates through async
 * continuations, giving correct attribution at ~10-50ns per read.
 */
export const requestContext = new AsyncLocalStorage<{ reqId: string }>();

export function createRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** Back-compat shim; prefer requestContext.run(). */
export function setRequestId(id: string | undefined): void {
  const store = requestContext.getStore();
  if (store && id) store.reqId = id;
}

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, ...args: unknown[]): void {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry: Record<string, unknown> = {
    ts: timestamp(),
    level,
    service: 'thay-auth',
  };

  const store = requestContext.getStore();
  if (store?.reqId) entry.reqId = store.reqId;

  let message: string | undefined;
  let error: unknown | undefined;

  for (const arg of args) {
    if (arg instanceof Error) {
      error = { name: arg.name, message: arg.message, stack: arg.stack?.split('\n').slice(0, 3).join('\n') };
      message = arg.message;
    } else if (typeof arg === 'object' && arg !== null) {
      Object.assign(entry, arg as Record<string, unknown>);
    } else if (typeof arg === 'string' && message === undefined) {
      message = arg;
    } else {
      entry.extra = args.length > 1 ? args : arg;
    }
  }

  entry.msg = message || '';

  if (error) entry.error = error;

  const output = JSON.stringify(entry);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  debug: (...args: unknown[]) => log('debug', ...args),
  info: (...args: unknown[]) => log('info', ...args),
  warn: (...args: unknown[]) => log('warn', ...args),
  error: (...args: unknown[]) => log('error', ...args),
};
