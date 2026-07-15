/**
 * Cloudflare Pages Function — proxies /api/* requests to VPS Express API.
 *
 * The home base SPA is served by Cloudflare Pages at auth.thaypley.com.
 * All /api/* calls from the frontend are proxied through this function
 * to the thay-auth Express server running on the Hostinger VPS.
 *
 * The VPS nginx routes /thauth/* → http://127.0.0.1:3749/* (thay-auth Docker)
 * Set AUTH_API_URL as an environment variable in CF Pages dashboard:
 *   AUTH_API_URL = https://thaypley.com/thauth
 */

const AUTH_API = typeof AUTH_API_URL !== 'undefined'
  ? AUTH_API_URL
  : 'https://thaypley.com/thauth';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Rewrite /api/* to the auth backend (strip /api prefix)
  // e.g. /api/auth/login → /thauth/auth/login on the VPS
  const backendPath = url.pathname.replace(/^\/api/, '') || '/';
  const target = new URL(backendPath + url.search, AUTH_API);

  // Forward the request, preserving method, headers, and body
  const init = {
    method: request.method,
    headers: {},
  };

  // Copy headers (filter out hop-by-hop headers)
  const hopByHop = ['connection', 'keep-alive', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'proxy-authorization', 'proxy-authenticate'];
  for (const [key, value] of request.headers) {
    if (!hopByHop.includes(key.toLowerCase())) {
      init.headers[key] = value;
    }
  }

  // Set forwarded headers so Express knows the original request
  init.headers['Host'] = 'thaypley.com';
  init.headers['X-Forwarded-Proto'] = 'https';
  init.headers['X-Forwarded-Host'] = 'auth.thaypley.com';

  // Forward body for POST/PUT/PATCH/DELETE
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    try {
      init.body = await request.text();
    } catch {
      init.body = '';
    }
  }

  try {
    const response = await fetch(target.toString(), init);

    // Return with CORS headers
    const corsHeaders = {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization',
      'access-control-max-age': '86400',
    };

    // Handle preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Copy response headers + add CORS
    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders)) {
      responseHeaders.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Backend unreachable' }), {
      status: 502,
      headers: {
        'content-type': 'application/json',
        'access-control-allow-origin': '*',
      },
    });
  }
}