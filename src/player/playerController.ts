/**
 * PlayerController
 * ---------------------------------------------------------------------------
 * A hybrid character controller.
 *
 * The character is a *kinematic* body driven by Rapier's character controller
 * (so it never falls through geometry and copes with slopes), but every
 * interaction with the world is force based:
 *
 *  - moving platforms are carried manually (Rapier only carries kinematic
 *    bodies, and our logs are dynamic),
 *  - the character's weight and acceleration are fed back into the log it
 *    stands on, so leaning really does tip the boat,
 *  - jumps preserve the platform velocity at the launch point.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNE } from '../core/config';
import { Input } from '../core/input';
import { InterpolatedTransform } from '../core/interpolated';
import { WaterFlowSystem } from '../world/waterFlowSystem';
import { GrabSystem } from './grabSystem';
import { PaddleSystem } from './paddleSystem';

export type PlayerState = 'grounded' | 'airborne' | 'swimming' | 'grabbing' | 'climbing';

export interface PlayerSnapshot {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  state: PlayerState;
  grounded: boolean;
  swimming: boolean;
  submersion: number;
  platformSpeed: number;
  ridingLog: boolean;
  grabTarget: boolean;
}

export class PlayerController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  readonly controller: RAPIER.KinematicCharacterController;
  readonly transform = new InterpolatedTransform();
  readonly grab: GrabSystem;
  readonly paddle: PaddleSystem;

  /** World velocity of the character. */
  readonly velocity = new THREE.Vector3();
  /** Velocity of the platform under the character's feet. */
  readonly platformVel = new THREE.Vector3();
  /** Contact point with the ground (world space). */
  readonly groundPoint = new THREE.Vector3();

  groundBody: RAPIER.RigidBody | null = null;
  groundCollider: RAPIER.Collider | null = null;
  grounded = false;
  swimming = false;
  grabbing = false;
  state: PlayerState = 'airborne';
  submersion = 0;
  /** Set true while the character rides a floating log. */
  ridingLog = false;

  /** Diagnostics from the last step. */
  readonly debug = {
    desiredY: 0, moveY: 0, platformY: 0, velY: 0, grounded: false, groundDist: 0,
  };

  /** The character's position in the platform's local frame (last step). */
  private readonly platLocal = new THREE.Vector3();
  private readonly platLocalPrev = new THREE.Vector3();
  private hasPlatLocal = false;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQInv = new THREE.Quaternion();
  private readonly tmpDrift = new THREE.Vector3();

  private coyote = 0;
  private jumpBuffer = 0;
  private readonly halfHeight: number;
  private readonly radius: number;
  private readonly footOffset: number;
  private readonly tmp = new THREE.Vector3();
  private readonly tmp2 = new THREE.Vector3();
  private readonly ball: RAPIER.Ball;

  constructor(
    private readonly world: RAPIER.World,
    private readonly water: WaterFlowSystem,
    private readonly grabbables: Set<number>,
    start: THREE.Vector3,
  ) {
    this.halfHeight = 0.55;
    this.radius = TUNE.character.radius;
    this.footOffset = this.halfHeight + this.radius;

    const desc = RAPIER.RigidBodyDesc.kinematicPositionBased()
      .setTranslation(start.x, start.y, start.z);
    this.body = world.createRigidBody(desc);

    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(this.halfHeight, this.radius)
        .setFriction(0.6)
        .setRestitution(0),
      this.body,
    );

    this.controller = world.createCharacterController(0.02);
    this.controller.setUp({ x: 0, y: 1, z: 0 });
    this.controller.enableAutostep(0.45, 0.2, true);
    this.controller.enableSnapToGround(0.45);
    this.controller.setMaxSlopeClimbAngle((58 * Math.PI) / 180);
    this.controller.setMinSlopeSlideAngle((48 * Math.PI) / 180);
    this.controller.setSlideEnabled(true);
    // The character controller must NOT push dynamic bodies directly: the
    // chaotic collision impulses make a log roll away uncontrollably. The
    // player's weight is transferred to the log by hand instead.
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.controller.setCharacterMass(TUNE.character.mass);

    this.ball = new RAPIER.Ball(0.12);

    this.grab = new GrabSystem(world, this.grabbables);
    this.paddle = new PaddleSystem();

    this.transform.init(start, new THREE.Quaternion());
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return this.tmp.set(t.x, t.y, t.z);
  }

  /** Yaw the character is facing (follows the camera). */
  facingYaw = 0;

  /**
   * Advance the character by one fixed step.
   * `wish` is the camera-relative movement direction (world XZ, normalised).
   * `facing` is the camera's forward direction (world XZ, normalised).
   */
  fixedUpdate(
    dt: number,
    input: Input,
    wish: THREE.Vector3,
    sprint: boolean,
    facing: THREE.Vector3,
  ): void {
    const pos = this.position.clone();

    // -------------------------------------------------------------- water
    // The column sample is taken at the feet so that being *above* the
    // surface still tells us how deep the water is here.
    const column = this.water.columnAt(pos.x, pos.z);
    const feetY = pos.y - this.footOffset;
    const surface = column.present ? column.surfaceY : -Infinity;
    const sub = column.present
      ? THREE.MathUtils.clamp((surface - feetY) / (this.footOffset * 2), 0, 1)
      : 0;
    this.submersion = sub;

    const deep = column.present && surface > feetY + 0.35;
    const veryDeep = column.present && surface > pos.y + 0.2;
    this.swimming = veryDeep || (deep && !this.grounded);

    // ------------------------------------------------------------- states
    if (this.grab.active) {
      this.state = this.grab.climbing ? 'climbing' : 'grabbing';
    } else if (this.swimming) {
      this.state = 'swimming';
    } else if (this.grounded) {
      this.state = 'grounded';
    } else {
      this.state = 'airborne';
    }

    // ------------------------------------------------------------- timers
    this.coyote = this.grounded ? TUNE.character.coyoteTime : Math.max(0, this.coyote - dt);
    if (input.pressed('Space')) this.jumpBuffer = TUNE.character.jumpBuffer;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    // ---------------------------------------------------------- movement
    const wishLen = wish.length();
    if (wishLen > 1e-4) {
      wish.multiplyScalar(1 / wishLen);
    }
    const hasInput = wishLen > 1e-4;

    if (this.swimming) {
      this.swimUpdate(dt, wish, hasInput, column);
    } else if (this.grounded) {
      this.groundUpdate(dt, wish, hasInput, sprint);
    } else {
      this.airUpdate(dt, wish, hasInput);
    }

    // ------------------------------------------------------------- jump
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0) && !this.swimming) {
      const platformUp = this.platformVel.y;
      this.velocity.y = platformUp + TUNE.character.jumpSpeed;
      // Third law: pushing off shoves the log downwards.
      if (this.groundBody) {
        const imp = TUNE.character.mass * TUNE.character.jumpSpeed;
        this.groundBody.applyImpulseAtPoint(
          { x: 0, y: -imp, z: 0 },
          { x: this.groundPoint.x, y: this.groundPoint.y, z: this.groundPoint.z },
          true,
        );
      }
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      this.groundBody = null;
    }

    // ------------------------------------------------------ grab & paddle
    // Grab: press the left mouse button to catch a reachable log.
    if (input.mousePressed(0) && !this.grab.active) {
      const hand = new THREE.Vector3(pos.x, pos.y + 0.28, pos.z);
      this.grab.tryGrab(hand, facing, TUNE.character.grabRange);
    }
    if (input.mouseReleased(0) && this.grab.active) {
      this.grab.release();
    }
    this.grab.update(dt, this, wish, hasInput);
    this.paddle.update(dt, this, input, wish, hasInput, facing, column);

    // ------------------------------------------------- desired translation
    const desired = this.tmp2.copy(this.velocity).multiplyScalar(dt);
    // Press gently into whatever we are standing on so contact is maintained.
    if (this.grounded && !this.swimming) desired.y = -0.55 * dt;

    this.controller.computeColliderMovement(this.collider, {
      x: desired.x, y: desired.y, z: desired.z,
    });
    const movement = this.controller.computedMovement();
    this.debug.desiredY = desired.y;
    this.debug.moveY = movement.y;
    this.debug.platformY = this.platformVel.y;
    this.debug.velY = this.velocity.y;

    const cur = this.body.translation();
    let nextX = cur.x + movement.x;
    let nextY = cur.y + movement.y;
    let nextZ = cur.z + movement.z;

    // --- traction ---------------------------------------------------------
    // A wet log is slippery, but a character who is not trying to move
    // should still be able to stand still. Cancel the slow drift relative
    // to the log, up to a limit so a steep tilt still throws them off.
    if (this.grounded && this.groundBody) {
      this.updatePlatformLocal(nextX, nextY, nextZ);
      if (!hasInput && this.hasPlatLocal) {
        const drift = this.tmpDrift.copy(this.platLocal).sub(this.platLocalPrev);
        const driftLen = drift.length();
        if (driftLen > 1e-6) {
          // Grip: cancel the slow drift completely, but let a fast slide
          // (a steeply tilted log) win.
          const limit = TUNE.character.gripLimit * dt;
          const correct = Math.min(driftLen, limit);
          drift.multiplyScalar(correct / driftLen);
          // Back to world space.
          this.tmpQ.set(
            this.groundBody.rotation().x,
            this.groundBody.rotation().y,
            this.groundBody.rotation().z,
            this.groundBody.rotation().w,
          );
          drift.applyQuaternion(this.tmpQ);
          nextX -= drift.x;
          nextY -= drift.y;
          nextZ -= drift.z;
          this.updatePlatformLocal(nextX, nextY, nextZ);
        }
      }
    }

    this.body.setNextKinematicTranslation({ x: nextX, y: nextY, z: nextZ });

    // If the controller blocked us (wall, steep slope) drop the blocked part
    // of our velocity so we do not keep pushing into it.
    const wanted = Math.hypot(desired.x, desired.z);
    const got = Math.hypot(movement.x, movement.z);
    if (wanted > 1e-4 && got < wanted * 0.92) {
      const k = THREE.MathUtils.clamp(got / wanted, 0, 1);
      this.velocity.x *= k;
      this.velocity.z *= k;
    }
  }

  /** Update the character's position in the platform's local frame. */
  private updatePlatformLocal(x: number, y: number, z: number): void {
    if (!this.groundBody) {
      this.hasPlatLocal = false;
      return;
    }
    const t = this.groundBody.translation();
    const r = this.groundBody.rotation();
    this.tmpQInv.set(r.x, r.y, r.z, r.w).invert();
    this.platLocal.set(x - t.x, y - t.y, z - t.z).applyQuaternion(this.tmpQInv);
  }

  /** Called after the physics step: refresh ground contact information. */
  postStep(dt: number): void {
    this.platLocalPrev.copy(this.platLocal);
    this.hasPlatLocal = this.grounded && this.groundBody !== null;
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    this.ridingLog = false;

    if (this.grounded) {
      const t = this.body.translation();
      const castPos = { x: t.x, y: t.y - this.footOffset + 0.12, z: t.z };
      const hit = this.world.castShape(
        castPos,
        { x: 0, y: 0, z: 0, w: 1 },
        { x: 0, y: -1, z: 0 },
        this.ball,
        0,
        0.55,
        true,
        undefined,
        undefined,
        this.collider,
        this.body,
      );

      if (hit) {
        this.debug.groundDist = hit.time_of_impact;
        this.groundBody = hit.collider.parent();
        this.groundCollider = hit.collider;
        this.groundPoint.set(hit.witness1.x, hit.witness1.y, hit.witness1.z);
        this.computePlatformVelocity();
        this.ridingLog = this.grabbables.has(hit.collider.handle);
      } else {
        this.groundBody = null;
        this.groundCollider = null;
        this.platformVel.set(0, 0, 0);
      }
    } else {
      this.groundBody = null;
      this.groundCollider = null;
      if (wasGrounded) {
        // Leaving a platform: bake its velocity into ours so momentum is kept.
        this.velocity.add(this.platformVel);
      }
      // Platform velocity bleeds off once we leave it.
      this.platformVel.multiplyScalar(Math.max(0, 1 - dt * 9));
    }
  }

  private computePlatformVelocity(): void {
    const body = this.groundBody;
    if (!body) {
      this.platformVel.set(0, 0, 0);
      return;
    }
    const lv = body.linvel();
    const av = body.angvel();
    const t = body.translation();
    const rx = this.groundPoint.x - t.x;
    const ry = this.groundPoint.y - t.y;
    const rz = this.groundPoint.z - t.z;
    let vx = lv.x + (av.y * rz - av.z * ry);
    let vy = lv.y + (av.z * rx - av.x * rz);
    let vz = lv.z + (av.x * ry - av.y * rx);
    // Keep the carry sane: a violently tumbling log should not launch anyone.
    const speed = Math.hypot(vx, vy, vz);
    const max = 12;
    if (speed > max) {
      const k = max / speed;
      vx *= k; vy *= k; vz *= k;
    }
    this.platformVel.set(vx, vy, vz);
  }

  // ---------------------------------------------------------------- states

  private groundUpdate(dt: number, wish: THREE.Vector3, hasInput: boolean, sprint: boolean): void {
    const relX = this.velocity.x - this.platformVel.x;
    const relZ = this.velocity.z - this.platformVel.z;

    const speed = sprint ? TUNE.character.runSpeed : TUNE.character.walkSpeed;
    const targetX = wish.x * speed;
    const targetZ = wish.z * speed;

    const accel = TUNE.character.groundAccel * dt;
    let nx = approach(relX, targetX, accel);
    let nz = approach(relZ, targetZ, accel);

    if (!hasInput) {
      const fr = TUNE.character.groundFriction * dt;
      nx = approach(nx, 0, fr);
      nz = approach(nz, 0, fr);
    }

    // Traction: without input the character settles relative to the log
    // instead of sliding off a rolling surface.
    if (!hasInput) {
      const grip = TUNE.character.traction * dt;
      nx = approach(nx, 0, grip);
      nz = approach(nz, 0, grip);
    }

    // Reacting against the platform: what we gain, the log loses.
    const dvx = nx - relX;
    const dvz = nz - relZ;
    if (this.groundBody && (dvx !== 0 || dvz !== 0)) {
      const k = -TUNE.character.mass * TUNE.character.logReaction;
      this.groundBody.applyImpulseAtPoint(
        { x: dvx * k, y: 0, z: dvz * k },
        { x: this.groundPoint.x, y: this.groundPoint.y, z: this.groundPoint.z },
        true,
      );
    }

    // The character's weight presses on the log: this is what tips and
    // rolls a floating platform under the player.
    if (this.groundBody) {
      const w = TUNE.character.mass * TUNE.world.gravity * dt;
      this.groundBody.applyImpulseAtPoint(
        { x: 0, y: -w, z: 0 },
        { x: this.groundPoint.x, y: this.groundPoint.y, z: this.groundPoint.z },
        true,
      );
    }

    this.velocity.x = this.platformVel.x + nx;
    this.velocity.z = this.platformVel.z + nz;
    // The vertical motion of the surface is handled by the ground solver:
    // following it exactly would push the character into (or off) a log that
    // is rolling underneath them.
    this.velocity.y = 0;
  }

  private airUpdate(dt: number, wish: THREE.Vector3, hasInput: boolean): void {
    const speed = TUNE.character.runSpeed;
    if (hasInput) {
      const accel = TUNE.character.airAccel * dt;
      this.velocity.x = approach(this.velocity.x, wish.x * speed, accel);
      this.velocity.z = approach(this.velocity.z, wish.z * speed, accel);
    } else {
      const drag = TUNE.character.airDrag * dt;
      this.velocity.x = approach(this.velocity.x, 0, drag);
      this.velocity.z = approach(this.velocity.z, 0, drag);
    }
    this.velocity.y -= TUNE.world.gravity * dt;
    this.velocity.y = Math.max(this.velocity.y, -42);
  }

  private swimUpdate(
    dt: number,
    wish: THREE.Vector3,
    hasInput: boolean,
    water: { vx: number; vy: number; vz: number; surfaceY: number; present: boolean },
  ): void {    const speed = TUNE.character.swimSpeed;
    const accel = TUNE.character.swimAccel * dt;

    if (hasInput) {
      // The stroke adds velocity *relative to the water*.
      const targetVx = water.vx + wish.x * speed;
      const targetVz = water.vz + wish.z * speed;
      this.velocity.x = approach(this.velocity.x, targetVx, accel);
      this.velocity.z = approach(this.velocity.z, targetVz, accel);
    } else {
      // Drift with the current.
      this.velocity.x = approach(this.velocity.x, water.vx, accel * 0.6);
      this.velocity.z = approach(this.velocity.z, water.vz, accel * 0.6);
    }

    // Buoyancy: settle with the body floating at `floatDepth` below the surface.
    const pos = this.position;
    const targetY = water.surfaceY - TUNE.character.floatDepth;
    const buoy = (targetY - pos.y) * TUNE.character.buoyancyK;
    const ay = THREE.MathUtils.clamp(buoy, -18, 22);
    this.velocity.y += ay * dt;
    this.velocity.y *= 1 - Math.min(0.9, 2.6 * dt);
    this.velocity.y += water.vy * 0.35 * dt;
  }

  /** Apply an impulse (m/s change) to the character. */
  addImpulse(v: THREE.Vector3): void {
    this.velocity.add(v);
  }

  syncFromBody(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.transform.capture(
      new THREE.Vector3(t.x, t.y, t.z),
      new THREE.Quaternion(r.x, r.y, r.z, r.w),
    );
  }

  teleport(pos: THREE.Vector3): void {
    this.body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
    this.body.setNextKinematicTranslation({ x: pos.x, y: pos.y, z: pos.z });
    this.velocity.set(0, 0, 0);
    this.platformVel.set(0, 0, 0);
    this.grab.release();
    this.transform.init(pos, new THREE.Quaternion());
  }

  snapshot(): PlayerSnapshot {
    return {
      position: this.position.clone(),
      velocity: this.velocity.clone(),
      state: this.state,
      grounded: this.grounded,
      swimming: this.swimming,
      submersion: this.submersion,
      platformSpeed: this.platformVel.length(),
      ridingLog: this.ridingLog,
      grabTarget: this.grab.active,
    };
  }
}

/** Move `current` towards `target` by at most `maxDelta`. */
export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
