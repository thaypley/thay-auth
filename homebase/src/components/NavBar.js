/**
 * Navigation bar component.
 */
import { h } from '../utils/dom.js';
import auth, { hasToken } from '../sdk.js';
import { navigate } from '../router.js';
import { setState, getState } from '../store.js';
import { VIBES, applyVibe, getVibeColor, loadVibe } from '../utils/vibes.js';

export function NavBar() {
  const isLoggedIn = hasToken();
  const state = getState();
  const user = state.user || state.profile;
  const current = loadVibe();

  const brand = h('button', { type: 'button', className: 'navbar-brand', onClick: () => navigate('/') }, ['thay']);

  const downloadsLink = h('button', {
    className: 'btn btn-ghost btn-sm',
    onClick: () => navigate('/downloads'),
  }, ['downloads']);

  const vibeDots = VIBES.map((v) => h('button', {
    type: 'button',
    className: `vibe-dot${v === current ? ' active' : ''}`,
    style: { background: getVibeColor(v) },
    title: v,
    'aria-label': `theme: ${v}`,
    onClick: (e) => {
      applyVibe(v);
      e.currentTarget.parentElement.querySelectorAll('.vibe-dot').forEach((dot) => dot.classList.remove('active'));
      e.currentTarget.classList.add('active');
    },
  }));
  const vibeSwitcher = h('div', { className: 'vibe-switcher' }, vibeDots);

  const end = h('div', { className: 'navbar-end' });
  end.appendChild(downloadsLink);
  end.appendChild(vibeSwitcher);

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

    const userMenu = h('button', {
      type: 'button',
      className: 'navbar-user',
      onClick: () => navigate('/profile'),
      'aria-label': 'go to your profile',
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