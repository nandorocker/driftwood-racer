/**
 * Focused diagnostics: traces the player / log state over time.
 *   node tools/trace.mjs --script "<js>"   (runs inside the page)
 */
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const script = arg('script', 'return 1;');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(arg('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction('window.__driftwood !== undefined', { timeout: 30000 });

const out = await page.evaluate(script);
console.log(JSON.stringify(out, null, 2));
await browser.close();
