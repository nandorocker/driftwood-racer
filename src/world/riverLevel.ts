/**
 * RiverLevel
 * ---------------------------------------------------------------------------
 * The whole "First Descent" course in one place: the channel network, the
 * terrain shaping rules, the obstacles, the log spawns and the endpoints.
 *
 * Downstream is +Z. Water surface of the upper river is y = 0.
 *
 *   A  z -150 .. -70   gentle current
 *   B  z  -70 ..  42   winding river with boulders
 *   C  z   42 .. 138   fork: wide slow left / narrow fast right
 *   D  z  138 .. 152   waterfall
 *   E  z  152 .. 215   recovery pool + finish
 */

import { Channel, ChannelNode, WaterFlowSystem, WaterfallDef } from './waterFlowSystem';

export const RIVER = {
  /** Water surface of the upper river. */
  surfaceY: 0,
  /** Depth of the carved river bed below the surface. */
  bedDepth: 4.0,
  /** Height of the surrounding land above the water. */
  plateau: 2.6,
  /** Width of the bank slope between the water line and the plateau. */
  bankWidth: 8.0,
  /** Height of the plunge pool surface (relative to the upper river). */
  poolY: -24,
  /** Depth of the plunge pool below its surface. */
  poolDepth: 4.5,
  /** Z of the waterfall lip. */
  lipZ: 138,
  /** Z where the cliff turns into the pool basin. */
  basinZ: 140.5,
  /** Z of the finish line. */
  finishZ: 208,
  /** Half width of the fall. */
  fallHalfWidth: 17,
  /** Horizontal speed of the water at the lip. */
  fallSpeed: 6.4,
};

export interface RockSpec {
  x: number;
  z: number;
  radius: number;
  height: number;
  /** Y offset of the rock relative to the local bed. */
  sink: number;
  seed: number;
  /** Extra flow deflection around the rock. */
  strength: number;
}

export interface LogSpawn {
  x: number;
  z: number;
  y: number;
  /** Yaw of the log around the vertical axis (radians). */
  yaw: number;
  length?: number;
  radius?: number;
  mass?: number;
}

export interface TreeSpec {
  x: number;
  z: number;
  scale: number;
  seed: number;
}

export interface RiverLevelData {
  water: WaterFlowSystem;
  channels: Channel[];
  rocks: RockSpec[];
  logs: LogSpawn[];
  trees: TreeSpec[];
  start: { x: number; z: number };
  finish: { x: number; z: number; zEnd: number };
}

function n(
  x: number, z: number, halfWidth: number, speed: number,
  turbulence = 0.4, y = RIVER.surfaceY,
): ChannelNode {
  return { x, y, z, halfWidth, speed, turbulence };
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    ((2 * p1) +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Resample a control polyline into a smooth Catmull-Rom spline so both the
 * flow field and the visible surface follow the same gentle curve.
 */
function resample(nodes: ChannelNode[], spacing = 3.0): ChannelNode[] {
  const n = nodes.length;
  if (n < 2) return nodes.slice();
  const out: ChannelNode[] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = nodes[Math.max(0, i - 1)];
    const p1 = nodes[i];
    const p2 = nodes[i + 1];
    const p3 = nodes[Math.min(n - 1, i + 2)];
    const len = Math.hypot(p2.x - p1.x, p2.z - p1.z);
    const steps = Math.max(1, Math.round(len / spacing));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      out.push({
        x: cr(p0.x, p1.x, p2.x, p3.x, t),
        y: cr(p0.y, p1.y, p2.y, p3.y, t),
        z: cr(p0.z, p1.z, p2.z, p3.z, t),
        halfWidth: p1.halfWidth + (p2.halfWidth - p1.halfWidth) * t,
        speed: p1.speed + (p2.speed - p1.speed) * t,
        turbulence: p1.turbulence + (p2.turbulence - p1.turbulence) * t,
      });
    }
  }
  out.push({ ...nodes[n - 1] });
  return out;
}

