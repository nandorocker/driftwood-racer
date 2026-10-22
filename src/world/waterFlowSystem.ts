/**
 * WaterFlowSystem
 * ---------------------------------------------------------------------------
 * The river is *not* a fluid simulation. It is a network of flow "channels"
 * (spline guided volumes) plus one explicit waterfall, queried through a
 * single interface:
 *
 *     SampleWater(worldPosition) -> { surfaceY, depth, velocity, present, ... }
 *
 * Logs and the character both read from this same interface, so the physical
 * behaviour can be retuned (or the implementation swapped) without touching
 * anything that consumes it.
 */

import { fbm2 } from '../core/noise';

export interface ChannelNode {
  /** Centreline position. `y` is the water surface height. */
  x: number;
  y: number;
  z: number;
  /** Half width of the wetted channel at this node. */
  halfWidth: number;
  /** Centreline flow speed (m/s). */
  speed: number;
  /** Extra turbulence multiplier. */
  turbulence: number;
}

export interface ChannelSample {
  /** Distance from the centreline (m). */
  dist: number;
  /** 0 at the centreline, 1 at the bank. */
  lateral: number;
  /** Interpolated water surface height. */
  surfaceY: number;
  /** Interpolated centreline speed. */
  speed: number;
  /** Interpolated turbulence. */
  turbulence: number;
  /** Unit downstream direction (XZ). */
  dirX: number;
  dirZ: number;
  /** Signed offset of the sample from the centreline (positive = right). */
  signedOffset: number;
  /** True when the closest point sits on the channel's end cap. */
  atCap: boolean;
  /** Arc-length position of the closest point. */
  along: number;
  /** Interpolated half width. */
  halfWidth: number;
}

function makeSample(): ChannelSample {
  return {
    dist: 0, lateral: 0, surfaceY: 0, speed: 0, turbulence: 0,
    dirX: 0, dirZ: 1, signedOffset: 0, atCap: false, along: 0, halfWidth: 1,
  };
}

export class Channel {
  readonly nodes: ChannelNode[];
  /** Distances between consecutive nodes (XZ). */
  private readonly segLen: number[] = [];
  /** Total XZ arc length. */
  readonly length: number;
  /** Whether the channel carves the terrain. */
  carveTerrain: boolean;
  /** Whether the channel is used for the flow field at all. */
  participates: boolean;

  constructor(nodes: ChannelNode[], opts: { carveTerrain?: boolean; participates?: boolean } = {}) {
    this.nodes = nodes;
    this.carveTerrain = opts.carveTerrain ?? true;
    this.participates = opts.participates ?? true;
    let total = 0;
    for (let i = 0; i < nodes.length - 1; i++) {
      const d = Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].z - nodes[i].z);
      this.segLen.push(d);
      total += d;
    }
    this.length = total;
  }

  /** Closest point on the centreline (flat end caps). */
  closest(x: number, z: number, out: ChannelSample = makeSample()): ChannelSample {
    const res = out;
    const nodes = this.nodes;

    let best = Infinity;
    let bestSeg = 0;
    let bestT = 0;

    for (let i = 0; i < this.segLen.length; i++) {
      const a = nodes[i];
      const b = nodes[i + 1];
      const abx = b.x - a.x;
      const abz = b.z - a.z;
      const len2 = abx * abx + abz * abz;
      let t = len2 > 1e-9 ? ((x - a.x) * abx + (z - a.z) * abz) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = a.x + abx * t;
      const pz = a.z + abz * t;
      const d = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d < best) {
        best = d;
        bestSeg = i;
        bestT = t;
      }
    }

    if (nodes.length === 1) {
      res.dist = Math.hypot(x - nodes[0].x, z - nodes[0].z);
      res.surfaceY = nodes[0].y;
      res.speed = nodes[0].speed;
      res.turbulence = nodes[0].turbulence;
      res.halfWidth = nodes[0].halfWidth;
      res.dirX = 0; res.dirZ = 1;
      res.signedOffset = 0;
      res.along = 0;
      res.atCap = true;
      return res;
    }

    const a = nodes[bestSeg];
    const b = nodes[bestSeg + 1];
    const px = a.x + (b.x - a.x) * bestT;
    const pz = a.z + (b.z - a.z) * bestT;

    res.dist = Math.sqrt(best);
    res.surfaceY = a.y + (b.y - a.y) * bestT;
    res.speed = a.speed + (b.speed - a.speed) * bestT;
    res.turbulence = a.turbulence + (b.turbulence - a.turbulence) * bestT;
    res.halfWidth = a.halfWidth + (b.halfWidth - a.halfWidth) * bestT;

    let dx = b.x - a.x;
    let dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    res.dirX = dx;
    res.dirZ = dz;

    // Signed lateral offset: positive when the sample is to the right of the flow.
    res.signedOffset = (x - px) * dz - (z - pz) * dx;
    res.lateral = Math.abs(res.signedOffset) / Math.max(0.001, res.halfWidth);

    let along = 0;
    for (let i = 0; i < bestSeg; i++) along += this.segLen[i];
    along += this.segLen[bestSeg] * bestT;
    res.along = along;
    res.atCap =
      (bestSeg === 0 && bestT === 0) ||
      (bestSeg === this.segLen.length - 1 && bestT === 1);
    return res;
  }
}

