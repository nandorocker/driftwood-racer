/**
 * FloatingBody
 * ---------------------------------------------------------------------------
 * Turns any rigid body into a floating object.
 *
 * Buoyancy is solved *analytically* for the cylinder: the volume of the log
 * that sits below the water surface is integrated over its cross section, and
 * the resulting force is applied at the true centre of buoyancy. That is what
 * makes a log right itself, pitch with the current and roll when the player
 * shifts their weight, instead of wobbling like a point mass.
 *
 * Drag is applied per sample point so the current can push on the wetted
 * part of the log and spin it, and so rotation is damped naturally.
 */

import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { WaterFlowSystem } from './waterFlowSystem';
import { TUNE } from '../core/config';

const WATER_DENSITY = 1000;

export interface FloatingBodyOptions {
  /** Half length of the cylinder along the body's local Y axis. */
  halfLength: number;
  radius: number;
  /** Mass of the body (kg). Rapier only knows it after the first step. */
  mass: number;
  /** Number of drag stations along the axis. */
  stations: number;
  /** Number of drag points around the circumference. */
  ring: number;
  /** Multiplier on the buoyant force. */
  buoyancyScale?: number;
  /** Drag coefficient against the surrounding water. */
  currentDrag?: number;
  /** Linear damping applied by the integrator. */
  linearDamping?: number;
  /** Angular damping applied by the integrator. */
  angularDamping?: number;
}

interface DiscCell {
  x: number;
  z: number;
  area: number;
}

export class FloatingBody {
  readonly body: RAPIER.RigidBody;
  readonly halfLength: number;
  readonly radius: number;
  readonly mass: number;

  /** Local drag sample points. */
  readonly localSamples: THREE.Vector3[] = [];
  /** World positions of the drag samples (for the debug view). */
  readonly worldSamples: THREE.Vector3[] = [];
  /** Wetted area represented by each drag sample (m^2). */
  readonly sampleAreas: number[] = [];

  readonly buoyancyScale: number;
  readonly currentDrag: number;
  /** Submerged volume of the last step (m^3) - useful for debugging. */
  submergedVolume = 0;
  /** Draft of the last step (m). */
  draft = 0;
  /** Diagnostics from the last step. */
  readonly debug = { surfaceY: 0, belowV: 0, nx: 0, ny: 0, nz: 0, present: false, force: 0, wetted: 0, roll: 0, rtorque: 0 };

  private readonly discCells: DiscCell[] = [];
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQInv = new THREE.Quaternion();
  private readonly tmpP = new THREE.Vector3();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpN = new THREE.Vector3();
  private readonly tmpC = new THREE.Vector3();
  private readonly tmpAxis = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3();
  private readonly tmpSide = new THREE.Vector3();
  private readonly tmpCross = new THREE.Vector3();

  constructor(body: RAPIER.RigidBody, opts: FloatingBodyOptions) {
    this.body = body;
    this.halfLength = opts.halfLength;
    this.radius = opts.radius;
    this.mass = opts.mass;

    const { stations, ring } = opts;
    this.buoyancyScale = opts.buoyancyScale ?? 1;
    this.currentDrag = opts.currentDrag ?? 2.1;

    // --- cross-section integration cells (equal area) ---------------------
    const rings = 4;
    const sectors = 12;
    for (let r = 0; r < rings; r++) {
      const r0 = r / rings;
      const r1 = (r + 1) / rings;
      const ringArea = Math.PI * (r1 * r1 - r0 * r0) * opts.radius * opts.radius;
      const cellArea = ringArea / sectors;
      const rm = (r0 + r1) * 0.5 * opts.radius;
      for (let s = 0; s < sectors; s++) {
        const a = (s / sectors) * Math.PI * 2;
        this.discCells.push({ x: Math.cos(a) * rm, z: Math.sin(a) * rm, area: cellArea });
      }
    }

    // --- drag sample points ----------------------------------------------
    const totalArea = 2 * opts.radius * opts.halfLength * 2 + Math.PI * opts.radius * opts.radius;
    const sliceArea = totalArea / stations;
    const perPoint = sliceArea / ring;
    for (let i = 0; i < stations; i++) {
      const y = -opts.halfLength + ((i + 0.5) / stations) * opts.halfLength * 2;
      for (let j = 0; j < ring; j++) {
        const a = (j / ring) * Math.PI * 2;
        this.localSamples.push(
          new THREE.Vector3(Math.cos(a) * opts.radius * 0.78, y, Math.sin(a) * opts.radius * 0.78),
        );
        this.worldSamples.push(new THREE.Vector3());
        this.sampleAreas.push(perPoint);
      }
    }

    body.setLinearDamping(opts.linearDamping ?? 0.05);
    body.setAngularDamping(opts.angularDamping ?? 3.2);
  }

  /** Apply buoyancy, water drag and current forces for this step. */
  applyForces(water: WaterFlowSystem, gravity: number, dt: number): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    this.tmpQInv.copy(this.tmpQ).invert();

    const linvel = this.body.linvel();
    const angvel = this.body.angvel();

