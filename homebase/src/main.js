/**
 * thay-homebase — Main entry point.
 * Import CSS through JS so Vite bundles/hashes them for production.
 */
import './css/tokens.css';
import './css/base.css';
import './css/components.css';
import { route, initRouter } from './router.js';
import { hasToken } from './sdk.js';

// Lazy load pages
const LoginPage = () => import('./pages/LoginPage.js').then(m => m.default);
const SignupPage = () => import('./pages/SignupPage.js').then(m => m.default);
const WaitlistPage = () => import('./pages/WaitlistPage.js').then(m => m.default);
const DashboardPage = () => import('./pages/DashboardPage.js').then(m => m.default);
const ProfilePage = () => import('./pages/ProfilePage.js').then(m => m.default);
const NotFoundPage = () => import('./pages/NotFoundPage.js').then(m => m.default);

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

route('/waitlist', async (container) => {
  await WaitlistPage(container);
});

route('/profile', async (container) => {
  if (!hasToken()) {
    const { navigate } = await import('./router.js');
    navigate('/login', true);
    return;
  }
  await ProfilePage(container);
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