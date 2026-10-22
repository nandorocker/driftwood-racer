/**
 * Central tuning table for the whole prototype.
 *
 * Every value here is live-editable from the in-game panel (TAB) and can be
 * exported / imported as JSON, so balancing never requires touching source.
 */

export interface TUNE {
  character: {
    mass: number;
    height: number;
    radius: number;
    walkSpeed: number;
    runSpeed: number;
    groundAccel: number;
    groundFriction: number;
    airAccel: number;
    airDrag: number;
    jumpSpeed: number;
    coyoteTime: number;
    jumpBuffer: number;
    swimSpeed: number;
    swimAccel: number;
    buoyancyK: number;
    floatDepth: number;
    grabRange: number;
    grabStiffness: number;
    grabDamping: number;
    climbSpeed: number;
    paddleImpulse: number;
    paddleCadence: number;
    logReaction: number;
    traction: number;
    gripLimit: number;
  };
  log: {
    mass: number;
    radius: number;
    length: number;
    buoyancyScale: number;
    linearDrag: number;
    angularDrag: number;
    currentDrag: number;
    verticalDrag: number;
    righting: number;
    rightingDamp: number;
    sampleStations: number;
    sampleRing: number;
    friction: number;
    restitution: number;
  };
  water: {
    currentScale: number;
    turbulenceScale: number;
    dragScale: number;
    inwardPull: number;
    sheetThickness: number;
  };
  camera: {
    distance: number;
    height: number;
    minDistance: number;
    sensitivity: number;
    smoothing: number;
    fov: number;
    pitchMin: number;
    pitchMax: number;
  };
  world: {
    gravity: number;
    timeScale: number;
    playerStartZ: number;
  };
}

export const TUNE: TUNE = {
  character: {
    mass: 72,
    height: 1.74,
    radius: 0.32,
    walkSpeed: 4.4,
    runSpeed: 7.4,
    groundAccel: 42,
    groundFriction: 16,
    airAccel: 14,
    airDrag: 0.4,
    jumpSpeed: 7.4,
    coyoteTime: 0.14,
    jumpBuffer: 0.16,
    swimSpeed: 6.4,
    swimAccel: 9,
    buoyancyK: 15,
    floatDepth: 0.62,
    grabRange: 3.4,
    grabStiffness: 26,
    grabDamping: 5,
    climbSpeed: 2.1,
    paddleImpulse: 130,
    paddleCadence: 0.42,
    logReaction: 0.55,
    traction: 7,
    gripLimit: 0.55,
  },
  log: {
    mass: 950,
    radius: 0.95,
    length: 6.0,
    buoyancyScale: 1.0,
    linearDrag: 0.9,
    angularDrag: 2.6,
    currentDrag: 2.1,
    verticalDrag: 9,
    righting: 6000,
    rightingDamp: 1.0,
    sampleStations: 5,
    sampleRing: 12,
    friction: 0.95,
    restitution: 0.12,
  },
  water: {
    currentScale: 1.0,
    turbulenceScale: 1.0,
    dragScale: 1.0,
    inwardPull: 0.3,
    sheetThickness: 0.9,
  },
  camera: {
    distance: 8.2,
    height: 1.3,
    minDistance: 1.6,
    sensitivity: 0.0022,
    smoothing: 11,
    fov: 62,
    pitchMin: -1.15,
    pitchMax: 1.05,
  },
  world: {
    gravity: 9.81,
    timeScale: 1.0,
    playerStartZ: -138,
  },
};

/** Flat description of the parameters exposed in the tuning panel. */
export interface ParamSpec {
  path: string;
  label: string;
  min: number;
  max: number;
  step: number;
}