    // One water query for the whole body: the flow barely varies over a log.
    // The *column* sample is used (not a point sample) because a floating log
    // has its centre above the waterline - a point sample there would report
    // "dry" and the log would never be supported.
    const s = water.columnAt(t.x, t.z);
    this.debug.present = s.present;
    this.debug.surfaceY = s.surfaceY;
    if (!s.present) {
      this.submergedVolume = 0;
      return;
    }

    // ------------------------------------------------------------ buoyancy
    // A floating log has its axis *above* the waterline, so the test is
    // "does any part of the body reach below the surface".
    const surfaceY = s.surfaceY;
    if (t.y - this.radius < surfaceY) {
      const below = this.volumeBelow(surfaceY);
      let V = below.v;
      let mx = below.mx;
      let my = below.my;
      let mz = below.mz;

      // A falling sheet is a thin curtain: only the part of the log that is
      // actually inside the sheet is supported by the water.
      if (s.source === 'fall') {
        const upper = this.volumeBelow(surfaceY);
        const lower = this.volumeBelow(surfaceY - Math.max(0.2, s.depth));
        V = upper.v - lower.v;
        mx = upper.mx - lower.mx;
        my = upper.my - lower.my;
        mz = upper.mz - lower.mz;
      }

      if (V > 1e-5) {
        this.submergedVolume = V;
        // Centre of buoyancy in the body's local frame.
        const cl = this.tmpC.set(mx / V, my / V, mz / V);
        // ... and in world space.
        const cw = cl.clone().applyQuaternion(this.tmpQ);
        cw.x += t.x;
        cw.y += t.y;
        cw.z += t.z;

        // Cap the lift: a body that ends up deep under water must not be
        // fired back out at hundreds of metres per second.
        const maxLift = this.mass * gravity * 3.2;
        const f = Math.min(WATER_DENSITY * this.buoyancyScale * V * gravity, maxLift);
        this.debug.force = f;
        this.body.applyImpulseAtPoint(
          { x: 0, y: f * dt, z: 0 },
          { x: cw.x, y: cw.y, z: cw.z },
          true,
        );
        this.draft = Math.max(0, surfaceY - (t.y - this.radius));
      }
    } else {
      this.submergedVolume = 0;
    }

    // ---------------------------------------------------------------- drag
    // The wetted surface of a floating cylinder is a narrow strip along its
    // underside, so the drag is computed from the analytic wetted area and
    // applied at the centre of that strip. That keeps the current pushing the
    // log along at the speed of the water without a spurious rolling torque.
    const kLin = 90 * this.currentDrag;
    const kQuad = 190 * this.currentDrag;
    const mass = this.mass;
    const maxDepth = s.source === 'fall' ? s.depth : Infinity;

    const segArea = this.submergedVolume / Math.max(0.001, this.halfLength * 2);
    const geom = this.segmentGeometry(segArea);
    const wettedArea = geom.arc * this.halfLength * 2 * (maxDepth === Infinity ? 1 : 0.35);
    this.debug.wetted = wettedArea;

    if (wettedArea > 1e-4) {
      // The drag acts on the log's axis. The wetted surface of a cylinder is
      // symmetric, so pushing it from the centre of the hull is what keeps
      // the current from spinning the log like a wheel.
      this.tmpC.set(t.x, t.y, t.z);
      this.tmpV.set(linvel.x, linvel.y, linvel.z);
      const rvx = this.tmpV.x - s.vx;
      const rvy = this.tmpV.y - s.vy;
      const rvz = this.tmpV.z - s.vz;
      const speed = Math.hypot(rvx, rvy, rvz);
      if (speed > 1e-5) {
        const k = (kLin + kQuad * Math.min(speed, 25)) * wettedArea;
        let ix = -k * rvx * dt;
        // A floating body is far more damped vertically than horizontally -
        // without this the logs bob like a cork instead of settling.
        let iy = -k * rvy * dt * TUNE.log.verticalDrag;
        let iz = -k * rvz * dt;
        // The drag may never reverse the motion within a single step.
        const mag = Math.hypot(ix, iy, iz);
        const maxImp = mass * speed * 0.7;
        if (mag > maxImp) {
          const f = maxImp / mag;
          ix *= f; iy *= f; iz *= f;
        }
        this.body.applyImpulseAtPoint(
          { x: ix, y: iy, z: iz },
          { x: this.tmpC.x, y: this.tmpC.y, z: this.tmpC.z },
          true,
        );
      }
    }

