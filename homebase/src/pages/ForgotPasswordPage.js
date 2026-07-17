/**
 * Forgot password — requests a reset email.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function ForgotPasswordPage(container) {
  const emailInput = h('input', {
    className: 'input',
    type: 'email',
    placeholder: 'your email',
    id: 'forgot-email',
    autocomplete: 'email',
    required: true,
  });

  const submitBtn = h('button', {
    className: 'btn btn-primary btn-lg',
    type: 'submit',
  }, ['send reset link']);

  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' } });
  const successEl = h('p', { className: 'input-hint', style: { textAlign: 'center' } });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) { errorEl.textContent = 'Email is required'; return; }
      errorEl.textContent = '';
      successEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      try {
        await auth.requestPasswordReset(email);
        successEl.textContent = 'If an account exists with this email, a reset link is on its way.';
        toast('Check your inbox', 'success');
      } catch (err) {
        errorEl.textContent = err.message || 'Something went wrong';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'send reset link';
      }
    },
  }, [
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'forgot-email' }, ['email']),
      emailInput,
    ]),
    h('div', { className: 'form-actions' }, [submitBtn, errorEl, successEl]),
    h('div', { className: 'form-footer' }, [
      h('a', { onClick: () => navigate('/login') }, ['back to log in']),
    ]),
  ]);

  const card = h('div', { className: 'form-card' }, [
    h('h2', {}, ['reset password']),
    h('p', { className: 'subtitle' }, ["we'll email you a link"]),
    form,
  ]);

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);
  setTimeout(() => emailInput.focus(), 100);
  pageTransition(page);
}
