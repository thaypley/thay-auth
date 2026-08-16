/**
 * tabbi(COS) — the cognitive operating system. (webiverse) personal
 * context infrastructure + (webispectral) protocol.
 */
import { h, mount } from '../utils/dom.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { TABBI_APPS, TABBI_OVERVIEW, FAMILY_LINKS } from '../data/directory.js';

function tileLetter(displayName) {
  const cleaned = String(displayName || '').replace(/[()]/g, '');
  return (cleaned[0] || '?').toUpperCase();
}

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

  const grid = h('div', { className: 'catalog-grid' }, TABBI_APPS.map((app) =>
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
      h('div', { className: 'catalog-card-meta' }, [
        h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, [app.kind || 'web']),
        h('span', { className: 'input-hint', style: { marginLeft: 'auto' } }, [app.hints || '']),
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
