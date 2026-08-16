/**
 * Sky — thaypley.com's clock-driven animated day/night background.
 *
 * Ported verbatim from thaypley/js/nav-template.js buildPlatformSky() for brand
 * cohesion across all thay platforms. Self-contained: mounts its own DOM into
 * <body>, injects its own <style>, and keys the readable frosted layer off
 * body[data-sky-phase] + body[data-sky-lum] (see css/sky-theme.css).
 *
 * Auto only — the clock is the sole authority. Preview any phase with
 * ?sky=sunrise|day|sunset|twilight|night or localStorage.tp_sky_preview.
 *
 * Sky mounts on every page. The live weather overlay (mountWeather) is opt-in
 * so auth pages stay calm — only the dashboard enables it.
 */

// The static starfield + cloud layers are raw CSS strings built once at
// module load. Runtime is zero-cost: matched-position gradient layers are
// painted by the compositor, not JS.
const STARS_CSS = [
  'radial-gradient(1px 1px at 5% 8%,rgba(255,255,255,.95) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 10% 15%,rgba(255,255,255,.9) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 18% 4%,rgba(255,255,255,.7) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 25% 12%,rgba(255,255,255,.85) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 30% 8%,rgba(255,255,255,.7) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 38% 18%,rgba(255,255,255,.8) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 44% 6%,rgba(255,255,255,.65) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 50% 14%,rgba(255,255,255,.9) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 55% 20%,rgba(255,255,255,.8) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 62% 9%,rgba(255,255,255,.75) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 68% 3%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 72% 16%,rgba(255,255,255,.9) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 75% 5%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 80% 11%,rgba(255,255,255,.85) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 85% 7%,rgba(255,255,255,.7) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 88% 25%,rgba(255,255,255,.9) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 92% 13%,rgba(255,255,255,.8) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 96% 6%,rgba(255,255,255,.65) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 14% 28%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 20% 35%,rgba(255,255,255,.75) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 28% 42%,rgba(255,255,255,.5) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 35% 30%,rgba(255,255,255,.65) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 42% 38%,rgba(255,255,255,.8) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 48% 26%,rgba(255,255,255,.55) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 56% 44%,rgba(255,255,255,.7) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 63% 32%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 70% 48%,rgba(255,255,255,.75) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 77% 36%,rgba(255,255,255,.85) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 83% 52%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 90% 40%,rgba(255,255,255,.7) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 16% 62%,rgba(255,255,255,.65) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 33% 58%,rgba(255,255,255,.8) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 50% 70%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 60% 64%,rgba(255,255,255,.55) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 74% 72%,rgba(255,255,255,.7) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 80% 65%,rgba(255,255,255,.75) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 88% 78%,rgba(255,255,255,.8) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 22% 82%,rgba(255,255,255,.5) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 40% 88%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(2px 2px at 58% 85%,rgba(255,255,255,.7) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 15% 80%,rgba(255,255,255,.5) 0%,transparent 100%)',
  'radial-gradient(1.5px 1.5px at 70% 85%,rgba(255,255,255,.8) 0%,transparent 100%)',
  'radial-gradient(1px 1px at 35% 90%,rgba(255,255,255,.6) 0%,transparent 100%)',
  'radial-gradient(2.5px 2.5px at 3% 33%,rgba(255,255,255,.9) 0%,transparent 100%)',
  'radial-gradient(2.5px 2.5px at 47% 55%,rgba(255,255,255,.85) 0%,transparent 100%)',
  'radial-gradient(2.5px 2.5px at 93% 28%,rgba(255,255,255,.9) 0%,transparent 100%)',
].join(',');

