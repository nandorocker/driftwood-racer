/**
 * Visual water.
 *
 * The physical water lives in `waterFlowSystem`; this module is only the
 * surface you can see. A ribbon is generated per channel, following exactly
 * the same centreline, so what you see is what you swim in.
 */

import * as THREE from 'three';
import { Channel, WaterfallDef } from '../world/waterFlowSystem';

export interface WaterUniforms {
  uTime: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uSunColor: { value: THREE.Color };
  uDeep: { value: THREE.Color };
  uShallow: { value: THREE.Color };
  uFoam: { value: THREE.Color };
  uSky: { value: THREE.Color };
}

const VERT = /* glsl */ `
uniform float uTime;
attribute float aShore;
attribute float aFlow;
varying float vShore;
varying float vFlow;
varying vec3 vWorldPos;
varying vec3 vNormalW;
#include <fog_pars_vertex>

void main() {
  vShore = aShore;
  vFlow = aFlow;

  vec3 p = position;
  float amp = 0.05 * smoothstep(0.0, 0.4, aShore) * (0.5 + aFlow * 0.14);
  float a = p.z * 0.55 + uTime * 1.7 + aFlow * 0.4;
  float b = p.x * 0.92 - uTime * 2.4;
  float c = (p.x + p.z) * 1.75 + uTime * 3.3;
  float h = amp * (sin(a) + 0.6 * sin(b) + 0.3 * sin(c));
  p.y += h;

  float dhdx = amp * (0.6 * cos(b) * 0.92 + 0.3 * cos(c) * 1.75);
  float dhdz = amp * (cos(a) * 0.55 + 0.3 * cos(c) * 1.75);
  vNormalW = normalize(vec3(-dhdx, 1.0, -dhdz));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform float uTime;
varying float vShore;
varying float vFlow;
varying vec3 vWorldPos;
varying vec3 vNormalW;
#include <fog_pars_fragment>

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  vec3 N = normalize(vNormalW);
  vec3 V = normalize(cameraPosition - vWorldPos);
  vec3 L = normalize(uSunDir);

  float shore = clamp(vShore, 0.0, 1.0);
  vec3 base = mix(uShallow, uDeep, pow(shore, 0.55));
  vec3 col = base;

  // Scrolling ripple highlights.
  float rip = vnoise(vWorldPos.xz * 0.42 + vec2(uTime * 0.22, uTime * 0.13));
  float rip2 = vnoise(vWorldPos.xz * 1.35 - vec2(uTime * 0.4, 0.0));
  float rip3 = vnoise(vWorldPos.xz * 3.1 + vec2(0.0, uTime * 0.9));
  col += (rip * 0.55 + rip2 * 0.3 + rip3 * 0.15 - 0.5) * 0.16;
  // Darker in the deep middle, brighter where the light catches the ripples.
  col *= 0.88 + rip3 * 0.3;

  // Specular sun glint.
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 120.0);
  col += uSunColor * spec * 1.9;

  // Fresnel sky reflection.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  col = mix(col, uSky, fres * 0.42);

  // Foam: a bright band along the shore, plus streaks where the flow is fast.
  float edge = smoothstep(0.34, 0.03, vShore);
  float foamNoise = vnoise(vWorldPos.xz * 1.9 + vec2(0.0, uTime * 0.7));
  float foam = edge * (0.35 + 0.65 * foamNoise);
  foam += smoothstep(3.0, 6.5, vFlow) * 0.2 * foamNoise * smoothstep(0.75, 0.35, vShore);
  col = mix(col, uFoam, clamp(foam, 0.0, 0.9));

  float alpha = mix(0.95, 0.8, shore);

  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export function createWaterMaterial(
  uniforms: WaterUniforms,
  overrides: Record<string, THREE.IUniform> = {},
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    // The renderer writes the fog uniforms into whatever we hand it, so they
    // have to be present even though the shader reads them via the chunks.
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...(uniforms as unknown as Record<string, THREE.IUniform>),
      ...overrides,
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** Build the visible ribbon for one channel. */
export function buildChannelRibbon(channel: Channel, lateralSegments = 8): THREE.BufferGeometry {
  const nodes = channel.nodes;
  const rows = nodes.length;
  const cols = lateralSegments + 1;

  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const shore = new Float32Array(rows * cols);
  const flow = new Float32Array(rows * cols);

  let p = 0;
  let u = 0;
  let s = 0;
  let f = 0;
  let arc = 0;

  for (let i = 0; i < rows; i++) {
    const node = nodes[i];
    // Tangent from the neighbouring nodes.
    const prev = nodes[Math.max(0, i - 1)];
    const next = nodes[Math.min(rows - 1, i + 1)];
    let tx = next.x - prev.x;
    let tz = next.z - prev.z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    // Left normal in XZ.
    const nx = -tz;
    const nz = tx;

    if (i > 0) {
      arc += Math.hypot(node.x - nodes[i - 1].x, node.z - nodes[i - 1].z);
    }

    for (let j = 0; j < cols; j++) {
      const t = (j / lateralSegments) * 2 - 1;   // -1 .. 1
      const off = t * node.halfWidth;
      positions[p++] = node.x + nx * off;
      positions[p++] = node.y;
      positions[p++] = node.z + nz * off;
      uvs[u++] = arc * 0.08;
      uvs[u++] = (t * 0.5 + 0.5);
      shore[s++] = 1 - Math.abs(t);
      flow[f++] = node.speed;
    }
  }

  const indices = new Uint32Array((rows - 1) * lateralSegments * 6);
  let k = 0;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < lateralSegments; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));
  geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** The falling curtain of the waterfall. */
export function buildFallCurtain(fall: WaterfallDef, segments = 26, lateral = 10): THREE.BufferGeometry {
  const rows = segments + 1;
  const cols = lateral + 1;
  const positions = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const shore = new Float32Array(rows * cols);
  const flow = new Float32Array(rows * cols);

  const nx = -fall.dirZ;
  const nz = fall.dirX;

  let p = 0;
  let u = 0;
  let s = 0;
  let f = 0;

  for (let i = 0; i < rows; i++) {
    const t = i / segments;
    const d = t * 26;
    const y = fall.lipY - 0.5 * fall.g * (d / fall.v0) * (d / fall.v0);
    for (let j = 0; j < cols; j++) {
      const uu = (j / lateral) * 2 - 1;
      const off = uu * fall.halfWidth;
      positions[p++] = fall.lipX + fall.dirX * d + nx * off;
      positions[p++] = y;
      positions[p++] = fall.lipZ + fall.dirZ * d + nz * off;
      uvs[u++] = uu * 0.5 + 0.5;
      uvs[u++] = t * 3.2;
      shore[s++] = 1 - Math.abs(uu) * 0.6;
      flow[f++] = fall.v0;
    }
  }

  const indices = new Uint32Array((rows - 1) * lateral * 6);
  let k = 0;
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < lateral; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d2 = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d2;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('aShore', new THREE.BufferAttribute(shore, 1));
  geo.setAttribute('aFlow', new THREE.BufferAttribute(flow, 1));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}


const CURTAIN_VERT = /* glsl */ `
uniform float uTime;
attribute float aShore;
attribute float aFlow;
varying float vShore;
varying float vFlow;
varying vec2 vUvC;
varying vec3 vWorldPos;
#include <fog_pars_vertex>