    // --------------------------------------------------------- righting
    // A perfect cylinder has no righting moment at all, which turns every
    // log into a barrel that spins under the current. Real driftwood is
    // never a perfect cylinder, so give the logs a gentle tendency to lie
    // flat - the player can still tip them by shifting their weight.
    if (TUNE.log.righting > 0) {
      // The righting moment acts about the log's own axis: it rolls the log
      // back so that its flat side faces up, without fighting the (physical)
      // pitch righting moment that the buoyancy provides.
      this.tmpAxis.set(0, 1, 0).applyQuaternion(this.tmpQ);      // the log's axis
      this.tmpUp.set(0, 1, 0);
      // The world up, projected into the log's cross section.
      const along = this.tmpUp.dot(this.tmpAxis);
      this.tmpUp.addScaledVector(this.tmpAxis, -along);
      if (this.tmpUp.lengthSq() > 1e-8) {
        this.tmpUp.normalize();
        this.tmpSide.set(1, 0, 0).applyQuaternion(this.tmpQ);  // the log's "up"
        // Signed roll angle: how far the log's up is from the world up.
        this.tmpCross.copy(this.tmpSide).cross(this.tmpUp);
        const sinA = this.tmpCross.dot(this.tmpAxis);
        const cosA = THREE.MathUtils.clamp(this.tmpSide.dot(this.tmpUp), -1, 1);
        const angle = Math.atan2(sinA, cosA);
        // Critically damped spring: a stiff righting moment alone would make
        // the log oscillate (and eventually tumble) instead of settling.
        const inertia = 0.5 * this.mass * this.radius * this.radius;
        const k = TUNE.log.righting;
        const c = 2 * Math.sqrt(Math.max(1, k * inertia)) * TUNE.log.rightingDamp;
        const rollRate = angvel.x * this.tmpAxis.x + angvel.y * this.tmpAxis.y + angvel.z * this.tmpAxis.z;
        // A positive rotation about the axis carries the log's up towards
        // the world up, so the spring pushes in that direction.
        const torque = k * angle - c * rollRate;
        this.debug.roll = angle;
        this.debug.rtorque = torque;
        this.body.applyTorqueImpulse(
          { x: this.tmpAxis.x * torque * dt, y: this.tmpAxis.y * torque * dt, z: this.tmpAxis.z * torque * dt },
          true,
        );
      }
    }

    // Keep the debug sample points up to date.
    for (let i = 0; i < this.localSamples.length; i++) {
      const local = this.localSamples[i];
      this.tmpP.copy(local).applyQuaternion(this.tmpQ);
      this.worldSamples[i].set(t.x + this.tmpP.x, t.y + this.tmpP.y, t.z + this.tmpP.z);
    }
  }

  /**
   * Geometry of the submerged cross section of a cylinder.
   * Returns the wetted arc length and the distance of the submerged
   * segment's centroid from the axis (measured towards the deep side).
   */
  private segmentGeometry(segArea: number): { arc: number; centroid: number } {
    const r = this.radius;
    const maxArea = Math.PI * r * r;
    if (segArea <= 1e-6) return { arc: 0, centroid: 0 };
    if (segArea >= maxArea) return { arc: 2 * Math.PI * r, centroid: (4 * r) / (3 * Math.PI) };

    // A(c) = r^2 (acos(c) - c sqrt(1 - c^2)) is the area of a circular
    // segment and decreases monotonically with c, so bisect for it.
    let lo = 1;
    let hi = -1;
    for (let i = 0; i < 30; i++) {
      const c = (lo + hi) * 0.5;
      const a = r * r * (Math.acos(c) - c * Math.sqrt(Math.max(0, 1 - c * c)));
      if (a > segArea) lo = c;
      else hi = c;
    }
    const c = (lo + hi) * 0.5;
    const theta = Math.acos(c);
    const arc = 2 * r * theta;
    const denom = 3 * (2 * theta - Math.sin(2 * theta));
    const centroid = denom > 1e-6 ? (4 * r * Math.pow(Math.sin(theta), 3)) / denom : r;
    return { arc, centroid };
  }

  /**
   * Integrate the volume (and its first moments) of the cylinder that lies
   * below the horizontal plane `planeY` in world space.
   */
  private volumeBelow(planeY: number): { v: number; mx: number; my: number; mz: number } {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    this.tmpQInv.copy(this.tmpQ).invert();

    // The world "up" expressed in the body's local frame.
    this.tmpN.set(0, 1, 0).applyQuaternion(this.tmpQInv);
    const n = this.tmpN;
    // The plane offset in local coordinates.
    const d = planeY - t.y;

    this.debug.nx = n.x; this.debug.ny = n.y; this.debug.nz = n.z;

    const h = this.halfLength;
    let v = 0;
    let mx = 0;
    let my = 0;
    let mz = 0;

    const absNy = Math.abs(n.y);
    for (const cell of this.discCells) {
      const s = n.x * cell.x + n.z * cell.z;
      let len: number;
      let mid: number;
      if (absNy < 1e-4) {
        // The plane is parallel to the log's axis.
        len = s < d ? h * 2 : 0;
        mid = 0;
      } else if (n.y > 0) {
        const Y = (d - s) / n.y;
        const hi = Math.min(h, Y);
        len = Math.max(0, hi + h);
        mid = (-h + Math.min(h, Y)) * 0.5;
      } else {
        const Y = (d - s) / n.y;
        const lo = Math.max(-h, Y);
        len = Math.max(0, h - lo);
        mid = (Math.max(-h, Y) + h) * 0.5;
      }
      if (len <= 0) continue;
      const dv = len * cell.area;
      v += dv;
      mx += cell.x * dv;
      my += mid * dv;
      mz += cell.z * dv;
    }
    this.debug.belowV = v;
    return { v, mx, my, mz };
  }
}
