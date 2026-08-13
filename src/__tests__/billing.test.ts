import { describe, it, expect } from 'vitest';
import {
  billingConfigured,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription,
  verifyWebhook,
} from '../providers/billing.js';

describe('billing provider (mock mode)', () => {
  it('is not configured without a secret key', () => {
    expect(billingConfigured()).toBe(false);
  });

  it('creates a deterministic mock checkout URL without credentials', async () => {
    const result = await createCheckoutSession({
      userId: 'user_123',
      email: 'test@thaypley.com',
      tier: 'pro',
      successUrl: 'https://auth.thaypley.com/#/billing?checkout=success',
      cancelUrl: 'https://auth.thaypley.com/#/billing?checkout=cancelled',
    });
    expect(result.mode).toBe('mock');
    expect(result.url).toContain('/#/billing?mock_checkout=');
    expect(result.sessionId.startsWith('mock_cs_')).toBe(true);
  });

  it('creates a mock portal session without credentials', async () => {
    const result = await createPortalSession({ customerId: 'cus_1', returnUrl: 'https://auth.thaypley.com/#/billing' });
    expect(result.mode).toBe('mock');
    expect(result.url).toContain('/#/billing?mock_portal=');
  });

  it('cancels mock-subscription idempotently', async () => {
    const res = await cancelSubscription('sub_123');
    expect(res).toMatchObject({ id: 'sub_123', status: 'canceled', at_period_end: true });
  });

  it('accepts unsigned mock webhook payloads without a signature secret', async () => {
    const payload = Buffer.from(JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } }));
    const events = await verifyWebhook(payload, '');
    expect(events).toHaveLength(1);
    expect((events[0] as { type: string }).type).toBe('checkout.session.completed');
  });

});