export interface WaterfallDef {
  /** Lip position (water leaves the rock here). */
  lipX: number;
  lipY: number;
  lipZ: number;
  /** Unit horizontal direction of the fall. */
  dirX: number;
  dirZ: number;
  /** Half width of the falling sheet. */
  halfWidth: number;
  /** Horizontal speed of the water at the lip (m/s). */
  v0: number;
  /** Water surface height of the plunge pool. */
  poolY: number;
  /** Gravity used for the trajectory. */
  g: number;
  /** Thickness of the falling sheet. */
  thickness: number;
}

export interface WaterSample {
  /** True when the point is inside a water body. */
  present: boolean;
  /** Height of the water surface at this point. */
  surfaceY: number;
  /** Thickness of the water column below the surface. */
  depth: number;
  /** Water velocity (world space). */
  vx: number;
  vy: number;
  vz: number;
  /** Turbulence magnitude at this point. */
  turbulence: number;
  /** Speed of the flow in the XZ plane. */
  flowSpeed: number;
  /** Distance to the nearest bank (0 at the shore). */
  shoreDist: number;
  /** Which subsystem produced the sample (useful for debugging). */
  source: 'none' | 'channel' | 'fall' | 'pool';
  /** Index of the channel that produced the sample. */
  channelIndex: number;
}

/** A channel plus the metadata needed to blend it into a fork. */
export interface ForkDef {
  /** Index of the upstream channel that feeds the fork. */
  upstream: number;
  /** Indices of the two outgoing channels. */
  branches: [number, number];
  /** Position of the junction. */
  x: number;
  y: number;
  z: number;
  /** Unit direction of the upstream channel at the junction. */
  dirX: number;
  dirZ: number;
  /** Half width of the upstream channel at the junction. */
  halfWidth: number;
  /** How far downstream the fork's influence blends in. */
  blendLength: number;
}

export class WaterFlowSystem {
  readonly channels: Channel[] = [];
  readonly forks: ForkDef[] = [];
  waterfall: WaterfallDef | null = null;
  /** Pool surface height, used to decide when the falling sheet has landed. */
  poolY = 0;

  private time = 0;
  private readonly out: WaterSample = {
    present: false, surfaceY: 0, depth: 0, vx: 0, vy: 0, vz: 0,
    turbulence: 0, flowSpeed: 0, shoreDist: 0, source: 'none', channelIndex: -1,
  };
  private readonly scratchA = makeSample();
  private readonly scratchB = makeSample();
  private readonly scratchC = makeSample();

  addChannel(channel: Channel): number {
    this.channels.push(channel);
    return this.channels.length - 1;
  }

  addFork(fork: ForkDef): void {
    this.forks.push(fork);
  }

  update(dt: number): void {
    this.time += dt;
  }

  get elapsed(): number {
    return this.time;
  }

