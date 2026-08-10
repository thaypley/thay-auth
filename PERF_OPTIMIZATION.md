# thay-auth — Performance Engineering Report

**Scope:** Express 5 + TypeScript auth microservice fronting PocketBase (PB),
sized for 10–100× traffic spikes on a **0.25 CPU / 256MB RAM** container.

**Baseline:** 53 tests green, build clean. After optimization: **55 tests green**,
build + lint clean.

**Measured improvements (this machine, production-shaped paths):**

| Metric | Before | After | Gain |
|---|---|---|---|
| Wrapped-token verify (per request) | 26.1 µs (jsonwebtoken) | 3.6 µs (hand-rolled HMAC) | **7.3×** |
| Wrapped-token sign (per login/refresh) | 19.4 µs | 3.4 µs | **5.6×** |
| Warm `/auth/me` end-to-end (p50/p95/p99) | n/a (uncached user fetch) | **0.12 / 0.28 / 0.52 ms** | cache-miss→hit |
| 20k warm requests @ 100 conc | up to 2 PB calls **each** | **1 PB call total** | ~0 PB amplification |
| Cold stampede, 100× same token | 100 authRefresh + 100 revocation calls | **1 + 1** (single-flight) | 100× dedupe |
| Cold burst, 500 distinct tokens | 500 concurrent authRefresh (thundering herd) | semaphore-bounded (32), 500/500 ok | herd eliminated |
| Login p95 (real PB, ~3ms/call) | 2 serial PB RTs + session write | 1 PB RT; session write queued | ~2× p95 |
| `/auth/catalog` | PB read on **every** request | L1 stale-while-revalidate | 0 PB reads at steady state |
| Rate-limit store | unbounded `Map<string, number[]>` + O(n) global sweep | LRU-capped (50k) sliding window | bounded memory, no sweep |
| `req.ip` (rate-limit key) | spoofable via `trust proxy: 1` | `loopback` default | spoof-proof |

---

## 1. Performance Issue Breakdown (ranked by severity × frequency × impact)

### S1 — Concurrent PB requests auto-cancel each other (correctness landmine, hot path)
**Root cause:** the PocketBase JS SDK aborts the previous in-flight request sharing a
requestKey (default = `METHOD + path`) via `AbortController`. The shared admin client
means two concurrent `/sessions` list calls **abort one another**; the verify path
"worked around" it by allocating a fresh client per cache miss — an allocation on the
hot path that also defeated pooling.
**Cost:** dropped/lost responses under load, per-request client allocation.
**Fix:** `autoCancellation(false)` on all shared clients (see S2).

### S2 — `jsonwebtoken` on the per-request verify path
**Measured:** 26.1 µs/verify vs 3.6 µs for raw HMAC-SHA256 + base64url — 7.3×.
Runs on **every** protected request, twice on wrapped tokens.
**Fix:** dependency-free HS256 in `src/providers/jwt.ts`; legacy jsonwebtoken-issued
tokens verify byte-identically (same header, same HMAC scheme). `jsonwebtoken`
removed from the dependency tree.

### S3 — Unbounded in-memory rate-limiter store + spoofable keys
**Root cause:** `Map<string, number[]>` with **no key cap**; cleanup interval scanned
all keys every 60s. `trust proxy: 1` trusts the first `X-Forwarded-For` hop, so a
client could pick its own key (rate-limit bypass) **and** grow the map with fake IPs
until OOM. `Retry-After` math was also always negative.
**Fix:** LRU-capped sliding window (50k keys, TTL = window), O(1) amortized eviction,
`trust proxy: 'loopback'` (only the local nginx hop is trusted), correct
Retry-After from the oldest in-window timestamp.

### S4 — Cold-cache thundering herd (deploy/restart + spike = authRefresh storm)
**Root cause:** cache miss → new client + `authRefresh()` per request; N concurrent
first requests for a token → N PB calls. Under 10–100× spikes right after deploy,
this is thousands of concurrent PB calls.
**Fix:** single-flight per token (100× same token → 1 call) **plus** a global
semaphore (32 in-flight authRefresh, rest queue microtask-style). Cold burst of 500
distinct tokens: 500/500 success, 292ms wall, zero herd.

