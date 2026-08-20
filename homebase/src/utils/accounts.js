/**
 * Shared multi-account storage helpers — the single source of truth for the
 * thay-auth account switcher. Both AccountDrawer and LoginPage (add-account
 * mode) use this module so the account-slot semantics are identical everywhere.
 */
import auth from '../sdk.js';

const ACCOUNTS_KEY = 'thay_auth_accounts';
const TOKEN_KEY = 'thay_homebase_token';

export function readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function writeAccounts(accounts) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch { /* private mode */ }
}

export function ensureStoredAccount(user, token) {
  const accounts = readAccounts();
  if (!user) return accounts;
  const activeToken = token || auth.getToken();
  const idx = accounts.findIndex((a) => a.id === user.id);
  const entry = { id: user.id, username: user.username, avatar: user.avatar || '', token: activeToken || '' };
  if (idx >= 0) accounts[idx] = { ...accounts[idx], ...entry };
  else accounts.push(entry);
  writeAccounts(accounts);
  return accounts;
}

export function saveAccount(entry) {
  const accounts = readAccounts();
  const idx = accounts.findIndex((a) => a.id === entry.id);
  if (idx >= 0) accounts[idx] = { ...accounts[idx], ...entry };
  else accounts.push(entry);
  writeAccounts(accounts);
  return accounts;
}

export function switchToAccount(accounts, currentUser, nextId) {
  if (!currentUser || nextId === currentUser.id) return false;
  const current = accounts.find((a) => a.id === currentUser.id);
  const next = accounts.find((a) => a.id === nextId);
  if (!next || !next.token) return false;
  if (current && auth.getToken()) {
    writeAccounts(accounts.map((a) => (a.id === currentUser.id ? { ...a, token: auth.getToken() } : a)));
  }
  try {
    localStorage.setItem(TOKEN_KEY, next.token);
    auth.setToken(next.token);
  } catch { /* private mode */ }
  return true;
}

export function clearAllAccounts() {
  writeAccounts([]);
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch { /* private mode */ }
}
