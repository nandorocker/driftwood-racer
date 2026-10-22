/** Small deterministic value-noise helpers (hash based, no allocations). */

function hash2(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 2D value noise in [0,1]. */
export function valueNoise2(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smooth(xf);
  const v = smooth(yf);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

/** Fractal value noise in [0,1]. */
export function fbm2(x: number, y: number, octaves = 3): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(fx, fy);
    norm += amp;
    amp *= 0.5;
    fx *= 2.03;
    fy *= 1.97;
  }
  return sum / norm;
}

/** Signed 2D noise in [-1,1] suitable for jittering geometry. */
export function signedNoise2(x: number, y: number): number {
  return valueNoise2(x, y) * 2 - 1;
}