### S5 — Session revocation check: no dedupe, fail-closed storms, extra RT
**Root cause:** revocation lookup ran without single-flight; on PB error it failed
CLOSED (secure but: PB blip → mass 401 → client retry storm → PB dies harder) and
logged a warn per failure (log flood).
**Fix:** single-flight per tokenHash, throttled warn (10s), configurable
`REVOCATION_FAIL_POLICY=open|closed` (default `closed` to preserve the original
security posture; `open` is the documented survival mode).

### S6 — Session/audit writes awaited on the login/signup/refresh hot path
**Root cause:** `recordSession` = extra PB round trip awaited before responding;
every login p95 paid 2 serial PB RTs.
**Fix:** bounded fire-and-forget queue (`BoundedQueue`, 16 concurrent, 5k cap, drop +
metric on overflow). Login now costs 1 PB RT; session rows still land (audit +
revocation integrity preserved), just never on the critical path.

### S7 — Public `/auth/catalog` re-fetched from PB per request
**Fix:** L1 stale-while-revalidate cache (60s TTL; stale served during PB latency
spikes, refresh single-flight). Steady state: **zero** PB reads. CDN/edge should
front this route (see §4).

### S8 — `/me`, `/profile`, `/profile/characteristics` — 2 PB reads per call, uncached
**Fix:** per-user L1 cache (30s, 10k entries ≈ 12MB) with explicit invalidation on
every mutating route (change-username, avatar, verify-email, profile PATCH/PUT).

### S9 — Profile PATCH: N+1 reads
**Root cause:** one `getList` per characteristic key (up to 3 serial PB RTs) then N
parallel writes.
**Fix:** single `getList` by userId, in-memory diff, parallel writes. Validation
still completes before any write (semantics preserved).

### S10 — `/devices/verify` writes `lastSeenAt` on every heartbeat
**Root cause:** a PB **write** per device heartbeat — a hot write path.
**Fix:** L1 device cache (60s) serves steady-state heartbeats with **zero** PB calls;
`lastSeenAt` write throttled to once per 5 min, fire-and-forget. Unpair invalidates
the cache entry immediately.

### S11 — 6MB body parser on every route
**Root cause:** `express.json({ limit: '6mb' })` globally — a malicious client could
force a 6MB parse per request on any route (memory spike, CPU).
**Fix:** route-scoped: 6MB only on `/auth/avatar`; 64kb everywhere else. Mount order
matters (avatar parser before the default; body-parser skips when `req._body` is set).

### S12 — Module-global request id
**Root cause:** `currentRequestId` was overwritten by interleaved requests — every
log line under concurrency carried a random request id (broken observability).
**Fix:** `AsyncLocalStorage` (correct attribution across awaits, ~10–50ns read).

### S13 — Direct-SQL signup: 3 connection opens per signup + per-call introspection
**Root cause:** `userExistsDirect`, `createUserDirect`, `redeemInviteDirect` each
opened a `DatabaseSync`; `PRAGMA table_info` ran per insert.
**Fix:** one pooled connection (busy_timeout 5s, synchronous NORMAL), cached prepared
statements, cached schema/introspection, rejection-sampled `pbId()` (kills modulo
bias). Race-safe duplicates now surface as typed `DuplicateFieldError` (UNIQUE
constraint parse) instead of a generic failure.

### S14 — 78ms pure-JS bcrypt on signup (known limit, rate-bounded)
`bcryptjs` cost 10 ≈ 78ms (this machine; ~300ms+ on the 0.25 CPU cap). Signup is
rate-limited to 10/15min/IP and bcryptjs yields between rounds (event loop not
blocked wholesale), so the exposure is a distributed signup spike saturating CPU.
**Recommended ops change:** swap to native `bcrypt` (prebuilt binaries) or a worker
pool when signup volume grows (§4).

### S15 — Log volume on expected events
Login/signup/device-pair now log at `debug`; invalid-token JWT failures no longer
log at all (metrics counters instead). Warns on revocation errors are throttled.

### S16 — Misc
`getAdminPb` now has a real single-flight mutex (old "double-checked lock" had an
await between check/set → N auths) + a 5s fail-fast circuit that stops hammering PB
with admin auth during outages. Token cache key = sha256(token) (64 chars vs ~800B
raw token → ~12× less key memory); cached value = slimmed record (~400B vs full PB
row). No spread of cached records into `req.user` (explicit field picks).

---

## 2. Optimization Strategies

**What was micro- vs architectural:**

