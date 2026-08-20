/**
 * creative — the studio-grade family: (studio), (design), (ls)photo,
 * (ls)video, (ls)effect, (pattern).
 */
import { h, mount } from '../utils/dom.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { AppCard } from '../components/AppCard.js';
import { CREATIVE_APPS, CREATIVE_OVERVIEW, CORE_APPS, FAMILY_LINKS } from '../data/directory.js';

export default async function CreativePage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['creative']),
    h('p', { className: 'subtitle' }, ['the creative family — studio-grade tools for the whole universe of making']),
  ]);

  const body = h('div', { className: 'downloads-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'downloads-page' }, [heading, body])]);
  mount(container, shell);
  pageTransition(shell.querySelector('.downloads-page'));

  body.appendChild(h('div', { className: 'family-hero' }, [
    h('p', { className: 'family-hero-text' }, [CREATIVE_OVERVIEW.trim()]),
  ]));

  // ─── what opens today — the live family strip ───────────────────
  const liveStrip = h('div', { className: 'opens-today' }, [
    h('span', { className: 'input-hint', style: { marginRight: 'var(--space-md)' } }, ['what opens today']),
    ...CORE_APPS.map((app) =>
      h('a', { className: 'platform-chip', href: app.url, target: '_blank', rel: 'noopener noreferrer' }, [app.displayName])
    ),
    h('a', { className: 'platform-chip', href: '#/apps' }, ['all apps →']),
  ]);
  body.appendChild(liveStrip);

  const grid = h('div', { className: 'catalog-grid' }, CREATIVE_APPS.map(AppCard));
  body.appendChild(grid);

  body.appendChild(h('div', { className: 'family-nav-row', style: { marginTop: 'var(--space-2xl)' } }, [
    h('span', { className: 'input-hint', style: { marginRight: 'var(--space-md)' } }, ['app families']),
    ...FAMILY_LINKS.map((link) =>
      h('a', { className: 'platform-chip', href: link.href }, [link.label])
    ),
  ]));

  setTimeout(() => staggerIn(body, '.catalog-card', 150), 150);
}
