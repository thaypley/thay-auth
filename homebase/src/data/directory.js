/**
 * Curated app-family directory — the single source for the apps,
 * (dabba), tabbi and creative pages. Kept in the frontend so the
 * marketing pages stay fast and offline-safe; the backend catalog
 * (GET /auth/catalog) remains the source for the downloads page.
 *
 * Every entry carries: slug, displayName, tagline, description, kind,
 * hints, icon (key into utils/icons.js), status, cta, plus optional
 * overview and pricing fields used by the /app/:slug landing pages.
 */

export const CORE_APPS = [
  {
    slug: 'tunes',
    displayName: 'thaypley(tunes)',
    tagline: 'the whole world\'s music, curated for creators',
    description: 'stream, queue, and share across every device — deep artist mode, unlimited skips, and studio-grade output.',
    overview: 'tunes is the music surface of the thay universe. deep artist mode gives you the full catalog behind every track, unlimited skips keep the flow going, and studio-grade output means what you hear is what you ship. queue from any device, share to any surface, and keep the whole family in sync.',
    pricing: 'free for thay(portal) members',
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
    overview: 'tv brings the multiverse to the living room. host watch parties with the whole family, tune into ambient channels that match the vibe, and watch creator-first originals you will not find anywhere else.',
    pricing: 'free for thay(portal) members',
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
    overview: 'jot is where thoughts land before they become anything. markdown-native, synced across every device, and wired into the rest of the thay universe so a note can become a song, a design, or a project in one tap.',
    pricing: 'free for thay(portal) members',
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
    overview: 'locker is the encrypted vault for the whole universe of your life. passwords, keys, files, and secrets live behind one identity and sync across every device — locked tight, only yours.',
    pricing: 'free for thay(portal) members',
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
    overview: 'chronometer is time reimagined for the thay universe. clock, timer, and world-time surfaces built on the retro-LCD standard — precise, beautiful, and always on vibe.',
    pricing: 'free for thay(portal) members',
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
    overview: 'slashcat is the browser for people who make things. command-first navigation puts every action one keystroke away, tab groups keep projects straight, and AI-assisted browsing reads the room so you do not have to.',
    pricing: 'free for thay(portal) members',
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
  { slug: 'dabba-desktop', displayName: '(dabba) — desktop', tagline: 'your local studio dock', description: 'unified desktop launcher for every thaypley service.', overview: 'the unified desktop dock for the whole thay universe. every service, every surface, one calm launcher — local, private, always on.', pricing: 'free', kind: 'desktop', hints: 'mac · windows · linux', icon: 'dabba', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'dabba-cli', displayName: '(dabba) — cli', tagline: 'the whole fleet in your terminal', description: 'auth, deploy, and orchestrate from anywhere.', overview: 'the whole thay fleet from your terminal. auth, deploy, and orchestrate any service without leaving the command line.', pricing: 'free', kind: 'cli', hints: 'terminal', icon: 'cli', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'dabba-root', displayName: '(dabba) — root', tagline: 'the core assistant kernel', description: 'the root daemon that powers every dabba skill — local, private, always on.', overview: 'the root daemon behind every dabba skill. local, private, and always on — this is the kernel your whole assistant runs on.', pricing: 'free', kind: 'desktop', hints: 'mac · windows · linux', icon: 'root', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'dabba-cloud', displayName: '(dabba) — cloud', tagline: 'your services, running everywhere', description: 'managed cloud for the thay universe.', overview: 'managed cloud for the thay universe. your services run everywhere, synced through one identity, always reachable.', pricing: 'free', kind: 'cloud', hints: 'any browser', icon: 'cloud', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'gab', displayName: '(gab)-skills', tagline: 'skills for your assistant', description: 'the (gab) skills marketplace — install personality, workflow, and automation skills into dabba.', overview: 'the skills marketplace for your assistant. install personality, workflow, and automation skills into dabba and make it truly yours.', pricing: 'free', kind: 'cloud', hints: 'any browser', icon: 'gab', status: 'soon', price: 'free', cta: 'notify me' },
];

export const TABBI_APPS = [
  { slug: 'tabbi', displayName: 'tabbi(COS)', tagline: 'the cognitive operating system', description: 'an operating layer for thought — capture, structure, and retrieve everything your mind touches.', overview: 'an operating layer for thought. capture, structure, and retrieve everything your mind touches — the OS for the way you actually think.', pricing: 'free', kind: 'desktop', hints: 'mac · windows · linux', icon: 'tabbi', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'webiverse', displayName: '(webiverse)', tagline: 'personal context infrastructure', description: 'your context graph — every note, link, and memory woven into one navigable universe.', overview: 'your personal context graph. every note, link, and memory woven into one navigable universe that grows the more you use it.', pricing: 'free', kind: 'desktop', hints: 'mac · windows · linux', icon: 'webiverse', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'webispectral', displayName: '(webispectral)', tagline: 'protocol for minds, connected', description: 'the protocol layer — standard schemas and handshakes for sharing context between apps and agents.', overview: 'the protocol layer for connected minds. standard schemas and handshakes let apps and agents share context safely — the connective tissue of the thay universe.', pricing: 'free', kind: 'cli', hints: 'terminal', icon: 'webispectral', status: 'soon', price: 'free', cta: 'notify me' },
];

export const CREATIVE_APPS = [
  { slug: 'thaypley-studio', displayName: '(studio)', tagline: 'create the whole universe', description: 'the creator engine — music, video, design, and publishing in one studio-grade surface.', overview: 'studio is the creator engine for the whole thay universe. music, video, design, and publishing in one studio-grade surface — record, cut, compose, and ship without ever leaving the flow.', pricing: 'free during early access', kind: 'desktop', hints: 'mac · windows · linux', icon: 'studio', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'thay-design', displayName: '(design)', tagline: 'graphic design, reimagined', description: 'vector, layout, and brand tools in one fluid canvas — made for creators who ship.', overview: 'design is graphic design reimagined for creators who ship. vector, layout, and brand tools live in one fluid canvas that keeps up with your hands.', pricing: 'free during early access', kind: 'desktop', hints: 'mac · windows · linux', icon: 'design', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'ls-photo', displayName: '(ls)photo', tagline: 'photo editing, light-speed', description: 'non-destructive RAW editing, layers, and film-grade color in a blazing-fast editor.', overview: 'photo editing at light speed. non-destructive RAW editing, layers, and film-grade color in an editor fast enough to stay out of your way.', pricing: 'free during early access', kind: 'desktop', hints: 'mac · windows · linux', icon: 'photo', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'ls-video', displayName: '(ls)video', tagline: 'video editing, light-speed', description: 'timeline-first editing, smart proxies, and AI assists that never get in the way of the cut.', overview: 'video editing at light speed. timeline-first editing, smart proxies, and AI assists that never get in the way of the cut.', pricing: 'free during early access', kind: 'desktop', hints: 'mac · windows · linux', icon: 'video', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'ls-effect', displayName: '(ls)effect', tagline: 'motion graphics & effects', description: 'compositing, particles, and typography in motion — the VFX surface for the thay universe.', overview: 'motion graphics and effects for the thay universe. compositing, particles, and typography in motion — the VFX surface that makes worlds move.', pricing: 'free during early access', kind: 'desktop', hints: 'mac · windows · linux', icon: 'effect', status: 'soon', price: 'free', cta: 'notify me' },
  { slug: 'thay-pattern', displayName: '(pattern)', tagline: 'fashion design studio', description: 'pattern drafting, textile simulation, and runway-ready presentation in one studio.', overview: 'pattern is the fashion design studio for the thay universe. pattern drafting, textile simulation, and runway-ready presentation in one surface.', pricing: 'free during early access', kind: 'desktop', hints: 'mac · windows · linux', icon: 'pattern', status: 'soon', price: 'free', cta: 'notify me' },
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
