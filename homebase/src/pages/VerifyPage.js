/**
 * Email verification page — sends a 6-digit code, verifies it.
 * Reached after signup, or after a login blocked by EMAIL_NOT_VERIFIED.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { setState } from '../store.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

const RESEND_COOLDOWN_S = 30;

export default async function VerifyPage(container) {
  if (!auth.getToken()) {
    navigate('/login', true);
    return;
  }

  const codeInput = h('input', {
    className: 'input',
    type: 'text',
    inputmode: 'numeric',
    pattern: '[0-9]{6}',
    maxlength: 6,
    placeholder: '6-digit code',
    id: 'verify-code',
    autocomplete: 'one-time-code',
    required: true,
    style: { textAlign: 'center', letterSpacing: '8px', fontSize: '1.25rem' },
  });

  const statusEl = h('p', { className: 'input-hint', style: { textAlign: 'center' }, 'aria-live': 'polite' });
  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center', marginTop: '8px' }, 'aria-live': 'polite' });
  const submitBtn = h('button', { className: 'btn btn-primary btn-lg', type: 'submit' }, ['verify']);

  let cooldown = 0;
  let cooldownTimer = null;
  const resendLink = h('button', {
    type: 'button',
    className: 'link-btn',
    onClick: async () => {
      if (cooldown > 0) return;
      await sendCode();
    },
  }, ['resend code']);

  function startCooldown() {
    cooldown = RESEND_COOLDOWN_S;
    resendLink.disabled = true;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      cooldown--;
      resendLink.textContent = cooldown > 0 ? `resend code (${cooldown}s)` : 'resend code';
      if (cooldown <= 0) {
        clearInterval(cooldownTimer);
        resendLink.disabled = false;
      }
    }, 1000);
  }

  async function sendCode() {
    errorEl.textContent = '';
    statusEl.textContent = 'sending code…';
    try {
      await auth.sendVerificationEmail();
      statusEl.textContent = 'we emailed (you) a 6-digit code';
      startCooldown();
    } catch (err) {
      statusEl.textContent = '';
      errorEl.textContent = err.message || 'could not send the code — try resend';
    }
  }

  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      const code = codeInput.value.trim();
      if (!/^\d{6}$/.test(code)) {
        errorEl.textContent = 'enter the 6-digit code from your email';
        return;
      }
      errorEl.textContent = '';
      submitBtn.disabled = true;
      submitBtn.textContent = '...';
      try {
        await auth.verifyEmail(code);
        // Drop the cached (unverified) profile so the dashboard refetches
        setState({ profile: null });
        toast('email verified — welcome to thay!', 'success');
        navigate('/');
      } catch (err) {
        errorEl.textContent = err.message || 'verification failed — try again';
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = 'verify';
      }
    },
  }, [
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'verify-code' }, ['verification code']),
      codeInput,
      statusEl,
    ]),
    h('div', { className: 'form-actions' }, [submitBtn, errorEl]),
    h('div', { className: 'form-footer' }, [
      resendLink,
      ' · ',
      h('button', {
        type: 'button',
        className: 'link-btn',
        onClick: async () => {
          await auth.logout();
          const { clearToken } = await import('../sdk.js');
          clearToken();
          navigate('/login');
        },
      }, ['log out']),
    ]),
  ]);

  const card = h('div', { className: 'form-card' }, [
    h('h2', {}, ['check your email']),
    h('p', { className: 'subtitle' }, ['one last step — confirm it’s really (you)']),
    form,
  ]);

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);

  setTimeout(() => codeInput.focus(), 100);
  pageTransition(page);

  // Fire the first code automatically on arrival
  sendCode();
}
