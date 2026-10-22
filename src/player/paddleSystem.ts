/**
 * PaddleSystem
 * ---------------------------------------------------------------------------
 * Directional paddle strokes. An explicit, input driven force - not a hand
 * based fluid simulation.
 *
 * While swimming the stroke propels the character through the water. While
 * riding a log near the surface the stroke pushes the *log*, which is how a
 * player steers a floating platform by paddling it.
 */

import * as THREE from 'three';
import { TUNE } from '../core/config';
import { Input } from '../core/input';
import type { PlayerController } from './playerController';

export class PaddleSystem {
  private timer = 0;
  /** Distance travelled by the last stroke (for feedback). */
  lastStrokePower = 0;

  update(
    dt: number,
    player: PlayerController,
    input: Input,
    wish: THREE.Vector3,
    hasInput: boolean,
    facing: THREE.Vector3,
    water: { surfaceY: number; present: boolean },
  ): void {
    if (!input.mouseDown(2)) {
      this.timer = 0;
      return;
    }

    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = TUNE.character.paddleCadence;

    // Direction: where the player is steering, else where the camera looks.
    const dir = this.tmpDir;
    if (hasInput) dir.copy(wish);
    else dir.copy(facing);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();

    const impulse = TUNE.character.paddleImpulse;
    this.lastStrokePower = impulse;

    if (player.swimming) {
      const dv = impulse / TUNE.character.mass;
      player.addImpulse(dir.clone().multiplyScalar(dv));
      return;
    }

    // Riding a log: the stroke is applied to the log, not the character.
    const ground = player.groundBody;
    if (!ground) return;
    const pos = player.position;
    // The stroke has to reach the water: check the character's feet, not
    // their head, and allow a generous reach from a floating log.
    const feet = pos.y - 0.87;
    const nearWater =
      water.present && water.surfaceY > feet - 2.4 && water.surfaceY < feet + 1.4;
    if (!nearWater) return;

    ground.applyImpulseAtPoint(
      { x: dir.x * impulse * 2.0, y: 0, z: dir.z * impulse * 2.0 },
      { x: pos.x, y: pos.y - 0.4, z: pos.z },
      true,
    );
  }

  private readonly tmpDir = new THREE.Vector3();
}
