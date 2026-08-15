/* thay homebase — service worker
 * Scrubs Cloudflare's edge-injected Web Analytics beacon from every
 * navigation response. The <script data-cf-beacon> tag is injected by
 * Cloudflare at the edge (origin HTML has no beacon); client ad blockers
 * cancel it with ERR_BLOCKED_BY_CLIENT and the dashboard tier cannot
 * disable Web Analytics. Stripping the tag before the renderer parses the
 * document means the browser never creates the network request at all.
 */
self.importScripts('/scrub-beacon.js');

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

function headersForScrubbedResponse(res) {
  const headers = new Headers(res.headers);
  // The body is now re-encoded text: the original Content-Encoding (gzip/br)
  // and Content-Length refer to the wire bytes, not this Response's bytes.
  headers.delete('content-encoding');
  headers.delete('content-length');
  return headers;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.mode !== 'navigate') return;
  event.respondWith(
    fetch(req).then((res) => {
      if (!res.ok) return res;
      const type = res.headers.get('content-type') || '';
      if (!type.includes('text/html')) return res;
      return res.text().then((html) => {
        const cleaned = self.thayScrubBeaconHtml(html);
        if (cleaned === html) return res;
        return new Response(cleaned, {
          status: res.status,
          statusText: res.statusText,
          headers: headersForScrubbedResponse(res),
        });
      });
    })
  );
});
