/**
 * Reset password — completes the flow from the emailed link.
 * PocketBase's reset email points at a URL containing ?token=... ; read
 * it via the router's getQueryParams() helper.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate, getQueryParams } from '../router.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function ResetPasswordPage(container) {
  const token = getQueryParams().get('token');

  const passwordInput = h('input', {
    className: 'input',
    type: 'password',
    placeholder: 'new password',
    id: 'reset-password',
    autocomplete: 'new-password',
    required: true,
  });

  const confirmInput = h('input', {
    className: 'input',
    type: 'password',
    placeholder: 'confirm new password',
    id: 'reset-password-confirm',
    autocomplete: 'new-password',
    required: true,
  });

  const submitBtn = h('button', {
    className: 'btn btn-primary btn-lg',
    type: 'submit',
  }, ['reset password']);

  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' } });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!token) { errorEl.textContent = 'Missing or invalid reset link'; return; }
      const password = passwordInput.value;
      const passwordConfirm = confirmInput.value;
      if (password !== passwordConfirm) { errorEl.textContent = 'Passwords do not match'; return; }
      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      try {
        await auth.confirmPasswordReset(token, password, passwordConfirm);
        toast('Password reset — log in with your new password', 'success');
        navigate('/login');
      } catch (err) {
        errorEl.textContent = err.message || 'Reset link is invalid or expired';
        submitBtn.disabled = false;
        submitBtn.textContent = 'reset password';
      }
    },
  }, [
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'reset-password' }, ['new password']),
      passwordInput,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'reset-password-confirm' }, ['confirm password']),
      confirmInput,
    ]),
    h('div', { className: 'form-actions' }, [submitBtn, errorEl]),
  ]);

  const card = h('div', { className: 'form-card' }, [
    h('h2', {}, ['new password']),
    !token
      ? h('p', { className: 'input-hint-error', style: { textAlign: 'center' } }, ['This reset link is missing or invalid. Request a new one from the login page.'])
      : form,
  ]);

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);
  if (token) setTimeout(() => passwordInput.focus(), 100);
  pageTransition(page);
}
