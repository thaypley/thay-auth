/**
 * Navigation bar component.
 */
import { h } from '../utils/dom.js';
import auth, { hasToken } from '../sdk.js';
import { navigate } from '../router.js';
import { setState, getState } from '../store.js';

export function NavBar() {
  const isLoggedIn = hasToken();
  const state = getState();
  const user = state.user || state.profile;

  const brand = h('div', { className: 'navbar-brand', onClick: () => navigate('/') }, ['thay']);

  const downloadsLink = h('button', {
    className: 'btn btn-ghost btn-sm',
    onClick: () => navigate('/downloads'),
  }, ['downloads']);

  const end = h('div', { className: 'navbar-end' });
  end.appendChild(downloadsLink);

  if (isLoggedIn && user) {
    const avatar = user.avatar
      ? h('img', { className: 'navbar-avatar', src: user.avatar, alt: '' })
      : h('div', {
          className: 'navbar-avatar',
          style: {
            background: 'var(--gradient-pink)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: '14px',
            fontWeight: '700',
            fontFamily: 'var(--font-mono)',
          },
        }, [user.username ? user.username[0].toUpperCase() : '?']);

    const username = h('span', { className: 'navbar-username' }, [`@${user.username}`]);

    const userMenu = h('div', {
      className: 'navbar-user',
      onClick: () => navigate('/profile'),
    }, [avatar, username]);

    const logoutBtn = h('button', {
      className: 'btn btn-ghost btn-sm',
      onClick: async () => {
        await auth.logout();
        setState({ user: null, profile: null, apps: [], devices: [] });
        navigate('/login', true);
      },
    }, ['log out']);

    end.appendChild(userMenu);
    end.appendChild(logoutBtn);
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

export function AppShell(pageContent) {
  const nav = NavBar();
  const main = h('main', {}, [pageContent]);
  return h('div', {}, [nav, main]);
}