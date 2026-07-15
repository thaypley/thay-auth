/**
 * Auth SDK singleton with localStorage persistence.
 */
import { ThayAuth } from '@thaypley/auth-sdk';

const STORAGE_TOKEN_KEY = 'thay_homebase_token';

const auth = new ThayAuth({
  baseUrl: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '/api'  // Vite proxy in dev
    : '/api',  // CF Pages Function proxy in prod
});

// Restore token on boot
const savedToken = localStorage.getItem(STORAGE_TOKEN_KEY);
if (savedToken) {
  auth.setToken(savedToken);
}

// Wrap login to persist token
const origLogin = auth.login.bind(auth);
auth.login = async (identity, password) => {
  const result = await origLogin(identity, password);
  localStorage.setItem(STORAGE_TOKEN_KEY, result.token);
  return result;
};

// Wrap signup to persist token
const origSignup = auth.signup.bind(auth);
auth.signup = async (data) => {
  const result = await origSignup(data);
  localStorage.setItem(STORAGE_TOKEN_KEY, result.token);
  return result;
};

// Wrap logout to clear token
const origLogout = auth.logout.bind(auth);
auth.logout = async () => {
  await origLogout();
  localStorage.removeItem(STORAGE_TOKEN_KEY);
};

// Wrap refresh to persist updated token
const origRefresh = auth.refreshSession.bind(auth);
auth.refreshSession = async () => {
  const result = await origRefresh();
  localStorage.setItem(STORAGE_TOKEN_KEY, result.token);
  return result;
};

export function clearToken() {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  auth.setToken(null);
}

export function hasToken() {
  return !!localStorage.getItem(STORAGE_TOKEN_KEY);
}

export default auth;