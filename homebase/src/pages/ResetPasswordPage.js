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
  const passwordHint = h('p', { className: 'input-hint' }, ['at least 8 characters']);

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

  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' }, 'aria-live': 'polite' });

  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      if (!token) { errorEl.textContent = 'missing or invalid reset link'; return; }
      const password = passwordInput.value;
      const passwordConfirm = confirmInput.value;
      if (password.length < 8) { errorEl.textContent = 'password needs to be at least 8 characters'; return; }
      if (password !== passwordConfirm) { errorEl.textContent = "passwords don't match"; return; }
      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      try {
        await auth.confirmPasswordReset(token, password, passwordConfirm);
        toast('password reset — log in with your new password', 'success');
        navigate('/login');
      } catch (err) {
        errorEl.textContent = err.message || 'that reset link is invalid or expired';
        submitBtn.disabled = false;
        submitBtn.textContent = 'reset password';
      }
    },
  }, [
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'reset-password' }, ['new password']),
      passwordInput,
      passwordHint,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'reset-password-confirm' }, ['confirm password']),
      confirmInput,
    ]),
    h('div', { className: 'form-actions' }, [submitBtn, errorEl]),
    h('div', { className: 'form-footer' }, [
      "link expired or not working? ",
      h('button', { type: 'button', className: 'link-btn', onClick: () => navigate('/forgot-password') }, ['request a new one']),
    ]),
  ]);

  const card = h('div', { className: 'form-card' }, [
    h('h2', {}, ['new password']),
    !token
      ? h('div', { style: { textAlign: 'center' } }, [
        h('p', { className: 'input-hint-error' }, ['this reset link is missing or invalid — request a new one below.']),
        h('button', {
          className: 'btn btn-primary btn-lg',
          style: { marginTop: 'var(--space-lg)' },
          onClick: () => navigate('/forgot-password'),
        }, ['request a new link']),
      ])
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
