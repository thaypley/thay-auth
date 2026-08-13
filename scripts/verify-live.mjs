import PocketBase from 'pocketbase';

const base = process.env.PB_URL || 'http://host.docker.internal:8090';
console.log('⚙️  PB:', base);
const pb = new PocketBase(base);
pb.autoCancellation(false);

// Admin auth
await pb.admins.authWithPassword(process.env.PB_ADMIN_EMAIL, process.env.PB_ADMIN_PASSWORD);
console.log('✅ admin auth OK');

// Collections that exist
const names = ['users','user_characteristics','catalog_apps','invite_codes','devices','user_apps'];
for (const name of names) {
  try {
    const r = await pb.collection(name).getList(1, 1);
    console.log(`📦 ${name}: ${r.totalItems} items`);
  } catch (e) {
    console.log(`❌ ${name}: ${e.response?.status || e.status || e.message}`);
  }
}

// First user
const users = await pb.collection('users').getList(1, 3);
if (users.items[0]) {
  console.log('👤 first user:', users.items[0].email);
  console.log('   keys:', Object.keys(users.items[0]).filter(k => !k.startsWith('_')).join(', '));
}
