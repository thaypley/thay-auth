/**
 * Settings — vibe themes, appearance, and account management.
 *
 * The vibe switcher moved here (out of the navbar) per the redesign.
 * Also surfaces active sessions so users can revoke from anywhere.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { toast } from '../utils/toast.js';
import { VIBES, applyVibe, getVibeColor, loadVibe } from '../utils/vibes.js';

export default async function SettingsPage(container) {
  const token = auth.getToken();
  if (!token) {
    navigate('/login', true);
    return;
  }

  const body = h('div', { className: 'settings-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'settings-page' }, [body])]);
  mount(container, shell);
  pageTransition(body);

  const current = loadVibe();

  // ─── Appearance: 7 square vibe swatches ──────────────────────────
  const swatches = VIBES.map((v) => {
    const isActive = v === current;
    return h('button', {
      className: 'vibe-swatch' + (isActive ? ' active' : ''),
      type: 'button',
      'aria-pressed': isActive ? 'true' : 'false',
      onClick: () => {
        applyVibe(v);
        // Visually update all swatches.
        swatches.forEach((s) => s.classList.remove('active'));
        document.querySelector('.vibe-swatch[aria-pressed="true"]')?.removeAttribute('aria-pressed');
        swatches.forEach((s) => s.setAttribute('aria-pressed', 'false'));
        swatches[VIBES.indexOf(v)].classList.add('active');
        swatches[VIBES.indexOf(v)].setAttribute('aria-pressed', 'true');
        toast(`theme: ${v}`, 'success');
      },
    }, [
      h('span', { className: 'vibe-swatch-color', style: { background: getVibeColor(v) } }),
      h('span', { className: 'vibe-swatch-label' }, [v]),
    ]);
  });

  const appearanceCard = h('div', { className: 'glass-card-static' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['appearance']),
      h('span', { className: 'input-hint' }, ['vibe themes']),
    ]),
    h('div', { className: 'vibe-swatch-grid' }, swatches),
  ]);

  // ─── Account management ──────────────────────────────────────────
  const accountCard = h('div', { className: 'glass-card-static' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['account']),
      h('span', { className: 'input-hint' }, ['manage your identity']),
    ]),
    h('div', { className: 'settings-links' }, [
      h('a', { className: 'right-panel-link', href: '#/profile' }, ['edit profile']),
      h('a', { className: 'right-panel-link', href: '#/billing' }, ['billing & subscriptions']),
    ]),
  ]);

  // ─── Sessions ────────────────────────────────────────────────────
  const sessionList = h('div', { className: 'devices-list' });
  let sessions = [];
  try {
    sessions = await auth.listSessions();
  } catch {
    sessions = [];
  }
  const sessionRows = sessions.length
    ? sessions.map((s) => h('div', { className: 'device-item', style: { flexWrap: 'wrap' } }, [
        h('div', { className: 'device-info' }, [
          h('span', { className: 'device-label' }, [s.app || 'web']),
          h('span', { className: 'device-meta' }, [
            s.ip ? `ip ${s.ip} · ` : '',
            s.createdAt ? `since ${new Date(s.createdAt).toLocaleDateString()}` : '',
            s.revoked ? ' · revoked' : '',
          ]),
        ]),
        !s.revoked ? h('button', {
          className: 'btn btn-ghost btn-sm',
          style: { color: 'rgba(230, 57, 70, 0.9)' },
          onClick: async () => {
            try {
              await auth.revokeSession(s.id);
              toast('session revoked', 'success');
              const refresh = await auth.listSessions();
              sessionList.textContent = '';
              refresh.forEach((r) => sessionList.appendChild(h('div', { className: 'device-item' }, [h('span', { className: 'device-label' }, [r.app || 'web'])])));
            } catch {
              toast('could not revoke session', 'error');
            }
          },
        }, ['revoke']) : null,
      ].filter(Boolean)))
    : h('p', { className: 'input-hint', style: { textAlign: 'center', padding: '16px' } }, ['no active sessions']);

  sessionRows.forEach((r) => sessionList.appendChild(r));

  const sessionsCard = h('div', { className: 'glass-card-static' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['sessions']),
      h('span', { className: 'input-hint' }, [`${sessions.filter((s) => !s.revoked).length} active`]),
    ]),
    sessionList,
  ]);

  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['settings']),
    h('p', { className: 'subtitle' }, ['appearance, vibe themes, and account management']),
  ]);

  body.appendChild(heading);
  body.appendChild(appearanceCard);
  body.appendChild(h('div', { style: { marginTop: 'var(--space-xl)' } }, [accountCard]));
  body.appendChild(h('div', { style: { marginTop: 'var(--space-xl)' } }, [sessionsCard]));

  setTimeout(() => staggerIn(body, '.vibe-swatch, .device-item', 150), 150);
}
