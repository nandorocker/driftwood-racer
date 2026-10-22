/**
 * Terrain construction.
 *
 * The land is a single trimesh built on a regular grid. The river channels
 * carve their bed into it, so the shoreline you see is exactly the shoreline
 * the water system uses - no separate collision proxy to drift out of sync.
 */

import * as THREE from 'three';
import { Channel } from './waterFlowSystem';
import { RIVER } from './riverLevel';
import { fbm2, signedNoise2 } from '../core/noise';

export interface TerrainOptions {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  step: number;
}

export const DEFAULT_TERRAIN: TerrainOptions = {
  minX: -72,
  maxX: 72,
  minZ: -178,
  maxZ: 244,
  step: 1.0,
};

export class Terrain {
  geometry!: THREE.BufferGeometry;
  vertices!: Float32Array;
  indices!: Uint32Array;
  readonly options: TerrainOptions;

  private readonly carveChannels: Channel[];
  private readonly basinChannel: Channel | null;

  constructor(carveChannels: Channel[], basinChannel: Channel | null, options = DEFAULT_TERRAIN) {
    this.options = options;
    this.carveChannels = carveChannels;
    this.basinChannel = basinChannel;
    this.build();
  }

  private build(): void {
    const { minX, maxX, minZ, maxZ, step } = this.options;
    const nx = Math.round((maxX - minX) / step) + 1;
    const nz = Math.round((maxZ - minZ) / step) + 1;

    const positions = new Float32Array(nx * nz * 3);
    const colors = new Float32Array(nx * nz * 3);
    const uvs = new Float32Array(nx * nz * 2);
    const heights = new Float32Array(nx * nz);

    // Pass 1: heights (the expensive part - channel queries).
    for (let j = 0; j < nz; j++) {
      const z = minZ + j * step;
      for (let i = 0; i < nx; i++) {
        heights[j * nx + i] = this.heightAt(minX + i * step, z);
      }
    }

    // Pass 2: positions, colours (slopes come from the height grid).
    let p = 0;
    let c = 0;
    let u = 0;
    for (let j = 0; j < nz; j++) {
      const z = minZ + j * step;
      for (let i = 0; i < nx; i++) {
        const x = minX + i * step;
        const h = heights[j * nx + i];
        positions[p++] = x;
        positions[p++] = h;
        positions[p++] = z;
        uvs[u++] = x * 0.05;
        uvs[u++] = z * 0.05;

        const hx = heights[j * nx + Math.min(nx - 1, i + 1)] - heights[j * nx + Math.max(0, i - 1)];
        const hz = heights[Math.min(nz - 1, j + 1) * nx + i] - heights[Math.max(0, j - 1) * nx + i];
        const slope = Math.min(1, Math.hypot(hx, hz) / (2 * step * 2.4));

        const col = this.colorAt(x, z, h, slope);
        colors[c++] = col.r;
        colors[c++] = col.g;
        colors[c++] = col.b;
      }
    }

    const indices = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let k = 0;
    for (let j = 0; j < nz - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        const b = a + 1;
        const d = a + nx;
        const e = d + 1;
        indices[k++] = a; indices[k++] = d; indices[k++] = b;
        indices[k++] = b; indices[k++] = d; indices[k++] = e;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere();

    this.geometry = geo;
    this.vertices = positions;
    this.indices = indices;
  }

  /** Height of the land at a world position. */
  heightAt(x: number, z: number): number {
    // --- base land: rolling plateau with a little noise -------------------
    const broad = fbm2(x * 0.012 + 3.1, z * 0.012 + 7.7, 3) - 0.5;
    const detail = signedNoise2(x * 0.09, z * 0.09) * 0.22;
    const ridge = Math.abs(signedNoise2(x * 0.021 + 40, z * 0.021 - 12)) * 1.6;
    let base = RIVER.plateau + broad * 5.2 + detail + ridge * 0.6;

    // The land rises into hills away from the river so the edge of the
    // terrain is never visible from the water.
    const edgeX = Math.max(0, Math.abs(x) - 24) / 48;
    const edgeZ = Math.max(0, Math.max(-150 - z, z - 212)) / 34;
    const edge = Math.min(1, Math.max(edgeX, edgeZ));
    // Mountain ridges close the valley, so the edge of the terrain reads as a
    // horizon rather than a cut off table.
    base += edge * edge * 48;
    base += (fbm2(x * 0.009 - 12, z * 0.009 + 5, 3) - 0.42) * 46 * edge;
    base += (fbm2(x * 0.035 + 3, z * 0.035 - 9, 2) - 0.5) * 7 * edge;

    let h = base;

    // --- carve the river channels ----------------------------------------
    for (const ch of this.carveChannels) {
      const s = ch.closest(x, z);
      const hw = s.halfWidth;
      if (s.dist <= hw) {
        // Parabolic bed: deepest in the middle, meeting the water line at the bank.
        const t = s.dist / Math.max(0.001, hw);
        const bed = -RIVER.bedDepth * (1 - t * t);
        if (bed < h) h = bed;
      } else if (s.dist < hw + RIVER.bankWidth) {
        const t = (s.dist - hw) / RIVER.bankWidth;
        const bank = smoothstep(t) * base;
        if (bank < h) h = bank;
      }
    }

    // --- plunge pool basin + waterfall cliff ------------------------------
    if (z >= RIVER.basinZ - 1.5 && this.basinChannel) {
      const s = this.basinChannel.closest(x, z);
      const hw = s.halfWidth;
      const poolBed = RIVER.poolY - RIVER.poolDepth;
      const t = s.dist / Math.max(0.001, hw);
      let basin: number;
      if (s.dist <= hw) {
        basin = poolBed + 0.6 * (1 - t * t);
      } else {
        const u = Math.min(1, (s.dist - hw) / RIVER.bankWidth);
        basin = poolBed + smoothstep(u) * (base - poolBed);
      }
      if (basin < h) h = basin;
    }

    return h;
  }

  private colorAt(x: number, z: number, h: number, slope: number): THREE.Color {
    // Slope-aware palette: rock on steep faces, moss on the flats, wet sand
    // near the water line, dark silt on the river bed.
    const n1 = fbm2(x * 0.06 + 11, z * 0.06 - 5, 2);
    const n2 = fbm2(x * 0.21 - 3, z * 0.21 + 9, 2);

    const meadow = new THREE.Color(0x46603a).lerp(new THREE.Color(0x7d9350), n1);
    const dry = new THREE.Color(0x8a8a55).lerp(new THREE.Color(0xa39a63), n2);
    const rock = new THREE.Color(0x5f5f58).lerp(new THREE.Color(0x827f74), n2);
    const sand = new THREE.Color(0x9c8b64);
    const silt = new THREE.Color(0x2b3529);

    // Meadow with dry patches, then rock on the steep faces.
    const c = meadow.clone().lerp(dry, Math.max(0, n1 - 0.55) * 1.6);
    c.lerp(rock, Math.min(1, slope * 1.15));
    // Wet band around the upper water line and everything below it.
    const waterline = z >= RIVER.basinZ ? RIVER.poolY : RIVER.surfaceY;
    const flat = 1 - Math.min(1, slope * 1.6);
    if (h < waterline + 0.35) {
      c.lerp(sand, Math.min(1, (waterline + 0.35 - h) * 1.4) * 0.75 * flat);
    }
    if (h < waterline - 1.2) {
      c.lerp(silt, Math.min(1, (waterline - 1.2 - h) * 0.5) * flat);
    }
    // High ground turns to rock and scree.
    const alt = Math.min(1, Math.max(0, (h - 22) / 26));
    if (alt > 0) {
      c.lerp(new THREE.Color(0x6b6a63).lerp(new THREE.Color(0x9a978c), n2), alt * 0.85);
    }
    c.multiplyScalar(0.82 + n2 * 0.34);
    return c;
  }
}

function smoothstep(t: number): number {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
}
