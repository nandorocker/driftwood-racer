/**
 * Input + performance smoke test.
 *   node tools/input-test.mjs
 */
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(arg('url', 'http://localhost:5173/'), { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction('window.__driftwood !== undefined', { timeout: 30000 });

// --- physics performance ---------------------------------------------------
const perf = await page.evaluate(() => {
  const g = window.__driftwood;
  const t0 = performance.now();
  g.simulate(600);
  const t1 = performance.now();
  return {
    msPer600Steps: +(t1 - t0).toFixed(1),
    msPerStep: +((t1 - t0) / 600).toFixed(3),
    budgetAt60fps: 16.6,
  };
});
console.log('physics:', JSON.stringify(perf));

// --- keyboard ---------------------------------------------------------------
await page.evaluate(() => {
  const g = window.__driftwood;
  window.__probe = { start: g.player.position.clone(), jumped: false, state: '' };
  g.simInput = { x: 0, y: 1, jump: false, grab: false, paddle: false };
});
await page.keyboard.down('KeyW');
await page.evaluate(() => window.__driftwood.simulate(90));
const walked = await page.evaluate(() => {
  const g = window.__driftwood;
  const d = g.player.position.distanceTo(window.__probe.start);
  window.__probe.state = g.player.state;
  return { moved: +d.toFixed(2), state: g.player.state };
});
await page.keyboard.up('KeyW');
console.log('walk (W):', JSON.stringify(walked));

// --- jump ------------------------------------------------------------------
const beforeJump = await page.evaluate(() => {
  const g = window.__driftwood;
  // Stand on a log first.
  const log = g.logs[0];
  const lt = log.body.translation();
  g.player.teleport(new g.player.position.constructor(lt.x, lt.y + log.radius + 0.2, lt.z));
  g.simInput = { x: 0, y: 0, jump: false, grab: false, paddle: false };
  g.simulate(45);
  g.player.velocity.y = 0;
  g.simulate(2);
  return { vy: +g.player.velocity.y.toFixed(2), grounded: g.player.grounded };
});
await page.keyboard.press('Space');
const jumped = await page.evaluate(
  (b) => {
    const g = window.__driftwood;
    let peak = 0;
    for (let i = 0; i < 20; i++) {
      g.simulate(1);
      peak = Math.max(peak, g.player.velocity.y);
    }
    return { before: b.vy, grounded: b.grounded, peak: +peak.toFixed(2) };
  },
  beforeJump,
);
console.log('jump (space):', JSON.stringify(jumped));

// --- grab ------------------------------------------------------------------
const grabbed = await page.evaluate(() => {
  const g = window.__driftwood;
  const p = g.player;
  const log = g.logs[2];
  const lt = log.body.translation();
  p.teleport(new p.position.constructor(lt.x + 2.2, lt.y + log.radius + 0.4, lt.z));
  g.simulate(10);
  const hand = p.position.clone();
  hand.y += 0.28;
  const dir = new p.position.constructor(lt.x - hand.x, lt.y - hand.y, lt.z - hand.z).normalize();
  const ok = p.grab.tryGrab(hand, dir, 4.5);
  g.simulate(30);
  return { grabbed: ok, active: p.grab.active, state: p.state };
});
console.log('grab (LMB):', JSON.stringify(grabbed));

// --- paddle ----------------------------------------------------------------
const paddled = await page.evaluate(() => {
  const g = window.__driftwood;
  const p = g.player;
  p.grab.release();
  p.teleport(new p.position.constructor(0, 0.2, -100));
  g.simulate(60);
  const before = p.velocity.clone();
  g.simInput = { x: 0, y: 1, jump: false, grab: false, paddle: true };
  // the paddle listens to the right mouse button
  const canvas = document.querySelector('canvas');
  window.__input.locked = true;
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
  g.simulate(30);
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
  window.__input.locked = false;
  g.simInput = null;
  return { before: +before.length().toFixed(2), after: +p.velocity.length().toFixed(2), state: p.state };
});
console.log('paddle (RMB):', JSON.stringify(paddled));

await browser.close();
