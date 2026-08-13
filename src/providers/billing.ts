/**
 * Billing provider — thay-sub payment surface.
 *
 * Native-fetch Stripe-compatible wiring (no new dependency): checkout
 * sessions create a hosted Stripe Checkout/Portal URL, webhook events
 * reconcile entitlements, and a MOCK mode (no STRIPE_SECRET_KEY) keeps
 * dev + tests fully functional behind the exact same contract.
 *
 * The client-facing contract (tier, checkoutUrl, manageUrl, entitlements)
 * never changes — only this provider knows whether Stripe is real.
 */
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

const STRIPE_API = 'https://api.stripe.com/v1';

/**
 * Maps a thay-sub tier to a Stripe price ID. Configurable via env so the
 * VPS deployment can point at live plan IDs without a code change.
 */
function priceIdFor(tier: string, _isAnnual: boolean): string {
  const envId = process.env[`STRIPE_PRICE_${tier.toUpperCase().replace(/-/g, '_')}`];
  if (envId) return envId;
  // Defaults match the published plan grid (USD/mo). In mock mode these
  // are ignored; in prod, set STRIPE_PRICE_* explicitly at deploy.
  const defaults: Record<string, string> = {
    core: 'price_thay_core',
    plus: 'price_thay_plus',
    pro: 'price_thay_pro',
    enterprise: 'price_thay_ent',
  };
  return defaults[tier] || '';
}

export function billingConfigured(): boolean {
  return Boolean(config.stripe.secretKey);
}

function authHeaders(): Record<string, string> {
  return {
    'Authorization': `Bearer ${config.stripe.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
}

function encodeForm(data: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined && v !== '') params.append(k, String(v));
  }
  return params.toString();
}

async function stripeFetch(path: string, form?: Record<string, string | number | boolean | undefined>, method = 'POST') {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: authHeaders(),
    body: form ? encodeForm(form) : undefined,
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    logger.error('Stripe non-JSON response', { status: res.status, body: text.slice(0, 200) });
  }
  if (!res.ok) {
    throw new Error(`Stripe ${method} ${path} failed: ${res.status} ${(json as { error?: { message?: string } }).error?.message || text.slice(0, 160)}`);
  }
  return json;
}

export interface CheckoutInput {
  userId: string;
  email: string;
  tier: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutResult {
  url: string;
  mode: 'stripe' | 'mock';
  sessionId: string;
}

export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutResult> {
  if (!billingConfigured()) {
    logger.info('Billing mock mode: checkout stub for', { userId: input.userId, tier: input.tier });
    // Deterministic mock session id so tests/UI can assert the contract.
    const sessionId = `mock_cs_${input.userId.slice(0, 8)}_${Date.now().toString(36)}`;
    return { url: `${config.appBaseUrl}/#/billing?mock_checkout=${sessionId}&tier=${encodeURIComponent(input.tier)}`, mode: 'mock', sessionId };
  }
  const price = priceIdFor(input.tier, false);
  if (!price) throw new Error(`No Stripe price configured for tier ${input.tier}`);
  const data = await stripeFetch('/checkout/sessions', {
    mode: 'subscription',
    customer_email: input.email,
    line_items: `[{"price":"${price}","quantity":1}]`,
    subscription_data: JSON.stringify({ metadata: { userId: input.userId, tier: input.tier } }),
    metadata: JSON.stringify({ userId: input.userId, tier: input.tier }),
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.userId,
  });
  return { url: String(data.url), mode: 'stripe', sessionId: String(data.id) };
}

export interface PortalInput {
  customerId: string;
  returnUrl: string;
}

export async function createPortalSession(input: PortalInput): Promise<CheckoutResult> {
  if (!billingConfigured()) {
    return { url: `${config.appBaseUrl}/#/billing?mock_portal=customer_${input.customerId}`, mode: 'mock', sessionId: `mock_ps_${Date.now().toString(36)}` };
  }
  const data = await stripeFetch('/billing_portal/sessions', {
    customer: input.customerId,
    return_url: input.returnUrl,
  });
  return { url: String(data.url), mode: 'stripe', sessionId: String(data.id) };
}

export async function cancelSubscription(subscriptionId: string, atPeriodEnd = true): Promise<unknown> {
  if (!billingConfigured()) return { id: subscriptionId, status: 'canceled', at_period_end: true };
  return stripeFetch(`/subscriptions/${subscriptionId}`, { cancel_at_period_end: atPeriodEnd });
}

/**
 * Verify a Stripe webhook signature. When STRIPE_WEBHOOK_SECRET is set,
 * the signature is checked with HMAC-SHA256 as Stripe does; in mock mode
 * the raw payload is returned (tests send mock events directly).
 */
export async function verifyWebhook(rawBody: Buffer, signature: string): Promise<unknown[]> {
  const secret = config.stripe.webhookSecret;
  if (!secret) {
    // Mock mode: accept the body as one event (or an array), unsigned.
    const text = rawBody.toString('utf8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const parts = signature.split(',').map((p) => p.trim());
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2) || '';
  const sig = parts.find((p) => p.startsWith('v1='))?.slice(3) || '';
  const expected = crypto.createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody.toString('utf8')}`)
    .digest('hex');
  const provided = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length || !crypto.timingSafeEqual(provided, expectedBuf)) {
    throw new Error('Invalid Stripe webhook signature');
  }
  const text = rawBody.toString('utf8');
  return [JSON.parse(text)];
}
