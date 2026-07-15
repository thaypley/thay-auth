import { ThayAuth } from './auth-sdk-lib.js';

const STORAGE_TOKEN_KEY = 'thay_homebase_token';

const auth = new ThayAuth({
  baseUrl: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '/api'
    : 'https://api.thaypley.com',
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

export function clearToken() {
  localStorage.removeItem(STORAGE_TOKEN_KEY);
  auth.setToken(null);
}

export function hasToken() {
  return !!localStorage.getItem(STORAGE_TOKEN_KEY);
}

export default auth;
