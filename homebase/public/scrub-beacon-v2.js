/* thay homebase — shared Cloudflare beacon scrubber v2.
 * Pure function, no dependencies. Attached to whatever global is available
 * (service worker `self` at runtime, `globalThis` in tests) so the exact
 * same logic is exercised by the unit test and the production SW.
 *
 * v2: versioned filename — Cloudflare's CDN caches the v1 file with
 * max-age 14400, and the account tier has no cache-purge API access.
 */
(function (global) {
  global.thayScrubBeaconHtml = function stripBeaconHtml(html) {
    if (typeof html !== 'string') return html;
    // Edge-injected by Cloudflare as:
    //   <script defer src="https://static.cloudflareinsights.com/beacon.min.js" [...]></script>
    // or with a versioned path that varies by release:
    //   <script defer src="https://static.cloudflareinsights.com/beacon.min.js/v4513226cdae..." [...]></script>
    // Attribute order/quoting vary, so match by URL presence in any attribute list.
    return html.replace(
      /<script\b(?=[^>]*src=["']https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js(?:[\/?][^"']*)?["'])[^>]*><\/script>/gi,
      ''
    );
  };
})(typeof self !== 'undefined' ? self : globalThis);
