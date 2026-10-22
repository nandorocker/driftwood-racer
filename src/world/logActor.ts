/**
 * LogActor
 * ---------------------------------------------------------------------------
 * A giant floating log: rigid body + simple cylindrical collider + visual
 * mesh + a FloatingBody that makes it ride the current.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { FloatingBody } from './floatingBody';
import { TUNE } from '../core/config';
import { InterpolatedTransform } from '../core/interpolated';
import { fbm2 } from '../core/noise';

let barkTexture: THREE.Texture | null = null;
let endTexture: THREE.Texture | null = null;

function makeBarkTexture(): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Vertical striations plus blotches.
      const stripe = Math.sin(x * 0.55 + fbm2(x * 0.05, y * 0.012, 2) * 9) * 0.5 + 0.5;
      const grain = fbm2(x * 0.09, y * 0.42, 3);
      const v = 0.42 + stripe * 0.28 + grain * 0.3;
      const i = (y * size + x) * 4;
      img.data[i] = Math.min(255, 118 * v * 1.35);
      img.data[i + 1] = Math.min(255, 88 * v * 1.3);
      img.data[i + 2] = Math.min(255, 64 * v * 1.25);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeEndTexture(): THREE.Texture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c8a878';
  ctx.fillRect(0, 0, size, size);
  // Growth rings.
  for (let r = size / 2; r > 0; r -= 4 + Math.random() * 4) {
    ctx.beginPath();
    ctx.strokeStyle = `rgba(120,92,58,${0.16 + Math.random() * 0.3})`;
    ctx.lineWidth = 1 + Math.random() * 1.6;
    ctx.arc(size / 2, size / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface LogActorOptions {
  x: number;
  y: number;
  z: number;
  yaw: number;
  length?: number;
  radius?: number;
  mass?: number;
}

export class LogActor {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly floating: FloatingBody;
  readonly mesh: THREE.Group;
  readonly transform = new InterpolatedTransform();
  readonly length: number;
  readonly radius: number;
  /** Height of the log's axis above the water when it is settled. */
  readonly floatOffset: number;
  /** Logs can be grabbed by the player. */
  readonly grabbable = true;
  /** How long the log has been out of the water (used for stuck detection). */
  stuckTimer = 0;

  constructor(world: RAPIER.World, opts: LogActorOptions) {
    const length = opts.length ?? TUNE.log.length;
    const radius = opts.radius ?? TUNE.log.radius;
    const mass = opts.mass ?? TUNE.log.mass;
    this.length = length;
    this.radius = radius;

    // A floating cylinder settles with its axis at a specific height above
    // the water line. Spawning it there avoids a violent settling bob.
    const float = equilibriumOffset(mass, radius, length);
    this.floatOffset = float;

    const q = flatQuaternion(opts.yaw);

    const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(opts.x, opts.y + float, opts.z)
      .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(0.06)
      .setAngularDamping(0.55)
      .setCcdEnabled(true);
    this.body = world.createRigidBody(bodyDesc);

    const colDesc = RAPIER.ColliderDesc.cylinder(length / 2, radius)
      .setDensity(0)
      .setFriction(TUNE.log.friction)
      .setRestitution(TUNE.log.restitution);
    this.collider = world.createCollider(colDesc, this.body);
    this.collider.setMass(mass);

    this.floating = new FloatingBody(this.body, {
      halfLength: length / 2,
      radius,
      mass,
      stations: TUNE.log.sampleStations,
      ring: TUNE.log.sampleRing,
      buoyancyScale: TUNE.log.buoyancyScale,
      currentDrag: TUNE.log.currentDrag,
    });

    this.mesh = buildLogMesh(length, radius);
    this.transform.init(
      new THREE.Vector3(opts.x, opts.y + float, opts.z),
      new THREE.Quaternion(q.x, q.y, q.z, q.w),
    );
  }

  syncFromBody(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.transform.capture(
      new THREE.Vector3(t.x, t.y, t.z),
      new THREE.Quaternion(r.x, r.y, r.z, r.w),
    );
  }
}

/** The orientation of a log lying flat on the water. */
export function flatQuaternion(yaw: number): THREE.Quaternion {
  return new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
}

/**
 * Height of the log's axis above the water surface once it has settled.
 * Solves the circular-segment area for the displaced volume.
 */
export function equilibriumOffset(mass: number, radius: number, length: number): number {
  const targetArea = mass / 1000 / Math.max(0.001, length);
  let lo = 0;
  let hi = radius * 2;
  for (let i = 0; i < 32; i++) {
    const d = (lo + hi) * 0.5;
    const c = (radius - d) / radius;
    const area = radius * radius * (Math.acos(c) - c * Math.sqrt(Math.max(0, 1 - c * c)));
    if (area < targetArea) lo = d;
    else hi = d;
  }
  return radius - (lo + hi) * 0.5;
}

function buildLogMesh(length: number, radius: number): THREE.Group {
  if (!barkTexture) barkTexture = makeBarkTexture();
  if (!endTexture) endTexture = makeEndTexture();

  const group = new THREE.Group();

  const barkMat = new THREE.MeshStandardMaterial({
    map: barkTexture,
    color: 0xb08a62,
    roughness: 0.95,
    metalness: 0.0,
  });
  (barkMat.map as THREE.Texture).repeat.set(2, 1.4);

  const endMat = new THREE.MeshStandardMaterial({
    map: endTexture,
    color: 0xd8bb8d,
    roughness: 0.85,
  });

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius * 0.94, length, 16, 1, false),
    barkMat,
  );
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  group.add(trunk);

  for (const s of [1, -1]) {
    const cap = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.95, 16), endMat);
    cap.position.y = (s * length) / 2 - s * 0.002;
    cap.rotation.x = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    cap.castShadow = false;
    group.add(cap);
  }

  // A couple of knots and a broken stub branch for character.
  const knotMat = new THREE.MeshStandardMaterial({ color: 0x6b4d33, roughness: 1 });
  for (let i = 0; i < 3; i++) {
    const knot = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.22, 8, 6), knotMat);
    const a = (i / 3) * Math.PI * 2 + 0.7;
    knot.position.set(Math.cos(a) * radius * 0.92, (i - 1) * length * 0.22, Math.sin(a) * radius * 0.92);
    knot.scale.set(1, 0.7, 1);
    group.add(knot);
  }

  const stub = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.16, radius * 0.24, radius * 1.5, 7),
    barkMat,
  );
  stub.position.set(radius * 0.5, length * 0.26, 0);
  stub.rotation.z = -0.9;
  stub.castShadow = true;
  group.add(stub);

  return group;
}
