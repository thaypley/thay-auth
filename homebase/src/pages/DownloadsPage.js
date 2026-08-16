/**
 * Downloads — public catalog of thaypley apps and tools.
 * No login required: doubles as a marketing page. Pulls from
 * GET /auth/catalog (catalog_apps collection + curated fallback covering
 * thaypley(tunes), thaypley(tv), (jot), (chronometer), (dabba) desktop/
 * cli/cloud, thaypley(studio)) and groups by kind with the squared-edge
 * card presentation: square icon tile, full name, tagline, description,
 * price/status badge, download CTA.
 *
 * Apps without a real download URL render an inline waitlist capture
 * instead of a dead "coming soon" button.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { AppCard } from '../components/AppCard.js';

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

// Map a backend catalog entry to the shared AppCard schema. Apps with no
// downloadable artifact become waitlist-capture cards (status: 'soon').
function toAppCard(app) {
  const url = pickDownloadUrl(app.downloads);
  return {
    slug: app.slug || '',
    displayName: app.displayName || app.name || 'unknown',
    tagline: app.tagline || '',
    description: app.description || '',
    kind: app.kind || 'web',
    hints: KIND_HINTS[app.kind] || '',
    icon: app.slug || '',
    status: url ? 'live' : 'soon',
    cta: url ? 'download' : 'notify me',
    url: url || undefined,
    isFree: app.isFree,
    price: app.price,
  };
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

  // ─── Skeleton shell ──────────────────────────────────────────────
  // Paint shimmer panels immediately so the page is never a blank
  // screen while the catalog fetch is in flight.
  const skeleton = h('div', { 'aria-busy': 'true', style: { opacity: 0.7 } }, [
    h('div', { className: 'glass-card-static', style: { height: '220px' } }),
  ]);
  body.appendChild(skeleton);

  let apps = [];
  try {
    apps = await auth.getCatalog();
  } catch (err) {
    skeleton.remove();
    body.appendChild(h('div', { className: 'form-card', style: { textAlign: 'center', gridColumn: '1 / -1' } }, [
      h('h3', {}, ['something broke']),
      h('p', { className: 'input-hint-error' }, ['could not load the catalog right now — try again shortly.']),
      h('button', { className: 'btn btn-primary btn-sm', onClick: () => location.reload() }, ['retry']),
    ]));
    return;
  }

  skeleton.remove();

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
      members: members.map(toAppCard),
    });
  }

  for (const group of groups) {
    const section = h('div', { style: { marginTop: 'var(--space-2xl)' } }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, [group.label]),
        h('span', { className: 'input-hint' }, [`${group.members.length} available`]),
      ]),
      h('div', { className: 'catalog-grid' }, group.members.map(AppCard)),
    ]);
    body.appendChild(section);
  }

  setTimeout(() => staggerIn(body, '.catalog-card', 150), 150);
}
