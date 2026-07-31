/**
 * Vibe theme system — ported from thay-jot/src/stores/vibes.ts.
 * Applies body.vibe-{name} class + inline props. Persists to localStorage.
 */

export const VIBES = ['pink', 'yellow', 'blue', 'spectrum', 'cosmic', 'sunset', 'alien'];

const STORAGE_KEY = 'thay-vibe';
export const DEFAULT_VIBE = 'cosmic';

// vibes.css/tokens.css already own --vibe-text/--vibe-sub via the body class
// (set on body, they win the cascade) — don't duplicate them inline.
const CSS_OWNED_PROPS = new Set(['--vibe-text', '--vibe-sub']);

const VIBE_PROPS = {
  pink: {
    '--vibe-primary': '#f177ae',
    '--vibe-bg': '#ffffff',
    '--pink': '#f177ae',
    '--yellow': '#fad448',
    '--blue': '#6581b8',
    '--light-pink': '#fce4ec',
  },
  yellow: {
    '--vibe-primary': '#fad448',
    '--vibe-bg': '#ffffff',
    '--pink': '#f177ae',
    '--yellow': '#fad448',
    '--blue': '#6581b8',
    '--light-pink': '#fce4ec',
  },
  blue: {
    '--vibe-primary': '#6581b8',
    '--vibe-bg': '#ffffff',
    '--pink': '#f177ae',
    '--yellow': '#fad448',
    '--blue': '#6581b8',
    '--light-pink': '#fce4ec',
  },
  spectrum: {
    '--vibe-primary': 'linear-gradient(135deg,#f177ae,#9baad1,#fad448)',
    '--vibe-bg': '#ffffff',
    '--pink': '#f177ae',
    '--yellow': '#fad448',
    '--blue': '#6581b8',
    '--light-pink': '#fce4ec',
  },
  cosmic: {
    '--vibe-primary': 'linear-gradient(135deg,#3a106e,#b47eff)',
    '--vibe-bg': '#1a0a2e',
    '--pink': '#b47eff',
    '--yellow': '#fad448',
    '--blue': '#6581b8',
    '--light-pink': '#3a106e',
  },
  sunset: {
    '--vibe-primary': 'linear-gradient(135deg,#e07060,#f177ae)',
    '--vibe-bg': '#fff5f0',
    '--pink': '#f177ae',
    '--yellow': '#fad448',
    '--blue': '#6581b8',
    '--light-pink': '#fce4ec',
  },
  alien: {
    '--vibe-primary': '#00cc00',
    '--vibe-bg': '#0a0a0a',
    '--pink': '#00ff00',
    '--yellow': '#ffff00',
    '--blue': '#00ffff',
    '--light-pink': '#003300',
  },
};

const VIBE_HL = {
  pink: '#fce4ec',
  yellow: '#fff3c4',
  blue: '#dfe6f5',
  spectrum: '#eef0f7',
  cosmic: '#2a1652',
  sunset: '#ffe3da',
  alien: '#063d06',
};

export function getVibeColor(vibe) {
  return VIBE_PROPS[vibe]['--vibe-primary'] || '#f177ae';
}

export function applyVibe(vibe) {
  document.body.classList.remove(...VIBES.map((v) => `vibe-${v}`));
  document.body.classList.add(`vibe-${vibe}`);
  const props = VIBE_PROPS[vibe] || {};
  const root = document.documentElement;
  for (const [prop, value] of Object.entries(props)) {
    if (CSS_OWNED_PROPS.has(prop)) continue;
    root.style.setProperty(prop, value);
  }
  root.style.setProperty('--vibe-hl-current', VIBE_HL[vibe] || '#2a1652');
  try {
    localStorage.setItem(STORAGE_KEY, vibe);
  } catch { /* private mode */ }
}

export function loadVibe() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && VIBES.includes(saved)) return saved;
  } catch { /* private mode */ }
  return DEFAULT_VIBE;
}

export function initVibe() {
  const vibe = loadVibe();
  applyVibe(vibe);
  return vibe;
}
