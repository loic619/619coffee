#!/usr/bin/env node
// Drive the running app in a headless browser: sign in through the gate,
// navigate, optionally click, screenshot, and report console errors.
//
// Usage (from frontend/, with the server already running):
//   APP_ACCESS=<code> node ../.claude/skills/run-app/scripts/drive.mjs \
//     --path '/demand?tab=certified' \
//     --wait 'text=Antwerp' \
//     --out /tmp/shot.png \
//     [--click 'button:has-text("port")'] [--full] [--port 3002]
//
// Why a bundled script: every visual check needs the same six unobvious
// steps (gate login, UA override, element-based wait, chromium path, error
// capture). Rewriting them per task is where the time goes.

import { createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';

// This script lives outside frontend/, but playwright is installed inside it.
// Node resolves bare specifiers from the importing FILE's directory, not the
// cwd, so import it through a require rooted at wherever you ran this from.
const require = createRequire(process.cwd() + '/');
let chromium;
try { ({ chromium } = require('playwright')); }
catch {
  console.error('playwright not found. Run from frontend/ after: npm i -D playwright --no-save');
  process.exit(1);
}

const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? dflt : (process.argv[i + 1]?.startsWith('--') ? true : process.argv[i + 1]);
};
const has = name => process.argv.includes(`--${name}`);

const PORT = arg('port', process.env.APP_PORT || '3002');
const PATHNAME = arg('path', '/');
const OUT = arg('out', '/tmp/app-screenshot.png');
const WAIT = arg('wait', null);
const CLICK = arg('click', null);
const BASE = `http://localhost:${PORT}`;

// Playwright's bundled browser revision rarely matches the image's, so resolve
// whatever Chromium is actually installed rather than trusting the default.
const root = '/opt/pw-browsers';
const executablePath = !existsSync(root) ? null : readdirSync(root)
  .filter(d => /^chromium-\d+$/.test(d))
  .map(d => `${root}/${d}/chrome-linux/chrome`)
  .filter(existsSync)
  .sort()
  .at(-1);
if (!executablePath) {
  console.error('No Chromium under /opt/pw-browsers — is this the standard image?');
  process.exit(1);
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  viewport: { width: Number(arg('width', 1500)), height: Number(arg('height', 1000)) },
  // The middleware treats any UA containing "headless" as a bot. Present as a
  // normal browser or the gate never lets you through.
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
});
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url().replace(BASE, '')}`); });

// ── Gate ────────────────────────────────────────────────────────────────────
// /welcome posts to /api/identify. Name is free-form; the password must match
// GATE_PW_USER on the server (see SKILL.md).
await page.goto(`${BASE}/welcome`, { waitUntil: 'domcontentloaded' });
if (page.url().includes('/welcome')) {
  await page.fill('input[name="first"]', 'Claude');
  await page.fill('input[name="last"]', 'Agent');
  await page.fill('input[name="password"]', process.env.APP_ACCESS ?? '');
  await page.click('button');
  await page.waitForTimeout(2000);
  if (page.url().includes('err=2')) {
    console.error('Gate rejected the access code. Is GATE_PW_USER set on the server to the same value as APP_ACCESS?');
    await browser.close();
    process.exit(1);
  }
}

// ── Navigate ────────────────────────────────────────────────────────────────
// Never wait for networkidle: the app polls live data, so it never settles and
// you get a 60s timeout instead of a page. Wait for a real element.
errors.length = 0;
await page.goto(`${BASE}${PATHNAME}`, { waitUntil: 'domcontentloaded' });
if (WAIT) {
  try { await page.waitForSelector(WAIT, { timeout: 45000 }); }
  catch { console.error(`WARNING: never saw ${WAIT} — the page may not have loaded its data.`); }
}
await page.waitForTimeout(Number(arg('settle', 4000)));

if (CLICK) { await page.locator(CLICK).first().click(); await page.waitForTimeout(1000); }

await page.screenshot({ path: OUT, fullPage: has('full') });
console.log(`screenshot: ${OUT}`);
console.log(`url: ${page.url()}`);
console.log('console/network errors:', errors.length ? errors.slice(0, 6) : 'none');
await browser.close();