/** Build the level: channels, flow system, props. */
export function buildRiverLevel(): RiverLevelData {
  const channels: Channel[] = [];
  const water = new WaterFlowSystem();

  // ---------------------------------------------------------------- section A
  // Wide and calm - a place to learn how a log moves.
  const a = new Channel([
    n(0, -156, 13.0, 2.4, 0.25),
    n(0, -132, 13.5, 3.0, 0.3),
    n(0, -108, 13.5, 3.2, 0.35),
    n(1.5, -88, 12.5, 3.3, 0.35),
    n(2, -70, 11.5, 3.5, 0.4),
  ]);
  channels.push(a);

  // ---------------------------------------------------------------- section B
  // The bend: current speeds up, boulders force steering decisions.
  const b = new Channel([
    n(2, -70, 11.5, 3.5, 0.4),
    n(6, -52, 11.0, 3.9, 0.5),
    n(12, -34, 10.0, 4.3, 0.6),
    n(15, -16, 9.2, 4.7, 0.6),
    n(11, 2, 9.0, 4.9, 0.55),
    n(3, 16, 9.0, 5.0, 0.5),
    n(0, 30, 9.0, 5.0, 0.45),
    n(0, 42, 9.0, 5.0, 0.4),
  ]);
  channels.push(b);

  // ---------------------------------------------------------------- section C
  // The fork. The upstream channel is tiled by the two branches at z = 42 so
  // the water splits cleanly at the junction.
  const cLeft = new Channel([
    n(-4.5, 42, 4.5, 5.0, 0.4),
    n(-9.5, 52, 5.6, 4.5, 0.45),
    n(-16, 66, 7.0, 4.0, 0.5),
    n(-21, 84, 8.0, 3.7, 0.55),
    n(-21.5, 102, 8.0, 3.7, 0.6),
    n(-16, 118, 7.0, 4.2, 0.7),
    n(-9, 130, 7.5, 5.4, 0.9),
    n(-5, 138, 10.0, RIVER.fallSpeed, 1.1),
  ]);
  channels.push(cLeft);

  const cRight = new Channel([
    n(4.5, 42, 4.5, 5.0, 0.4),
    n(10, 52, 5.0, 5.4, 0.6),
    n(16, 66, 5.0, 6.0, 0.8),
    n(20, 84, 5.0, 6.4, 0.9),
    n(20, 102, 5.0, 6.5, 0.9),
    n(16, 118, 5.5, 6.5, 0.8),
    n(10, 130, 7.0, 6.5, 0.7),
    n(5, 138, 10.0, RIVER.fallSpeed, 0.7),
  ]);
  channels.push(cRight);

  // ---------------------------------------------------------------- section E
  // Recovery pool. It does not carve the terrain (the basin is shaped
  // explicitly) but it does carry the water.
  const pool = new Channel([
    n(0, RIVER.basinZ, 21, 1.0, 1.0, RIVER.poolY),
    n(0, 152, 20, 1.4, 1.1, RIVER.poolY),
    n(-2, 168, 18, 1.8, 0.8, RIVER.poolY),
    n(-1, 184, 15, 2.2, 0.6, RIVER.poolY),
    n(0, 200, 13, 2.6, 0.5, RIVER.poolY),
    n(0, 216, 12, 2.8, 0.5, RIVER.poolY),
  ], { carveTerrain: false });
  channels.push(pool);

  const smooth = channels.map((ch) =>
    new Channel(resample(ch.nodes), {
      carveTerrain: ch.carveTerrain,
      participates: ch.participates,
    }),
  );
  for (const ch of smooth) water.addChannel(ch);

  // The fork: the upstream channel (B) hands over to the two branches.
  const junction = channels[1].nodes[channels[1].nodes.length - 1];
  water.addFork({
    upstream: 1,
    branches: [2, 3],
    x: junction.x,
    y: junction.y,
    z: junction.z,
    dirX: 0,
    dirZ: 1,
    halfWidth: 9,
    blendLength: 26,
  });

  // ---------------------------------------------------------------- waterfall
  const fall: WaterfallDef = {
    lipX: 0,
    lipY: RIVER.surfaceY,
    lipZ: RIVER.lipZ,
    dirX: 0,
    dirZ: 1,
    halfWidth: RIVER.fallHalfWidth,
    v0: RIVER.fallSpeed,
    poolY: RIVER.poolY,
    g: 9.81,
    thickness: 1.1,
  };
  water.waterfall = fall;
  water.poolY = RIVER.poolY;

  // ------------------------------------------------------------------- rocks
  const rocks: RockSpec[] = [
    // Section B - boulders in the bend.
    { x: 8, z: -46, radius: 2.6, height: 3.4, sink: 1.4, seed: 11, strength: 1.0 },
    { x: 14.5, z: -24, radius: 1.9, height: 2.8, sink: 1.2, seed: 23, strength: 0.9 },
    { x: 4.5, z: -6, radius: 2.2, height: 3.0, sink: 1.3, seed: 37, strength: 0.95 },
    { x: 6.5, z: 20, radius: 1.6, height: 2.4, sink: 1.0, seed: 51, strength: 0.8 },
    // Section C - a couple of rocks guarding the junction.
    { x: -2.6, z: 34, radius: 1.5, height: 2.2, sink: 1.0, seed: 67, strength: 0.7 },
    { x: -13.5, z: 74, radius: 2.4, height: 3.0, sink: 1.3, seed: 83, strength: 1.0 },
    { x: 14.5, z: 96, radius: 1.7, height: 2.5, sink: 1.1, seed: 97, strength: 0.9 },
    { x: -24.5, z: 110, radius: 1.4, height: 2.1, sink: 0.9, seed: 113, strength: 0.7 },
    // Plunge pool - a few submerged teeth to break the landing.
    { x: -7, z: 158, radius: 1.8, height: 2.6, sink: 1.4, seed: 131, strength: 0.6 },
    { x: 8, z: 165, radius: 1.5, height: 2.2, sink: 1.2, seed: 149, strength: 0.5 },
  ];

  // ------------------------------------------------------------------- logs
  const logs: LogSpawn[] = [
    { x: -2.5, z: -140, y: 0, yaw: 0.12, length: 6.2 },
    { x: 4.5, z: -120, y: 0, yaw: -0.25, length: 5.6 },
    { x: 0, z: -100, y: 0, yaw: 0.4, length: 6.6 },
    { x: 7.5, z: -60, y: 0, yaw: -0.15, length: 5.8 },
    { x: 10.5, z: -30, y: 0, yaw: 0.3, length: 6.2 },
    { x: 6.0, z: 4, y: 0, yaw: -0.4, length: 5.4 },
    { x: -2.0, z: 26, y: 0, yaw: 0.2, length: 6.0 },
    { x: -14, z: 60, y: 0, yaw: 0.5, length: 5.8 },
    { x: -20, z: 90, y: 0, yaw: -0.2, length: 6.2 },
    { x: 14, z: 58, y: 0, yaw: -0.5, length: 5.6 },
    { x: 19, z: 92, y: 0, yaw: 0.35, length: 6.0 },
    { x: -4, z: 130, y: 0, yaw: 0.1, length: 5.8 },
    { x: 5, z: 128, y: 0, yaw: -0.3, length: 5.6 },
    { x: -8, z: 160, y: RIVER.poolY, yaw: 0.45, length: 6.0 },
    { x: 7, z: 172, y: RIVER.poolY, yaw: -0.15, length: 5.8 },
    { x: 0, z: 190, y: RIVER.poolY, yaw: 0.25, length: 6.4 },
  ];

  // ------------------------------------------------------------------ trees
  const trees: TreeSpec[] = [];
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = 0; i < 320; i++) {
    const z = -150 + rand() * 365;
    const side = rand() < 0.5 ? -1 : 1;
    const x = side * (14 + rand() * 24);
    trees.push({ x, z, scale: 0.75 + rand() * 0.9, seed: Math.floor(rand() * 100000) });
  }

  return {
    water,
    channels: smooth,
    rocks,
    logs,
    trees,
    start: { x: -2.5, z: -140 },
    finish: { x: 0, z: RIVER.finishZ, zEnd: RIVER.finishZ + 30 },
  };
}
