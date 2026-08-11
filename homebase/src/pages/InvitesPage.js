/**
 * Invites — architect-only invite minting for thay-auth signup.
 * The backend enforces the architect gate (403 otherwise); this UI
 * just surfaces it. Mint, copy, and revoke invite codes.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';
import { toast } from '../utils/toast.js';
import { pageTransition } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';

export default async function InvitesPage(container) {
  const token = auth.getToken();
  if (!token) {
    navigate('/login', true);
    return;
  }

  // The API enforces the gate regardless; the UI check only decides
  // whether to render or bounce. On a fresh visit state may not have
  // profile loaded yet — fetch it so architects aren't bounced home.
  const state = getState();
  let isArchitect = !!(state.user?.isArchitect || state.profile?.isArchitect);
  if (!isArchitect) {
    try {
      const profile = await auth.getProfile();
      isArchitect = !!profile.isArchitect;
      // Persist to the store so NavBar's architect-gated invites
      // link appears immediately, even on a hard refresh of /invites.
      setState({ user: { ...(state.user || {}), ...profile }, profile });
    } catch {
      navigate('/', true);
      return;
    }
  }
  if (!isArchitect) {
    navigate('/', true);
    return;
  }

  const listEl = h('div', { className: 'invites-list' });
  const maxUsesInput = h('input', { className: 'input', type: 'number', value: '1', min: '1', max: '1000', id: 'invite-max-uses' });
  const noteInput = h('input', { className: 'input', type: 'text', placeholder: 'note (optional)', id: 'invite-note', maxlength: '500' });
  const expiryInput = h('input', { className: 'input', type: 'date', id: 'invite-expiry' });
  const errorEl = h('p', { className: 'input-hint-error', style: { textAlign: 'center' }, 'aria-live': 'polite' });

  async function loadInvites() {
    listEl.textContent = '';
    let invites = [];
    try {
      invites = await auth.listInvites();
    } catch (err) {
      console.error('Failed to load invites:', err);
      listEl.appendChild(h('div', { className: 'form-card', style: { textAlign: 'center' } }, [
        h('h3', {}, ['something broke']),
        h('p', { className: 'input-hint-error' }, ['could not load invites — try again shortly.']),
        h('button', { className: 'btn btn-primary btn-sm', onClick: () => location.reload() }, ['retry']),
      ]));
      return;
    }

    if (!invites.length) {
      listEl.appendChild(h('p', { className: 'input-hint', style: { textAlign: 'center', padding: '16px' } }, ['no invites minted yet.']));
      return;
    }

    const items = invites.map((invite) => {
      const usedText = invite.used
        ? `used by @${invite.usedBy ? invite.usedBy.slice(0, 12) : 'someone'}`
        : `${invite.useCount}/${invite.maxUses} used`;
      const statusBadge = invite.used
        ? h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, ['used'])
        : h('span', { className: 'app-card-badge', style: { background: 'var(--glass-mid)', color: 'var(--vibe-accent)' } }, ['live']);

      const copyBtn = h('button', {
        className: 'btn btn-ghost btn-sm',
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(invite.code);
            toast('invite code copied!', 'success');
          } catch {
            errorEl.textContent = 'could not copy — select the code manually';
          }
        },
      }, ['copy']);

      const deleteBtn = h('button', {
        className: 'btn btn-ghost btn-sm',
        style: { color: 'rgba(230, 57, 70, 0.9)' },
        onClick: async () => {
          try {
            await auth.deleteInvite(invite.id);
            toast('invite revoked', 'success');
            await loadInvites();
          } catch (err) {
            errorEl.textContent = err.message || 'could not revoke invite';
          }
        },
      }, ['revoke']);

      return h('div', { className: 'device-item', style: { flexWrap: 'wrap' } }, [
        h('div', { className: 'device-info' }, [
          h('span', { className: 'device-label', style: { fontFamily: 'var(--font-mono)' } }, [invite.code]),
          statusBadge,
        ]),
        h('div', { className: 'device-meta' }, [
          usedText,
          invite.note ? ` — ${invite.note}` : '',
          invite.expiresAt ? ` — expires ${new Date(invite.expiresAt).toLocaleDateString()}` : '',
        ]),
        h('div', { style: { display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' } }, [copyBtn, deleteBtn]),
      ].filter(Boolean));
    });
    items.forEach((item) => listEl.appendChild(item));
  }

  const form = h('form', {
    onSubmit: async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      try {
        const maxUses = parseInt(maxUsesInput.value, 10) || 1;
        const note = noteInput.value.trim();
        const expiresAt = expiryInput.value ? new Date(expiryInput.value).toISOString() : '';
        const invite = await auth.createInvite({ maxUses, note, expiresAt });
        toast(`invite ${invite.code} minted!`, 'success');
        maxUsesInput.value = '1';
        noteInput.value = '';
        expiryInput.value = '';
        await loadInvites();
      } catch (err) {
        errorEl.textContent = err.message || 'could not create invite';
      }
    },
  }, [
    h('h3', {}, ['mint a new invite']),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'invite-max-uses' }, ['max uses']),
      maxUsesInput,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'invite-note' }, ['note']),
      noteInput,
    ]),
    h('div', { className: 'input-group', style: { marginTop: '16px' } }, [
      h('label', { className: 'input-label', htmlFor: 'invite-expiry' }, ['expires (optional)']),
      expiryInput,
    ]),
    h('div', { className: 'form-actions', style: { marginTop: '24px' } }, [
      h('button', { className: 'btn btn-primary btn-lg', type: 'submit' }, ['mint invite']),
      errorEl,
    ]),
  ]);

  const page = h('div', { className: 'auth-page', style: { maxWidth: '760px' } }, [
    h('div', { className: 'auth-logo', style: { fontSize: '1.5rem' } }, ['thay']),
    h('div', { className: 'downloads-header' }, [
      h('h2', {}, ['invite codes']),
      h('p', { className: 'subtitle' }, ['mint and manage thay-auth signup invites']),
    ]),
    h('div', { className: 'form-card', style: { maxWidth: '520px', margin: '0 auto 24px' } }, [form]),
    h('div', { className: 'glass-card-static' }, [
      h('div', { className: 'section-header' }, [
        h('h3', {}, ['issued invites']),
        h('span', { className: 'input-hint' }, ['architect access']),
      ]),
      listEl,
    ]),
  ]);

  const shell = h('div', {}, [NavBar(), page]);
  mount(container, shell);
  pageTransition(page);
  await loadInvites();
}