  /**
   * Query the water at a world position.
   * A fresh object is returned so callers can hold on to it safely.
   *
   * `hint` restricts the channel search to a single channel index - a big
   * speed-up for bodies that are known to be inside one channel.
   */
  sampleWater(x: number, y: number, z: number, hint = -1, column = false): WaterSample {
    const out = this.out;
    out.present = false;
    out.surfaceY = 0;
    out.depth = 0;
    out.vx = out.vy = out.vz = 0;
    out.turbulence = 0;
    out.flowSpeed = 0;
    out.shoreDist = 0;
    out.source = 'none';
    out.channelIndex = -1;

    // ---- 1. falling sheet (highest priority: it is a thin curtain) ----
    const fall = this.waterfall;
    if (fall) {
      const rx = x - fall.lipX;
      const rz = z - fall.lipZ;
      const d = rx * fall.dirX + rz * fall.dirZ;   // distance downstream of the lip
      const lateral = rx * fall.dirZ - rz * fall.dirX;
      // The sheet only exists until it lands in the plunge pool.
      const dMax = fall.v0 * Math.sqrt(Math.max(0, (2 * (fall.lipY - fall.poolY)) / fall.g));
      if (d > -2 && d < dMax && Math.abs(lateral) <= fall.halfWidth) {
        const t = Math.max(0, d) / fall.v0;
        const sheetY = fall.lipY - 0.5 * fall.g * t * t;
        const vy = -fall.g * t;
        // The sheet only has thickness; below it there is open air.
        if (column || (y <= sheetY && y >= sheetY - fall.thickness)) {
          out.present = true;
          out.surfaceY = sheetY;
          out.depth = fall.thickness;
          out.vx = fall.dirX * fall.v0;
          out.vz = fall.dirZ * fall.v0;
          out.vy = vy;
          out.flowSpeed = fall.v0;
          out.turbulence = 0.35 + 0.5 * Math.min(1, t);
          out.shoreDist = fall.halfWidth - Math.abs(lateral);
          out.source = 'fall';
          out.channelIndex = -1;
          return { ...out };
        }
      }
    }

    // ---- 2. fork blending (two branches sharing a junction) ----
    for (const fork of this.forks) {
      const rx = x - fork.x;
      const rz = z - fork.z;
      const d = rx * fork.dirX + rz * fork.dirZ;
      if (d < -fork.blendLength * 0.35 || d > fork.blendLength) continue;
      const lateral = rx * fork.dirZ - rz * fork.dirX;
      if (Math.abs(lateral) > fork.halfWidth * 1.3) continue;

      const left = this.channels[fork.branches[0]];
      const right = this.channels[fork.branches[1]];

      const ls = left.closest(x, z, this.scratchA);
      const lValid = ls.dist <= ls.halfWidth;
      const lDist = ls.dist, lHalf = ls.halfWidth;
      const lDirX = ls.dirX, lDirZ = ls.dirZ, lSpeed = ls.speed, lSurf = ls.surfaceY, lTurb = ls.turbulence;

      const rs = right.closest(x, z, this.scratchB);
      const rValid = rs.dist <= rs.halfWidth;
      const rDist = rs.dist, rHalf = rs.halfWidth;
      const rDirX = rs.dirX, rDirZ = rs.dirZ, rSpeed = rs.speed, rSurf = rs.surfaceY, rTurb = rs.turbulence;

      if (!lValid && !rValid) continue;

      // Blend factor across the junction: 0 = left branch, 1 = right branch.
      const edge = Math.max(0.5, fork.halfWidth * 0.95);
      const t = Math.min(1, Math.max(0, (lateral + edge) / (2 * edge)));
      const blend = t * t * (3 - 2 * t);

      let dirX: number, dirZ: number, speed: number, surfaceY: number, turb: number;
      if (lValid && rValid) {
        dirX = lDirX + (rDirX - lDirX) * blend;
        dirZ = lDirZ + (rDirZ - lDirZ) * blend;
        speed = lSpeed + (rSpeed - lSpeed) * blend;
        surfaceY = lSurf + (rSurf - lSurf) * blend;
        turb = lTurb + (rTurb - lTurb) * blend;
      } else if (lValid) {
        dirX = lDirX; dirZ = lDirZ; speed = lSpeed; surfaceY = lSurf; turb = lTurb;
      } else {
        dirX = rDirX; dirZ = rDirZ; speed = rSpeed; surfaceY = rSurf; turb = rTurb;
      }
      const l = Math.hypot(dirX, dirZ) || 1;
      dirX /= l; dirZ /= l;

      if (!column && y > surfaceY) continue;   // above the water surface

      // Upstream of the junction the river still runs straight; downstream it
      // splits. Blend between the two so the water never stalls at the fork.
      const upstream = this.channels[fork.upstream];
      const us = upstream.closest(x, z, this.scratchC);
      if (us.dist <= us.halfWidth) {
        const w = d <= 0 ? 0 : Math.min(1, d / (fork.blendLength * 0.4));
        const s = w * w * (3 - 2 * w);
        const ul = Math.hypot(us.dirX, us.dirZ) || 1;
        dirX = us.dirX / ul + (dirX - us.dirX / ul) * s;
        dirZ = us.dirZ / ul + (dirZ - us.dirZ / ul) * s;
        const nl = Math.hypot(dirX, dirZ) || 1;
        dirX /= nl;
        dirZ /= nl;
        speed = us.speed + (speed - us.speed) * s;
        turb = us.turbulence + (turb - us.turbulence) * s;
      }

      const shore = Math.min(
        lValid ? lHalf - lDist : Infinity,
        rValid ? rHalf - rDist : Infinity,
      );

      // No inward pull in the fork: the two branches pull the water apart,
      // and a pull towards the junction would drive logs onto the island.
      this.fillChannelSample(out, dirX, dirZ, speed, surfaceY, turb, 1, 0);
      out.shoreDist = shore === Infinity ? 0 : shore;
      out.source = 'channel';
      out.channelIndex = blend < 0.5 ? fork.branches[0] : fork.branches[1];
      return { ...out };
    }

    // ---- 3. regular channels ----
    let bestIdx = -1;
    let bestScore = Infinity;
    let bestDist = 0;
    let bestHalf = 1;

    for (let i = 0; i < this.channels.length; i++) {
      if (hint >= 0 && i !== hint) continue;
      const ch = this.channels[i];
      if (!ch.participates) continue;
      const s = ch.closest(x, z, this.scratchC);
      if (s.dist > s.halfWidth) continue;
      const score = s.dist / s.halfWidth;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = i;
        bestDist = s.dist;
        bestHalf = s.halfWidth;
        this.scratchA.dist = s.dist;
        this.scratchA.lateral = s.lateral;
        this.scratchA.surfaceY = s.surfaceY;
        this.scratchA.speed = s.speed;
        this.scratchA.turbulence = s.turbulence;
        this.scratchA.dirX = s.dirX;
        this.scratchA.dirZ = s.dirZ;
        this.scratchA.signedOffset = s.signedOffset;
        this.scratchA.halfWidth = s.halfWidth;
      }
    }

