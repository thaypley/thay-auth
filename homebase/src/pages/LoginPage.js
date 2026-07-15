/**
 * Login page — embedded auth form.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { setState } from '../store.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function LoginPage(container) {
  const email = h('input', {
    className: 'input',
    type: 'email',
    placeholder: 'email',
    id: 'login-email',
    autocomplete: 'email',
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
  }, ['log in']);

  const errorEl = h('p', { className: 'input-hint-error', id: 'login-error', style: { textAlign: 'center', marginTop: '8px' } });

  const form = h('form', {
    id: 'login-form',
    onsubmit: async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.textContent = '...';
      errorEl.textContent = '';

      try {
        const result = await auth.login(email.value, password.value);
        setState({ user: result.user, profile: { ...result.user, characteristics: {} } });
        toast('Welcome back!', 'success');
        navigate('/');
      } catch (err) {
        errorEl.textContent = err.message || 'Login failed';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'log in';
      }
    },
  }, [
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'login-email' }, ['email']),
      email,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'login-password' }, ['password']),
      password,
    ]),
    h('div', { className: 'form-actions' }, [submitBtn, errorEl]),
    h('div', { className: 'form-footer' }, [
      "don't have an account? ",
      h('a', { onClick: () => navigate('/signup') }, ['sign up']),
      ' · ',
      h('a', { onClick: () => navigate('/waitlist') }, ['join waitlist']),
    ]),
  ]);

  const card = h('div', { className: 'form-card' }, [
    h('h2', {}, ['welcome back']),
    h('p', { className: 'subtitle' }, ['log in to your thay account']),
    form,
  ]);

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);

  // Focus email input
  setTimeout(() => email.focus(), 100);

  // Animation
  pageTransition(page);
}