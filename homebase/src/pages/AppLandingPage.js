/**
 * AppLandingPage — /app/:slug. Individual landing surface for every app in
 * the thay family, live or soon. Live apps get an open CTA; soon apps get an
 * OS-specific early-access waitlist that POSTs to /auth/waitlist with
 * `source: <slug>` and an `os` note so the crew knows which platform to
 * prioritize. Unknown slugs render a graceful not-found card.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { iconEl } from '../utils/icons.js';
import { pageTransition, fadeUp } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { CORE_APPS, DABBA_APPS, TABBI_APPS, CREATIVE_APPS, FAMILY_LINKS } from '../data/directory.js';

const ALL_APPS = [...CORE_APPS, ...DABBA_APPS, ...TABBI_APPS, ...CREATIVE_APPS];
const OS_OPTIONS = ['mac', 'windows', 'linux'];

export default async function AppLandingPage(container, slug) {
  const app = ALL_APPS.find((a) => a.slug === slug) || null;

  const page = h('div', { className: 'downloads-page' });
  const body = h('div', { className: 'downloads-body' });
  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);

  if (!app) {
    page.appendChild(h('div', { className: 'downloads-header' }, [
      h('h2', {}, ['app not found']),
      h('p', { className: 'subtitle' }, ['that app does not exist in the thay family — yet.']),
    ]));
    page.appendChild(h('div', { className: 'downloads-body' }, [
      h('a', { className: 'btn btn-primary', href: '#/apps' }, ['browse all apps']),
    ]));
    pageTransition(page);
    return;
  }

  const isLive = app.status === 'live' || !!app.url;

  // ─── OS picker (soon apps only) ─────────────────────────────────
  let pickedOs = 'mac';
  const osButtons = OS_OPTIONS.map((os) => {
    const btn = h('button', {
      className: 'os-picker-option' + (os === pickedOs ? ' os-picker-option--active' : ''),
      type: 'button',
      onClick: () => {
        pickedOs = os;
        osButtons.forEach((b) => b.classList.toggle('os-picker-option--active', b === btn));
      },
    }, [os]);
    return btn;
  });

  const emailInput = h('input', {
    className: 'input',
    type: 'email',
    placeholder: 'your email',
    'aria-label': `email for ${app.displayName} early access`,
    autocomplete: 'email',
  });
  const statusEl = h('p', { className: 'input-hint', style: { textAlign: 'center' }, 'aria-live': 'polite' });
  const waitlistBtn = h('button', {
    className: 'btn btn-primary',
    type: 'button',
    onClick: async () => {
      const email = emailInput.value.trim();
      if (!email) {
        emailInput.focus();
        emailInput.style.borderColor = 'var(--danger)';
        return;
      }
      waitlistBtn.disabled = true;
      waitlistBtn.textContent = '...';
      statusEl.textContent = '';
      try {
        const result = await auth.joinWaitlist(email, `early access · ${pickedOs}`, app.slug);
        statusEl.textContent = result.message || `you're on the ${app.displayName} early-access list`;
        statusEl.className = 'input-hint success-text';
        waitlistBtn.textContent = 'you\'re on the list ✓';
        emailInput.disabled = true;
      } catch (err) {
        statusEl.textContent = err.message || 'could not join — try again';
        statusEl.className = 'input-hint-error';
        waitlistBtn.disabled = false;
        waitlistBtn.textContent = 'notify me';
      }
    },
  }, ['notify me']);

  // ─── Header ─────────────────────────────────────────────────────
  const heading = h('div', { className: 'downloads-header app-landing-head' }, [
    h('a', { className: 'input-hint', href: '#/apps', style: { textDecoration: 'none' } }, ['← all apps']),
    h('div', { className: 'app-landing-hero' }, [
      iconEl(app, 'app-landing-icon') || h('div', { className: 'app-landing-icon', style: { background: 'var(--vibe-primary)' } }, [
        (app.displayName || '?').replace(/[()]/g, '')[0].toUpperCase(),
      ]),
      h('div', { className: 'app-landing-titles' }, [
        h('h2', {}, [app.displayName]),
        h('p', { className: 'subtitle' }, [app.tagline]),
      ]),
    ]),
    h('div', { className: 'app-landing-badges' }, [
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, [isLive ? 'live' : 'soon']),
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, [app.kind || 'web']),
      ...(app.pricing ? [h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-text)' } }, [app.pricing])] : []),
    ]),
  ]);

  // ─── Description + overview ─────────────────────────────────────
  const desc = h('div', { className: 'app-landing-desc glass-card' }, [
    h('p', { style: { margin: 0 } }, [app.description]),
    ...(app.overview ? [h('p', { className: 'input-hint', style: { marginTop: 'var(--space-md)' } }, [app.overview])] : []),
  ]);

  // ─── CTA / waitlist panel ───────────────────────────────────────
  const ctaPanel = h('div', { className: 'app-landing-waitlist glass-card' }, isLive
    ? [
        h('h3', {}, ['open it now']),
        h('p', { className: 'input-hint' }, ['live in any browser — one identity, every surface.']),
        h('a', { className: 'btn btn-primary', href: app.url, target: '_blank', rel: 'noopener noreferrer' }, [app.cta || 'open ↗']),
      ]
    : [
        h('h3', {}, [`${app.displayName} is almost here`]),
        h('p', { className: 'input-hint' }, ['join early access — we will prioritize your OS and email you the moment it ships.']),
        h('div', { className: 'os-picker', role: 'group', 'aria-label': 'choose your operating system' }, osButtons),
        h('div', { className: 'os-picker-form' }, [emailInput, waitlistBtn]),
        statusEl,
      ]);

  page.appendChild(heading);
  body.appendChild(desc);
  body.appendChild(ctaPanel);
  page.appendChild(body);

  // ─── Family nav ─────────────────────────────────────────────────
  page.appendChild(h('div', { className: 'family-nav-row', style: { marginTop: 'var(--space-2xl)' } }, [
    h('span', { className: 'input-hint', style: { marginRight: 'var(--space-md)' } }, ['app families']),
    ...FAMILY_LINKS.map((link) =>
      h('a', { className: 'platform-chip', href: link.href }, [link.label])
    ),
  ]));

  pageTransition(page);
  setTimeout(() => fadeUp(body.firstChild), 50);
}
