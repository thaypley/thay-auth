/**
 * Curated app-family directory — the single source for the apps,
 * (dabba), tabbi and creative pages. Kept in the frontend so the
 * marketing pages stay fast and offline-safe; the backend catalog
 * (GET /auth/catalog) remains the source for the downloads page.
 *
 * Every entry carries: slug, displayName, tagline, description, kind,
 * hints, icon (key into utils/icons.js), status, and cta.
 */

export const CORE_APPS = [
  {
    slug: 'tunes',
    displayName: 'thaypley(tunes)',
    tagline: 'the whole world\'s music, curated for creators',
    description: 'stream, queue, and share across every device — deep artist mode, unlimited skips, and studio-grade output.',
    url: 'https://tunes.thaypley.com',
    kind: 'web',
    hints: 'any browser',
    icon: 'music',
    status: 'live',
    price: 'free',
    cta: 'open ↗',
  },
  {
    slug: 'tv',
    displayName: 'thaypley(tv)',
    tagline: 'television for the multiverse',
    description: 'watch parties, ambient channels, and creator-first originals — the living room side of thaypley.',
    url: 'https://tv.thaypley.com',
    kind: 'web',
    hints: 'any browser',
    icon: 'tv',
    status: 'live',
    price: 'free',
    cta: 'open ↗',
  },
  {
    slug: 'thay-jot',
    displayName: 'thay(jot)',
    tagline: 'thoughts, captured at light speed',
    description: 'the note surface of the thay universe — markdown, sync, and collaborative linking across every app.',
    url: 'https://jot.thaypley.com',
    kind: 'web',
    hints: 'any browser',
    icon: 'jot',
    status: 'live',
    price: 'free',
    cta: 'open ↗',
  },
  {
    slug: 'thay-locker',
    displayName: 'thay(locker)',
    tagline: 'your encrypted vault for everything',
    description: 'passwords, keys, files, and secrets — locked tight and syncable across devices.',
    url: 'https://locker.thaypley.com',
    kind: 'web',
    hints: 'any browser',
    icon: 'locker',
    status: 'live',
    price: 'free',
    cta: 'open ↗',
  },
  {
    slug: 'chronometer',
    displayName: '(chronometer)',
    tagline: 'time, but make it thay',
    description: 'the clock, timer, and world-time surface for the thay universe — built on the retro-LCD standard.',
    url: 'https://chronometer.thaypley.com',
    kind: 'web',
    hints: 'any browser',
    icon: 'chronometer',
    status: 'live',
    price: 'free',
    cta: 'open ↗',
  },
  {
    slug: 'slashcat',
    displayName: '(slashcat) browser',
    tagline: 'a browser that thinks with you',
    description: 'the creator browser — command-first navigation, tab groups, and AI-assisted browsing built in.',
    url: 'https://slashcat.thaypley.com',
    kind: 'web',
    hints: 'any browser',
    icon: 'browser',
    status: 'live',
    price: 'free',
    cta: 'open ↗',
  },
];

export const DABBA_APPS = [
  { slug: 'dabba-desktop', displayName: '(dabba) — desktop', tagline: 'your local studio dock', description: 'unified desktop launcher for every thaypley service.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'dabba', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'dabba-cli', displayName: '(dabba) — cli', tagline: 'the whole fleet in your terminal', description: 'auth, deploy, and orchestrate from anywhere.', kind: 'cli', hints: 'terminal', icon: 'cli', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'dabba-root', displayName: '(dabba) — root', tagline: 'the core assistant kernel', description: 'the root daemon that powers every dabba skill — local, private, always on.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'root', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'dabba-cloud', displayName: '(dabba) — cloud', tagline: 'your services, running everywhere', description: 'managed cloud for the thay universe.', kind: 'cloud', hints: 'any browser', icon: 'cloud', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'gab', displayName: '(gab)-skills', tagline: 'skills for your assistant', description: 'the (gab) skills marketplace — install personality, workflow, and automation skills into dabba.', kind: 'cloud', hints: 'any browser', icon: 'gab', status: 'soon', price: 'free', cta: 'notify me' },
];

export const TABBI_APPS = [
  { slug: 'tabbi', displayName: 'tabbi(COS)', tagline: 'the cognitive operating system', description: 'an operating layer for thought — capture, structure, and retrieve everything your mind touches.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'tabbi', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'webiverse', displayName: '(webiverse)', tagline: 'personal context infrastructure', description: 'your context graph — every note, link, and memory woven into one navigable universe.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'webiverse', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'webispectral', displayName: '(webispectral)', tagline: 'protocol for minds, connected', description: 'the protocol layer — standard schemas and handshakes for sharing context between apps and agents.', kind: 'cli', hints: 'terminal', icon: 'webispectral', status: 'soon', price: 'free', cta: 'notify me' },
];

export const CREATIVE_APPS = [
  { slug: 'thaypley-studio', displayName: '(studio)', tagline: 'create the whole universe', description: 'the creator engine — music, video, design, and publishing in one studio-grade surface.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'studio', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'thay-design', displayName: '(design)', tagline: 'graphic design, reimagined', description: 'vector, layout, and brand tools in one fluid canvas — made for creators who ship.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'design', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'ls-photo', displayName: '(ls)photo', tagline: 'photo editing, light-speed', description: 'non-destructive RAW editing, layers, and film-grade color in a blazing-fast editor.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'photo', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'ls-video', displayName: '(ls)video', tagline: 'video editing, light-speed', description: 'timeline-first editing, smart proxies, and AI assists that never get in the way of the cut.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'video', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'ls-effect', displayName: '(ls)effect', tagline: 'motion graphics & effects', description: 'compositing, particles, and typography in motion — the VFX surface for the thay universe.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'effect', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'thay-pattern', displayName: '(pattern)', tagline: 'fashion design studio', description: 'pattern drafting, textile simulation, and runway-ready presentation in one studio.', kind: 'desktop', hints: 'mac · windows · linux', icon: 'pattern', status: 'soon', price: 'free', cta: 'notify me' },
];

export const DABBA_OVERVIEW = '\n  (dabba) is your yogi mindfulness vibe-coding / chat assistant — a calm, present\n  companion that helps you code, create, and think across your personal, fam, and\n  werk spaces. One kernel, every context: the same quiet intelligence follows you\n  from your personal notes to the family group to the work studio, always local,\n  always private, always on.\n';

export const TABBI_OVERVIEW = '\n  tabbi(COS) is the cognitive operating system — an operating layer for thought.\n  (webiverse) builds your personal context infrastructure, and (webispectral) is\n  the protocol that lets minds, apps, and agents share context safely.\n';

export const CREATIVE_OVERVIEW = '\n  the creative family — studio-grade tools for the whole universe of making.\n  music, design, photo, video, motion, and fashion — every surface built to\n  ship what you imagine.\n';

export const FAMILY_LINKS = [
  { label: 'apps', href: '#/apps' },
  { label: 'dabba', href: '#/dabba' },
  { label: 'tabbi', href: '#/tabbi' },
  { label: 'creative', href: '#/creative' },
  { label: 'downloads', href: '#/downloads' },
];
