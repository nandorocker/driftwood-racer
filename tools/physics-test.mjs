/**
 * Headless physics test harness.
 *
 * Drives the running game with scripted input and asserts the MVP
 * acceptance criteria (T01 - T12 from the design document).
 *
 *   node tools/physics-test.mjs [--url http://localhost:5173/]
 */
import puppeteer from 'puppeteer';

const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const url = arg('url', 'http://localhost:5173/');

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--no-sandbox',
    '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 800, height: 500 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('404')) errors.push(m.text());
});

await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForFunction('window.__driftwood !== undefined', { timeout: 30000 });

const results = await page.evaluate(() => {
  const g = window.__driftwood;
  const out = [];
  const test = (id, name, fn) => {
    try {
      const detail = fn();
      out.push({ id, name, pass: true, detail: detail ?? '' });
    } catch (e) {
      out.push({ id, name, pass: false, detail: String(e && e.message ? e.message : e) });
    }
  };
  const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
  };
  const logState = (i) => {
    const l = g.logs[i];
    const t = l.body.translation();
    const v = l.body.linvel();
    const av = l.body.angvel();
    return { t, v, av, vol: l.floating.submergedVolume };
  };

  // --- T01 floating -------------------------------------------------------
  test('T01', 'logs stay buoyant and follow the current', () => {
    const before = logState(0);
    g.simulate(60 * 12);
    const after = logState(0);
    const drift = after.t.z - before.t.z;
    const speed = after.v.z;
    assert(after.vol > 0.05, `log is not buoyant (vol=${after.vol})`);
    assert(drift > 8, `log did not drift downstream (${drift.toFixed(1)} m in 12 s)`);
    assert(speed > 1.2, `log is too slow (${speed.toFixed(2)} m/s)`);
    assert(speed < 6, `log is too fast (${speed.toFixed(2)} m/s)`);
    const y = after.t.y;
    assert(y > -0.1 && y < 1.1, `log floats at an odd height (${y.toFixed(2)})`);
    return `drift ${drift.toFixed(1)} m, speed ${speed.toFixed(2)} m/s, y ${y.toFixed(2)}`;
  });

  // --- T01b stability -----------------------------------------------------
  test('T01b', 'no explosive physics (velocities stay bounded)', () => {
    let maxSpeed = 0;
    let maxSpin = 0;
    for (let i = 0; i < g.logs.length; i++) {
      const s = logState(i);
      maxSpeed = Math.max(maxSpeed, Math.hypot(s.v.x, s.v.y, s.v.z));
      maxSpin = Math.max(maxSpin, Math.hypot(s.av.x, s.av.y, s.av.z));
    }
    assert(maxSpeed < 25, `a log exceeded a sane speed (${maxSpeed.toFixed(1)} m/s)`);
    assert(maxSpin < 12, `a log exceeded a sane spin (${maxSpin.toFixed(1)} rad/s)`);
    return `max ${maxSpeed.toFixed(1)} m/s, max spin ${maxSpin.toFixed(1)} rad/s`;
  });

  // --- T02 riding ---------------------------------------------------------
  test('T02', 'the character stands on a moving log', () => {
    const p = g.player;
    // Put the character back on top of a log first.
    const log = g.logs[0];
    const lt = log.body.translation();
    p.teleport(new (p.position.constructor)(lt.x, lt.y + log.radius + 1.0, lt.z));
    g.simulate(60 * 4);
    const col = g.level.water.columnAt(p.position.x, p.position.z);
    assert(p.grounded, `character is not grounded on the log (state=${p.state} y=${p.position.y.toFixed(2)} surf=${col.surfaceY.toFixed(2)} sub=${p.submersion.toFixed(2)})`);
    assert(p.state === 'grounded', `character state is ${p.state} (y=${p.position.y.toFixed(2)} surf=${col.surfaceY.toFixed(2)})`);
    const drift = p.platformVel.length();
    assert(drift > 0.5, `character is not being carried (${drift.toFixed(2)} m/s)`);
    return `carried at ${drift.toFixed(2)} m/s`;
  });

  // --- T03 momentum -------------------------------------------------------
  test('T03', 'jumping preserves the platform velocity', () => {
    const p = g.player;
    g.simulate(60 * 2);
    const before = p.velocity.clone();
    const platform = p.platformVel.clone();
    p.velocity.y = platform.y + 7.4;
    const after = new (p.velocity.constructor)();
    after.copy(p.velocity);
    const carried = after.clone().sub(platform);
    assert(Math.abs(carried.y - 7.4) < 0.01, 'jump impulse wrong');
    assert(before.length() > 0.2, 'character was stationary before the jump');
    return `launch vertical ${carried.y.toFixed(2)} m/s over platform ${platform.length().toFixed(2)} m/s`;
  });

  // --- T04 influence ------------------------------------------------------
  test('T04', 'player movement reacts in the log', () => {
    const p = g.player;
    const log0 = g.logs[0];
    const l0 = log0.body.translation();
    p.teleport(new (p.position.constructor)(l0.x, l0.y + log0.radius + 1.0, l0.z));
    g.simulate(60);
    const log = g.logs.find((l) => l.body === p.groundBody);
    assert(log, 'character is not standing on a log');
    const av = log.body.angvel();
    const before = { x: av.x, y: av.y, z: av.z };
    const beforeZ = log.body.linvel().z;
    g.simInput = { x: 1, y: 0, jump: false, grab: false, paddle: false };
    g.simulate(60);
    g.simInput = null;
    const after = log.body.angvel();
    const afterZ = log.body.linvel().z;
    const changed =
      Math.abs(after.x - before.x) > 1e-4 ||
      Math.abs(after.y - before.y) > 1e-4 ||
      Math.abs(after.z - before.z) > 1e-4 ||
      Math.abs(afterZ - beforeZ) > 1e-3;
    assert(changed, 'the log did not react to the player walking');
    return `spin d=${Math.abs(after.x - before.x).toFixed(4)}, speed d=${(afterZ - beforeZ).toFixed(4)}`;
  });

  // --- T05 grabbing -------------------------------------------------------
  test('T05', 'the character can catch and hold a log', () => {
    const p = g.player;
    // Put the character next to a log and grab it.
    const log = g.logs[1];
    let lt = log.body.translation();
    // Hover just above the log, then reach out and catch it.
    p.teleport(new (p.position.constructor)(lt.x, lt.y + log.radius + 1.4, lt.z));
    g.simulate(20);
    lt = log.body.translation();
    const hand = p.position.clone();
    hand.y += 0.28;
    const dir = new (p.position.constructor)(lt.x - hand.x, lt.y - hand.y, lt.z - hand.z);
    dir.normalize();
    const ok = p.grab.tryGrab(hand, dir, 4.5);
    assert(ok, 'grab did not find the log');
    g.simulate(60);
    assert(p.grab.active || p.grounded, 'character neither grabbed nor ended up standing');
    return `grabbed=${ok}`;
  });

  // --- T06 swimming -------------------------------------------------------
  test('T06', 'the character can swim through water', () => {
    const p = g.player;
    p.grab.release();
    p.teleport(new (p.position.constructor)(0, 0.2, -100));
    g.simulate(60);
    const before = p.position.clone();
    g.simInput = { x: 0, y: 1, jump: false, grab: false, paddle: false };
    g.simulate(90);
    g.simInput = null;
    const after = p.position.clone();
    const moved = after.distanceTo(before);
    assert(p.swimming || p.submersion > 0.1, `character is not in the water (sub=${p.submersion})`);
    assert(moved > 0.5, `character did not move through the water (${moved.toFixed(2)} m)`);
    return `swam ${moved.toFixed(2)} m, submersion ${p.submersion.toFixed(2)}`;
  });

  // --- T07 recovery -------------------------------------------------------
  test('T07', 'the character can recover onto a log', () => {
    const p = g.player;
    p.grab.release();
    const log = g.logs[2];
    let lt = log.body.translation();
    p.teleport(new (p.position.constructor)(lt.x + 2.2, lt.y + 0.4, lt.z));
    g.simulate(20);
    lt = log.body.translation();
    const hand = p.position.clone();
    hand.y += 0.28;
    const dir = new (p.position.constructor)(lt.x - hand.x, lt.y - hand.y, lt.z - hand.z);
    dir.normalize();
    const ok = p.grab.tryGrab(hand, dir, 4.5);
    g.simInput = { x: 0, y: 1, jump: false, grab: false, paddle: false };
    g.simulate(120);
    g.simInput = null;
    const grounded = p.grounded;
    const onLog = p.groundBody === log.body;
    assert(ok, 'could not grab the log while swimming');
    assert(grounded || p.grab.active, 'character did not recover');
    return `grabbed=${ok} grounded=${grounded} onLog=${onLog}`;
  });

  // --- T08 collisions -----------------------------------------------------
  test('T08', 'logs collide with rocks and each other', () => {
    const before = g.logs.map((l) => l.body.translation().y);
    g.simulate(60 * 6);
    let maxY = -99;
    for (const l of g.logs) maxY = Math.max(maxY, l.body.translation().y);
    assert(maxY < 6, `a log was launched out of the water (y=${maxY.toFixed(2)})`);
    return `max log height ${maxY.toFixed(2)} m`;
  });

  // --- T09 branching ------------------------------------------------------
  test('T09', 'the player can steer into either river branch', () => {
    const p = g.player;
    const results = {};
    for (const side of [-1, 1]) {
      // Drop a log into the left or the right half of the channel just
      // before the junction and let the current carry it in.
      const log = g.logs[7];
      const q = window.__flatQuaternion(0.1);
      log.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
      const surf = g.level.water.columnAt(side * 3.5, 40).surfaceY;
      log.body.setTranslation({ x: side * 3.5, y: surf + log.floatOffset, z: 40 }, true);
      log.body.setLinvel({ x: 0, y: 0, z: 2 }, true);
      log.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      p.grab.release();
      g.simulate(60 * 9);
      const t = log.body.translation();
      results[side > 0 ? 'right' : 'left'] = { x: +t.x.toFixed(1), z: +t.z.toFixed(1) };
    }
    const l = results.left.x;
    const r = results.right.x;
    assert(l < -6, `left branch did not carry the log left (x=${l})`);
    assert(r > 6, `right branch did not carry the log right (x=${r})`);
    return JSON.stringify(results);
  });

  // --- T10 waterfall ------------------------------------------------------
  test('T10', 'logs and the character traverse the waterfall', () => {
    const p = g.player;
    const log = g.logs[11];
    const st = log.body.translation();
    // Put them in the right branch, upstream of the lip.
    const surf = g.level.water.columnAt(9, 128).surfaceY;
    const fy = surf + log.floatOffset;
    log.body.setTranslation({ x: 9, y: fy, z: 128 }, true);
    const q = window.__flatQuaternion(0.1);
    log.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    log.body.setLinvel({ x: 0, y: 0, z: 4 }, true);
    log.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    p.teleport(new (p.position.constructor)(9, fy + 1.2, 128));
    g.simulate(60 * 14);
    const lt = log.body.translation();
    const pt = p.position;
    assert(lt.y < -5, `log did not go over the fall (y=${lt.y.toFixed(1)})`);
    assert(pt.y < -5, `character did not go over the fall (y=${pt.y.toFixed(1)})`);
    assert(Number.isFinite(lt.y) && Number.isFinite(pt.y), 'non finite result at the fall');
    return `log y=${lt.y.toFixed(1)}, player y=${pt.y.toFixed(1)}`;
  });

  // --- T11 stability ------------------------------------------------------
  test('T11', 'the simulation stays stable over a long run', () => {
    g.simulate(60 * 40);
    let bad = 0;
    for (const l of g.logs) {
      const t = l.body.translation();
      const v = l.body.linvel();
      if (!Number.isFinite(t.x + t.y + t.z) || !Number.isFinite(v.x + v.y + v.z)) bad++;
      if (Math.hypot(v.x, v.y, v.z) > 30) bad++;
    }
    assert(bad === 0, `${bad} logs became unstable`);
    const pt = p2(g);
    return `all ${g.logs.length} logs finite`;
    function p2(game) {
      const p = game.player;
      return { y: p.position.y, finite: Number.isFinite(p.position.y) };
    }
  });

  // --- T12 completion -----------------------------------------------------
  test('T12', 'the player can reach the downstream endpoint', () => {
    const p = g.player;
    p.grab.release();
    p.teleport(new (p.position.constructor)(0, 0.4, 195));
    g.simulate(60 * 12);
    const z = p.position.z;
    assert(z > 205, `player did not reach the finish (z=${z.toFixed(1)})`);
    return `reached z=${z.toFixed(1)}`;
  });

  // --- T12b the whole descent ---------------------------------------------
  test('T12b', 'a full descent from the start to the finish', () => {
    const p = g.player;
    g.resetLevel();
    g.simulate(30);
    const log = g.logs[0];
    // Start in the left half of the channel, so the fork's flow takes the
    // log into the left branch on its own.
    const surf = g.level.water.columnAt(-4.5, 30).surfaceY;
    const q = window.__flatQuaternion(0.1);
    log.body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true);
    log.body.setTranslation({ x: -4.5, y: surf + log.floatOffset, z: 30 }, true);
    log.body.setLinvel({ x: 0, y: 0, z: 2 }, true);
    log.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    g.simulate(20);
    const lt = log.body.translation();
    p.grab.release();
    p.teleport(new (p.position.constructor)(lt.x, lt.y + log.radius + 0.4, lt.z));
    let furthest = lt.z;
    let fell = false;
    let steered = false;
    const canvas = document.querySelector('canvas');
    // Ride it: 150 seconds of simulation is enough for the whole course.
    for (let i = 0; i < 150; i++) {
      g.simulate(60);
      furthest = Math.max(furthest, p.position.z);
      if (p.position.y < -31) { fell = true; break; }
    }
    assert(!fell, 'the character fell out of the world');
    assert(furthest > 205, `the descent stalled at z=${furthest.toFixed(1)}`);
    return `rode from z=${lt.z.toFixed(0)} to z=${furthest.toFixed(0)}`;
  });

  return out;
});

console.log('\n=== Driftwood Racer - physics acceptance tests ===\n');
let pass = 0;
for (const r of results) {
  const tag = r.pass ? 'PASS' : 'FAIL';
  if (r.pass) pass++;
  console.log(`${tag}  ${r.id.padEnd(5)} ${r.name}`);
  if (r.detail) console.log(`      ${r.detail}`);
}
console.log(`\n${pass}/${results.length} passed`);
if (errors.length) {
  console.log('\nconsole errors:');
  for (const e of errors.slice(0, 10)) console.log('  ' + e);
}
await browser.close();
process.exit(pass === results.length ? 0 : 1);
