/**
 * Waitlist page — for users without invite codes.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
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

  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' }, 'aria-live': 'polite' });

  const card = h('div', { className: 'form-card' });

  function renderForm() {
    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const email = emailInput.value.trim();
        if (!email) { errorEl.textContent = 'email is required'; return; }
        errorEl.textContent = '';
        submitBtn.disabled = true;
        submitBtn.textContent = '...';

        try {
          const result = await auth.joinWaitlist(email, noteInput.value.trim());
          renderConfirmation(result.message);
        } catch (err) {
          errorEl.textContent = err.message || 'could not join the waitlist — try again';
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
        h('button', { type: 'button', className: 'link-btn', onClick: () => navigate('/signup') }, ['sign up']),
      ]),
    ]);

    mount(card, form);
  }

  // Persistent confirmation instead of a 4s toast + immediate redirect to a
  // login screen the visitor can't use yet — the toast could easily be
  // missed and there was nothing on /login to remind them they'd just
  // joined the waitlist.
  function renderConfirmation(message) {
    mount(card, h('div', { style: { textAlign: 'center' } }, [
      h('h2', {}, ["you're on the list"]),
      h('p', { className: 'subtitle' }, [message || "we'll email (you) when a spot opens up"]),
      h('button', {
        className: 'btn btn-primary btn-lg',
        onClick: () => navigate('/login'),
      }, ['back to log in']),
    ]));
  }

  renderForm();

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);
  setTimeout(() => emailInput.focus(), 100);
  pageTransition(page);
}