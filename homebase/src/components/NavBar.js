/**
 * Navigation bar component.
 *
 * The vibe theme switcher no longer lives in the header — themes are
 * managed from /settings (per the squared-edge redesign). In its place:
 * an avatar tile that opens the account switcher right panel (pley/fam/werk
 * platform tabs + multi-account management ported from thaypley.com).
 */
import { h } from '../utils/dom.js';
import { hasToken } from '../sdk.js';
import { navigate } from '../router.js';
import { setState, getState } from '../store.js';
import { mountAccountDrawer } from './AccountDrawer.js';

export function NavBar() {
  const isLoggedIn = hasToken();
  const state = getState();
  const user = state.user || state.profile;

  // Account drawer state (mounted lazily on first open).
  let drawerMount = null;
  let drawerOpen = false;
  // Assigned inside the logged-in branch below; referenced by openDrawer,
  // so it must live at NavBar function scope, not block scope.
  let userMenu = null;

  const brand = h('button', { type: 'button', className: 'navbar-brand', onClick: () => navigate('/') }, ['thay']);

  const downloadsLink = h('button', {
    className: 'btn btn-ghost btn-sm',
    onClick: () => navigate('/downloads'),
  }, ['downloads']);

  const platformsLink = h('button', {
    className: 'btn btn-ghost btn-sm',
    onClick: () => navigate('/platforms'),
  }, ['platforms']);

  // Invite minting is architect-only (the API enforces this too — the
  // menu item is just the surface). Normal users keep a clean hub.
  const isArchitect = !!(state.user?.isArchitect || state.profile?.isArchitect);
  let invitesLink = null;
  if (isArchitect) {
    invitesLink = h('button', {
      className: 'btn btn-ghost btn-sm',
      onClick: () => navigate('/invites'),
    }, ['invites']);
  }

  const end = h('div', { className: 'navbar-end' });
  end.appendChild(platformsLink);
  end.appendChild(downloadsLink);
  if (invitesLink) end.appendChild(invitesLink);

  // Drawer helpers — created here but only reachable with userMenu defined.
  // The drawer's onClose is the NavBar-level close; the drawer root's own
  // `_close` re-renders it closed. A flag avoids double-closing.
  function closeDrawer() {
    if (!drawerOpen) return;
    drawerOpen = false;
    const root = drawerMount;
    if (!root) return;
    if (root._close) {
      const fn = root._close;
      root._close = null;
      fn();
    }
    // Visually retract the slide-in panel (close() only unwires listeners).
    const panel = root.querySelector('.right-panel');
    if (panel) panel.classList.remove('open');
    if (root._toggle) {
      root._toggle.setAttribute('aria-expanded', 'false');
    }
  }

  function openDrawer() {
    if (drawerOpen) {
      closeDrawer();
      return;
    }
    if (!drawerMount) {
      drawerMount = document.createElement('div');
      drawerMount.id = 'account-drawer-root';
      document.body.appendChild(drawerMount);
    }
    drawerOpen = true;
    mountAccountDrawer(drawerMount, { open: true, onClose: closeDrawer });
    if (drawerMount && userMenu) {
      drawerMount._toggle = userMenu;
      userMenu.setAttribute('aria-expanded', 'true');
    }
  }

  if (isLoggedIn && user) {
    const avatar = user.avatar
      ? h('img', { className: 'navbar-avatar', src: user.avatar, alt: `${user.username || 'your'} avatar` })
      : h('div', {
          className: 'navbar-avatar',
          style: {
            background: 'var(--gradient-pink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--vibe-primary-text)',
            fontSize: '14px',
            fontWeight: '700',
            fontFamily: 'var(--font-mono)',
          },
        }, [(user.username || '?')[0].toUpperCase()]);

    const username = h('span', { className: 'navbar-username' }, [`@${user.username || 'you'}`]);

    // The avatar tile opens the ACCOUNT SWITCHER (pley/fam/werk + account
    // management) instead of a plain profile link, matching thaypley.com.
    userMenu = h('button', {
      type: 'button',
      className: 'navbar-user',
      onClick: openDrawer,
      'aria-label': 'open account switcher',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
    }, [avatar, username]);

    end.appendChild(userMenu);
  } else {
    const loginBtn = h('button', {
      className: 'btn btn-ghost btn-sm',
      onClick: () => navigate('/login'),
    }, ['log in']);

    const signupBtn = h('button', {
      className: 'btn btn-primary btn-sm',
      onClick: () => navigate('/signup'),
    }, ['sign up']);

    end.appendChild(loginBtn);
    end.appendChild(signupBtn);
  }

  return h('nav', { className: 'navbar' }, [brand, end]);
}