const STARS_PSEUDO_CSS = `
  @keyframes cloud-drift {
    0%   { transform:translateX(-420px); opacity:0; }
    8%   { opacity:var(--cloud-opacity,.5); }
    92%  { opacity:var(--cloud-opacity,.5); }
    100% { transform:translateX(calc(100vw + 420px)); opacity:0; }
  }
  @keyframes tp-twinkle {
    0%,100% { opacity:.9; }
    50%     { opacity:.25; }
  }
  #tp-stars::before {
    content:'';
    position:absolute;inset:0;
    background-image:
      radial-gradient(2px 2px at 12% 10%,rgba(255,255,255,.95) 0%,transparent 100%),
      radial-gradient(2px 2px at 45% 22%,rgba(255,255,255,.9) 0%,transparent 100%),
      radial-gradient(2.5px 2.5px at 67% 8%,rgba(255,255,255,.95) 0%,transparent 100%),
      radial-gradient(2px 2px at 88% 18%,rgba(255,255,255,.85) 0%,transparent 100%),
      radial-gradient(2px 2px at 23% 55%,rgba(255,255,255,.8) 0%,transparent 100%),
      radial-gradient(2.5px 2.5px at 58% 60%,rgba(255,255,255,.9) 0%,transparent 100%),
      radial-gradient(2px 2px at 78% 72%,rgba(255,255,255,.85) 0%,transparent 100%);
    animation: tp-twinkle 9s ease-in-out infinite;
    pointer-events:none;
  }
  #tp-stars::after {
    content:'';
    position:absolute;inset:0;
    background-image:
      radial-gradient(1.5px 1.5px at 8% 42%,rgba(255,255,255,.8) 0%,transparent 100%),
      radial-gradient(2px 2px at 33% 15%,rgba(255,255,255,.9) 0%,transparent 100%),
      radial-gradient(1.5px 1.5px at 52% 48%,rgba(255,255,255,.75) 0%,transparent 100%),
      radial-gradient(2px 2px at 71% 35%,rgba(255,255,255,.85) 0%,transparent 100%),
      radial-gradient(1.5px 1.5px at 91% 55%,rgba(255,255,255,.8) 0%,transparent 100%),
      radial-gradient(2px 2px at 15% 75%,rgba(255,255,255,.75) 0%,transparent 100%),
      radial-gradient(2px 2px at 44% 82%,rgba(255,255,255,.85) 0%,transparent 100%);
    animation: tp-twinkle 13s ease-in-out infinite;
    animation-delay: -2.1s;
    pointer-events:none;
  }
`;

// Small DOM builder that only handles the tag/class/style shape used here —
// keeps the module import-free (sky.js is on the boot path).
function skyEl(tag, cls, cssText) {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (cssText) el.style.cssText = cssText;
  return el;
}

