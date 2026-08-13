/**
 * Dashboard — home base with profile card, app grid, and devices panel.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { getState, setState, onStateChange } from '../store.js';
import { pageTransition, staggerIn, fadeUp } from '../utils/animations.js';
import { mountWeather } from '../utils/sky.js';
import { NavBar } from '../components/NavBar.js';

export default async function DashboardPage(container) {
  // Ambient weather particles (rain/snow/fog) — dashboard only, where users
  // linger. Auth pages stay calm.
  mountWeather();
  // Ensure logged in
  const token = auth.getToken();
  if (!token) {
    navigate('/login', true);
    return;
  }

  const retryTimer = { id: null };
  function clearRetryTimer() {
    if (retryTimer.id) {
      clearTimeout(retryTimer.id);
      retryTimer.id = null;
    }
  }
  function showErrorCard(subtitle, code, retryAfter) {
    clearRetryTimer();
    const isUnavailable = code === 'PROFILE_UNAVAILABLE' || code === 'CATALOG_UNAVAILABLE' || code === 'APPS_UNAVAILABLE';
    const cardTitle = isUnavailable ? 'thay services are warming up' : 'something broke';
    const autoRetrySeconds = retryAfter > 0 ? retryAfter : 5;
    if (isUnavailable) {
      // Auto-retry: a stale PB admin session heals on the next request, so
      // give the user a countdown instead of a dead-end manual retry.
      retryTimer.id = setTimeout(() => location.reload(), autoRetrySeconds * 1000);
    }
    const errorCard = h('div', { className: 'form-card', style: { textAlign: 'center' } }, [
      h('h2', {}, [cardTitle]),
      h('p', { className: 'subtitle' }, [
        isUnavailable
          ? `${subtitle} auto-retrying in ${autoRetrySeconds}s…`
          : subtitle,
      ]),
      h('button', {
        className: 'btn btn-primary',
        onClick: () => location.reload(),
      }, isUnavailable ? ['try now'] : ['retry']),
    ]);
    mount(container, h('div', {}, [NavBar(), h('div', { className: 'auth-page' }, [errorCard])]));
  }

  // Load profile if not loaded. Profile is load-bearing (identity); apps and
  // devices are independent panels — a hiccup in one must never take down
  // the whole dashboard (the prior all-or-nothing Promise.all did exactly
  // that: a single /devices 500 rendered the full-page error card).
  let state = getState();
  if (!state.profile) {
    try {
      const profile = await auth.getProfile();
      setState({ profile });
    } catch (err) {
      console.error('Failed to load profile:', err);
      if (err.status === 401) {
        // Token invalid — clear it so /login actually renders (with a token
        // it redirects back to '/', which is an infinite loop)
        const { clearToken } = await import('../sdk.js');
        clearToken();
        navigate('/login', true);
        return;
      }
      // Server-side failure: show a retry state instead of looping
      showErrorCard("the (u)niverse hiccuped — your dashboard couldn't load", err.code, err.retryAfter);
      return;
    }

    // Non-fatal: apps/devices load in parallel, each failing independently
    // to an empty/relaxed panel instead of a full-page crash.
    const [apps, devices] = await Promise.allSettled([
      auth.getApps(),
      auth.listDevices(),
    ]);
    setState({
      apps: apps.status === 'fulfilled' ? apps.value : [],
      devices: devices.status === 'fulfilled' ? devices.value : [],
    });
    state = getState();
  }

  const profile = state.profile;
  if (profile && !profile.isVerified) {
    navigate('/verify', true);
    return;
  }
  const apps = state.apps || [];
  const devices = state.devices || [];

  // Everything below can throw on an unexpected/malformed profile record
  // (e.g. an empty username from an in-progress backend migration) — the
  // router has no global catch, so an uncaught error here used to leave
  // the user stuck on the boot spinner forever with zero feedback.
  try {
    // ─── Profile Card ──────────────────────────────────────────────

    const displayName = profile.username || '?';
    const avatar = profile.avatar
      ? h('img', { className: 'profile-avatar', src: profile.avatar, alt: `${displayName} avatar` })
      : h('div', { className: 'profile-avatar-placeholder' }, [displayName[0].toUpperCase()]);

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
      h('div', { className: 'profile-name' }, [displayName]),
      h('div', { className: 'profile-handle' }, [`@${displayName}`]),
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
        h('div', { className: 'app-card-version' }, [app.installedVersion ? `v${app.installedVersion}` : 'version unknown']),
        statusBadge,
      ].filter(Boolean));
    });

    // Link to the public downloads catalog rather than a dead-end card.
    // Only this card gets the pointer/hover-lift affordance — the real
    // installed-app cards above have no action, so they no longer look
    // clickable when they aren't.
    appCards.push(h('div', {
      className: 'app-card app-card--action',
      tabindex: '0',
      role: 'button',
      'aria-label': 'get more apps',
      onClick: () => navigate('/downloads'),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate('/downloads');
        }
      },
    }, [
      h('div', { className: 'app-card-icon', style: { background: 'var(--gradient-pink)', fontSize: '24px' } }, ['+']),
      h('div', { className: 'app-card-name' }, ['get more apps']),
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
          h('span', { className: 'device-label' }, [d.label || 'unknown device']),
          h('span', { className: 'device-meta' }, [
            d.lastSeenAt ? `last seen ${new Date(d.lastSeenAt).toLocaleDateString()}` : '',
          ]),
        ]),
      ]))
      : h('div', { style: { textAlign: 'center', padding: '16px' } }, [
        h('p', { className: 'input-hint', style: { marginBottom: '4px' } }, ['no devices paired yet']),
        h('p', { className: 'input-hint' }, ["pair one from any thaypley app's settings to see it here"]),
      ]);

    const devicesSection = h('div', { className: 'glass-card-static' }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, ['connected devices']),
      ]),
      h('div', { className: 'devices-list' }, deviceItems),
    ]);

    // ─── Platform Strip (quick links to the thay web family) ──────
    // Best-effort: if the directory API hiccups, the dashboard still
    // renders — links are decorative shortcuts, never load-bearing.
    let platformLinks = [];
    try {
      platformLinks = await auth.getPlatforms();
    } catch { /* non-fatal */ }

    const corePlatforms = platformLinks.filter((p) => ['thaypley', 'fam', 'werk', 'du'].includes(p.slug));
    const platformChips = [
      ...corePlatforms.map((p) => h('a', {
        className: 'platform-chip',
        href: p.url,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, [p.name])),
      h('a', { className: 'platform-chip platform-chip--all', href: '#/platforms' }, ['all platforms →']),
    ];
    const platformStrip = h('div', { className: 'glass-card-static platform-strip' }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, ['the thay universe']),
        h('span', { className: 'input-hint' }, ['one identity, every surface']),
      ]),
      h('div', { className: 'platform-chip-row' }, platformChips),
    ]);

    // ─── Layout ────────────────────────────────────────────────────

    const leftPanel = h('div', { className: 'dashboard-panel' }, [profileCard]);
    const rightPanel = h('div', { className: 'dashboard-panel' }, [platformStrip, appsSection, devicesSection]);

    const grid = h('div', { className: 'dashboard-grid fade-in' }, [leftPanel, rightPanel]);
    const dashboard = h('div', { className: 'dashboard' }, [grid]);

    const shell = h('div', {}, [NavBar(), dashboard]);
    mount(container, shell);

    // Animations
    pageTransition(grid);
    setTimeout(() => staggerIn(grid, '.app-card, .device-item, .platform-chip', 200), 200);
  } catch (err) {
    console.error('Dashboard render failed:', err);
    showErrorCard("the (u)niverse hiccuped — your dashboard couldn't load");
  }
}