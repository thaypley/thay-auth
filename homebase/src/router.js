/**
 * Simple hash-based SPA router.
 */
const routes = {};
let currentCleanup = null;

// When navigate() changes the hash it also calls render() directly; the
// browser then fires hashchange asynchronously, which would render again.
// This flag suppresses that duplicate so every navigation paints ONCE.
let suppressHashRender = false;

export function route(path, renderFn) {
  routes[path] = renderFn;
}

function getHash() {
  const raw = window.location.hash.slice(1) || '/';
  // Strip a trailing query string so route matching isn't thrown off by
  // e.g. "#/reset-password?token=abc" — use getQueryParams() to read it.
  const qIndex = raw.indexOf('?');
  return qIndex === -1 ? raw : raw.slice(0, qIndex);
}

export function getQueryParams() {
  const raw = window.location.hash.slice(1) || '';
  const qIndex = raw.indexOf('?');
  return new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
}

function getParams(routePath, hash) {
  const routeParts = routePath.split('/');
  const hashParts = hash.split('/');
  const params = {};

  for (let i = 0; i < routeParts.length; i++) {
    if (routeParts[i].startsWith(':')) {
      params[routeParts[i].slice(1)] = hashParts[i] || null;
    }
  }

  return params;
}

// Precompile the route table once so matchRoute never re-splits strings
// or allocates an entries array per render.
let compiledRoutes = null;
function getCompiledRoutes() {
  if (compiledRoutes) return compiledRoutes;
  const paramRoutes = [];
  const exact = new Map();
  for (const [path, handler] of Object.entries(routes)) {
    // The '*' catch-all belongs to render()'s unmatched-hash fallback,
    // not the exact map (which would only match a literal '#/*' hash).
    if (path === '*') continue;
    if (path.indexOf(':') === -1) {
      exact.set(path, { handler, params: {} });
    } else {
      paramRoutes.push({ parts: path.split('/'), handler });
    }
  }
  compiledRoutes = { exact, paramRoutes };
  return compiledRoutes;
}

function matchRoute(hash) {
  const { exact, paramRoutes: params } = getCompiledRoutes();

  // Exact match first — O(1).
  const exactHit = exact.get(hash);
  if (exactHit) return exactHit;

  // Parametric match — only for routes that actually contain ':'.
  const hashParts = hash.split('/');
  for (const { parts, handler } of params) {
    if (parts.length !== hashParts.length) continue;
    let isMatch = true;
    const p = {};
    for (let i = 0; i < parts.length; i++) {
      if (parts[i].startsWith(':')) {
        p[parts[i].slice(1)] = hashParts[i];
      } else if (parts[i] !== hashParts[i]) {
        isMatch = false;
        break;
      }
    }
    if (isMatch) return { handler, params: p };
  }

  return null;
}

function setHash(path, replace) {
  // Same-hash navigation is a no-op (prevents a pointless reload cycle
  // when redirecting to the very route we are already on).
  if (getHash() === path) return;
  suppressHashRender = true;
  if (replace) {
    window.location.replace('#' + path);
  } else {
    window.location.hash = path;
  }
}

export async function navigate(path, replace = false) {
  setHash(path, replace);
  await render();
}

async function render() {
  const hash = getHash();
  const app = document.getElementById('app');

  // Run cleanup from previous page
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  const matched = matchRoute(hash);

  if (!matched) {
    // Catch-all is registered as '*' — fall through to it.
    const fallback = routes['*'];
    if (fallback) {
      await fallback(app, {});
    }
    return;
  }

  try {
    const cleanup = await matched.handler(app, matched.params);
    if (typeof cleanup === 'function') {
      currentCleanup = cleanup;
    }
  } catch (err) {
    // Global safety net: without this, any uncaught error inside a page
    // handler left the user stuck on the boot spinner forever with no
    // feedback and no way forward except closing the tab.
    console.error('Route render failed:', err);
    app.innerHTML = `
      <div class="error-page">
        <h1 style="font-size: 2.5rem;">oops</h1>
        <p>something broke loading this page — try refreshing.</p>
        <button id="error-refresh" class="btn btn-primary">refresh</button>
      </div>
    `;
    // CSP forbids inline event handlers (script-src 'self'); use a listener.
    document.getElementById('error-refresh')?.addEventListener('click', () => location.reload());
  }
}

export function initRouter() {
  window.addEventListener('hashchange', () => {
    if (suppressHashRender) {
      suppressHashRender = false;
      return;
    }
    render();
  });
  render();
}

export function getCurrentPath() {
  return getHash();
}
