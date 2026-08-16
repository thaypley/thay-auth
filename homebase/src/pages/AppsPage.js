/**
 * apps — the curated core app family: thaypley(tunes), thaypley(tv),
 * thay(jot), thay(locker), (chronometer), (slashcat) browser. Replaces
 * the app directory that used to live on /platforms.
 */
import { h, mount } from '../utils/dom.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { CORE_APPS, FAMILY_LINKS } from '../data/directory.js';

function tileLetter(displayName) {
  const cleaned = String(displayName || '').replace(/[()]/g, '');
  return (cleaned[0] || '?').toUpperCase();
}

export default async function AppsPage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['apps']),
    h('p', { className: 'subtitle' }, ['the core thaypley app family — one identity, every surface']),
    h('p', { className: 'input-hint' }, ['thaypley(tunes) · thaypley(tv) · thay(jot) · thay(locker) · (chronometer) · (slashcat) browser']),
  ]);

  const body = h('div', { className: 'downloads-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'downloads-page' }, [heading, body])]);
  mount(container, shell);
  pageTransition(shell.querySelector('.downloads-page'));

  const grid = h('div', { className: 'catalog-grid' }, CORE_APPS.map((app) =>
    h('div', { className: 'catalog-card glass-card' }, [
      h('div', { className: 'catalog-card-head' }, [
        h('div', { className: 'app-card-icon', style: { width: '56px', height: '56px', fontSize: '24px', flexShrink: 0 } }, [
          tileLetter(app.displayName),
        ]),
        h('div', { className: 'catalog-card-title' }, [
          h('div', { className: 'catalog-card-name' }, [app.displayName]),
          app.tagline ? h('div', { className: 'catalog-card-tagline' }, [app.tagline]) : null,
        ]),
      ]),
      app.description ? h('p', { className: 'catalog-card-description' }, [app.description]) : null,
      h('div', { className: 'catalog-card-footer' }, [
        h('a', { className: 'btn btn-primary btn-sm', href: app.url, target: '_blank', rel: 'noopener' }, ['open ↗']),
      ]),
    ])
  ));
  body.appendChild(grid);

  body.appendChild(h('div', { className: 'family-nav-row', style: { marginTop: 'var(--space-2xl)' } }, [
    h('span', { className: 'input-hint', style: { marginRight: 'var(--space-md)' } }, ['app families']),
    ...FAMILY_LINKS.map((link) =>
      h('a', { className: 'platform-chip', href: link.href }, [link.label])
    ),
  ]));

  setTimeout(() => staggerIn(body, '.catalog-card', 150), 150);
}
