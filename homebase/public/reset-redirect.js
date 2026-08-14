// PocketBase sends password-reset emails with URLs like
// /_/auth/reset-password/{TOKEN} based on meta.appURL.
// Redirect to the hash-routed SPA page that ResetPasswordPage handles.
// (Sits in public/ so CSP can stay script-src 'self' — no inline script.)
(function () {
  var m = location.pathname.match(/^\/_\/auth\/reset-password\/(.+)$/);
  if (m) location.replace('/#/reset-password?token=' + encodeURIComponent(m[1]));
})();