export const PARAM_SPECS: ParamSpec[] = [
  { path: 'character.walkSpeed', label: 'walk speed', min: 1, max: 12, step: 0.1 },
  { path: 'character.runSpeed', label: 'run speed', min: 2, max: 18, step: 0.1 },
  { path: 'character.groundAccel', label: 'ground accel', min: 4, max: 120, step: 1 },
  { path: 'character.groundFriction', label: 'ground friction', min: 1, max: 60, step: 0.5 },
  { path: 'character.airAccel', label: 'air control', min: 0, max: 60, step: 0.5 },
  { path: 'character.jumpSpeed', label: 'jump impulse', min: 2, max: 16, step: 0.1 },
  { path: 'character.coyoteTime', label: 'coyote time', min: 0, max: 0.5, step: 0.01 },
  { path: 'character.swimSpeed', label: 'swim speed', min: 1, max: 16, step: 0.1 },
  { path: 'character.buoyancyK', label: 'buoyancy', min: 2, max: 45, step: 0.5 },
  { path: 'character.grabRange', label: 'grab range', min: 1, max: 7, step: 0.1 },
  { path: 'character.grabStiffness', label: 'grab strength', min: 4, max: 80, step: 1 },
  { path: 'character.climbSpeed', label: 'climb speed', min: 0.2, max: 6, step: 0.1 },
  { path: 'character.paddleImpulse', label: 'paddle impulse', min: 5, max: 220, step: 1 },
  { path: 'character.paddleCadence', label: 'paddle cadence', min: 0.12, max: 1.2, step: 0.02 },
  { path: 'character.logReaction', label: 'log reaction', min: 0, max: 2, step: 0.05 },
  { path: 'character.traction', label: 'wet traction', min: 0, max: 25, step: 0.5 },
  { path: 'character.gripLimit', label: 'grip limit (m/s)', min: 0.1, max: 6, step: 0.1 },
  { path: 'character.mass', label: 'character mass', min: 20, max: 200, step: 1 },

  { path: 'log.mass', label: 'log mass', min: 40, max: 1200, step: 5 },
  { path: 'log.buoyancyScale', label: 'buoyancy scale', min: 0.4, max: 2.2, step: 0.02 },
  { path: 'log.currentDrag', label: 'current drag', min: 0.2, max: 8, step: 0.05 },
  { path: 'log.verticalDrag', label: 'vertical drag', min: 0, max: 30, step: 0.5 },
  { path: 'log.righting', label: 'log righting', min: 0, max: 12000, step: 100 },
  { path: 'log.rightingDamp', label: 'righting damping', min: 0.1, max: 4, step: 0.05 },
  { path: 'log.linearDrag', label: 'linear drag', min: 0, max: 6, step: 0.05 },
  { path: 'log.angularDrag', label: 'angular drag', min: 0, max: 12, step: 0.1 },
  { path: 'log.friction', label: 'log friction', min: 0, max: 2, step: 0.05 },

  { path: 'water.currentScale', label: 'current strength', min: 0, max: 2.5, step: 0.05 },
  { path: 'water.turbulenceScale', label: 'turbulence', min: 0, max: 3, step: 0.05 },
  { path: 'water.dragScale', label: 'water drag', min: 0, max: 3, step: 0.05 },
  { path: 'water.inwardPull', label: 'bank inward pull', min: 0, max: 1.5, step: 0.05 },

  { path: 'camera.distance', label: 'camera distance', min: 2, max: 16, step: 0.1 },
  { path: 'camera.height', label: 'camera height', min: 0, max: 4, step: 0.05 },
  { path: 'camera.sensitivity', label: 'look sensitivity', min: 0.0004, max: 0.008, step: 0.0001 },
  { path: 'camera.smoothing', label: 'follow smoothing', min: 1, max: 40, step: 0.5 },
  { path: 'camera.fov', label: 'fov', min: 40, max: 100, step: 1 },

  { path: 'world.gravity', label: 'gravity', min: 0, max: 25, step: 0.1 },
  { path: 'world.timeScale', label: 'time scale', min: 0.1, max: 2, step: 0.05 },
];

/** Read a dotted path out of the tuning table. */
export function getParam(path: string): number {
  const parts = path.split('.');
  let node: any = TUNE;
  for (const p of parts) node = node?.[p];
  return typeof node === 'number' ? node : 0;
}

/** Write a dotted path into the tuning table. */
export function setParam(path: string, value: number): void {
  const parts = path.split('.');
  let node: any = TUNE;
  for (let i = 0; i < parts.length - 1; i++) node = node?.[parts[i]];
  if (node) node[parts[parts.length - 1]] = value;
}

/** Snapshot of the whole table (for export / localStorage). */
export function exportTuning(): string {
  return JSON.stringify(TUNE, null, 2);
}

/** Merge a previously exported tuning snapshot back in. */
export function importTuning(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    for (const group of Object.keys(TUNE) as (keyof TUNE)[]) {
      const src = parsed[group];
      if (!src) continue;
      for (const key of Object.keys(TUNE[group])) {
        const v = src[key];
        if (typeof v === 'number' && Number.isFinite(v)) {
          (TUNE[group] as any)[key] = v;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

const STORAGE_KEY = 'driftwood-racer.tuning';

export function loadTuningFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) importTuning(raw);
  } catch {
    /* storage unavailable - defaults are fine */
  }
}

export function saveTuningToStorage(): void {
  try {
    localStorage.setItem(STORAGE_KEY, exportTuning());
  } catch {
    /* ignore */
  }
}
