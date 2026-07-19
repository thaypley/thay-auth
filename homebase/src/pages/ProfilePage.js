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
  } catch (err) {
    if (err.status === 401) {
      const { clearToken } = await import('../sdk.js');
      clearToken();
      navigate('/login', true);
      return;
    }
    // A transient/server error is not the same as "your session expired" —
    // don't silently boot an actively logged-in user back to login.
    const errorCard = h('div', { className: 'form-card', style: { textAlign: 'center' } }, [
      h('h2', {}, ['something broke']),
      h('p', { className: 'subtitle' }, ["couldn't load your profile — the server had an issue"]),
      h('button', { className: 'btn btn-primary', onClick: () => location.reload() }, ['retry']),
    ]);
    mount(container, h('div', {}, [NavBar(), h('div', { className: 'auth-page' }, [errorCard])]));
    return;
  }

  const chars = profile.characteristics || {};

  // Avatar
  let avatarFile = null;
  const avatarPreview = profile.avatar
    ? h('div', { style: { width: '72px', height: '72px', margin: '0 auto', borderRadius: '50%', overflow: 'hidden' } }, [
      h('img', { src: profile.avatar, alt: `${profile.username || 'your'} avatar`, style: { width: '100%', height: '100%', objectFit: 'cover' } }),
    ])
    : h('div', {
      className: 'profile-avatar-placeholder',
      style: { width: '72px', height: '72px', margin: '0 auto', fontSize: '1.5rem' },
    }, [(profile.username || '?')[0].toUpperCase()]);
  const avatarFileInput = h('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp,image/gif',
    style: { display: 'none' },
  });
  const avatarHint = h('p', { className: 'input-hint', style: { textAlign: 'center' } }, ['click to change']);
  // programmatic .click() bubbles back to the picker's onClick — don't loop
  avatarFileInput.addEventListener('click', (e) => e.stopPropagation());
  avatarFileInput.addEventListener('change', () => {
    const file = avatarFileInput.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      avatarHint.className = 'input-hint-error';
      avatarHint.textContent = 'image too large (max 4mb)';
      return;
    }
    avatarFile = file;
    avatarHint.className = 'input-hint';
    avatarHint.textContent = file.name;
    const url = URL.createObjectURL(file);
    avatarPreview.textContent = '';
    avatarPreview.style.borderRadius = '50%';
    avatarPreview.style.overflow = 'hidden';
    avatarPreview.appendChild(h('img', {
      src: url, alt: '',
      style: { width: '100%', height: '100%', objectFit: 'cover' },
    }));
  });
  const avatarPicker = h('div', {
    style: { textAlign: 'center', cursor: 'pointer' },
    tabindex: '0',
    role: 'button',
    'aria-label': 'change profile picture',
    onClick: () => avatarFileInput.click(),
    onKeydown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        avatarFileInput.click();
      }
    },
  }, [avatarPreview, avatarFileInput, avatarHint]);

  const usernameInput = h('input', {
    className: 'input',
    type: 'text',
    value: profile.username || '',
    id: 'edit-username',
    autocomplete: 'off',
  });
  const usernameHint = h('p', { className: 'input-hint', 'aria-live': 'polite' });
  let usernameCheckTimer = null;
  usernameInput.addEventListener('input', () => {
    clearTimeout(usernameCheckTimer);
    const val = usernameInput.value.trim();
    if (val === profile.username) {
      usernameHint.className = 'input-hint';
      usernameHint.textContent = '';
      return;
    }
    if (val.length < 3) {
      usernameHint.className = 'input-hint';
      usernameHint.textContent = 'min 3 characters, letters, numbers, underscores';
      return;
    }
    usernameHint.textContent = 'checking...';
    usernameCheckTimer = setTimeout(async () => {
      try {
        const result = await auth.checkUsername(val);
        if (result.available) {
          usernameHint.className = 'input-hint-success';
          usernameHint.textContent = '✓ available';
        } else {
          usernameHint.className = 'input-hint-error';
          usernameHint.textContent = result.error || 'username taken';
        }
      } catch {
        usernameHint.textContent = 'could not check';
      }
    }, 400);
  });

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
      'aria-pressed': chars.pronouns === p ? 'true' : 'false',
      onClick: () => {
        pronounPills.forEach(pp => { pp.classList.remove('selected'); pp.setAttribute('aria-pressed', 'false'); });
        pill.classList.add('selected');
        pill.setAttribute('aria-pressed', 'true');
      },
    }, [p]);
    return pill;
  });

  const signPills = ASTRAL_SIGNS.map(s => {
    const pill = h('button', {
      className: 'pill' + (chars.astral_sign === s ? ' selected' : ''),
      type: 'button',
      dataset: { value: s },
      'aria-pressed': chars.astral_sign === s ? 'true' : 'false',
      onClick: () => {
        signPills.forEach(sp => { sp.classList.remove('selected'); sp.setAttribute('aria-pressed', 'false'); });
        pill.classList.add('selected');
        pill.setAttribute('aria-pressed', 'true');
      },
    }, [s.charAt(0).toUpperCase() + s.slice(1)]);
    return pill;
  });
  // "none" must be able to select itself (it couldn't before — clicking it
  // just deselected everything with no visible feedback and no way to
  // actually clear an existing sign, since the submit handler only sent
  // astral_sign when a pill's dataset.value was truthy).
  const noneSignPill = h('button', {
    className: 'pill' + (!chars.astral_sign ? ' selected' : ''),
    type: 'button',
    dataset: { value: '' },
    'aria-pressed': !chars.astral_sign ? 'true' : 'false',
    onClick: () => {
      signPills.forEach(sp => { sp.classList.remove('selected'); sp.setAttribute('aria-pressed', 'false'); });
      noneSignPill.classList.add('selected');
      noneSignPill.setAttribute('aria-pressed', 'true');
    },
  }, ['none']);
  signPills.push(noneSignPill);

  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' }, 'aria-live': 'polite' });

  async function handleAuthError(err) {
    if (err.status !== 401) return false;
    toast('your session expired — log back in to save changes', 'error');
    const { clearToken } = await import('../sdk.js');
    clearToken();
    navigate('/login', true);
    return true;
  }

  const form = h('form', {
    novalidate: true,
    onsubmit: async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const username = usernameInput.value.trim();

      if (!username) {
        errorEl.textContent = 'username is required';
        return;
      }

      // Attempt username change if different
      if (username !== profile.username) {
        try {
          const result = await auth.changeUsername(username);
          profile = { ...profile, ...result.user };
        } catch (err) {
          if (await handleAuthError(err)) return;
          errorEl.textContent = err.message || 'could not update your username — try again';
          return;
        }
      }

      // Update characteristics. All three keys are always sent explicitly
      // (including empty string) — the backend upserts by key and never
      // clears a characteristic that's simply missing from the payload, so
      // omitting a blanked-out bio or a "none"-selected sign silently left
      // the old value in place. Sending '' is what actually clears it.
      const selectedPronoun = pronounPills.find(p => p.classList.contains('selected'));
      const selectedSign = signPills.find(p => p.classList.contains('selected'));
      const charsUpdate = {
        bio: bioInput.value.trim(),
        pronouns: selectedPronoun ? selectedPronoun.dataset.value : '',
        astral_sign: selectedSign ? selectedSign.dataset.value : '',
      };

      try {
        if (avatarFile) {
          await auth.uploadAvatar(avatarFile);
          avatarFile = null;
        }
        await auth.updateProfile({ characteristics: charsUpdate });
        const updatedProfile = await auth.getProfile();
        setState({ profile: updatedProfile });
        toast('profile updated!', 'success');
        navigate('/');
      } catch (err) {
        if (await handleAuthError(err)) return;
        errorEl.textContent = err.message || 'could not update your profile — try again';
      }
    },
  }, [
    h('h2', {}, ['edit profile']),
    h('div', { className: 'input-group' }, [
      h('label', { className: 'input-label' }, ['avatar']),
      avatarPicker,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
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
      h('div', { className: 'pill-group', role: 'radiogroup', 'aria-label': 'pronouns' }, pronounPills),
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label' }, ['astral sign']),
      h('div', { className: 'pill-group', role: 'radiogroup', 'aria-label': 'astral sign' }, signPills),
    ]),
    h('div', { className: 'form-actions', style: { marginTop: '24px' } }, [
      h('button', { className: 'btn btn-primary btn-lg', type: 'submit' }, ['save']),
      errorEl,
    ]),
    h('div', { className: 'form-footer' }, [
      h('button', { type: 'button', className: 'link-btn', onClick: () => navigate('/') }, ['back to dashboard']),
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