void main() {
  vShore = aShore;
  vFlow = aFlow;
  vUvC = uv;
  vec3 p = position;
  // A little chatter so the sheet is never perfectly smooth.
  p.x += sin(p.y * 0.7 + uTime * 3.1) * 0.12;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorldPos = world.xyz;
  vec4 mvPosition = viewMatrix * world;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const CURTAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uSunColor;
uniform vec3 uFoam;
uniform vec3 uSky;
varying float vShore;
varying float vFlow;
varying vec2 vUvC;
varying vec3 vWorldPos;
#include <fog_pars_fragment>

float hash21(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
  // Vertical streaks racing down the sheet.
  float streak = vnoise(vec2(vUvC.x * 26.0, vUvC.y * 3.0 - uTime * 3.4));
  float streak2 = vnoise(vec2(vUvC.x * 60.0, vUvC.y * 1.5 - uTime * 6.0));
  float sheet = streak * 0.6 + streak2 * 0.4;

  vec3 col = mix(uFoam * 0.72, uFoam, sheet);
  col = mix(col, uSky * 0.9, 0.18);
  col += uSunColor * pow(sheet, 6.0) * 0.5;

  // Thicker in the middle, thinner and mistier at the edges.
  float edge = smoothstep(0.0, 0.35, vShore);
  float alpha = (0.45 + 0.5 * sheet) * (0.35 + 0.65 * edge);
  // Spray where the sheet meets the pool.
  alpha += smoothstep(0.85, 1.0, vUvC.y) * 0.25;

  gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.95));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The falling sheet of the waterfall: streaky, semi transparent spray. */
export function createCurtainMaterial(uniforms: WaterUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...(uniforms as unknown as Record<string, THREE.IUniform>),
    },
    vertexShader: CURTAIN_VERT,
    fragmentShader: CURTAIN_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
}

/** White, frothy material for the falling sheet and the splash zone. */
export function createFoamMaterial(uniforms: WaterUniforms): THREE.ShaderMaterial {
  return createWaterMaterial(uniforms, {
    uDeep: { value: new THREE.Color(0xbfe4ea) },
    uShallow: { value: new THREE.Color(0xf2fbfb) },
    uFoam: { value: new THREE.Color(0xffffff) },
  });
}