export function buildPlatformSky() {
  if (document.getElementById('tp-sky')) { return; } // already mounted

  // The static starfield background (44 gradient stops) is a single
  // pre-built CSS string — set once, never touched again.
  const sky = skyEl('div', null, 'position:fixed;inset:0;z-index:-2;transition:background 4s ease;');
  sky.id = 'tp-sky';
  document.body.appendChild(sky);

  const stars = skyEl('div', null, `position:fixed;inset:0;z-index:-1;opacity:0;transition:opacity 3s ease;pointer-events:none;background-image:${STARS_CSS}`);
  stars.id = 'tp-stars';
  document.body.appendChild(stars);

  // Each phase carries:
  //   name → fine tint hook   (body[data-sky-phase])
  //   lum  → contrast bucket  (body[data-sky-lum]): 'light' = dark text, 'dark' = light text
  // css/sky-theme.css keys the readable frosted layer off both.
  const SKY_PHASES = [
    { start: 6, end: 8, name: 'sunrise', lum: 'light', clouds: 0.20, bg: 'linear-gradient(180deg,#f9c06a 0%,#f6a96e 25%,#f2c9b0 55%,#f7dfc9 80%,#fef3ea 100%)' },
    { start: 8, end: 17, name: 'day', lum: 'light', clouds: 0.25, bg: 'linear-gradient(180deg,#5badf0 0%,#7ec8f8 25%,#b8defa 55%,#d8eefb 80%,#eef6fd 100%)' },
    { start: 17, end: 20, name: 'sunset', lum: 'light', clouds: 0.20, bg: 'linear-gradient(180deg,#f7a34b 0%,#f9c26a 25%,#fad98e 55%,#fce8b4 80%,#fef5d6 100%)' },
    { start: 20, end: 22, name: 'twilight', lum: 'dark', clouds: 0.12, bg: 'linear-gradient(180deg,#5b3aa6 0%,#8b5cf6 20%,#c084fc 42%,#f177ae 70%,#f0cbd9 100%)' },
    { start: 22, end: 6, name: 'night', lum: 'dark', clouds: 0.04, stars: true, bg: 'linear-gradient(180deg,#0e0b0c 0%,#1a1533 20%,#231b4a 50%,#2d2260 80%,#1a1240 100%)' },
  ];

  function getPhase() {
    // Preview override (testing): ?sky=<name> or localStorage.tp_sky_preview.
    // Hash router — the query may live in location.search OR inside the #hash.
    let override = null;
    try {
      const qs = new URLSearchParams(window.location.search).get('sky')
        || new URLSearchParams((window.location.hash || '').replace(/^#\/?/, '').split('?')[1] || '').get('sky');
      override = qs || localStorage.getItem('tp_sky_preview');
    } catch (_) { /* ignore */ }
    if (override) {
      const forced = SKY_PHASES.find(p => p.name === override);
      if (forced) { return forced; }
    }
    const h = new Date().getHours();
    return SKY_PHASES.find(p => p.start < p.end ? h >= p.start && h < p.end : h >= p.start || h < p.end) || SKY_PHASES[1];
  }

  function applyPhase(p) {
    sky.style.background = p.bg;
    stars.style.opacity = p.stars ? '1' : '0';
    document.querySelectorAll('.tp-cloud').forEach(c => c.style.setProperty('--cloud-opacity', p.clouds));
    document.body.dataset.skyPhase = p.name;
    document.body.dataset.skyLum = p.lum;
    document.body.classList.toggle('sky-night', p.lum === 'dark');
  }

  // Spawn clouds using the thaypley cloud sprite (shared brand asset).
  for (let i = 0; i < 4; i++) {
    const el = skyEl('div', 'tp-cloud', 'position:fixed;pointer-events:none;z-index:-1;opacity:0;');
    const w = 120 + Math.random() * 200;
    const top = 2 + Math.random() * 35;
    const dur = 120 + Math.random() * 90;
    el.style.cssText = `position:fixed;pointer-events:none;z-index:-1;opacity:0;` +
      `top:${top}%;width:${w}px;` +
      `animation:cloud-drift ${dur}s linear infinite;` +
      `animation-delay:-${Math.random() * dur}s;`;
    const img = document.createElement('img');
    img.src = '/assets/logos/thaypley_cloud.png';
    img.style.cssText = 'width:100%;display:block;pointer-events:none;';
    img.setAttribute('aria-hidden', 'true');
    el.appendChild(img);
    document.body.appendChild(el);
  }

  // Inject sky keyframes if not already present.
  if (!document.getElementById('tp-sky-style')) {
    const s = document.createElement('style');
    s.id = 'tp-sky-style';
    s.textContent = STARS_PSEUDO_CSS;
    document.head.appendChild(s);
  }

  // Auto only — the clock is the sole authority. No dark-mode coupling.
  function syncSky() { applyPhase(getPhase()); }

  syncSky();
  setInterval(syncSky, 10 * 60 * 1000);
}

// ── LIVE WEATHER LAYER (optional, opt-in) ───────────────────────────────────
// Mounts a weather overlay div on top of the sky. Uses browser geolocation
// + Open-Meteo (free, no key). Polls every 15 min. Falls back gracefully if
// geolocation is denied — sky still works as normal. Idempotent; safe to call
// anytime (auth pages never do — only the dashboard enables it).
export function mountWeather() {
  // Opt-in only: never request geolocation on page load. The dashboard
  // calls this only after the user flips the ambient-weather toggle in
  // Settings (localStorage.thay_weather_optin === '1').
  if (localStorage.getItem('thay_weather_optin') !== '1') {
    return () => {};
  }
  // Tauri desktop webviews have no geolocation permission — requesting it
  // makes WKWebView's CoreLocationProvider log kCLErrorLocationUnknown and
  // leaves dead particles behind. Skip entirely; the static sky still runs.
  const isTauri =
    window.location.protocol === 'tauri:' ||
    window.location.hostname === 'tauri.localhost' ||
    !!window.__TAURI_INTERNALS__;
  if (isTauri) {
    return () => {};
  }
  if (document.getElementById('tp-weather')) { return; }

  const WEATHER_OVERLAYS = {
    clear: null,
    fog: { css: 'background:rgba(200,210,220,0.32);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);', anim: null },
    overcast: { css: 'background:rgba(140,155,175,0.22);', anim: null },
    drizzle: { css: '', anim: 'tp-rain-light' },
    rain: { css: '', anim: 'tp-rain-heavy' },
    snow: { css: '', anim: 'tp-snow' },
    thunder: { css: 'background:rgba(60,40,90,0.18);', anim: 'tp-rain-heavy' },
  };

  function wmoToOverlay(code) {
    if (code === 0) { return 'clear'; }
    if (code <= 2) { return 'clear'; }
    if (code === 3) { return 'overcast'; }
    if (code >= 45 && code <= 48) { return 'fog'; }
    if (code >= 51 && code <= 57) { return 'drizzle'; }
    if (code >= 61 && code <= 67) { return 'rain'; }
    if (code >= 71 && code <= 77) { return 'snow'; }
    if (code >= 80 && code <= 82) { return 'drizzle'; }
    if (code === 85 || code === 86) { return 'snow'; }
    if (code >= 95) { return 'thunder'; }
    return 'clear';
  }

  if (!document.getElementById('tp-weather-style')) {
    const ws = document.createElement('style');
    ws.id = 'tp-weather-style';
    ws.textContent = `
      #tp-weather { position:fixed;inset:0;z-index:-1;pointer-events:none;transition:background 8s ease,opacity 4s ease; }
      .tp-rain-drop {
        position:fixed;pointer-events:none;z-index:-1;
        width:1.5px;background:linear-gradient(to bottom,transparent,rgba(180,210,240,0.55));
        border-radius:2px;animation:tp-rain-fall linear infinite;
      }
      @keyframes tp-rain-fall {
        0%   { transform:translateY(-120px); opacity:0; }
        8%   { opacity:1; }
        92%  { opacity:1; }
        100% { transform:translateY(110vh); opacity:0; }
      }
      .tp-snow-flake {
        position:fixed;pointer-events:none;z-index:-1;
        border-radius:50%;background:rgba(255,255,255,0.82);
        animation:tp-snow-fall linear infinite;
      }
      @keyframes tp-snow-fall {
        0%   { transform:translateY(-20px) translateX(0); opacity:0; }
        10%  { opacity:.9; }
        90%  { opacity:.7; }
        100% { transform:translateY(105vh) translateX(30px); opacity:0; }
      }
    `;
    document.head.appendChild(ws);
  }

  const weatherEl = document.createElement('div');
  weatherEl.id = 'tp-weather';
  document.body.appendChild(weatherEl);

  let _wxParticles = [];
  let _wxLast = null;
  let _wxTimer = null;
  // Teardown race guard: geolocation's getCurrentPosition resolves
  // asynchronously, possibly AFTER the router already called stopWeather()
  // (e.g. navigating off the dashboard in the first 8s). Without this flag
  // the late callback would spawn a polling timer and orphan DOM that never
  // gets torn down. The guard makes stopWeather BEFORE the callback and
  // AFTER it behave identically — a leak-proof no-op either way.
  let _stopped = false;

  function clearWeatherParticles() {
    _wxParticles.forEach(el => el.remove());
    _wxParticles = [];
  }

  function spawnRain(heavy) {
    const count = heavy ? 80 : 38;
    for (let i = 0; i < count; i++) {
      const d = document.createElement('div');
      d.className = 'tp-rain-drop';
      const height = heavy ? (18 + Math.random() * 22) : (12 + Math.random() * 14);
      const dur = heavy ? (0.55 + Math.random() * 0.35) : (0.8 + Math.random() * 0.6);
      d.style.cssText =
        `left:${Math.random() * 102 - 1}%;` +
        `top:${-Math.random() * 15}%;` +
        `height:${height}px;` +
        `animation-duration:${dur}s;` +
        `animation-delay:-${Math.random() * dur}s;` +
        `opacity:${0.4 + Math.random() * 0.4};`;
      document.body.appendChild(d);
      _wxParticles.push(d);
    }
  }

  function spawnSnow() {
    for (let i = 0; i < 55; i++) {
      const d = document.createElement('div');
      d.className = 'tp-snow-flake';
      const size = 2 + Math.random() * 4;
      const dur = 5 + Math.random() * 8;
      d.style.cssText =
        `left:${Math.random() * 100}%;` +
        `width:${size}px;height:${size}px;` +
        `animation-duration:${dur}s;` +
        `animation-delay:-${Math.random() * dur}s;`;
      document.body.appendChild(d);
      _wxParticles.push(d);
    }
  }

  function applyWeather(overlayKey) {
    if (_stopped) return;
    if (overlayKey === _wxLast) { return; }
    _wxLast = overlayKey;
    clearWeatherParticles();
    const cfg = WEATHER_OVERLAYS[overlayKey];
    if (!cfg) { weatherEl.style.cssText = ''; return; }
    weatherEl.style.cssText = cfg.css || '';
    if (cfg.anim === 'tp-rain-light') { spawnRain(false); }
    if (cfg.anim === 'tp-rain-heavy') { spawnRain(true); }
    if (cfg.anim === 'tp-snow') { spawnSnow(); }
  }

  async function fetchWeather(lat, lon) {
    if (_stopped) return;
    try {
      // Server-side proxy (GET /auth/weather) — the browser makes zero
      // third-party requests, so ERR_BLOCKED_BY_CLIENT is impossible.
      const { default: auth } = await import('../sdk.js');
      const data = await auth.getWeather(lat, lon);
      applyWeather(wmoToOverlay(data?.weatherCode ?? 0));
    } catch (_) { /* silently skip on network error */ }
  }

  function startWeatherPolling(lat, lon) {
    if (_stopped) return; // late geolocation callback after teardown
    fetchWeather(lat, lon);
    _wxTimer = setInterval(() => {
      if (_stopped) { clearInterval(_wxTimer); _wxTimer = null; return; }
      fetchWeather(lat, lon);
    }, 15 * 60 * 1000);
  }

  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => startWeatherPolling(pos.coords.latitude, pos.coords.longitude),
      () => { /* permission denied — sky only, no weather layer */ },
      { maximumAge: 10 * 60 * 1000, timeout: 8000 },
    );
  }

  // Router cleanup: stop the poll, clear the DOM, and remove the injected
  // style so a later visit starts fresh (and Tauri never re-prompts).
  return function stopWeather() {
    _stopped = true;
    if (_wxTimer) { clearInterval(_wxTimer); _wxTimer = null; }
    clearWeatherParticles();
    weatherEl.remove();
    document.getElementById('tp-weather-style')?.remove();
  };
}

export function initSky() {
  buildPlatformSky();
}
