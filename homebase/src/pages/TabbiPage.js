/**
 * tabbi(COS) — the cognitive operating system. (webiverse) personal
 * context infrastructure + (webispectral) protocol.
 */
import { h, mount } from '../utils/dom.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { AppCard } from '../components/AppCard.js';
import { TABBI_APPS, TABBI_OVERVIEW, CORE_APPS, FAMILY_LINKS } from '../data/directory.js';

export default async function TabbiPage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['tabbi(COS)']),
    h('p', { className: 'subtitle' }, ['the cognitive operating system']),
  ]);

  const body = h('div', { className: 'downloads-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'downloads-page' }, [heading, body])]);
  mount(container, shell);
  pageTransition(shell.querySelector('.downloads-page'));

  body.appendChild(h('div', { className: 'family-hero' }, [
    h('p', { className: 'family-hero-text' }, [TABBI_OVERVIEW.trim()]),
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

  const grid = h('div', { className: 'catalog-grid' }, TABBI_APPS.map(AppCard));
  body.appendChild(grid);

  body.appendChild(h('div', { className: 'family-nav-row', style: { marginTop: 'var(--space-2xl)' } }, [
    h('span', { className: 'input-hint', style: { marginRight: 'var(--space-md)' } }, ['app families']),
    ...FAMILY_LINKS.map((link) =>
      h('a', { className: 'platform-chip', href: link.href }, [link.label])
    ),
  ]));

  setTimeout(() => staggerIn(body, '.catalog-card', 150), 150);
}
