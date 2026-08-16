/**
 * AccountDrawer — right-side account + platform switcher, ported from
 * thaypley-ui/src/components/AccountDrawer.tsx to vanilla JS for homebase.
 *
 * Square brand tiles for the three web platforms — (pley) (fam) (werk) —
 * each firing the thay-auth relay before navigating to its subdomain.
 * Below: the multi-account switcher (localStorage-backed, same shape as
 * thaypley.com's tp_accounts but origin-scoped to thay-auth's own store),
 * add-account, thay-auth info links, and logout / sign-out-all.
 *
 * The theme has no sky-override toggle — the sky is auto-only in homebase —
 * so that row from the pley drawer is omitted here.
 */
import { h } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';

const ACCOUNTS_KEY = 'thay_auth_accounts';
const TOKEN_KEY = 'thay_homebase_token';

const PLATFORM_TABS = [
  { id: 'pley', label: '(pley)', host: 'https://thaypley.com' },
  { id: 'fam', label: '(fam)', host: 'https://fam.thaypley.com' },
  { id: 'werk', label: '(werk)', host: 'https://werk.thaypley.com' },
];

function readAccounts() {
  try {
    return JSON.parse(localStorage.getItem(ACCOUNTS_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeAccounts(accounts) {
  try {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* private mode */
  }
}

function currentUser() {
  const state = getState();
  return state.user || state.profile || null;
}

function ensureCurrentAccount(user) {
  const accounts = readAccounts();
  if (!user) return accounts;
  const token = auth.getToken();
  const idx = accounts.findIndex((a) => a.id === user.id);
  const entry = { id: user.id, username: user.username, avatar: user.avatar || '', token: token || '' };
  if (idx >= 0) {
    accounts[idx] = { ...accounts[idx], ...entry };
  } else {
    accounts.push(entry);
  }
  writeAccounts(accounts);
  return accounts;
}

function switchToAccount(accounts, user, id) {
  if (!user || id === user.id) return;
  const current = accounts.find((a) => a.id === user.id);
  const next = accounts.find((a) => a.id === id);
  if (!next) return;
  if (current && auth.getToken()) {
    writeAccounts(accounts.map((a) => (a.id === user.id ? { ...a, token: auth.getToken() } : a)));
  }
  // Swap the active token then reload — the router boots straight into the
  // dashboard for the newly-selected account.
  if (next.token) {
    localStorage.setItem(TOKEN_KEY, next.token);
    auth.setToken(next.token);
  }
  setState({ user: null, profile: null, apps: [], devices: [] });
  window.location.hash = '/';
  window.location.reload();
}

async function handlePlatformSwitch(tab) {
  // Best-effort: relay the current session to the sibling subdomain, then
  // navigate regardless. If the relay is down the destination re-auths.
  try {
    await auth.relayPlatform();
  } catch {
    /* non-fatal */
  }
  window.location.href = tab.host;
}

function handleLogout(accounts, user) {
  if (!window.confirm('log out of this account?')) return;
  const remaining = user ? accounts.filter((a) => a.id !== user.id) : accounts;
  writeAccounts(remaining);
  if (remaining.length > 0) {
    const next = remaining[0];
    if (next.token) {
      localStorage.setItem(TOKEN_KEY, next.token);
      auth.setToken(next.token);
    }
    setState({ user: null, profile: null, apps: [], devices: [] });
    window.location.reload();
  } else {
    auth.logout().finally(() => {
      setState({ user: null, profile: null, apps: [], devices: [] });
      navigate('/login', true);
    });
  }
}

function handleSignOutAll() {
  if (!window.confirm('sign out of all devices?\nthis will end all active sessions for this account.')) return;
  writeAccounts([]);
  auth.logout().finally(() => {
    setState({ user: null, profile: null, apps: [], devices: [] });
    navigate('/login', true);
  });
}

/**
 * Renders the drawer into `container` (appended at body level by the NavBar).
 * open/onClose follow the thaypley right-panel pattern: fixed right slide-in.
 */
export function mountAccountDrawer(container, { open, onClose }) {
  const user = currentUser();
  const accounts = ensureCurrentAccount(user);
  const state = getState();
  const isArchitect = !!(state.user?.isArchitect || state.profile?.isArchitect);

  // ── Platform tabs (square, brand-identity colors) ──────────────
  const tabs = PLATFORM_TABS.map((tab) => h('button', {
    className: `tp-ptab tp-ptab--${tab.id}`,
    type: 'button',
    onClick: () => handlePlatformSwitch(tab),
  }, [tab.label]));

  // ── Account list ────────────────────────────────────────────────
  const accountRows = accounts.length
    ? accounts.map((acc) => {
        const isActive = acc.id === user?.id;
        const ini = (acc.username || '??').slice(0, 2).toUpperCase();
        const avatar = acc.avatar
          ? h('img', { src: acc.avatar, alt: '', style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' } })
          : ini;
        return h('div', {
          className: 'right-panel-account' + (isActive ? ' right-panel-account--active' : ''),
          role: isActive ? 'option' : 'button',
          'aria-selected': isActive ? 'true' : 'false',
          onClick: () => !isActive && switchToAccount(accounts, user, acc.id),
        }, [
          h('div', { className: 'right-panel-avatar', style: { background: 'var(--vibe-primary)' } }, [avatar]),
          h('div', { style: { flex: 1 } }, [
            h('div', { className: 'right-panel-account-name' }, [`@${acc.username}`]),
            h('div', { className: 'right-panel-account-state' }, [isActive ? '✓ active' : 'tap to switch']),
          ]),
        ]);
      })
    : null;

  // ── thay-auth info links (replacing thaypley.com's platform links) ─
  const links = [
    { label: 'downloads', href: '#/downloads' },
    { label: 'apps', href: '#/apps' },
    { label: 'dabba', href: '#/dabba' },
    { label: 'tabbi', href: '#/tabbi' },
    { label: 'creative', href: '#/creative' },
    { label: 'platforms', href: '#/platforms' },
    { label: 'billing & subscriptions', href: '#/billing' },
    { label: 'settings', href: '#/settings' },
  ];
  if (isArchitect) {
    links.push({ label: 'invite codes', href: '#/invites', highlight: true });
  }

  // Close contract: `close()` triggers onClose (NavBar-level: retract panel,
  // reset aria, clear state). It is idempotent — the second call no-ops — so
  // NavBar and the drawer can both call it without recursion.
  let closed = false;
  const outsideClick = (e) => {
    if (closed) return;
    if (container && !container.contains(e.target)) close();
  };
  const escKey = (e) => {
    if (closed) return;
    if (e.key === 'Escape') close();
  };
  // Route changes (hashchange) must retract the panel even if the NavBar
  // re-render loses its drawer references — the root lives in document.body.
  const onHashChange = () => close();

  container.addEventListener('mousedown', outsideClick);
  document.addEventListener('keydown', escKey);
  window.addEventListener('hashchange', onHashChange);

  const close = () => {
    if (closed) return;
    closed = true;
    container.removeEventListener('mousedown', outsideClick);
    document.removeEventListener('keydown', escKey);
    window.removeEventListener('hashchange', onHashChange);
    onClose();
  };

  const header = user ? `@${user.username}` : '@';

  const drawer = h('div', { id: 'rightPanel', className: 'right-panel' + (open ? ' open' : ''), role: 'dialog', 'aria-label': 'account switcher' }, [
    h('div', { className: 'tp-platform-tabs' }, tabs),
    h('div', { className: 'right-panel-header' }, [header]),
    h('div', { className: 'switch-account-section' }, ['switch account']),
    ...(accountRows || []),
    h('div', { className: 'right-panel-add', role: 'button', tabindex: '0', onClick: () => { window.location.href = '#/login?addaccount=1'; } }, [
      'add account',
      h('span', { style: { marginLeft: 'auto' } }, ['+']),
    ]),
    h('div', { className: 'right-panel-divider' }),
    ...links.map((link) => h('a', {
      className: 'right-panel-link' + (link.highlight ? ' highlight' : ''),
      href: link.href,
      onClick: close,
    }, [link.label])),
    h('div', { className: 'right-panel-divider' }),
    h('div', { className: 'right-panel-logout', role: 'button', onClick: () => handleLogout(accounts, user) }, ['log out']),
    h('div', { className: 'right-panel-logout right-panel-logout--subtle', role: 'button', onClick: handleSignOutAll }, ['sign out all devices']),
  ]);

  container.textContent = '';
  container.appendChild(drawer);

  // Keep the drawer state current after a token swap.
  container._close = close;
}

