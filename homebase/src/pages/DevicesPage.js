/**
 * Devices — every device signed in / allowed on the account.
 *
 * Two panels: paired devices (labels, scopes, live/expired/revoked
 * health, unpair) and active sessions (app, ip, revoke). This is the
 * real, actionable home for "connected devices" — the dashboard panel
 * links here.
 */
import { h, mount } from '../utils/dom.js';
import auth from '../sdk.js';
import { navigate } from '../router.js';
import { pageTransition, staggerIn } from '../utils/animations.js';
import { NavBar } from '../components/NavBar.js';
import { toast } from '../utils/toast.js';

function deviceState(d) {
  if (d.revoked) return { dot: 'device-dot device-dot--expired', text: 'revoked' };
  if (d.expiresAt && new Date(d.expiresAt).getTime() < Date.now()) {
    return { dot: 'device-dot device-dot--expired', text: 'expired' };
  }
  return { dot: 'device-dot device-dot--live', text: 'live' };
}

export default async function DevicesPage(container) {
  const token = auth.getToken();
  if (!token) {
    navigate('/login', true);
    return;
  }

  const body = h('div', { className: 'settings-body' });
  const shell = h('div', {}, [NavBar(), h('div', { className: 'settings-page' }, [body])]);
  mount(container, shell);
  pageTransition(body);

  const heading = h('div', { className: 'downloads-header' }, [
    h('h2', {}, ['devices']),
    h('p', { className: 'subtitle' }, ['every device signed in or allowed on your account']),
  ]);
  body.appendChild(heading);

  // ─── Skeleton shell ──────────────────────────────────────────────
  // Paint shimmer panels immediately so the page is never a blank
  // screen while the devices/sessions fetches are in flight.
  const skeleton = h('div', { 'aria-busy': 'true', style: { opacity: 0.7 } }, [
    h('div', { className: 'glass-card-static', style: { height: '160px' } }),
    h('div', { className: 'glass-card-static', style: { height: '160px', marginTop: 'var(--space-xl)' } }),
  ]);
  body.appendChild(skeleton);

  // ─── Paired devices panel ────────────────────────────────────────
  const deviceList = h('div', { className: 'devices-list' });
  const devicesCard = h('div', { className: 'glass-card-static' }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['paired devices']),
      h('span', { className: 'input-hint' }, ['devices allowed to act for you']),
    ]),
    deviceList,
  ]);
  body.appendChild(devicesCard);

  // ─── Active sessions panel ───────────────────────────────────────
  const sessionList = h('div', { className: 'devices-list' });
  const sessionsCard = h('div', { className: 'glass-card-static', style: { marginTop: 'var(--space-xl)' } }, [
    h('div', { className: 'section-header' }, [
      h('h3', {}, ['active sessions']),
      h('span', { className: 'input-hint' }, ['where you are signed in right now']),
    ]),
    sessionList,
  ]);
  body.appendChild(sessionsCard);

  let devices = [];
  let sessions = [];
  try {
    [devices, sessions] = await Promise.all([auth.listDevices(), auth.listSessions()]);
  } catch (err) {
    skeleton.remove();
    body.appendChild(h('div', { className: 'form-card', style: { textAlign: 'center', marginTop: 'var(--space-xl)' } }, [
      h('h3', {}, ['something broke']),
      h('p', { className: 'input-hint-error' }, ['could not load devices right now — try again shortly.']),
      h('button', { className: 'btn btn-primary btn-sm', onClick: () => location.reload() }, ['retry']),
    ]));
    return;
  }

  skeleton.remove();

  // Rows are rebuilt after every action so stale UI never lingers.
  const renderDevices = () => {
    deviceList.textContent = '';
    if (!devices || devices.length === 0) {
      deviceList.appendChild(h('p', { className: 'input-hint', style: { textAlign: 'center', padding: '16px' } }, [
        'no devices paired yet — pair one from any thaypley app\u2019s settings to see it here.',
      ]));
      return;
    }
    devices.forEach((d) => {
      const st = deviceState(d);
      const scopes = Array.isArray(d.scopes) && d.scopes.length
        ? d.scopes.map((s) => h('span', { className: 'app-card-badge device-scope', style: { background: 'var(--glass-mid)', color: 'var(--vibe-sub)' } }, [s]))
        : null;
      deviceList.appendChild(h('div', { className: 'device-item', style: { flexWrap: 'wrap' } }, [
        h('div', { className: 'device-info' }, [
          h('span', { className: 'device-label' }, [
            h('span', { className: st.dot, title: st.text }),
            d.label || 'unknown device',
          ]),
          h('span', { className: 'device-meta' }, [
            d.lastSeenAt ? `last seen ${new Date(d.lastSeenAt).toLocaleDateString()}` : '',
            d.expiresAt ? ` · expires ${new Date(d.expiresAt).toLocaleDateString()}` : '',
            d.revoked ? ' · revoked' : '',
          ]),
        ]),
        scopes ? h('div', { className: 'device-scopes', style: { display: 'flex', gap: '6px', marginTop: '4px', width: '100%' } }, scopes) : null,
        !d.revoked ? h('button', {
          className: 'btn btn-ghost btn-sm',
          style: { color: 'rgba(230, 57, 70, 0.9)', marginLeft: 'auto' },
          onClick: async () => {
            try {
              await auth.revokeDevice(d.id);
              d.revoked = true;
              toast('device unpaired', 'success');
              renderDevices();
            } catch {
              toast('could not unpair device', 'error');
            }
          },
        }, ['unpair']) : null,
      ].filter(Boolean)));
    });
  };

  const renderSessions = () => {
    sessionList.textContent = '';
    const live = (sessions || []).filter((s) => !s.revoked);
    if (live.length === 0) {
      sessionList.appendChild(h('p', { className: 'input-hint', style: { textAlign: 'center', padding: '16px' } }, [
        'no active sessions on other surfaces.',
      ]));
      return;
    }
    live.forEach((s) => {
      sessionList.appendChild(h('div', { className: 'device-item', style: { flexWrap: 'wrap' } }, [
        h('div', { className: 'device-info' }, [
          h('span', { className: 'device-label' }, [s.app || 'web']),
          h('span', { className: 'device-meta' }, [
            s.ip ? `ip ${s.ip} · ` : '',
            s.createdAt ? `since ${new Date(s.createdAt).toLocaleDateString()}` : '',
          ]),
        ]),
        h('button', {
          className: 'btn btn-ghost btn-sm',
          style: { color: 'rgba(230, 57, 70, 0.9)', marginLeft: 'auto' },
          onClick: async () => {
            try {
              await auth.revokeSession(s.id);
              s.revoked = true;
              toast('session revoked', 'success');
              renderSessions();
            } catch {
              toast('could not revoke session', 'error');
            }
          },
        }, ['revoke']),
      ]));
    });
  };

  renderDevices();
  renderSessions();

  setTimeout(() => staggerIn(body, '.device-item', 150), 150);
}