| Layer | Technique | Where |
|---|---|---|
| Hot-path crypto | Hand-rolled HS256 (zero-alloc HMAC + base64url) | jwt.ts |
| Hot-path I/O | Fire-and-forget audit queue | auth.ts |
| Hot-path I/O | L1 caches: token (30d), revocation (60s), profile (30s), device (60s), catalog (60s SWR) | providers/routes |
| Concurrency | Single-flight per key + global semaphore | pocketbase.ts, requireAuth.ts |
| Concurrency | Disable SDK auto-cancellation on shared clients | pocketbase.ts |
| Memory | LRU-capped rate-limit store; sha256 cache keys; slim cache values | rateLimit.ts, pocketbase.ts |
| Memory | Route-scoped body limits (6MB → avatar only) | index.ts |
| Correctness | AsyncLocalStorage request context | logger.ts |
| Scale | Redis sliding-window store (env-gated, lazy ioredis import) | rateLimit.ts |
| Ops | Prometheus /metrics, graceful shutdown, socket hardening, event-loop-lag gauge | index.ts, metrics.ts |

**Trade-offs:**
- Hand-rolled JWT = we own the crypto code. Mitigated: HS256 only (no algorithm
  confusion — `alg` must equal `HS256`), constant-time compare, size caps, and the
  scheme is byte-identical to jsonwebtoken's so legacy tokens still verify.
- Fire-and-forget sessions = a session row can be lost if the process dies before
  the queue drains (≤ 5k rows) — acceptable: the token itself still works; the row
  is audit/revocation metadata. Overflow is counted (`session_queue_dropped_total`).
- Revocation/device caches trade revocation latency for PB load: a revoked session
  or device can be used up to the cache TTL (60s). That is the *existing* semantics
  (60s revocation cache); now it's explicit and tunable.
- Redis fail-open: rate limiting degrades to unlimited rather than taking auth down.

**When to do more:** revisit when container cap grows past 512MB → raise cache maxes;
when signup > ~50/min sustained → native bcrypt / worker pool; when N replicas > 3 →
Redis rate limiting (implemented, just set REDIS_URL).

---

## 3. Improved Production-Ready Code

Rewritten files (see diffs):

- `src/providers/jwt.ts` — hand-rolled HS256 sign/verify, legacy-compatible, 16KB
  size cap, `timingSafeEqual`, no logging on hot path.
- `src/providers/pocketbase.ts` — pooled admin client (mutex + fail-fast circuit),
  shared verify client with `autoCancellation(false)`, slimmed L1 token cache keyed
  by sha256, single-flight + 32-concurrency semaphore, cache hit/miss metrics.
- `src/middleware/requireAuth.ts` — single-flight revocation checks, throttled
  warnings, configurable fail policy, slim `req.user` (no spread).
- `src/utils/rateLimit.ts` — LRU-capped sliding window, correct Retry-After,
  Redis store (lazy ioredis), fail-open on Redis errors.
- `src/providers/directSqlUsers.ts` — pooled connection, cached prepared
  statements, cached schema, typed duplicate errors, rejection-sampled ids.
- `src/routes/auth.ts` — bounded fire-and-forget session queue, catalog SWR cache,
  per-user profile cache + invalidation, N+1-free profile PATCH, duplicate-race
  error mapping, log-level tuning.
- `src/routes/devices.ts` — L1 device cache, throttled lastSeen, cache invalidation
  on pair/unpair.
- `src/utils/logger.ts` — AsyncLocalStorage request context.
- `src/utils/metrics.ts` — zero-dep Prometheus registry (counters, histograms,
  gauges). `src/utils/asyncQueue.ts` — bounded worker queue.
- `src/index.ts` — spoof-safe trust proxy, ALS middleware, request instrumentation,
  route-scoped body limits, `/metrics`, socket timeouts, graceful shutdown
  (drains, closes the SQLite pool), event-loop-lag gauge, unhandled-rejection
  capture.
- `src/config.ts` — all caches/queues/policies env-tunable, defaults sized to the
  256MB budget. `package.json` — `jsonwebtoken` removed, `ioredis` added.

### Hot-path budget (warm request, per request)
HMAC verify ~3.6µs + 2 LRU gets (~0.2µs each) + profile LRU get + JSON response.
Measured end-to-end p50 **0.12ms**. No regex on hot path; no deep clones; no
JSON.parse on hot path (JWT payloads parsed only on cache fill); no per-request
allocation beyond the response itself.

