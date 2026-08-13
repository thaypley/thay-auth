// ── thay-auth relay bridge (inline for thaypley.com index.html) ────────────
// The account switcher on auth.thaypley.com POSTs to /auth/relay and sets a
// short-lived thay_auth_relay cookie on .thaypley.com just before navigating
// here. This boot block exchanges that cookie for a fresh session and seeds
// tp_token/tp_user, so the dashboard/feed boots already authenticated.
// Non-fatal: no cookie → the platform re-auths as it already does.
(function () {
  var has = document.cookie.split('; ').some(function (c) { return c.indexOf('thay_auth_relay=') === 0; });
  if (!has) return;
  fetch('https://api.thaypley.com/auth/consume-relay', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ aud: 'homebase' }),
    credentials: 'include'
  }).then(function (r) {
    return r.json().then(function (d) { return { ok: r.ok, d: d }; });
  }).then(function (res) {
    if (!res.ok || !res.d || !res.d.ok || !res.d.pbToken) return;
    var u = res.d.user || {};
    var user = {
      id: u.id,
      username: u.username || '',
      displayName: u.username || '',
      email: u.email || '',
      avatar: u.avatar || '',
      accountType: u.accountType || '',
      tier: u.tier || 'free'
    };
    localStorage.setItem('tp_token', res.d.pbToken);
    localStorage.setItem('tp_user', JSON.stringify(user));
    if (localStorage.getItem('tp_token')) window.location.reload();
  }).catch(function () {
    /* non-fatal — fall back to existing boot */
  });
})();