    if (bestIdx >= 0) {
      const s = this.scratchA;
      if (column || y <= s.surfaceY) {
        this.fillChannelSample(
          out, s.dirX, s.dirZ, s.speed, s.surfaceY, s.turbulence, 1,
          s.signedOffset / Math.max(0.5, s.halfWidth),
        );
        out.shoreDist = bestHalf - bestDist;
        out.source = 'channel';
        out.channelIndex = bestIdx;
        return { ...out };
      }
    }

    out.present = false;
    return { ...out };
  }

  /**
   * The water column at a horizontal position, regardless of height.
   * Used for immersion tests, where the probe point may be above the surface.
   */
  columnAt(x: number, z: number): WaterSample {
    return this.sampleWater(x, 0, z, -1, true);
  }

  /** Index of the channel that best covers a horizontal position (-1 if none). */
  nearestChannel(x: number, z: number): number {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.channels.length; i++) {
      const ch = this.channels[i];
      if (!ch.participates) continue;
      const s = ch.closest(x, z, this.scratchC);
      if (s.dist > s.halfWidth) continue;
      const score = s.dist / s.halfWidth;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  /**
   * Fill a sample from a channel's flow description.
   * `lateral01` is the normalised lateral offset (-1..1) used for the
   * "flow slows near the banks" profile and the gentle inward pull.
   */
  private fillChannelSample(
    out: WaterSample,
    dirX: number,
    dirZ: number,
    speed: number,
    surfaceY: number,
    turbulence: number,
    influence: number,
    lateral01: number,
  ): void {
    const t = Math.min(1, Math.abs(lateral01));
    // Flow slows down approaching the bank.
    const profile = 1 - 0.55 * t * t;
    const s = speed * profile * influence;

    // Gentle pull towards the middle of the channel. The signed offset uses
    // the perpendicular (dz, -dx), so the inward direction is its negative.
    const inward = Math.sign(lateral01) * t * 0.3 * speed * influence;

    out.present = true;
    out.surfaceY = surfaceY;
    out.depth = 4.0;
    out.vx = dirX * s - dirZ * inward;
    out.vz = dirZ * s + dirX * inward;
    out.vy = 0;
    out.flowSpeed = s;
    out.turbulence = turbulence;

    // Turbulent eddies: slow drifting noise so the water never feels static.
    const phase = out.shoreDist * 0.11;
    const n1 = fbm2(this.time * 0.35 + phase, 13.7, 2) - 0.5;
    const n2 = fbm2(71.3, this.time * 0.31 + phase, 2) - 0.5;
    out.vx += n1 * turbulence * 1.6;
    out.vz += n2 * turbulence * 1.6;
  }
}
