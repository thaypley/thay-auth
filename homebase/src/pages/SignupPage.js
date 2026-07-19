/**
 * Signup page — 3-step wizard: Invite Code → Account → Profile Setup.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { setState } from '../store.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { astralSign } from '../utils/zodiac.js';

const ASTRAL_SIGNS = ['aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo', 'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces'];
const PRONOUNS = ['they/them', 'she/her', 'he/him', 'xe/xem', 'ze/zir', 'any', 'ask'];

export default async function SignupPage(container) {
  const state = { step: 1, formData: {} };

  // ─── Elements ─────────────────────────────────────────────────

  const stepDots = [
    h('div', { className: 'step-dot active' }),
    h('div', { className: 'step-dot' }),
    h('div', { className: 'step-dot' }),
  ];

  function updateSteps(step) {
    stepDots.forEach((dot, i) => {
      dot.className = 'step-dot';
      if (i + 1 === step) dot.classList.add('active');
      if (i + 1 < step) dot.classList.add('completed');
    });
  }

  const stepsIndicator = h('div', { className: 'steps-indicator' }, stepDots);

  const content = h('div', { id: 'signup-content' });

  const page = h('div', { className: 'auth-page' }, [
    h('div', { className: 'auth-logo' }, ['thay']),
    h('div', { className: 'form-card', style: { maxWidth: '520px' } }, [stepsIndicator, content]),
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);

  // ─── Step 1: Invite Code ──────────────────────────────────────

  function renderStep1() {
    const codeInput = h('input', {
      className: 'input',
      type: 'text',
      placeholder: 'enter invite code',
      id: 'invite-code',
      autocomplete: 'off',
    });

    const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' }, 'aria-live': 'polite' });

    const noCode = h('button', { type: 'button', className: 'link-btn', onClick: () => navigate('/waitlist') }, ['no code? join the waitlist']);

    const step1SubmitBtn = h('button', { className: 'btn btn-primary btn-lg', type: 'submit' }, ['continue']);

    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const code = codeInput.value.trim();
        if (!code) { errorEl.textContent = 'please enter an invite code'; return; }
        errorEl.textContent = '';
        step1SubmitBtn.disabled = true;
        step1SubmitBtn.textContent = '...';

        try {
          const result = await auth.checkInviteCode(code);
          if (result.valid) {
            state.formData.inviteCode = code;
            state.step = 2;
            updateSteps(2);
            renderStep2();
            return;
          }
          errorEl.textContent = result.error || "that invite code isn't valid";
        } catch (err) {
          errorEl.textContent = err.message || 'could not check that code — try again';
        } finally {
          step1SubmitBtn.disabled = false;
          step1SubmitBtn.textContent = 'continue';
        }
      },
    }, [
      h('h2', {}, ['welcome']),
      h('p', { className: 'subtitle' }, ['enter your invite code to get started']),
      h('div', { className: 'input-group' }, [
        h('label', { className: 'input-label', htmlFor: 'invite-code' }, ['invite code']),
        codeInput,
      ]),
      h('div', { className: 'form-actions' }, [
        step1SubmitBtn,
        errorEl,
      ]),
      h('div', { className: 'form-footer' }, [noCode]),
    ]);

    mount(content, form);
    setTimeout(() => codeInput.focus(), 100);
  }

  // ─── Step 2: Account Details ──────────────────────────────────

  function renderStep2() {
    const emailInput = h('input', {
      className: 'input', type: 'email', placeholder: 'email', id: 'signup-email', autocomplete: 'email', required: true,
    });
    const pwInput = h('input', {
      className: 'input', type: 'password', placeholder: 'password', id: 'signup-password', autocomplete: 'new-password', required: true,
    });
    const pwHint = h('p', { className: 'input-hint' }, ['at least 8 characters']);
    const birthdayInput = h('input', {
      className: 'input', type: 'date', id: 'signup-birthday', required: true,
    });
    const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' }, 'aria-live': 'polite' });

    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        const email = emailInput.value.trim();
        const password = pwInput.value;
        const birthday = birthdayInput.value;

        if (!email || !password || !birthday) {
          errorEl.textContent = 'all fields are required';
          return;
        }
        if (password.length < 8) {
          errorEl.textContent = 'password needs to be at least 8 characters';
          return;
        }

        state.formData.email = email;
        state.formData.password = password;
        state.formData.birthday = birthday;
        state.step = 3;
        updateSteps(3);
        renderStep3();
      },
    }, [
      h('h2', {}, ['create account']),
      h('p', { className: 'subtitle' }, ['your email and birthday stay private']),
      h('div', { className: 'input-group' }, [
        h('label', { className: 'input-label', htmlFor: 'signup-email' }, ['email']),
        emailInput,
      ]),
      h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
        h('label', { className: 'input-label', htmlFor: 'signup-password' }, ['password']),
        pwInput,
        pwHint,
      ]),
      h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
        h('label', { className: 'input-label', htmlFor: 'signup-birthday' }, ['birthday']),
        birthdayInput,
      ]),
      h('div', { className: 'form-actions' }, [
        h('button', { className: 'btn btn-primary btn-lg', type: 'submit' }, ['continue']),
        errorEl,
      ]),
      h('div', { className: 'form-footer' }, [
        h('button', { type: 'button', className: 'link-btn', onClick: () => { state.step = 1; updateSteps(1); renderStep1(); } }, ['back']),
      ]),
    ]);

    mount(content, form);
    setTimeout(() => emailInput.focus(), 100);
  }

  // ─── Step 3: Profile Setup ────────────────────────────────────

  function renderStep3() {
    const usernameInput = h('input', {
      className: 'input',
      type: 'text',
      placeholder: 'username',
      id: 'setup-username',
      autocomplete: 'off',
      required: true,
      value: state.formData.username || '',
    });
    const usernameHint = h('p', { className: 'input-hint', id: 'username-hint', 'aria-live': 'polite' });
    let usernameAvailable = false;
    let usernameCheckTimer = null;

    function checkUsername(val) {
      clearTimeout(usernameCheckTimer);
      if (val.length < 3) {
        usernameHint.className = 'input-hint';
        usernameHint.textContent = 'min 3 characters, letters, numbers, underscores';
        usernameAvailable = false;
        return;
      }
      usernameHint.textContent = 'checking...';
      usernameCheckTimer = setTimeout(async () => {
        try {
          const result = await auth.checkUsername(val);
          if (result.available) {
            usernameHint.className = 'input-hint-success';
            usernameHint.textContent = '✓ available';
            usernameAvailable = true;
          } else {
            usernameHint.className = 'input-hint-error';
            usernameHint.textContent = result.error || 'username taken';
            usernameAvailable = false;
          }
        } catch {
          usernameHint.textContent = 'could not check';
          usernameAvailable = false;
        }
      }, 400);
    }

    usernameInput.addEventListener('input', () => {
      const val = usernameInput.value.trim();
      state.formData.username = val;
      checkUsername(val);
    });
    // Rehydrate: re-run the availability check if a value survived from a
    // previous visit to this step (going back then forward again).
    if (usernameInput.value.trim().length >= 3) checkUsername(usernameInput.value.trim());

    // Avatar
    const avatarPreview = h('div', {
      className: 'profile-avatar-placeholder',
      style: { width: '72px', height: '72px', margin: '0 auto', fontSize: '1.5rem', overflow: 'hidden' },
    }, ['+']);
    const avatarFileInput = h('input', {
      type: 'file',
      accept: 'image/png,image/jpeg,image/webp,image/gif',
      style: { display: 'none' },
    });
    const avatarHint = h('p', { className: 'input-hint', style: { textAlign: 'center' } }, ['optional — png, jpg, webp or gif, up to 4mb']);

    function setAvatarPreview(file) {
      const url = URL.createObjectURL(file);
      avatarPreview.textContent = '';
      avatarPreview.appendChild(h('img', {
        src: url, alt: '',
        style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' },
      }));
    }

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
      state.formData.avatarFile = file;
      avatarHint.className = 'input-hint';
      avatarHint.textContent = file.name;
      setAvatarPreview(file);
    });
    const avatarPicker = h('div', {
      className: 'avatar-upload-preview',
      style: { textAlign: 'center', cursor: 'pointer' },
      tabindex: '0',
      role: 'button',
      'aria-label': 'choose a profile picture (optional)',
      onClick: () => avatarFileInput.click(),
      onKeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          avatarFileInput.click();
        }
      },
    }, [avatarPreview, avatarFileInput, avatarHint]);

    // Rehydrate avatar preview/hint if a file survived from a previous visit
    if (state.formData.avatarFile) {
      avatarHint.textContent = state.formData.avatarFile.name;
      setAvatarPreview(state.formData.avatarFile);
    }

    // Bio
    const bioInput = h('textarea', {
      className: 'input',
      placeholder: 'a short bio... (280 chars)',
      id: 'setup-bio',
      style: { resize: 'vertical', minHeight: '80px', fontFamily: 'var(--font-body)' },
      maxlength: 280,
      value: state.formData.bio || '',
    });
    bioInput.addEventListener('input', () => { state.formData.bio = bioInput.value; });

    // Pronouns
    const pronounPills = PRONOUNS.map(p => {
      const pill = h('button', {
        className: 'pill' + (state.formData.pronoun === p ? ' selected' : ''),
        type: 'button',
        dataset: { value: p },
        'aria-pressed': state.formData.pronoun === p ? 'true' : 'false',
        onClick: () => {
          pronounPills.forEach(pp => { pp.classList.remove('selected'); pp.setAttribute('aria-pressed', 'false'); });
          pill.classList.add('selected');
          pill.setAttribute('aria-pressed', 'true');
          state.formData.pronoun = p;
        },
      }, [p]);
      return pill;
    });

    // Astral sign — precomputed from the birthday, still changeable. Once
    // the user has interacted with these pills at all (including "skip"),
    // state.formData.astralSign holds the explicit choice (possibly '');
    // until then it's undefined and the birthday-derived default applies.
    const computedSign = astralSign(state.formData.birthday);
    const initialSign = state.formData.astralSign !== undefined ? state.formData.astralSign : computedSign;
    const signPills = ASTRAL_SIGNS.map(s => {
      const pill = h('button', {
        className: 'pill' + (s === initialSign ? ' selected' : ''),
        type: 'button',
        dataset: { value: s },
        'aria-pressed': s === initialSign ? 'true' : 'false',
        onClick: () => {
          signPills.forEach(sp => { sp.classList.remove('selected'); sp.setAttribute('aria-pressed', 'false'); });
          pill.classList.add('selected');
          pill.setAttribute('aria-pressed', 'true');
          state.formData.astralSign = s;
        },
      }, [s.charAt(0).toUpperCase() + s.slice(1)]);
      return pill;
    });
    const skipSignPill = h('button', {
      className: 'pill' + (!initialSign ? ' selected' : ''),
      type: 'button',
      dataset: { value: '' },
      'aria-pressed': !initialSign ? 'true' : 'false',
      onClick: () => {
        signPills.forEach(sp => { sp.classList.remove('selected'); sp.setAttribute('aria-pressed', 'false'); });
        skipSignPill.classList.add('selected');
        skipSignPill.setAttribute('aria-pressed', 'true');
        state.formData.astralSign = '';
      },
    }, ['skip']);
    signPills.push(skipSignPill);

    const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' }, 'aria-live': 'polite' });

    const form = h('form', {
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        errorEl.textContent = '';
        const username = usernameInput.value.trim();

        if (!username || !usernameAvailable) {
          errorEl.textContent = 'choose an available username first';
          return;
        }

        const selectedPronoun = pronounPills.find(p => p.classList.contains('selected'));
        const selectedSign = signPills.find(p => p.classList.contains('selected'));

        try {
          const result = await auth.signup({
            email: state.formData.email,
            password: state.formData.password,
            username,
            accountType: 'lover',
            birthday: state.formData.birthday,
            inviteCode: state.formData.inviteCode,
          });

          // Save profile characteristics
          const chars = {};
          if (bioInput.value.trim()) chars.bio = bioInput.value.trim();
          if (selectedPronoun) chars.pronouns = selectedPronoun.dataset.value;
          if (selectedSign && selectedSign.dataset.value) chars.astral_sign = selectedSign.dataset.value;

          if (Object.keys(chars).length > 0) {
            try { await auth.setCharacteristics(chars); } catch { /* non-critical */ }
          }

          if (state.formData.avatarFile) {
            try { await auth.uploadAvatar(state.formData.avatarFile); } catch { /* non-critical */ }
          }

          setState({ user: result.user, profile: { ...result.user, characteristics: chars } });
          toast('account created — welcome, (you)!', 'success');
          navigate('/verify');
        } catch (err) {
          errorEl.textContent = err.message || 'signup failed — try again';
        }
      },
    }, [
      h('h2', {}, ['set up profile']),
      h('p', { className: 'subtitle' }, ['choose your identity']),
      h('div', { className: 'input-group' }, [
        h('label', { className: 'input-label' }, ['avatar']),
        avatarPicker,
      ]),
      h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
        h('label', { className: 'input-label', htmlFor: 'setup-username' }, ['username']),
        usernameInput,
        usernameHint,
      ]),
      h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
        h('label', { className: 'input-label', htmlFor: 'setup-bio' }, ['bio']),
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
        h('button', { className: 'btn btn-primary btn-lg', type: 'submit' }, ['create account']),
        errorEl,
      ]),
      h('div', { className: 'form-footer' }, [
        h('button', { type: 'button', className: 'link-btn', onClick: () => { state.step = 2; updateSteps(2); renderStep2(); } }, ['back']),
      ]),
    ]);

    mount(content, form);
    setTimeout(() => usernameInput.focus(), 100);
  }

  // ─── Start ────────────────────────────────────────────────────

  updateSteps(1);
  renderStep1();
  pageTransition(page);
}