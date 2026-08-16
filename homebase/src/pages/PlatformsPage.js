/**
 * Platforms — the three core thaypley web surfaces.
 * Exactly thaypley.com, fam.thaypley.com, werk.thaypley.com.
 * Apps now live on their own pages (/apps, /dabba, /tabbi, /creative).
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { FAMILY_LINKS } from '../data/directory.js';

export default async function PlatformsPage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['platforms']),
    h('p', { className: 'subtitle' }, ['the thaypley web platform family — one identity, every surface']),
  ]);

  const shellEl = h('div', { className: 'platforms-page' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'downloads-page' }, [heading, shellEl])]);
  mount(container, shell);
  pageTransition(shell.querySelector('.downloads-page'));

  let platforms = [];
  try {
    platforms = await auth.getPlatforms();
  } catch (err) {
    console.error('Failed to load platforms:', err);
    shellEl.appendChild(h('div', { className: 'form-card', style: { textAlign: 'center', gridColumn: '1 / -1' } }, [
      h('h3', {}, ['something broke']),
      h('p', { className: 'input-hint-error' }, ['could not load the platform directory right now — try again shortly.']),
      h('button', { className: 'btn btn-primary btn-sm', onClick: () => location.reload() }, ['retry']),
    ]));
    return;
  }

  // Only the three official web platforms — trimmed from the old roster
  // (du, auth, docs removed; the app directory moved to /apps).
  const core = platforms.filter((p) => ['thaypley', 'fam', 'werk'].includes(p.slug));

  shellEl.appendChild(h('div', {}, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['the web platform']),
      h('span', { className: 'input-hint' }, ['one account. every surface.']),
    ]),
    h('div', { className: 'catalog-grid' }, core.map((p) => h('a', {
      className: 'catalog-card glass-card platform-card',
      href: p.url,
      target: '_blank',
      rel: 'noopener noreferrer',
    }, [
      h('div', { className: 'app-card-icon', style: { width: '56px', height: '56px', fontSize: '24px', margin: '0 auto' } }, [
        p.name.replace(/[.].*$/, '').replace(/^thay/, 't')[0].toUpperCase(),
      ]),
      h('div', { className: 'catalog-card-name' }, [p.name]),
      h('p', { className: 'catalog-card-tagline' }, [p.tagline]),
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, ['open ↗']),
    ]))),
  ]));

  shellEl.appendChild(h('div', { className: 'glass-card-static', style: { marginTop: 'var(--space-2xl)' } }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['app families']),
      h('span', { className: 'input-hint' }, ['the rest of the thay universe']),
    ]),
    h('div', { className: 'family-nav-row' }, FAMILY_LINKS.map((link) =>
      h('a', { className: 'platform-chip', href: link.href }, [link.label])
    )),
  ]));

  setTimeout(() => staggerIn(shellEl, '.catalog-card, .platform-chip', 150), 150);
}
