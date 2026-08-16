/**
 * AppCard — the shared squared-edge catalog card used by every app-family
 * page. Renders a real icon (SVG line glyph), name, tagline, description,
 * kind/hint badges, and a footer CTA.
 *
 * CTA behavior:
 *  - `status: 'live'`  → primary button opens the app URL.
 *  - `status: 'soon'`  → inline waitlist capture (email → /auth/waitlist
 *    with `source: <slug>`). Converts dead "coming soon" buttons into
 *    lead capture without leaving the page.
 */
import { h } from '../utils/dom.js';
import { toast } from '../utils/toast.js';
import { iconEl } from '../utils/icons.js';

export function AppCard(app) {
  const isLive = app.status === 'live' || !!app.url;

  // ─── Waitlist capture (for soon/coming-soon apps) ───────────────
  const emailInput = h('input', {
    className: 'input input-sm',
    type: 'email',
    placeholder: 'your email',
    'aria-label': `email for ${app.displayName} waitlist`,
    autocomplete: 'email',
  });

  const statusEl = h('span', { className: 'input-hint', style: { marginLeft: 'auto' } });

  const notifyBtn = h('button', {
    className: 'btn btn-primary btn-sm',
    type: 'button',
    onClick: async () => {
      const email = emailInput.value.trim();
      if (!email) {
        emailInput.focus();
        emailInput.style.borderColor = 'var(--danger)';
        return;
      }
      notifyBtn.disabled = true;
      notifyBtn.textContent = '...';
      try {
        const { default: auth } = await import('../sdk.js');
        const result = await auth.joinWaitlist(email, `interested in ${app.displayName}`, app.slug);
        statusEl.textContent = result.message || "you're on the list";
        emailInput.style.display = 'none';
        notifyBtn.style.display = 'none';
        toast(`you're on the ${app.displayName} waitlist`, 'success');
      } catch (err) {
        statusEl.textContent = err.message || 'could not join — try again';
        statusEl.className = 'input-hint-error';
        notifyBtn.disabled = false;
        notifyBtn.textContent = 'notify me';
      }
    },
  }, [app.cta || 'notify me']);

  const footer = isLive
    ? h('div', { className: 'catalog-card-footer' }, [
        h('a', {
          className: 'btn btn-primary btn-sm',
          href: app.url,
          target: '_blank',
          rel: 'noopener noreferrer',
        }, [app.cta || 'open ↗']),
      ])
    : h('div', { className: 'catalog-card-footer catalog-card-footer--waitlist' }, [
        emailInput,
        notifyBtn,
        statusEl,
      ]);

  const icon = iconEl(app, 'app-card-icon');

  return h('div', { className: 'catalog-card glass-card' }, [
    h('div', { className: 'catalog-card-head' }, [
      icon || h('div', { className: 'app-card-icon', style: { width: '56px', height: '56px', fontSize: '24px', flexShrink: 0 } }, [
        (app.displayName || '?').replace(/[()]/g, '')[0].toUpperCase(),
      ]),
      h('div', { className: 'catalog-card-title' }, [
        h('div', { className: 'catalog-card-name' }, [app.displayName]),
        app.tagline ? h('div', { className: 'catalog-card-tagline' }, [app.tagline]) : null,
      ]),
    ]),
    app.description ? h('p', { className: 'catalog-card-description' }, [app.description]) : null,
    h('div', { className: 'catalog-card-meta' }, [
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, [
        app.status === 'live' ? 'live' : 'soon',
      ]),
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, [
        app.kind || 'web',
      ]),
      app.price ? h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-text)' } }, [app.price]) : null,
      h('span', { className: 'input-hint', style: { marginLeft: 'auto' } }, [app.hints || '']),
    ]),
    footer,
  ]);
}
