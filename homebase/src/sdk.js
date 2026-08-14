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
  // Dev: /api (Vite proxy strips the prefix to /auth|/devices|/sessions).
  // Prod SPA on auth.thaypley.com: '' (same-origin — nginx proxies the
  // /auth|/devices|/sessions tree directly, so a leading /api would hit
  // the SPA fallback and return index.html instead of JSON).
  // Anywhere else (Tauri desktop): the legacy api.thaypley.com host.
  baseUrl: isLocal ? '/api' : (isProdSpa ? '' : 'https://api.thaypley.com'),
});

const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
if (savedToken) {
  auth.setToken(savedToken);
}

const origLogin = auth.login.bind(auth);
auth.login = async (identity, password) => {
  const result = await origLogin(identity, password);
  localStorage.setItem(STORAGE_TOKEN_KEY, result.token);
  return result;
};

const origSignup = auth.signup.bind(auth);
auth.signup = async (data) => {
  const result = await origSignup(data);
  localStorage.setItem(STORAGE_TOKEN_KEY, result.token);
  return result;
};

const origLogout = auth.logout.bind(auth);
auth.logout = async () => {
  await origLogout();
  localStorage.removeItem(STORAGE_TOKEN_KEY);
};

const origRefresh = auth.refreshSession.bind(auth);
auth.refreshSession = async () => {
  const result = await origRefresh();
  localStorage.setItem(STORAGE_TOKEN_KEY, result.token);
  return result;
};

// Persist a token obtained outside the normal login/signup path
// (e.g. the EMAIL_NOT_VERIFIED 403 hands one back for the verify flow).
export function saveToken(token) {
  localStorage.setItem(STORAGE_TOKEN_KEY, token);
  auth.setToken(token);
}

export function clearToken() {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  auth.setToken(null);
}

export function hasToken() {
  return !!localStorage.getItem(STORAGE_TOKEN_KEY);
}

export default auth;
