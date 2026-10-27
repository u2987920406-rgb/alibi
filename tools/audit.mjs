// Runs tools/audit.html in headless Chrome, twice: normal motion and with
// prefers-reduced-motion forced, and prints both reports.
// Usage: node tools/audit.mjs [baseUrl] [--verbose] [--reduced-only] [--normal-only]
// Needs the site served over http (fetch of cases.json), default port 8140.
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:8140';
const verbose = args.includes('--verbose');
const runs = args.includes('--reduced-only') ? [true] : args.includes('--normal-only') ? [false] : [false, true];

let pass = true;
for (const reduced of runs) {
  const query = [verbose && 'verbose', reduced && 'reduced'].filter(Boolean).join('&');
  const dom = execFileSync('/usr/bin/google-chrome', [
    '--headless=new',
    '--hide-scrollbars',
    '--virtual-time-budget=240000',
    '--window-size=1500,1000',
    ...(reduced ? ['--force-prefers-reduced-motion'] : []),
    '--dump-dom',
    `${base}/tools/audit.html${query ? `?${query}` : ''}`,
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 });
  const match = dom.match(/<pre id="audit-out">([\s\S]*?)<\/pre>/);
  const text = (match ? match[1] : 'no audit output — RESULT FAIL')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  console.log(text);
  console.log('');
  if (!text.includes('RESULT PASS')) pass = false;
}
console.log(pass ? 'AUDIT PASS' : 'AUDIT FAIL');
process.exit(pass ? 0 : 1);
