/**
 * Simple hash-based SPA router.
 */
const routes = {};
let currentCleanup = null;

export function route(path, renderFn) {
  routes[path] = renderFn;
}

function getHash() {
  return window.location.hash.slice(1) || '/';
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

function matchRoute(hash) {
  // Exact match first
  if (routes[hash]) {
    return { handler: routes[hash], params: {} };
  }

  // Parametric match
  for (const [path, handler] of Object.entries(routes)) {
    const routeParts = path.split('/');
    const hashParts = hash.split('/');

    if (routeParts.length !== hashParts.length) continue;

    let isMatch = true;
    const params = {};
    for (let i = 0; i < routeParts.length; i++) {
      if (routeParts[i].startsWith(':')) {
        params[routeParts[i].slice(1)] = hashParts[i];
      } else if (routeParts[i] !== hashParts[i]) {
        isMatch = false;
        break;
      }
    }

    if (isMatch) {
      return { handler, params };
    }
  }

  return null;
}

export async function navigate(path, replace = false) {
  if (replace) {
    window.location.replace('#' + path);
  } else {
    window.location.hash = path;
  }
  // Navigate fires on hashchange anyway, but we call render immediately too
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
    // Try 404 handler
    if (routes['/404']) {
      await routes['/404'](app, {});
    }
    return;
  }

  const cleanup = await matched.handler(app, matched.params);
  if (typeof cleanup === 'function') {
    currentCleanup = cleanup;
  }
}

export function initRouter() {
  window.addEventListener('hashchange', render);
  render();
}

export function getCurrentPath() {
  return getHash();
}