import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, it, expect, beforeEach } from 'vitest';

const scrubSrc = readFileSync(new URL('../scrub-beacon-v2.js', import.meta.url), 'utf8');

function freshScrubber() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(scrubSrc, sandbox);
  return sandbox.thayScrubBeaconHtml;
}

describe('thayScrubBeaconHtml (Cloudflare edge-injected analytics beacon)', () => {
  let strip;
  beforeEach(() => { strip = freshScrubber(); });

  it('strips the standard injected beacon script (double quotes, src first)', () => {
    const html = '<html><head>\n<script defer src=\"https://static.cloudflareinsights.com/beacon.min.js\" data-cf-beacon=\"{\"token\":\"abc\"}\"></script>\n</head><body>hi</body></html>';
    expect(strip(html)).not.toContain('<script');
    expect(strip(html)).not.toContain('cloudflareinsights');
    expect(strip(html)).toContain('<html><head>');
    expect(strip(html)).toContain('</head><body>hi</body></html>');
  });

  it('strips beacon tag with single-quoted src and reversed attribute order', () => {
    const html = `<script data-cf-beacon='{"token":"x"}' defer src='https://static.cloudflareinsights.com/beacon.min.js?v=1'></script>`;
    expect(strip(html)).toBe('');
  });

  it('strips beacon tag that has no other attributes', () => {
    const html = `<script src="https://static.cloudflareinsights.com/beacon.min.js"></script>`;
    expect(strip(html)).toBe('');
  });

  it('only strips the beacon and does not touch first-party scripts', () => {
    const html = `<html><head><script src="/assets/index.js" defer></script><script src="https://static.cloudflareinsights.com/beacon.min.js" defer></script></head><body></body></html>`;
    expect(strip(html)).toBe(
      `<html><head><script src="/assets/index.js" defer></script></head><body></body></html>`
    );
  });

  it('leaves identical HTML untouched', () => {
    const html = '<html><head><title>x</title></head><body></body></html>';
    expect(strip(html)).toBe(html);
  });

  it('handles non-string input defensively', () => {
    expect(strip(undefined)).toBe(undefined);
    expect(strip(null)).toBe(null);
    expect(strip(42)).toBe(42);
  });

  it('matches the exact console-error beacon URL version', () => {
    const url = 'https://static.cloudflareinsights.com/beacon.min.js/v4513226cdae34746b4dedf0b4dfa099e1781791509496';
    const html = `<script defer src="${url}"></script>`;
    expect(strip(html)).toBe('');
  });
});
