/**
 * Downloads — public catalog of thaypley apps and tools.
 * No login required: doubles as a marketing page. Pulls from
 * GET /auth/catalog (catalog_apps collection) and groups by kind
 * (desktop / cli / cloud / web) so the whole fleet is discoverable:
 * thay(tunes), thay(jot), (chronometer), Dabba CLI, Dabba desktop,
 * dabba-cloud & more.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

function pickDownloadUrl(downloads) {
  if (!downloads || typeof downloads !== 'object') return null;
  const platform = navigator.platform || '';
  if (/mac/i.test(platform) && downloads.mac) return downloads.mac;
  if (/win/i.test(platform) && downloads.windows) return downloads.windows;
  if (/linux/i.test(platform) && downloads.linux) return downloads.linux;
  return downloads.mac || downloads.windows || downloads.linux || downloads.web || null;
}

const KIND_LABELS = {
  desktop: 'desktop apps',
  cli: 'command line',
  cloud: 'cloud & web',
  web: 'cloud & web',
};

function appCard(app) {
  const url = pickDownloadUrl(app.downloads);
  const downloadBtn = h('button', {
    className: 'btn btn-primary btn-sm',
    onClick: () => {
      if (url) window.open(url, '_blank', 'noopener');
    },
    disabled: !url,
  }, [url ? 'download' : 'coming soon']);

  return h('div', { className: 'catalog-card glass-card' }, [
    h('div', { className: 'app-card-icon', style: { width: '56px', height: '56px', fontSize: '24px', margin: '0 auto' } }, [
      app.displayName ? app.displayName.replace(/[()]/g, '')[0].toUpperCase() : '?',
    ]),
    h('div', { className: 'catalog-card-name' }, [app.displayName]),
    app.tagline ? h('p', { className: 'catalog-card-tagline' }, [app.tagline]) : null,
    app.description ? h('p', { className: 'catalog-card-description' }, [app.description]) : null,
    h('div', { className: 'catalog-card-footer' }, [
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, [
        app.isFree ? (app.kind || 'free') : (app.price || app.kind || ''),
      ]),
      downloadBtn,
    ]),
  ].filter(Boolean));
}

export default async function DownloadsPage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['downloads']),
    h('p', { className: 'subtitle' }, ['free applications & tools for every thay(portal) member']),
  ]);

  const body = h('div', { className: 'downloads-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'downloads-page' }, [heading, body])]);
  mount(container, shell);
  pageTransition(shell.querySelector('.downloads-page'));

  let apps = [];
  try {
    apps = await auth.getCatalog();
  } catch (err) {
    body.appendChild(h('div', { className: 'form-card', style: { textAlign: 'center', gridColumn: '1 / -1' } }, [
      h('h3', {}, ['something broke']),
      h('p', { className: 'input-hint-error' }, ['could not load the catalog right now — try again shortly.']),
      h('button', { className: 'btn btn-primary btn-sm', onClick: () => location.reload() }, ['retry']),
    ]));
    return;
  }

  if (!apps.length) {
    body.appendChild(h('p', { className: 'input-hint', style: { textAlign: 'center' } }, ['no downloads published yet — check back soon.']));
    return;
  }

  // Group preserving catalog sortOrder: desktop → cli → cloud/web.
  const groups = [];
  for (const kind of ['desktop', 'cli', 'cloud', 'web']) {
    const members = apps.filter((a) => (a.kind || 'web') === kind);
    if (!members.length) continue;
    groups.push({
      kind,
      label: KIND_LABELS[kind] || kind,
      members,
    });
  }

  for (const group of groups) {
    const section = h('div', { style: { marginTop: 'var(--space-2xl)' } }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, [group.label]),
        h('span', { className: 'input-hint' }, [`${group.members.length} available`]),
      ]),
      h('div', { className: 'catalog-grid' }, group.members.map(appCard)),
    ]);
    body.appendChild(section);
  }

  setTimeout(() => staggerIn(body), 150);
}
