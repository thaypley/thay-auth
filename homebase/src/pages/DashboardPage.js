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
  // Ambient weather particles — only when opted in from Settings. mountWeather
  // itself checks localStorage.thay_weather_optin and skips Tauri webviews, so
  // no CoreLocation prompt ever fires from page load.
  let weatherCleanup = null;
  const startedWeather = mountWeather();
  if (typeof startedWeather === 'function') {
    weatherCleanup = startedWeather;
  }
  const stopWeatherBeforeLeaving = () => {
    if (weatherCleanup) weatherCleanup();
    weatherCleanup = null;
  };
  // Ensure logged in
  const token = auth.getToken();
  if (!token) {
    stopWeatherBeforeLeaving();
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

  // ─── First paint: mount the nav + placeholder panels IMMEDIATELY so the
  // dashboard is never a blank screen while the profile/apps/devices/platforms
  // fetches are in flight. The previous flow awaited /auth/profile, then
  // /auth/apps + /auth/devices, then /auth/platforms — three sequential RTTs
  // before ANY dom node existed. Now the shell paints with zero network.
  mount(container, h('div', {}, [
    NavBar(),
    h('div', { className: 'dashboard', 'aria-busy': 'true' }, [
      h('div', { className: 'dashboard-grid dashboard-grid--loading', style: { opacity: 0.7 } }, [
        h('div', { className: 'dashboard-panel' }, [
          h('div', { className: 'glass-card profile-card', style: { height: '180px' } }),
        ]),
        h('div', { className: 'dashboard-panel' }, [
          h('div', { className: 'glass-card-static', style: { height: '84px', marginBottom: '16px' } }),
          h('div', { className: 'glass-card-static', style: { height: '220px' } }),
        ]),
      ]),
    ]),
  ]));

  // Load profile if not loaded. Profile is load-bearing (identity + the
  // verified-email gate); apps, devices and the platform strip are independent
  // panels — a hiccup in one must never take down the whole dashboard (the
  // prior all-or-nothing Promise.all did exactly that: a single /devices 500
  // rendered the full-page error card).
  let state = getState();
  if (!state.profile) {
    try {
      const profile = await auth.getProfile();
      setState({ profile });
    } catch (err) {
      // PROFILE_UNAVAILABLE is a transient infra state that auto-retries
      // (showErrorCard schedules the reload) — log it as a warning, not a
      // scary full-stack error.
      if (err.code === 'PROFILE_UNAVAILABLE' || err.status === 503) {
        console.warn('Profile unavailable (retrying):', err.code || err.status);
      } else {
        console.error('Failed to load profile:', err);
      }
      if (err.status === 401) {
        // Token invalid — clear it so /login actually renders (with a token
        // it redirects back to '/', which is an infinite loop)
        const { clearToken } = await import('../sdk.js');
        clearToken();
        navigate('/login', true);
        return;
      }
      // Server-side failure: show a retry state instead of looping
      stopWeatherBeforeLeaving();
      showErrorCard("the (u)niverse hiccuped — your dashboard couldn't load", err.code, err.retryAfter);
      return;
    }
    state = getState();
  }

  const profile = state.profile;
  if (profile && !profile.isVerified) {
    stopWeatherBeforeLeaving();
    navigate('/verify', true);
    return;
  }

  // ─── Parallel panel fetches ───────────────────────────────────────
  // apps/devices/platforms have zero interdependency and none block the
  // identity gate above. Loading them together (instead of the old
  // sequential profile → apps/devices → platforms chain) removes two
  // network round trips from the first meaningful paint, and
  // Promise.allSettled keeps each panel's failure isolated.
  const [appsResult, devicesResult, platformsResult] = await Promise.allSettled([
    state.apps ? Promise.resolve(state.apps) : auth.getApps(),
    state.devices ? Promise.resolve(state.devices) : auth.listDevices(),
    state._platforms ? Promise.resolve(state._platforms) : auth.getPlatforms(),
  ]);
  const devicesRejected = devicesResult.status === 'rejected';
  const appsRejected = appsResult.status === 'rejected';
  if (devicesRejected || appsRejected) {
    console.warn('non-fatal panel load failure', {
      apps: appsRejected ? appsResult.reason : undefined,
      devices: devicesRejected ? devicesResult.reason : undefined,
    });
  }
  setState({
    apps: appsResult.status === 'fulfilled' ? appsResult.value : (state.apps || []),
    devices: devicesResult.status === 'fulfilled' ? devicesResult.value : (state.devices || []),
    _platforms: platformsResult.status === 'fulfilled' ? platformsResult.value : (state._platforms || []),
    // The dashboard renders a visible retry chip + live/expired dots below.
    _appsHiccup: appsRejected,
    _devicesHiccup: devicesRejected,
  });
  state = getState();

  const apps = state.apps || [];
  const devices = state.devices || [];
  const platformLinks = state._platforms || [];

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

    // ─── Apps Summary ────────────────────────────────────────────────

    const appsSection = h('div', { className: 'glass-card-static' }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, ['your applications']),
        h('span', { className: 'input-hint' }, [`${apps.length} installed`]),
      ]),
      h('div', { className: 'apps-summary' }, [
        h('p', { className: 'input-hint' }, ['every core app, one identity — browse the full thaypley family.']),
        h('div', { className: 'apps-summary-actions' }, [
          h('button', {
            className: 'btn btn-secondary btn-sm',
            onClick: () => navigate('/apps'),
          }, ['browse apps →']),
          h('button', {
            className: 'btn btn-ghost btn-sm',
            onClick: () => navigate('/downloads'),
          }, ['downloads']),
        ]),
      ]),
    ]);

    // ─── Devices Panel ─────────────────────────────────────────────

    const devicesHiccup = state._devicesHiccup;

    // A device is "live" when its token expiry is in the future and it has
    // not been revoked — gives the panel a real-time health signal instead
    // of a static label.
    const deviceState = (d) => {
      if (d.revoked) return { dot: 'device-dot device-dot--expired', text: 'revoked' };
      if (d.expiresAt && new Date(d.expiresAt).getTime() < Date.now()) {
        return { dot: 'device-dot device-dot--expired', text: 'expired' };
      }
      return { dot: 'device-dot device-dot--live', text: 'live' };
    };

    const deviceItems = devices.length > 0
      ? devices.map(d => {
        const st = deviceState(d);
        return h('div', { className: 'device-item' }, [
          h('div', { className: 'device-info' }, [
            h('span', { className: 'device-label' }, [
              h('span', { className: st.dot, title: st.text }),
              d.label || 'unknown device',
            ]),
            h('span', { className: 'device-meta' }, [
              d.lastSeenAt ? `last seen ${new Date(d.lastSeenAt).toLocaleDateString()}` : '',
              d.expiresAt ? ` · expires ${new Date(d.expiresAt).toLocaleDateString()}` : '',
            ]),
          ]),
        ]);
      })
      : h('div', { style: { textAlign: 'center', padding: '16px' } }, [
        h('p', { className: 'input-hint', style: { marginBottom: '4px' } }, ['no devices paired yet']),
        h('p', { className: 'input-hint' }, ["pair one from any thaypley app's settings to see it here"]),
      ]);

    const hiccupChip = devicesHiccup
      ? h('div', { className: 'panel-hiccup', role: 'status' }, [
          h('span', {}, ['devices hiccuped — show', ' retry']),
          h('button', {
            className: 'btn btn-ghost btn-sm',
            onClick: () => location.reload(),
          }, ['retry']),
        ])
      : null;

    const devicesSection = h('div', { className: 'glass-card-static' }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, ['connected devices']),
        h('span', { className: 'input-hint' }, [`${devices.length} connected`]),
      ]),
      h('div', { className: 'devices-list' }, deviceItems),
      h('div', { className: 'settings-links', style: { marginTop: '12px' } }, [
        h('a', { className: 'right-panel-link', href: '#/devices' }, ['manage devices →']),
      ]),
    ]);

    // ─── Platform Strip (quick links to the thay web family) ──────
    // Best-effort: if the directory API hiccups, the dashboard still
    // renders — links are decorative shortcuts, never load-bearing.
    // A visible retry chip (mirroring the devices hiccup chip) keeps
    // the failure honest instead of silently dropping the strip.
    const platformsHiccup = platformsResult.status === 'rejected';
    const corePlatforms = platformLinks.filter((p) => ['thaypley', 'tunes', 'tv', 'fam', 'werk'].includes(p.slug));
    const platformChips = [
      ...corePlatforms.map((p) => h('a', {
        className: 'platform-chip',
        href: p.url,
        target: '_blank',
        rel: 'noopener noreferrer',
      }, [p.name])),
      h('a', { className: 'platform-chip platform-chip--all', href: '#/platforms' }, ['all platforms →']),
    ];
    const platformHiccupChip = platformsHiccup
      ? h('div', { className: 'panel-hiccup', role: 'status' }, [
          h('span', {}, ['platforms hiccuped — show', ' retry']),
          h('button', {
            className: 'btn btn-ghost btn-sm',
            onClick: () => location.reload(),
          }, ['retry']),
        ])
      : null;
    const platformStrip = h('div', { className: 'glass-card-static platform-strip' }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, ['the thay universe']),
        h('span', { className: 'input-hint' }, ['one identity, every surface']),
      ]),
      h('div', { className: 'platform-chip-row' }, platformChips),
      platformHiccupChip,
    ]);

    // ─── Creator Hero ──────────────────────────────────────────────
    // The first thing a creator sees: a direct path into making. Every
    // CTA routes to /creative (the studio family) — the concrete next
    // step for "I want to record a song" even before studio ships.
    const creatorHero = h('div', { className: 'glass-card creator-hero' }, [
      h('div', { className: 'creator-hero-copy' }, [
        h('h2', {}, ['make something']),
        h('p', { className: 'subtitle' }, ['record a song, cut a video, design a brand — the studio family is where the universe gets made.']),
      ]),
      h('div', { className: 'creator-hero-actions' }, [
        h('button', {
          className: 'btn btn-primary',
          onClick: () => navigate('/create'),
        }, ['record a song']),
        h('button', {
          className: 'btn btn-secondary',
          onClick: () => navigate('/create'),
        }, ['cut a video']),
        h('button', {
          className: 'btn btn-ghost',
          onClick: () => navigate('/create'),
        }, ['design a brand']),
        h('a', { className: 'right-panel-link', href: '#/creative' }, ['browse the creative family →']),
      ]),
    ]);

    // ─── Layout ────────────────────────────────────────────────────

    // First-run empty state: a brand-new account with zero apps/devices
    // should see what OPENS TODAY (the live family) right away, even
    // before the onboarding overlay — so the dashboard never feels hollow.
    const emptyFreshStrip = (!apps.length && !devices.length && platformLinks.length === 0)
      ? h('div', { className: 'opens-today', style: { marginBottom: 'var(--space-lg)' } }, [
          h('span', { className: 'input-hint', style: { marginRight: 'var(--space-md)' } }, ['start with the live family']),
          h('a', { className: 'platform-chip', href: 'https://thaypley.com', target: '_blank', rel: 'noopener noreferrer' }, ['thaypley.com']),
          h('a', { className: 'platform-chip', href: 'https://tunes.thaypley.com', target: '_blank', rel: 'noopener noreferrer' }, ['(tunes)']),
          h('a', { className: 'platform-chip', href: 'https://tv.thaypley.com', target: '_blank', rel: 'noopener noreferrer' }, ['(tv)']),
          h('a', { className: 'platform-chip', href: 'https://jot.thaypley.com', target: '_blank', rel: 'noopener noreferrer' }, ['(jot)']),
          h('a', { className: 'platform-chip', href: '#/apps' }, ['browse all apps →']),
        ])
      : null;

    const leftPanel = h('div', { className: 'dashboard-panel' }, [profileCard]);
    const rightPanel = h('div', { className: 'dashboard-panel' }, [emptyFreshStrip, platformStrip, appsSection, devicesSection]);

    const grid = h('div', { className: 'dashboard-grid fade-in' }, [creatorHero, leftPanel, rightPanel]);
    const dashboard = h('div', { className: 'dashboard' }, [grid]);

    const shell = h('div', {}, [NavBar(), dashboard]);
    // Replaces the aria-busy skeleton above — the settle point for the busy
    // state is exactly when the real panels render.
    mount(container, shell);

    // Animations
    pageTransition(grid);
    setTimeout(() => staggerIn(grid, '.app-card, .device-item, .platform-chip', 200), 200);

    // ─── First-run onboarding ─────────────────────────────────────
    // Fresh accounts (0 apps, 0 devices, < 24h old) get a 3-step welcome
    // instead of an empty dashboard: what you can create, one identity
    // everywhere, and pairing a device. Dismissed once, never again.
    try {
      const ONBOARDING_KEY = 'thay_onboarding_seen';
      const isFresh = !apps.length && !devices.length && profile.created &&
        (Date.now() - new Date(profile.created).getTime()) < 24 * 60 * 60 * 1000;
      if (isFresh && !localStorage.getItem(ONBOARDING_KEY)) {
        localStorage.setItem(ONBOARDING_KEY, '1');
        const overlay = h('div', { className: 'onboarding-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'welcome to thay' });
        const card = h('div', { className: 'onboarding-card glass-card' }, [
          h('h2', {}, ['welcome to thay']),
          h('p', { className: 'subtitle' }, ['one identity for the whole universe of making']),
          h('div', { className: 'onboarding-steps' }, [
            h('div', { className: 'onboarding-step' }, [
              h('span', { className: 'onboarding-step-num' }, ['01']),
              h('div', {}, [
                h('strong', {}, ['make something']),
                h('p', {}, ['record a song, cut a video, design a brand — the studio family is where it happens.']),
              ]),
            ]),
            h('div', { className: 'onboarding-step' }, [
              h('span', { className: 'onboarding-step-num' }, ['02']),
              h('div', {}, [
                h('strong', {}, ['one identity, every surface']),
                h('p', {}, ['sign in once, unlock thaypley.com, tunes, tv, fam, and werk.']),
              ]),
            ]),
            h('div', { className: 'onboarding-step' }, [
              h('span', { className: 'onboarding-step-num' }, ['03']),
              h('div', {}, [
                h('strong', {}, ['pair a device']),
                h('p', {}, ["link your desktop or phone from any thaypley app's settings to see it here."]),
              ]),
            ]),
          ]),
          h('div', { className: 'onboarding-actions' }, [
            h('button', { className: 'btn btn-primary', onClick: () => overlay.remove() }, ['start creating']),
            h('button', { className: 'btn btn-ghost', onClick: () => navigate('/devices') }, ['pair a device']),
          ]),
        ]);
        overlay.appendChild(card);
        document.body.appendChild(overlay);
        // Click on the overlay (not the card) dismisses.
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        // Escape dismisses.
        const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
        document.addEventListener('keydown', onKey);
      }
    } catch { /* onboarding is non-critical */ }

    // ─── Live state updates ────────────────────────────────────────
    // Whisper-quiet: only re-render the dashboard when a relevant slice
    // actually changes, never on unrelated mutations.
    const unsubscribe = onStateChange((next) => {
      if (!document.body.contains(grid)) {
        unsubscribe();
        return;
      }
      if (next.profile && next.profile.username !== profile.username) {
        profile.username = next.profile.username;
      }
    });
    grid._unsubscribe = unsubscribe;
  } catch (err) {
    stopWeatherBeforeLeaving();
    console.error('Dashboard render failed:', err);
    showErrorCard('something broke rendering your dashboard', null, 0);
  }
}
