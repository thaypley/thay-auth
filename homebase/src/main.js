/**
 * thay-homebase — Main entry point.
 * Import CSS through JS so Vite bundles/hashes them for production.
 */
import './css/tokens.css';
import './css/base.css';
import './css/components.css';
import { route, initRouter } from './router.js';
import { hasToken } from './sdk.js';

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

route('/404', async (container) => {
  await NotFoundPage(container);
});

// ─── Start ───────────────────────────────────────────────────────

initRouter();

// Auto-refresh session on boot if token exists
if (hasToken()) {
  const auth = (await import('./sdk.js')).default;
  import('./store.js').then(async ({ setState }) => {
    try {
      const result = await auth.refreshSession();
      setState({ user: result.user });
    } catch {
      // Token expired, clear
      const { clearToken } = await import('./sdk.js');
      clearToken();
    }
  });
}