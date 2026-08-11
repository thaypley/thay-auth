/**
 * Platforms — the full thay ecosystem hub.
 * Every surface authenticated by thay-auth, displayed as a launchpad:
 * web platform family (thaypley.com, fam, werk, du, auth, docs),
 * plus every downloadable app from the catalog that has a web home.
 * No login required — doubles as a marketing/directory page.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function PlatformsPage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['platforms']),
    h('p', { className: 'subtitle' }, ['every place your thay-auth identity lives']),
  ]);

  const shellEl = h('div', { className: 'platforms-page' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'downloads-page' }, [heading, shellEl])]);
  mount(container, shell);
  pageTransition(shell.querySelector('.downloads-page'));

  let platforms = [];
  let apps = [];
  try {
    [platforms, apps] = await Promise.all([auth.getPlatforms(), auth.getCatalog()]);
  } catch (err) {
    console.error('Failed to load platforms:', err);
    shellEl.appendChild(h('div', { className: 'form-card', style: { textAlign: 'center', gridColumn: '1 / -1' } }, [
      h('h3', {}, ['something broke']),
      h('p', { className: 'input-hint-error' }, ['could not load the platform directory right now — try again shortly.']),
      h('button', { className: 'btn btn-primary btn-sm', onClick: () => location.reload() }, ['retry']),
    ]));
    return;
  }

  // ─── Web platform family (the core hub) ────────────────────────
  // OFFICIAL_PLATFORMS from the API. Order preserved: thaypley.com,
  // fam, werk, du, then auth + docs.
  const webFamily = platforms.filter((p) => ['web', 'docs'].includes(p.type));

  const familySection = h('div', {}, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['the web platform']),
      h('span', { className: 'input-hint' }, ['one identity, every surface']),
    ]),
    h('div', { className: 'catalog-grid' }, webFamily.map((p) => h('a', {
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
  ]);

  // ─── App directory (everything else with a web home) ───────────
  const appHomes = apps.filter((a) => a.downloads && (a.downloads.web || a.downloads.mac || a.downloads.windows || a.downloads.linux));

  const appSection = h('div', { style: { marginTop: 'var(--space-2xl)' } }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['all thay apps']),
      h('span', { className: 'input-hint' }, [`${appHomes.length} platforms`]),
    ]),
    h('div', { className: 'catalog-grid' }, appHomes.map((app) => {
      const url = app.downloads.web || app.downloads.mac || app.downloads.windows || app.downloads.linux;
      return h('a', {
        className: 'catalog-card glass-card platform-card',
        href: url,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, [
        h('div', { className: 'app-card-icon', style: { width: '56px', height: '56px', fontSize: '24px', margin: '0 auto' } }, [
          app.displayName ? app.displayName.replace(/[()]/g, '')[0].toUpperCase() : '?',
        ]),
        h('div', { className: 'catalog-card-name' }, [app.displayName]),
        app.tagline ? h('p', { className: 'catalog-card-tagline' }, [app.tagline]) : null,
        h('div', { className: 'catalog-card-footer' }, [
          h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, [
            app.isFree ? (app.kind || 'free') : (app.price || app.kind || ''),
          ]),
          h('span', { className: 'input-hint' }, ['open ↗']),
        ]),
      ].filter(Boolean));
    })),
  ]);

  shellEl.appendChild(familySection);
  shellEl.appendChild(appSection);

  // ─── Identity note ─────────────────────────────────────────────
  shellEl.appendChild(h('div', { className: 'glass-card-static platform-note', style: { marginTop: 'var(--space-2xl)' } }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['one identity']),
      h('span', { className: 'input-hint' }, ['thay-auth']),
    ]),
    h('p', { className: 'catalog-card-description' }, [
      'every platform above is unlocked by the same thay-auth account — your profile, avatar, and devices carry across all of them. change your photo once, it updates everywhere.',
    ]),
  ]));

  setTimeout(() => staggerIn(shellEl), 150);
}
