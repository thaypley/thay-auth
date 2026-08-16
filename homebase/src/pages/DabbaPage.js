/**
 * (dabba) — the yogi mindfulness vibe-coding / chat personal, fam, werk
 * assistant. Overview + the five download surfaces.
 */
import { h, mount } from '../utils/dom.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { AppCard } from '../components/AppCard.js';
import { DABBA_APPS, DABBA_OVERVIEW, FAMILY_LINKS } from '../data/directory.js';

export default async function DabbaPage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['(dabba)']),
    h('p', { className: 'subtitle' }, ['your yogi mindfulness vibe-coding / chat personal, fam, werk assistant']),
  ]);

  const body = h('div', { className: 'downloads-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'downloads-page' }, [heading, body])]);
  mount(container, shell);
  pageTransition(shell.querySelector('.downloads-page'));

  body.appendChild(h('div', { className: 'family-hero' }, [
    h('p', { className: 'family-hero-text' }, [DABBA_OVERVIEW.trim()]),
  ]));

  const grid = h('div', { className: 'catalog-grid' }, DABBA_APPS.map(AppCard));
  body.appendChild(grid);

  body.appendChild(h('div', { className: 'family-nav-row', style: { marginTop: 'var(--space-2xl)' } }, [
    h('span', { className: 'input-hint', style: { marginRight: 'var(--space-md)' } }, ['app families']),
    ...FAMILY_LINKS.map((link) =>
      h('a', { className: 'platform-chip', href: link.href }, [link.label])
    ),
  ]));

  setTimeout(() => staggerIn(body, '.catalog-card', 150), 150);
}
