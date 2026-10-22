/**
 * Headless smoke test / screenshot tool.
 *
 *   node tools/screenshot.mjs [--url http://localhost:5173] [--out shots/x.png]
 *                              [--wait 4000] [--script "js expression"]
 *
 * Loads the game in headless Chrome, forwards console output, optionally runs
 * an expression in the page, and writes a screenshot.
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const url = arg('url', 'http://localhost:5173/');
const out = arg('out', 'shots/frame.png');
const wait = parseInt(arg('wait', '5000'), 10);
const script = arg('script', null);
const width = parseInt(arg('w', '1280'), 10);
const height = parseInt(arg('h', '760'), 10);

mkdirSync(dirname(out), { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    `--window-size=${width},${height}`,
  ],
});

const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });

const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));
page.on('requestfailed', (r) => logs.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, wait));

// Dismiss the click-to-play overlay so the render is visible.
await page.evaluate(() => {
  document.getElementById('click-to-play')?.classList.add('hidden');
  document.getElementById('title')?.classList.remove('show');
  document.getElementById('vignette')?.setAttribute('style', 'display:none');
});

if (script) {
  try {
    const result = await page.evaluate(script);
    console.log('SCRIPT RESULT:', JSON.stringify(result, null, 2));
  } catch (e) {
    console.log('SCRIPT ERROR:', e.message);
  }
}

await page.screenshot({ path: out });
console.log(`screenshot -> ${out}`);
console.log('--- console ---');
console.log(logs.slice(0, 60).join('\n') || '(clean)');

await browser.close();
