import crypto from 'crypto';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.LOG_LEVEL as LogLevel) || 'info';

export function createRequestId(): string {
  return crypto.randomBytes(8).toString('hex');
}

let currentRequestId: string | undefined;

export function setRequestId(id: string | undefined) {
  currentRequestId = id;
}

function timestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, ...args: unknown[]) {
  if (LOG_LEVELS[level] < LOG_LEVELS[currentLevel]) return;

  const entry: Record<string, unknown> = {
    ts: timestamp(),
    level,
    service: 'thay-auth',
  };

  if (currentRequestId) entry.reqId = currentRequestId;

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
