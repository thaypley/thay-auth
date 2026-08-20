/**
 * Login page — embedded auth form.
 *
 * Two modes:
 *   - plain login: the normal sign-in flow.
 *   - add-account (hash `?addaccount=1`, launched from the AccountDrawer):
 *     logged-in users can attach a second identity to this device WITHOUT
 *     losing the active session. The current account's token is captured into
 *     the account list first, then the new login lands as an additional slot.
 */
import { h, mount } from '../utils/dom.js';
import auth, { saveToken } from '../sdk.js';
import { navigate, getQueryParams } from '../router.js';
import { getState, setState } from '../store.js';
import { toast } from '../utils/toast.js';
import { ensureStoredAccount, saveAccount } from '../utils/accounts.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function LoginPage(container) {
  const params = getQueryParams();
  const isAddAccount = params.get('addaccount') === '1';
  const currentUser = getState().user || getState().profile || null;

  const identity = h('input', {
    className: 'input',
    type: 'text',
    placeholder: 'username or email',
    id: 'login-identity',
    autocomplete: 'username',
    autocapitalize: 'none',
    spellcheck: 'false',
    required: true,
  });

  const password = h('input', {
    className: 'input',
    type: 'password',
    placeholder: 'password',
    id: 'login-password',
    autocomplete: 'current-password',
    required: true,
  });

  const submitBtn = h('button', {
    className: 'btn btn-primary btn-lg',
    type: 'submit',
    id: 'login-submit',
  }, [isAddAccount ? 'add account' : 'log in']);

  const errorEl = h('p', { className: 'input-hint-error', id: 'login-error', style: { textAlign: 'center', marginTop: '8px' }, 'aria-live': 'polite' });

  // Banner shown only in add-account mode while a session is already active.
  const addBanner = isAddAccount && currentUser
    ? h('div', { className: 'form-card form-card--tight add-account-banner' }, [
        h('div', { className: 'add-account-banner-title' }, [`adding an account to @${currentUser.username}`]),
        h('p', { className: 'input-hint' }, [`log in with the account you want to add — switch back to @${currentUser.username} anytime from the avatar drawer.`]),
      ])
    : null;

  // Build footer links flat — h() only accepts strings and Nodes as children,
  // so a nested array (from a ternary) would silently drop the sign-up link.
  const footerLinks = [
    ...(isAddAccount ? [] : [
      "don't have an account? ",
      h('button', { type: 'button', className: 'link-btn', onClick: () => navigate('/signup') }, ['sign up']),
      ' · ',
    ]),
    h('button', { type: 'button', className: 'link-btn', onClick: () => navigate('/waitlist') }, ['join waitlist']),
  ];

  const form = h('form', {
    id: 'login-form',
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = '...';
      errorEl.textContent = '';

      // Preserve the ACTIVE account before minting a new session — the
      // new login must never clobber the identity we're adding from.
      const oldUser = currentUser;
      const oldToken = auth.getToken();

      try {
        const result = await auth.login(identity.value, password.value);
        if (isAddAccount) {
          if (oldUser) ensureStoredAccount(oldUser, oldToken);
          saveAccount({
            id: result.user.id,
            username: result.user.username,
            avatar: result.user.avatar || '',
            token: result.token,
          });
          setState({ user: result.user, profile: { ...result.user, characteristics: {} } });
          toast(`account added — switch back to @${oldUser ? oldUser.username : 'your account'} anytime`, 'success');
          navigate('/');
          return;
        }
        setState({ user: result.user, profile: { ...result.user, characteristics: {} } });
        toast('welcome back, (you)!', 'success');
        navigate('/');
      } catch (err) {
        if (err.code === 'EMAIL_NOT_VERIFIED' && err.data?.token) {
          // Password was right — park the token and route into verification.
          // In add-account mode, keep BOTH accounts in the slots: the old one
          // first (so its active session survives the verify token swap), and
          // the new unverified one too (so once verified, the drawer lists it).
          if (isAddAccount && oldUser) ensureStoredAccount(oldUser, oldToken);
          if (isAddAccount && err.data.user) {
            saveAccount({
              id: err.data.user.id,
              username: err.data.user.username,
              avatar: err.data.user.avatar || '',
              token: err.data.token,
            });
          }
          saveToken(err.data.token);
          setState({ user: err.data.user });
          toast(isAddAccount ? 'verify the new account to finish adding it' : 'one more step — verify your email', 'info');
          navigate('/verify');
          return;
        }
        errorEl.textContent = err.message || 'log in failed — check your details and try again';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = isAddAccount ? 'add account' : 'log in';
      }
    },
  }, [
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'login-identity' }, ['username or email']),
      identity,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'login-password' }, ['password']),
      password,
    ]),
    h('div', { className: 'form-actions' }, [submitBtn, errorEl]),
    h('div', { className: 'form-footer' }, [
      h('button', { type: 'button', className: 'link-btn', onClick: () => navigate('/forgot-password') }, ['forgot password?']),
    ]),
    h('div', { className: 'form-footer' }, footerLinks),
  ]);

  const card = h('div', { className: 'form-card' }, [
    h('h2', {}, [isAddAccount ? 'add an account' : 'welcome back']),
    h('p', { className: 'subtitle' }, [isAddAccount ? 'add another identity to this device' : 'log in to your thay account']),
    ...(addBanner ? [addBanner] : []),
    form,
  ]);

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    h('p', { className: 'auth-hero' }, ['one identity for the whole universe of making — music, video, design, and more.']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);

  // Focus identity input
  setTimeout(() => identity.focus(), 100);

  // Animation
  pageTransition(page);
}
