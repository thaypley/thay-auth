/**
 * App icon set — inline SVG line icons for the thay universe.
 * Each icon is a 24×24 stroke-based glyph matching the squared-edge
 * design language. Kept as a single module so catalog pages can swap
 * letter tiles for real icons without extra network requests.
 */

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const ICONS = {
  // music — thaypley(tunes)
  music: svg(`<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>`),
  // television — thaypley(tv)
  tv: svg(`<rect x="2" y="7" width="20" height="15" rx="2"/><path d="M17 2l-5 5-5-5"/>`),
  // note / jot
  jot: svg(`<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>`),
  // lock — thay(locker)
  locker: svg(`<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>`),
  // clock — (chronometer)
  chronometer: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>`),
  // browser — (slashcat)
  browser: svg(`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 8h20"/><path d="M6 6h.01M9 6h.01"/>`),
  // studio — the creator engine
  studio: svg(`<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 18l9 5 9-5"/>`),
  // design / pen
  design: svg(`<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><circle cx="11" cy="11" r="2"/>`),
  // photo
  photo: svg(`<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.5"/><path d="M21 15l-5-5L5 21"/>`),
  // video
  video: svg(`<rect x="2" y="5" width="14" height="14" rx="2"/><path d="M22 8l-6 4 6 4V8z"/>`),
  // effect / sparkles
  effect: svg(`<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/>`),
  // pattern / fashion
  pattern: svg(`<path d="M4 4h16v16H4z"/><path d="M4 9h16M4 15h16M9 4v16M15 4v16"/>`),
  // dabba — cube
  dabba: svg(`<path d="M12 2l9 5v10l-9 5-9-5V7l9-5z"/><path d="M3 7l9 5 9-5M12 12v10"/>`),
  // cli / terminal
  cli: svg(`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 9l4 3-4 3"/><path d="M12 15h6"/>`),
  // cloud
  cloud: svg(`<path d="M17.5 19a4.5 4.5 0 000-9 6 6 0 00-11.4 1.5A4 4 0 006 19h11.5z"/>`),
  // gab — chat
  gab: svg(`<path d="M21 12a8 8 0 01-8 8H4l2-3a8 8 0 1115-5z"/><path d="M8 10h8M8 14h5"/>`),
  // tabbi — brain/network
  tabbi: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2v7M12 15v7M2 12h7M15 12h7"/>`),
  // webiverse — globe
  webiverse: svg(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>`),
  // webispectral — signal
  webispectral: svg(`<path d="M4 20l4-9 3 5 3-8 6 12"/><circle cx="5" cy="5" r="1.5"/>`),
  // root / kernel
  root: svg(`<circle cx="12" cy="12" r="3"/><path d="M12 2v7M12 15v7M2 12h7M15 12h7"/>`),
  // web / portal
  web: svg(`<circle cx="12" cy="12" r="9"/><path d="M2 12h20"/><path d="M12 3a15 15 0 010 18M12 3a15 15 0 000 18"/>`),
};

// Backend catalog slugs (GET /auth/catalog) differ from the frontend
// directory slugs — map them to the matching icon glyph.
const SLUG_ALIASES = {
  'thaypley-tunes': 'music',
  'thaypley-tv': 'tv',
  'thay-jot': 'jot',
  'thay-locker': 'locker',
  'thaypley-studio': 'studio',
  'thay-design': 'design',
  'ls-photo': 'photo',
  'ls-video': 'video',
  'ls-effect': 'effect',
  'thay-pattern': 'pattern',
  'dabba-desktop': 'dabba',
  'dabba-cli': 'cli',
  'dabba-root': 'root',
  'dabba-cloud': 'cloud',
  'gab': 'gab',
  'tabbi': 'tabbi',
  'webiverse': 'webiverse',
  'webispectral': 'webispectral',
};

/**
 * Resolve an icon for an app entry. Falls back to a letter tile
 * when no icon matches — never throws.
 */
export function iconFor(app) {
  if (!app || !app.slug) return null;
  return ICONS[app.icon] || ICONS[app.slug] || ICONS[SLUG_ALIASES[app.slug]] || null;
}

export function iconEl(app, className = 'app-card-icon') {
  const icon = iconFor(app);
  if (!icon) return null;
  const el = document.createElement('div');
  el.className = className;
  el.innerHTML = icon;
  return el;
}
