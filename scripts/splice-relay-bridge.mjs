// Idempotently splices the thay-auth relay bridge into thaypley.com's
// index.html so the account-switcher cookie warms the destination session.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const bridgePath = join(here, 'relay-bridge.inline.js');
const target = process.argv[2] || '/Volumes/stalphXO/2026/thaypley-workspaces/thaypley/index.html';

if (!existsSync(target)) {
  console.error('target not found:', target);
  process.exit(1);
}
if (!existsSync(bridgePath)) {
  console.error('bridge file missing:', bridgePath);
  process.exit(1);
}

const html = readFileSync(target, 'utf8');
const bridge = readFileSync(bridgePath, 'utf8').trim();
const marker = 'thay-auth relay bridge';

if (html.includes(marker)) {
  console.log('relay bridge already present — no change');
  process.exit(0);
}

const injection = '\n<script>\n' + bridge + '\n</script>\n';
const closeBody = html.lastIndexOf('</body>');
if (closeBody === -1) {
  console.error('</body> not found — aborting');
  process.exit(1);
}

const updated = html.slice(0, closeBody) + injection + html.slice(closeBody);
writeFileSync(target, updated);
console.log('relay bridge spliced into', target, '(' + bridge.length + ' bytes before </body>)');
