/**
 * Dashboard — home base with profile card, app grid, and devices panel.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { getState, setState, onStateChange } from '../store.js';
import { pageTransition, staggerIn, fadeUp } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function DashboardPage(container) {
  // Ensure logged in
  const token = auth.getToken();
  if (!token) {
    navigate('/login', true);
    return;
  }

  // Load profile if not loaded
  let state = getState();
  if (!state.profile) {
    try {
      const profile = await auth.getProfile();
      const apps = await auth.getApps();
      const devices = await auth.listDevices();
      setState({ profile, apps, devices });
      state = getState();
    } catch (err) {
      console.error('Failed to load profile:', err);
      navigate('/login', true);
      return;
    }
  }

  const profile = state.profile;
  const apps = state.apps || [];
  const devices = state.devices || [];

  // ─── Profile Card ──────────────────────────────────────────────

  const avatar = profile.avatar
    ? h('img', { className: 'profile-avatar', src: profile.avatar, alt: '' })
    : h('div', { className: 'profile-avatar-placeholder' }, [profile.username[0].toUpperCase()]);

  const characteristics = profile.characteristics || {};

  const tags = [];
  if (characteristics.pronouns) {
    tags.push(h('span', { className: 'profile-tag' }, [characteristics.pronouns]));
  }
  if (characteristics.astral_sign) {
    const signSymbols = { aries: '♈', taurus: '♉', gemini: '♊', cancer: '♋', leo: '♌', virgo: '♍', libra: '♎', scorpio: '♏', sagittarius: '♐', capricorn: '♑', aquarius: '♒', pisces: '♓' };
    const symbol = signSymbols[characteristics.astral_sign] || '';
    tags.push(h('span', { className: 'profile-tag' }, [`${symbol} ${characteristics.astral_sign}`]));
  }

  const bioEl = characteristics.bio
    ? h('p', { className: 'profile-bio' }, [characteristics.bio])
    : null;

  const profileCard = h('div', { className: 'glass-card profile-card' }, [
    avatar,
    h('div', { className: 'profile-name' }, [profile.username]),
    h('div', { className: 'profile-handle' }, [`@${profile.username}`]),
    tags.length > 0 ? h('div', { className: 'profile-tags' }, tags) : null,
    bioEl,
    h('button', {
      className: 'btn btn-secondary btn-sm',
      onClick: () => navigate('/profile'),
      style: { marginTop: '8px' },
    }, ['edit profile']),
  ].filter(Boolean));

  // ─── App Grid ──────────────────────────────────────────────────

  const appCards = apps.map(app => {
    const statusBadge = app.latestVersion && app.latestVersion !== app.installedVersion
      ? h('span', { className: 'app-card-badge' }, ['update'])
      : null;

    return h('div', { className: 'app-card' }, [
      h('div', { className: 'app-card-icon' }, [app.appName ? app.appName[0].toUpperCase() : '?']),
      h('div', { className: 'app-card-name' }, [app.appName || app.appId]),
      h('div', { className: 'app-card-version' }, [`v${app.installedVersion || '1.0.0'}`]),
      statusBadge,
    ].filter(Boolean));
  });

  // Add placeholder "Coming Soon" card
  appCards.push(h('div', { className: 'app-card', style: { opacity: 0.5 } }, [
    h('div', { className: 'app-card-icon', style: { background: 'rgba(35,31,32,0.1)', fontSize: '24px' } }, ['+']),
    h('div', { className: 'app-card-name' }, ['coming soon']),
  ]));

  const appsSection = h('div', { className: 'glass-card-static' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['your applications']),
      h('span', { className: 'input-hint' }, [`${apps.length} installed`]),
    ]),
    h('div', { className: 'app-grid' }, appCards),
  ]);

  // ─── Devices Panel ─────────────────────────────────────────────

  const deviceItems = devices.length > 0
    ? devices.map(d => h('div', { className: 'device-item' }, [
      h('div', { className: 'device-info' }, [
        h('span', { className: 'device-label' }, [d.label || 'Unknown Device']),
        h('span', { className: 'device-meta' }, [
          d.lastSeenAt ? `last seen ${new Date(d.lastSeenAt).toLocaleDateString()}` : '',
        ]),
      ]),
    ]))
    : h('p', { style: { color: 'rgba(35,31,32,0.4)', textAlign: 'center', padding: '16px' } }, ['no devices paired yet']);

  const devicesSection = h('div', { className: 'glass-card-static' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['connected devices']),
    ]),
    h('div', { className: 'devices-list' }, deviceItems),
  ]);

  // ─── Layout ────────────────────────────────────────────────────

  const leftPanel = h('div', { className: 'dashboard-panel' }, [profileCard]);
  const rightPanel = h('div', { className: 'dashboard-panel' }, [appsSection, devicesSection]);

  const grid = h('div', { className: 'dashboard-grid fade-in' }, [leftPanel, rightPanel]);
  const dashboard = h('div', { className: 'dashboard' }, [grid]);

  const shell = h('div', {}, [NavBar(), dashboard]);
  mount(container, shell);

  // Animations
  pageTransition(grid);
  setTimeout(() => staggerIn(grid), 200);
}