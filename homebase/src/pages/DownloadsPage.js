/**
 * Downloads — public catalog of thaypley apps and tools.
 * No login required: doubles as a marketing page. Pulls from
 * GET /auth/catalog (catalog_apps collection + curated fallback covering
 * thaypley(tunes), thaypley(tv), (jot), (chronometer), (dabba) desktop/
 * cli/cloud, thaypley(studio)) and groups by kind with the squared-edge
 * card presentation: square icon tile, full name, tagline, description,
 * price/status badge, download CTA.
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

const KIND_HINTS = {
  desktop: 'mac · windows · linux',
  cli: 'terminal',
  cloud: 'any browser',
  web: 'any browser',
};

// Icon tile letter — strip stylization ((tunes) → t) for the square tile.
function tileLetter(displayName) {
  const cleaned = String(displayName || '').replace(/[()]/g, '');
  return (cleaned[0] || '?').toUpperCase();
}

function appCard(app) {
  const url = pickDownloadUrl(app.downloads);
  const hint = !url ? 'coming soon' : (app.isFree === false ? (app.price || 'paid') : 'free download');

  return h('div', { className: 'catalog-card glass-card' }, [
    h('div', { className: 'catalog-card-head' }, [
      h('div', { className: 'app-card-icon', style: { width: '56px', height: '56px', fontSize: '24px', flexShrink: 0 } }, [
        app.iconUrl
          ? h('img', { src: app.iconUrl, alt: `${app.displayName} icon`, style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
          : tileLetter(app.displayName),
      ]),
      h('div', { className: 'catalog-card-title' }, [
        h('div', { className: 'catalog-card-name' }, [app.displayName]),
        app.tagline ? h('div', { className: 'catalog-card-tagline' }, [app.tagline]) : null,
      ]),
    ]),
    app.description ? h('p', { className: 'catalog-card-description' }, [app.description]) : null,
    h('div', { className: 'catalog-card-meta' }, [
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, [
        app.isFree === false ? (app.price || 'paid') : 'free',
      ]),
      h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, [
        app.kind || 'web',
      ]),
      h('span', { className: 'input-hint', style: { marginLeft: 'auto' } }, [
        KIND_HINTS[app.kind] || '',
      ]),
    ]),
    h('div', { className: 'catalog-card-footer' }, [
      h('button', {
        className: 'btn btn-primary btn-sm',
        onClick: () => {
          if (url) window.open(url, '_blank', 'noopener');
        },
        disabled: !url,
      }, [url ? 'download' : 'coming soon']),
    ]),
  ]);
}

export default async function DownloadsPage(container) {
  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['downloads']),
    h('p', { className: 'subtitle' }, ['free applications & tools for every thay(portal) member']),
    h('p', { className: 'input-hint' }, ['one account. every surface. — thaypley(tunes) · thaypley(tv) · (jot) · (chronometer) · (dabba) desktop/cli/cloud · thaypley(studio)']),
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

  setTimeout(() => staggerIn(body, '.catalog-card', 150), 150);
}