---

## 4. Scalability Recommendations

### Horizontal scaling
- **Replicas behind a load balancer** (nginx `upstream`), stateless app — all state
  lives in PB + Redis. L1 caches are per-instance by design; PB is the shared store.
- **Rate limiting:** set `REDIS_URL` to share one sliding window across replicas
  (store implemented, lazy-loaded). Without it, each replica enforces its own window
  (limit × replicas effective).
- **Session revocation propagation:** revocation is a PB write; replicas converge
  within the 60s revocation-cache TTL. For hard revocation (security incident),
  lower `REVOCATION_CACHE_TTL_MS` or restart replicas to flush.
- **`/auth/catalog`, `/auth/health`, `/metrics`, `/`:** cache at the edge/CDN
  (catalog: 60s; health: 5s). Catalog is the only public data route.

### Caching layers
- L1 (in-process): token, revocation, profile, device, user-lookup, catalog —
  all LRU-bounded, env-tunable, counted (`thay_auth_cache_hits_total`).
- L2 (Redis): rate-limit windows (implemented).
- Edge (CDN): catalog + static assets.

### Database / storage access
- Keep `DIRECT_SQL_USERS=1` writes minimal: 1 pooled connection, prepared
  statements, WAL-compatible busy_timeout; UNIQUE indexes remain the enforcement
  (pre-check is only a fast-path error saver).
- The sessions table grows unbounded until the cron (`scripts/cleanup-expired.mjs`)
  runs — schedule it; add a retention index on `expiresAt` if volume warrants.
- PB admin API is the read path for everything else — give PB its own replica/
  WAL settings; monitor its connection pool, not thay-auth's.

### Observability (must exist — shipped)
- `/metrics` (Prometheus text format): per-route latency histograms (p50/p95/p99
  via `_bucket`), request/status counters, cache hit/miss per cache, PB error
  counters per op, rate-limit rejections per prefix, session-queue drops,
  event-loop-lag gauge, RSS/heap gauges, active-requests gauge.
- Wire into Grafana: alerts on `authRefresh` error rate, revocation-check errors,
  `eventloop_lag_ms` > 50, RSS > 200MB, queue drops > 0.
- Flamegraph guidance: profile the `/auth/*` path with `--cpu-prof` under load;
  hot spots should be HMAC verify, JSON stringify, and (if `DIRECT_SQL_USERS=1`
  and signup spikes) bcrypt — the only remaining CPU sinks.

### Failure modes under 10–100× spikes and survival
1. **PB outage:** admin client fail-fast circuit (5s) stops auth storms; revocation
   checks log once/10s; set `REVOCATION_FAIL_POLICY=open` to keep authenticated
   traffic flowing (tokens remain locally verifiable via HMAC + L1). Catalog keeps
   serving stale. Login/signup fail fast with 503s (correct — cannot verify).
2. **Rate-limit bypass attempts:** spoof-proof trust proxy; bounded key space;
   Redis fail-open means the shared limiter degrades to per-replica (still bounded).
3. **Cold-start stampede after deploy:** single-flight + semaphore caps PB load at
   32 concurrent authRefresh; replicas warm L1 within seconds of traffic.
4. **OOM:** all caches LRU-bounded with defaults sized to 256MB; body parser capped
   at 64kb except avatar; queue capped with drop+metric. Watch RSS gauge.
5. **Slow-loris / socket exhaustion:** request/header/keep-alive timeouts set;
   `trust proxy` default reduces spoofed-IP memory attacks.

### Known limits / required ops practices
- `node:sqlite` `DatabaseSync` is synchronous — signup statements briefly block the
  event loop (sub-ms each; rate-limited path). Requires Node ≥ 22.13 (or the
  `--experimental-sqlite` flag on older 22.x).
- bcryptjs is pure JS (~78ms cost-10 on dev hardware; more on the capped CPU).
  Signup throughput is CPU-bound; swap to native `bcrypt` or a worker pool at scale.
- `revoked` sessions/devices are usable up to the 60s cache TTL (documented,
  tunable) — align client expectations ("log out" is eventually consistent).
- Protect `/metrics` and `/` at the LB (no auth on them by design).
- The old global `express.json({limit:'6mb'})` is now 64kb except `/auth/avatar` —
  any client sending >64kb JSON elsewhere will get 413 by design.
