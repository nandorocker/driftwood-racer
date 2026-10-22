/**
 * A dreamlike sky dome: a vertical gradient with a soft sun, plus a ring of
 * distant hills so the world does not simply end at the terrain edge.
 */

import * as THREE from 'three';
import { fbm2 } from '../core/noise';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
varying vec3 vDir;

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h >= 0.0) {
    col = mix(uHorizon, uTop, pow(clamp(h, 0.0, 1.0), 0.62));
  } else {
    col = mix(uHorizon, uBottom, pow(clamp(-h, 0.0, 1.0), 0.5));
  }
  // Sun glow.
  float sun = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sun, 220.0) * 1.5;
  col += uSunColor * pow(sun, 12.0) * 0.16;
  // Soft banding break-up.
  float band = sin(d.y * 34.0) * 0.004;
  gl_FragColor = vec4(col + band, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function createSky(sunDir: THREE.Vector3): {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
} {
  const uniforms: Record<string, THREE.IUniform> = {
    uTop: { value: new THREE.Color(0x2f6f9e) },
    uHorizon: { value: new THREE.Color(0xbcd9e2) },
    uBottom: { value: new THREE.Color(0x8fa6a4) },
    uSunDir: { value: sunDir.clone() },
    uSunColor: { value: new THREE.Color(0xffe9c2) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 20), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  return { mesh, uniforms };
}

/**
 * Distant hills: a ring of low-poly ridges far outside the playable area.
 * Purely decorative, but it sells the scale of the valley.
 */
export function createDistantHills(): THREE.Mesh {
  const segments = 260;
  const rings = 3;
  const radius = 520;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const cNear = new THREE.Color(0x4a6a58);
  const cFar = new THREE.Color(0x7d97a0);

  for (let r = 0; r < rings; r++) {
    const rad = radius + r * 140;
    for (let i = 0; i <= segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      const n = fbm2(Math.cos(a) * 3 + r * 17, Math.sin(a) * 3, 4);
      const height = 26 + n * 78 + r * 14;
      positions.push(x, -40, z);
      colors.push(cFar.r, cFar.g, cFar.b);
      positions.push(x, height, z);
      const c = cNear.clone().lerp(cFar, r / (rings - 1));
      colors.push(c.r, c.g, c.b);
    }
  }

  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < segments; i++) {
      const a = r * (segments + 1) * 2 + i * 2;
      const b = a + 1;
      const c = a + (segments + 1) * 2;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
