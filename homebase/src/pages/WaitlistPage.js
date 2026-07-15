/**
 * Waitlist page — for users without invite codes.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function WaitlistPage(container) {
  const emailInput = h('input', {
    className: 'input',
    type: 'email',
    placeholder: 'your email',
    id: 'waitlist-email',
    autocomplete: 'email',
    required: true,
  });

  const noteInput = h('input', {
    className: 'input',
    type: 'text',
    placeholder: 'anything to add? (optional)',
    id: 'waitlist-note',
  });

  const submitBtn = h('button', {
    className: 'btn btn-primary btn-lg',
    type: 'submit',
  }, ['join waitlist']);

  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' } });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      const email = emailInput.value.trim();
      if (!email) { errorEl.textContent = 'Email is required'; return; }
      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '...';

      try {
        const result = await auth.joinWaitlist(email, noteInput.value.trim());
        toast(result.message, 'success');
        navigate('/login');
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to join waitlist';
        submitBtn.disabled = false;
        submitBtn.textContent = 'join waitlist';
      }
    },
  }, [
    h('h2', {}, ['join waitlist']),
    h('p', { className: 'subtitle' }, ['no invite code yet? get in line']),
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'waitlist-email' }, ['email']),
      emailInput,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'waitlist-note' }, ['note (optional)']),
      noteInput,
    ]),
    h('div', { className: 'form-actions' }, [submitBtn, errorEl]),
    h('div', { className: 'form-footer' }, [
      'have an invite code? ',
      h('a', { onClick: () => navigate('/signup') }, ['sign up']),
    ]),
  ]);

  const card = h('div', { className: 'form-card' }, [form]);

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);
  setTimeout(() => emailInput.focus(), 100);
  pageTransition(page);
}