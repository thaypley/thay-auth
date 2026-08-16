/**
 * Billing & Subscriptions — the thay-sub surface.
 *
 * 2026-08 model: no free tier. thay base ($5/mo) is the entry membership;
 * architects are unlocked across every thay-auth platform & app with no
 * billing. Tier/perk detail beyond base is still being worked out.
 *
 * Reads GET /auth/subscription (tier + entitlements + billing status),
 * then drives the REAL checkout/portal/cancel endpoints. In dev (no
 * STRIPE_SECRET_KEY) the provider runs in mock mode and checkout returns
 * a deterministic in-app URL — the UI stays identical either way.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { toast } from '../utils/toast.js';

export default async function BillingPage(container) {
  const token = auth.getToken();
  if (!token) {
    navigate('/login', true);
    return;
  }

  const body = h('div', { className: 'billing-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'billing-page' }, [body])]);
  mount(container, shell);
  pageTransition(body);

  let sub;
  try {
    sub = await auth.getSubscription();
  } catch (err) {
    console.error('Failed to load subscription:', err);
    body.appendChild(h('div', { className: 'form-card', style: { textAlign: 'center' } }, [
      h('h2', {}, ['something broke']),
      h('p', { className: 'subtitle' }, ['could not load your subscription — the server had an issue']),
      h('button', { className: 'btn btn-primary', onClick: () => location.reload() }, ['retry']),
    ]));
    return;
  }

  const plan = sub.plan || null;
  const isArchitect = sub.architect === true || sub.tier === 'architect';
  const purchases = sub.purchases || [];
  const billingEnabled = sub.billingEnabled !== false;
  const manageUrl = sub.manageUrl || '';

  let busy = false;
  const withBusy = (fn) => async (...args) => {
    if (busy) return;
    busy = true;
    try {
      await fn(...args);
    } finally {
      busy = false;
    }
  };

  const startCheckout = withBusy(async (target) => {
    try {
      // 'base' → { tier:'base' }; 'app:<slug>' → { target:'app:<slug>' }.
      const isApp = String(target).startsWith('app:');
      const res = await auth.createCheckout(isApp ? '' : target, isApp ? target : undefined);
      if (!res || !res.url) {
        toast('could not start checkout — try again in a moment', 'error');
        return;
      }
      if (res.mode === 'mock') {
        toast('mock mode: simulating checkout — refreshing entitlement state', 'info');
        await new Promise((r) => setTimeout(r, 600));
        location.hash = '#/billing';
        location.reload();
        return;
      }
      window.location.href = res.url;
    } catch (err) {
      console.error('Checkout failed:', err);
      toast('could not start checkout — try again in a moment', 'error');
    }
  });

  const openPortal = withBusy(async () => {
    if (manageUrl && !billingEnabled) {
      window.location.href = manageUrl;
      return;
    }
    try {
      const res = await auth.openBillingPortal();
      if (!res || !res.url) {
        toast('no billing customer yet — upgrade first to open the portal', 'info');
        return;
      }
      window.location.href = res.url;
    } catch (err) {
      console.error('Portal failed:', err);
      toast('could not open billing portal — try again in a moment', 'error');
    }
  });

  const cancelPlan = withBusy(async () => {
    if (!window.confirm('cancel your thay-sub? there is no free tier — access ends at the end of the current billing period.')) return;
    try {
      await auth.cancelSubscription();
      toast('subscription canceled — access ends at the period end', 'info');
      location.hash = '#/billing';
      location.reload();
    } catch (err) {
      console.error('Cancel failed:', err);
      toast('could not cancel — try again in a moment', 'error');
    }
  });

  // ─── Current plan card ──────────────────────────────────────────
  const priceHint = !plan
    ? 'starting at $5/mo'
    : plan.monthly === -1
      ? 'unrestricted'
      : plan.status === 'trialing'
        ? `trial — ${plan.trialDaysLeft ?? ''} days left`
        : `$${plan.monthly}/mo`;
  const planName = !plan
    ? 'no active membership'
    : isArchitect
      ? 'thay architect'
      : (plan.name || 'thay base');
  const planBlurb = !plan
    ? 'every surface now starts with thay base at $5/mo.'
    : (plan.blurb || '');

  const currentPlan = h('div', { className: 'glass-card-static billing-current' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['your thay-sub']),
      h('span', { className: 'input-hint' }, [priceHint]),
    ]),
    h('div', { className: 'billing-plan-name' }, [planName]),
    h('p', { className: 'billing-plan-blurb' }, [planBlurb]),
    h('div', { className: 'billing-device-limit' }, [
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, [
        isArchitect || (plan && plan.deviceLimit === -1)
          ? 'unlimited devices'
          : `${plan && plan.deviceLimit !== undefined ? plan.deviceLimit : 1} device${plan && plan.deviceLimit === 1 ? '' : 's'}`,
      ]),
    ]),
    h('ul', { className: 'billing-feature-list' }, (plan ? plan.features || [] : []).map((f) => h('li', {}, [f]))),
    h('div', { className: 'billing-actions' }, [
      isArchitect
        ? h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, ['unrestricted — every platform & app'])
        : plan
          ? h('button', { className: 'btn btn-ghost btn-sm', onClick: openPortal }, ['manage / billing portal'])
          : h('span', { className: 'input-hint', style: { alignSelf: 'center' } }, ['choose thay base below to start']),
      !isArchitect && plan
        ? h('button', { className: 'btn btn-ghost btn-sm', onClick: openPortal }, ['payment method & invoices'])
        : null,
      !isArchitect && plan
        ? h('button', { className: 'btn btn-ghost btn-sm', style: { color: 'var(--danger, #ff6b6b)' }, onClick: cancelPlan }, ['cancel subscription'])
        : h('span', { className: 'input-hint', style: { alignSelf: 'center' } }, isArchitect ? '' : billingEnabled ? '' : 'mock billing mode — set STRIPE_SECRET_KEY for live payments'),
    ]),
  ]);

  // ─── Plan options (thay-sub tiers) ──────────────────────────────
  // One purchasable tier today: thay base at $5/mo. Architect is status,
  // not a purchase — only accounts with architect status move freely
  // across all thay-auth platforms/apps.
  const tierOptions = [
    { id: 'base', name: 'thay base', price: '$5/mo', blurb: 'the thaypley.com membership', deviceLimit: 5, architect: false },
    { id: 'architect', name: 'thay architect', price: 'unrestricted', blurb: 'every platform & app, no billing', deviceLimit: -1, architect: true },
  ];
  const tierGrid = h('div', { className: 'billing-tier-grid' }, tierOptions.map((t) => {
    const isCurrent = t.id === sub.tier;
    return h('div', { className: 'billing-tier' + (isCurrent ? ' billing-tier--current' : ''), style: isCurrent ? { borderColor: 'var(--vibe-accent)' } : {} }, [
      h('div', { className: 'billing-tier-name' }, [t.name]),
      h('div', { className: 'billing-tier-price' }, [t.price]),
      h('div', { className: 'input-hint' }, [t.blurb]),
      h('div', { className: 'billing-tier-devices' }, [
        h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, [
          t.deviceLimit === -1 ? 'unlimited devices' : `${t.deviceLimit} device${t.deviceLimit === 1 ? '' : 's'}`,
        ]),
      ]),
      isCurrent
        ? h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, ['current'])
        : t.architect
          ? h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, ['by status'])
          : h('button', { className: 'btn btn-ghost btn-sm', onClick: () => startCheckout('base') }, ['choose']),
    ]);
  }));

  // ─── App purchases (real entitlements) ──────────────────────────
  const purchaseRows = purchases.length
    ? purchases.map((p) => h('div', { className: 'device-item', style: { flexWrap: 'wrap' } }, [
        h('div', { className: 'device-info' }, [
          h('span', { className: 'device-label' }, [p.appName]),
        ]),
        h('div', { className: 'device-meta' }, [p.price]),
        h('div', { style: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' } }, [
          h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: p.owned ? 'var(--vibe-accent)' : 'var(--vibe-sub)' } }, [p.owned ? 'owned' : (p.status === 'trial' ? 'trial' : 'not owned')]),
          p.owned
            ? null
            : h('button', { className: 'btn btn-ghost btn-sm', onClick: () => startCheckout('app:' + p.slug) }, ['buy']),
        ]),
      ].filter(Boolean)))
    : h('p', { className: 'input-hint', style: { textAlign: 'center', padding: '16px' } }, ['no paid applications yet — the catalog grows weekly.']);

  const purchasesCard = h('div', { className: 'glass-card-static' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['application purchases']),
      h('span', { className: 'input-hint' }, [`${purchases.length} in catalog`]),
    ]),
    h('div', { className: 'devices-list' }, purchaseRows),
  ]);

  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['billing & subscriptions']),
    h('p', { className: 'subtitle' }, ['your thay-sub, application purchases, and entitlements']),
  ]);

  body.appendChild(heading);
  body.appendChild(currentPlan);
  body.appendChild(h('div', { style: { marginTop: 'var(--space-xl)' } }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['plans']),
      h('span', { className: 'input-hint' }, [billingEnabled ? 'live checkout via stripe' : 'mock billing mode — set STRIPE_SECRET_KEY for live payments']),
    ]),
    tierGrid,
  ]));
  body.appendChild(h('div', { style: { marginTop: 'var(--space-xl)' } }, [purchasesCard]));

  setTimeout(() => staggerIn(body, '.billing-tier, .device-item', 150), 150);
}
