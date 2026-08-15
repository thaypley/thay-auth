/**
 * thay-homebase — Main entry point.
 * Import CSS through JS so Vite bundles/hashes them for production.
 */
import './css/tokens.css';
import './css/base.css';
import './css/components.css';
import './css/sky-theme.css';
import { route, initRouter } from './router.js';
import { hasToken } from './sdk.js';
import { initVibe } from './utils/vibes.js';
import { initSky } from './utils/sky.js';

initVibe();
initSky();

// ─── Service worker: scrub Cloudflare's edge-injected analytics beacon ───
// The beacon (<script data-cf-beacon> → static.cloudflareinsights.com) is
// injected by Cloudflare at the edge, not by this origin. Client ad blockers
// cancel it with ERR_BLOCKED_BY_CLIENT, and disabling Web Analytics is not
// available on this account tier. The SW strips the injected tag from every
// navigation response, so the browser never even creates the request.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    if (!location.protocol.startsWith('http')) return;
    navigator.serviceWorker.register('/sw-v2.js', { updateViaCache: 'none' }).catch((err) => {
      // Non-fatal: the beacon stays harmless (single console line) if SW
      // registration is refused (private mode, unsupported browser).
      console.warn('SW registration skipped:', err && err.message);
    });
  });
}

// Lazy load pages — each returns an async page fn that loads the chunk,
// then renders into the container (previously the loaded fn was never called).
const lazy = (load) => async (...args) => (await load()).default(...args);
const LoginPage = lazy(() => import('./pages/LoginPage.js'));
const SignupPage = lazy(() => import('./pages/SignupPage.js'));
const WaitlistPage = lazy(() => import('./pages/WaitlistPage.js'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.js'));
const VerifyPage = lazy(() => import('./pages/VerifyPage.js'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js'));
const DownloadsPage = lazy(() => import('./pages/DownloadsPage.js'));
const PlatformsPage = lazy(() => import('./pages/PlatformsPage.js'));
const InvitesPage = lazy(() => import('./pages/InvitesPage.js'));
const BillingPage = lazy(() => import('./pages/BillingPage.js'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js'));
const ForgotPasswordPage = lazy(() => import('./pages/ForgotPasswordPage.js'));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage.js'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js'));

// ─── Route Definitions ───────────────────────────────────────────

route('/', async (container) => {
  if (hasToken()) {
    await DashboardPage(container);
  } else {
    await LoginPage(container);
  }
});

route('/login', async (container) => {
  if (hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/', true);
    return;
  }
  await LoginPage(container);
});

route('/signup', async (container) => {
  if (hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/', true);
    return;
  }
  await SignupPage(container);
});

route('/verify', async (container) => {
  if (!hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/login', true);
    return;
  }
  await VerifyPage(container);
});

route('/waitlist', async (container) => {
  await WaitlistPage(container);
});

route('/forgot-password', async (container) => {
  if (hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/', true);
    return;
  }
  await ForgotPasswordPage(container);
});

route('/reset-password', async (container) => {
  await ResetPasswordPage(container);
});

route('/profile', async (container) => {
  if (!hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/login', true);
    return;
  }
  await ProfilePage(container);
});

// Public — no login required, doubles as a marketing page.
route('/downloads', async (container) => {
  await DownloadsPage(container);
});

// Public directory — the full thay ecosystem launchpad.
route('/platforms', async (container) => {
  await PlatformsPage(container);
});

// Architect-only invite minting (backend-enforced).
route('/invites', async (container) => {
  await InvitesPage(container);
});

// Billing & subscriptions (thay-sub future).
route('/billing', async (container) => {
  if (!hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/login', true);
    return;
  }
  await BillingPage(container);
});

route('/settings', async (container) => {
  if (!hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/login', true);
    return;
  }
  await SettingsPage(container);
});

route('/forgot-password/:x', async () => {});

// SPA catch-all.
route('*', async (container) => {
  await NotFoundPage(container);
});

initRouter();
