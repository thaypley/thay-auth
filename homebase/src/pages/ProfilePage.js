/**
 * Profile edit page — update username, characteristics, avatar.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

const PRONOUNS = ['they/them', 'she/her', 'he/him', 'xe/xem', 'ze/zir', 'any', 'ask'];
const ASTRAL_SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];

export default async function ProfilePage(container) {
  const token = auth.getToken();
  if (!token) {
    navigate('/login', true);
    return;
  }

  let profile;
  try {
    profile = await auth.getProfile();
  } catch {
    navigate('/login', true);
    return;
  }

  const chars = profile.characteristics || {};

  const usernameInput = h('input', {
    className: 'input',
    type: 'text',
    value: profile.username || '',
    id: 'edit-username',
    autocomplete: 'off',
  });
  const usernameHint = h('p', { className: 'input-hint' });

  const bioInput = h('textarea', {
    className: 'input',
    placeholder: 'bio (280 chars)',
    id: 'edit-bio',
    style: { resize: 'vertical', minHeight: '80px', fontFamily: 'var(--font-body)' },
    maxlength: 280,
  });
  if (chars.bio) bioInput.value = chars.bio;

  const pronounPills = PRONOUNS.map(p => {
    const pill = h('button', {
      className: 'pill' + (chars.pronouns === p ? ' selected' : ''),
      type: 'button',
      dataset: { value: p },
      onClick: () => {
        pronounPills.forEach(pp => pp.classList.remove('selected'));
        pill.classList.add('selected');
      },
    }, [p]);
    return pill;
  });

  const signPills = ASTRAL_SIGNS.map(s => {
    const pill = h('button', {
      className: 'pill' + (chars.astral_sign === s ? ' selected' : ''),
      type: 'button',
      dataset: { value: s },
      onClick: () => {
        signPills.forEach(sp => sp.classList.remove('selected'));
        pill.classList.add('selected');
      },
    }, [s.charAt(0).toUpperCase() + s.slice(1)]);
    return pill;
  });
  signPills.push(h('button', {
    className: 'pill' + (!chars.astral_sign ? ' selected' : ''),
    type: 'button',
    onClick: () => {
      signPills.forEach(sp => sp.classList.remove('selected'));
    },
  }, ['none']));

  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' } });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const username = usernameInput.value.trim();

      if (!username) {
        errorEl.textContent = 'Username is required';
        return;
      }

      // Attempt username change if different
      if (username !== profile.username) {
        try {
          const result = await auth.changeUsername(username);
          profile = { ...profile, ...result.user };
        } catch (err) {
          errorEl.textContent = err.message || 'Failed to update username';
          return;
        }
      }

      // Update characteristics
      const selectedPronoun = pronounPills.find(p => p.classList.contains('selected'));
      const selectedSign = signPills.find(p => p.classList.contains('selected'));
      const charsUpdate = {};
      if (bioInput.value.trim()) charsUpdate.bio = bioInput.value.trim();
      if (selectedPronoun) charsUpdate.pronouns = selectedPronoun.dataset.value;
      if (selectedSign && selectedSign.dataset.value) charsUpdate.astral_sign = selectedSign.dataset.value;

      try {
        await auth.updateProfile({ characteristics: charsUpdate });
        const updatedProfile = await auth.getProfile();
        setState({ profile: updatedProfile });
        toast('Profile updated!', 'success');
        navigate('/');
      } catch (err) {
        errorEl.textContent = err.message || 'Failed to update profile';
      }
    },
  }, [
    h('h2', {}, ['edit profile']),
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label', htmlFor: 'edit-username' }, ['username']),
      usernameInput,
      usernameHint,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'edit-bio' }, ['bio']),
      bioInput,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label' }, ['pronouns']),
      h('div', { className: 'pill-group' }, pronounPills),
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label' }, ['astral sign']),
      h('div', { className: 'pill-group' }, signPills),
    ]),
    h('div', { className: 'form-actions', style: { marginTop: '24px' } }, [
      h('button', { className: 'btn btn-primary btn-lg', type: 'submit' }, ['save']),
      errorEl,
    ]),
    h('div', { className: 'form-footer' }, [
      h('a', { onClick: () => navigate('/') }, ['back to dashboard']),
    ]),
  ]);

  const card = h('div', { className: 'form-card', style: { maxWidth: '520px' } }, [form]);

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo', style: { fontSize: '1.5rem' } }, ['thay']),
    card,
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);
  pageTransition(page);
}