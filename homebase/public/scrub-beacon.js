/* thay homebase — shared Cloudflare beacon scrubber.
 * Pure function, no dependencies. Attached to whatever global is available
 * (service worker `self` at runtime, `globalThis` in tests) so the exact
 * same logic is exercised by the unit test and the production SW.
 */
(function (global) {
  global.thayScrubBeaconHtml = function stripBeaconHtml(html) {
    if (typeof html !== 'string') return html;
    // Edge-injected by Cloudflare as:
    //   <script defer src="https://static.cloudflareinsights.com/beacon.min.js" [...]></script>
    // Attribute order/quoting vary, so match by URL presence in any attribute list.
    return html.replace(
      /<script\b(?=[^>]*src=["']https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js(?:[\/?][^"']*)?["'])[^>]*><\/script>/gi,
      ''
    );
  };
})(typeof self !== 'undefined' ? self : globalThis);
