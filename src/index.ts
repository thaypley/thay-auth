import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { performance } from 'node:perf_hooks';
import { config } from './config.js';
import { logger, createRequestId, requestContext } from './utils/logger.js';
import { metrics } from './utils/metrics.js';
import { closeDirectSql } from './providers/directSqlUsers.js';
import { closeBcryptPool } from './utils/bcrypt.js';
import authRouter from './routes/auth.js';
import linksRouter from './routes/links.js';
import devicesRouter from './routes/devices.js';
import sessionsRouter from './routes/sessions.js';

const app = express();

app.disable('x-powered-by');

// thay-auth sits behind an nginx/VPS reverse proxy. Default 'loopback'
// trusts ONLY the local nginx hop — a client-forged X-Forwarded-For can
// no longer spoof req.ip (which the rate limiter keys on). Set
// TRUST_PROXY=1 when nginx is on a different host.
app.set('trust proxy', config.trustProxy);

// ── Request context: correct reqId attribution across awaits ───────
// AsyncLocalStorage propagates through async continuations, so every log
// line from a handler is attributed to its own request. (The old
// module-global reqId was overwritten by interleaved requests.)
app.use((req, _res, next) => {
  const reqId = (req.headers['x-request-id'] as string) || createRequestId();
  (req as unknown as Record<string, unknown>).reqId = reqId;
  requestContext.run({ reqId }, () => next());
});

// ── Request instrumentation (must be early to time everything) ─────
function routeLabel(req: express.Request): string {
  const routePath = (req as unknown as { route?: { path?: string } }).route?.path;
  if (routePath) return `${req.method} ${routePath}`;
  const segs = req.path.split('/').filter(Boolean);
  return `${req.method} /${segs.slice(0, 2).join('/')}`;
}

let activeRequests = 0;
metrics.registerGauge('thay_auth_active_requests', () => activeRequests);

app.use((req, res, next) => {
  const start = performance.now();
  activeRequests += 1;
  res.on('finish', () => {
    const ms = performance.now() - start;
    const route = routeLabel(req);
    const status = String(res.statusCode);
    metrics.observe('thay_auth_request_latency', ms, { route, status });
    metrics.inc('thay_auth_requests_total', { route, status });
    activeRequests -= 1;
  });
  next();
});

app.use(helmet());
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
}));

// Route-scoped body limits: 6MB ONLY for /auth/avatar (base64 images);
// everything else is capped at 64kb so a large-body attack can't force
// a multi-MB parse per request. Mounted BEFORE the default parser (body-
// parser skips when req._body is already set, so order matters).
app.use('/auth/avatar', express.json({ limit: '6mb' }));
// Raw body ONLY for /auth/webhook — Stripe webhook signatures must be
// verified against the exact bytes received.
app.use('/auth/webhook', express.raw({ type: () => true, limit: '64kb' }));
app.use(express.json({ limit: '64kb' }));

app.use('/auth/links', linksRouter);
app.use('/auth', authRouter);
app.use('/devices', devicesRouter);
app.use('/sessions', sessionsRouter);

app.get('/', (_req, res) => {
  res.status(200).json({
    service: 'thay-auth',
    version: '2.0.0',
    status: 'running',
  });
});

// ── Prometheus metrics (Prometheus text exposition format) ─────────
metrics.registerGauge('thay_auth_process_memory_rss_bytes', () => process.memoryUsage().rss);
metrics.registerGauge('thay_auth_process_memory_heap_used_bytes', () => process.memoryUsage().heapUsed);
metrics.registerGauge('thay_auth_process_memory_heap_total_bytes', () => process.memoryUsage().heapTotal);
metrics.registerGauge('thay_auth_process_uptime_seconds', () => process.uptime());

app.get('/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4; charset=utf-8').send(metrics.render());
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // body-parser 413 / malformed JSON land here — 4xx, not a 500.
  const status = (err as { status?: number; type?: string }).status ?? 500;
  if (status >= 500) {
    metrics.inc('thay_auth_pb_errors_total', { op: 'unhandled' });
    logger.error('Unhandled error:', err);
  } else {
    metrics.inc('thay_auth_client_errors_total', { status: String(status) });
  }
  if (res.headersSent) return _next(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : 'Bad request' });
});

const server = app.listen(config.port, () => {
  logger.info(`thay-auth running on port ${config.port}`);
  logger.info(`PocketBase URL: ${config.pbUrl}`);
});

// ── Socket hardening ───────────────────────────────────────────────
server.requestTimeout = 30_000;
server.headersTimeout = 35_000;
server.keepAliveTimeout = 5_000;

// ── Event-loop lag gauge ───────────────────────────────────────────
setInterval(() => {
  const start = performance.now();
  setImmediate(() => {
    metrics.setGauge('thay_auth_eventloop_lag_ms', {}, performance.now() - start);
  });
}, 5000).unref();

// ── Graceful shutdown ──────────────────────────────────────────────
let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, draining connections...`);
  const force = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  force.unref();
  server.close(() => {
    closeDirectSql();
    closeBcryptPool();
    logger.info('Shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  metrics.inc('thay_auth_pb_errors_total', { op: 'unhandledRejection' });
  logger.error('Unhandled promise rejection:', reason);
});

export default app;
