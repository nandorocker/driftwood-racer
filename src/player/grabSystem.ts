/**
 * GrabSystem
 * ---------------------------------------------------------------------------
 * A temporary physical grip between the character and a reachable object.
 *
 * Implemented as a distance constraint (a "rope") that is solved manually so
 * that both sides react properly: the character is pulled towards the object
 * and the object receives the equal and opposite impulse. Holding the grab
 * while pushing towards the object reels the grip in, which is how the
 * character climbs back aboard a log.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNE } from '../core/config';
import type { PlayerController } from './playerController';

export class GrabSystem {
  active = false;
  /** True while the grip is reeling in (climbing). */
  climbing = false;
  target: RAPIER.RigidBody | null = null;
  targetCollider: RAPIER.Collider | null = null;

  private readonly localAnchor = new THREE.Vector3();
  private readonly anchorWorld = new THREE.Vector3();
  private maxLen = 0;
  private readonly minLen = 0.55;
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();

  constructor(
    private readonly world: RAPIER.World,
    private readonly grabbables: Set<number>,
  ) {}

  /** Try to grab whatever is in front of the character. */
  tryGrab(origin: THREE.Vector3, dir: THREE.Vector3, range: number): boolean {
    if (this.active) return false;
    const ray = new RAPIER.Ray(
      { x: origin.x, y: origin.y, z: origin.z },
      { x: dir.x, y: dir.y, z: dir.z },
    );
    const hit = this.world.castRay(
      ray,
      range,
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      (collider: RAPIER.Collider) => this.grabbables.has(collider.handle),
    );
    if (!hit) return false;

    const body = hit.collider.parent();
    if (!body) return false;

    const t = body.translation();
    const r = body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w).invert();
    // The hit point in world space -> body local space.
    const worldPoint = new THREE.Vector3(
      origin.x + dir.x * hit.timeOfImpact,
      origin.y + dir.y * hit.timeOfImpact,
      origin.z + dir.z * hit.timeOfImpact,
    );
    this.localAnchor.set(
      worldPoint.x - t.x,
      worldPoint.y - t.y,
      worldPoint.z - t.z,
    ).applyQuaternion(this.tmpQ);

    this.target = body;
    this.targetCollider = hit.collider;
    this.maxLen = Math.min(range, worldPoint.distanceTo(origin) + 0.15);
    this.active = true;
    this.climbing = false;
    return true;
  }

  release(): void {
    this.active = false;
    this.climbing = false;
    this.target = null;
    this.targetCollider = null;
  }

  update(dt: number, player: PlayerController, wish: THREE.Vector3, hasInput: boolean): void {
    if (!this.active || !this.target) return;

    const body = this.target;
    const t = body.translation();
    const r = body.rotation();
    this.tmpQ.set(r.x, r.y, r.z, r.w);
    this.anchorWorld.copy(this.localAnchor).applyQuaternion(this.tmpQ);
    this.anchorWorld.x += t.x;
    this.anchorWorld.y += t.y;
    this.anchorWorld.z += t.z;

    const pos = player.position;
    // The "hand" sits slightly in front of the chest.
    this.tmpV.set(pos.x, pos.y + 0.28, pos.z);
    this.tmpDir.copy(this.anchorWorld).sub(this.tmpV);
    const d = this.tmpDir.length();
    if (d < 1e-4) return;
    this.tmpDir.multiplyScalar(1 / d);

    // --- reeling in: pushing towards the object climbs onto it ------------
    this.climbing = false;
    if (hasInput && wish.dot(this.tmpDir) > 0.25 && d < TUNE.character.grabRange * 1.6) {
      this.maxLen = Math.max(this.minLen, this.maxLen - TUNE.character.climbSpeed * dt);
      this.climbing = true;
    }

    // --- distance constraint ---------------------------------------------
    if (d > this.maxLen) {
      const excess = d - this.maxLen;
      const force = TUNE.character.grabStiffness * excess;   // acceleration
      player.velocity.addScaledVector(this.tmpDir, force * dt);

      // Third law: the object feels the pull.
      const imp = force * TUNE.character.mass * dt;
      body.applyImpulseAtPoint(
        { x: -this.tmpDir.x * imp, y: -this.tmpDir.y * imp, z: -this.tmpDir.z * imp },
        { x: this.anchorWorld.x, y: this.anchorWorld.y, z: this.anchorWorld.z },
        true,
      );
    }

    // --- auto release once we are back on top ----------------------------
    // The character is "aboard" when the character controller has them
    // standing on the object they are holding.
    if (player.groundBody && player.groundBody === this.target) {
      this.release();
      return;
    }
  }
}
