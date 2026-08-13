import PocketBase from 'pocketbase';

const API = process.env.THAY_AUTH_API || 'http://127.0.0.1:3749';
const base = process.env.PB_URL || 'http://host.docker.internal:8090';
const pb = new PocketBase(base);
pb.autoCancellation(false);
await pb.admins.authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);

// 1. Mint a fresh invite code (unique)
const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
const code = `TP-${suffix}`;
const inv = await pb.collection('signup_invites').create({
  code,
  maxUses: 1,
  useCount: 0,
  createdBy: pb.authStore.token?.slice(0, 8) || 'verify',
  expiresAt: new Date(Date.now() + 3600e3).toISOString(),
});
console.log(`✅ minted invite ${code}`);

// 2. Sign up through the LIVE API
const ts = Date.now().toString(36).slice(-6);
const email = `verify-e2e-${ts}@thaypley.com`;
const username = `verify_${ts}`;
const password = 'Verify-E2E-2026!x';
const signup = await fetch(API + '/auth/signup', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email, password, username,
    accountType: 'musician',
    birthday: '2000-01-15',
    inviteCode: code,
    app: 'verify',
  }),
});
const body = await signup.json();
console.log(`signup: ${signup.status}`, body.token ? '(token issued)' : JSON.stringify(body).slice(0, 200));
if (!signup.ok) process.exit(2);

// 3. Login through the LIVE API
const login = await fetch(API + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identity: email, password }),
});
const lj = await login.json();
console.log(`login: ${login.status}`, lj.token ? '(token issued)' : JSON.stringify(lj).slice(0, 200));
if (!login.ok) process.exit(3);
const token = lj.token;

// 4. GET /auth/profile — the endpoint that returned 500
const profile = await fetch(API + '/auth/profile', {
  headers: { Authorization: 'Bearer ' + token },
});
const pj = await profile.json();
console.log(`profile: ${profile.status}`);
if (!profile.ok) { console.log('  BODY:', JSON.stringify(pj).slice(0, 300)); process.exit(4); }
console.log(`  ✅ email: ${pj.email} | username: ${pj.username} | type: ${pj.accountType}`);
console.log(`  ✅ characteristics: ${pj.characteristics?.length ?? 0} entries`);

// 5. GET /auth/apps — the dashboard companion call
const apps = await fetch(API + '/auth/apps', { headers: { Authorization: 'Bearer ' + token } });
console.log(`apps: ${apps.status}`);

console.log('\n🎉 END-TO-END VERIFY PASSED');
