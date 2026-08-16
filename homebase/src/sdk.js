import { ThayAuth } from './auth-sdk-lib.js';

const STORAGE_TOKEN_KEY = 'thay_homebase_token';

// Origin resolution:
//   browser dev        (localhost:5173)     → /api (Vite proxy → 3749)
//   Tauri desktop      (tauri://localhost or localhost in a WKWebView)
//                                          → api.thaypley.com (Tauri CSP
//                                            allows exactly that origin; a
//                                            same-origin /api would attempt
//                                            tauri://localhost/api and fail)
//   auth.thaypley.com  (prod SPA)           → /api (nginx already proxies
//                                            /auth|/devices|/sessions — no
//                                            need for a cross-origin hop that
//                                            costs a DNS + TLS round trip)
const isTauri =
  window.location.protocol === 'tauri:' ||
  window.location.hostname === 'tauri.localhost' ||
  !!window.__TAURI_INTERNALS__;
const hostname = window.location.hostname;
const isLocal = (hostname === 'localhost' || hostname === '127.0.0.1') && !isTauri;
const isProdSpa = !isTauri && hostname === 'auth.thaypley.com';

const auth = new ThayAuth({
  baseUrl: isLocal ? '/api' : (isProdSpa ? '' : 'https://api.thaypley.com'),
});

// In-memory token flag — hasToken() is called on every route guard AND
// every NavBar render. Each call used to do a synchronous localStorage
// read, which blocks the main thread (tens to hundreds of µs on mobile
// webviews) and forces storage serialization on every page navigated.
// Every token write in this module already funnels through the functions
// below, so the mirror can never go stale within this tab. The initial
// value is read once at boot, exactly like the original auth.setToken.
let cachedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
if (cachedToken) {
  auth.setToken(cachedToken);
}

function persistToken(token) {
  cachedToken = token;
  try {
    localStorage.setItem(STORAGE_TOKEN_KEY, token);
  } catch { /* private mode — in-memory session only */ }
}

const origLogin = auth.login.bind(auth);
auth.login = async (identity, password) => {
  const result = await origLogin(identity, password);
  persistToken(result.token);
  return result;
};

const origSignup = auth.signup.bind(auth);
auth.signup = async (data) => {
  const result = await origSignup(data);
  persistToken(result.token);
  return result;
};

const origLogout = auth.logout.bind(auth);
auth.logout = async () => {
  await origLogout();
  cachedToken = null;
  try {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
  } catch { /* private mode */ }
};

const origRefresh = auth.refreshSession.bind(auth);
auth.refreshSession = async () => {
  const result = await origRefresh();
  persistToken(result.token);
  return result;
};

// Persist a token obtained outside the normal login/signup path
// (e.g. the EMAIL_NOT_VERIFIED 403 hands one back for the verify flow).
export function saveToken(token) {
  persistToken(token);
  auth.setToken(token);
}

export function clearToken() {
  cachedToken = null;
  try {
    localStorage.removeItem(STORAGE_TOKEN_KEY);
  } catch { /* private mode */ }
  auth.setToken(null);
}

export function hasToken() {
  return !!cachedToken;
}

export default auth;
