/**
 * CameraController
 * ---------------------------------------------------------------------------
 * Third person orbit camera that follows the *character*, never the log.
 *
 * It keeps a stable world-up orientation, so a log rolling underneath does
 * not roll the camera, and it pulls in when geometry gets between the camera
 * and the player.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TUNE } from '../core/config';
import { Input } from '../core/input';

export class CameraController {
  yaw = Math.PI;   // start looking downstream
  pitch = -0.12;
  private distance = TUNE.camera.distance;
  private readonly focus = new THREE.Vector3();
  private readonly desiredFocus = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private readonly offset = new THREE.Vector3();
  /** Bodies the camera ray should ignore (e.g. the log we are standing on). */
  exclude: RAPIER.RigidBody | null = null;
  private readonly probe = new RAPIER.Ball(0.32);

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.camera.fov = TUNE.camera.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Camera forward direction on the XZ plane (normalised). */
  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /** Camera right direction on the XZ plane (normalised). */
  get right(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  /** Free flying camera (debug). */
  free = false;
  private freePos = new THREE.Vector3();

  toggleFree(target: THREE.Vector3): void {
    this.free = !this.free;
    if (this.free) {
      this.freePos.copy(this.camera.position);
    } else {
      this.snapTo(target);
    }
  }

  updateFree(dt: number, input: Input): void {
    this.yaw -= input.mouseDX * TUNE.camera.sensitivity;
    this.pitch -= input.mouseDY * TUNE.camera.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.5, 1.5);

    const speed = (input.sprint ? 60 : 18) * dt;
    const fwd = this.forward;
    const right = this.right;
    this.freePos.addScaledVector(fwd, input.moveY * speed);
    this.freePos.addScaledVector(right, input.moveX * speed);
    if (input.down('KeyQ')) this.freePos.y -= speed;
    if (input.down('KeyE')) this.freePos.y += speed;

    this.camera.position.copy(this.freePos);
    const look = this.tmp.copy(this.freePos).addScaledVector(fwd, 10);
    this.camera.lookAt(look);
    this.camera.up.set(0, 1, 0);
  }

  update(dt: number, input: Input, target: THREE.Vector3, world: RAPIER.World): void {
    // --- mouse look -------------------------------------------------------
    this.yaw -= input.mouseDX * TUNE.camera.sensitivity;
    this.pitch -= input.mouseDY * TUNE.camera.sensitivity;
    this.pitch = THREE.MathUtils.clamp(this.pitch, TUNE.camera.pitchMin, TUNE.camera.pitchMax);
    if (input.wheel !== 0) {
      this.distance = THREE.MathUtils.clamp(
        this.distance + input.wheel * 0.6,
        TUNE.camera.minDistance,
        TUNE.camera.distance * 2.4,
      );
    }

    // --- follow the character --------------------------------------------
    this.desiredFocus.set(target.x, target.y + TUNE.camera.height, target.z);
    const k = 1 - Math.exp(-TUNE.camera.smoothing * dt);
    this.focus.lerp(this.desiredFocus, k);

    // --- desired camera placement ----------------------------------------
    const cp = Math.cos(this.pitch);
    this.offset.set(
      Math.sin(this.yaw) * cp,
      Math.sin(this.pitch),
      Math.cos(this.yaw) * cp,
    ).multiplyScalar(this.distance);

    // --- collision: pull in if something is in the way -------------------
    // A sphere cast (rather than a ray) keeps the camera from scraping
    // along thin geometry.
    const len = this.offset.length();
    const dir = this.tmp.set(this.offset.x, this.offset.y, this.offset.z).multiplyScalar(1 / len);
    const hit = world.castShape(
      { x: this.focus.x, y: this.focus.y, z: this.focus.z },
      { x: 0, y: 0, z: 0, w: 1 },
      { x: dir.x, y: dir.y, z: dir.z },
      this.probe,
      0,
      len,
      true,
      undefined,
      undefined,
      undefined,
      this.exclude ?? undefined,
    );
    let dist = len;
    if (hit) {
      dist = Math.max(TUNE.camera.minDistance * 0.6, hit.time_of_impact - 0.3);
    }
    this.offset.setLength(dist);

    this.camera.position.copy(this.focus).add(this.offset);
    this.tmp.copy(this.focus);
    this.camera.lookAt(this.tmp);
    this.camera.up.set(0, 1, 0);
  }

  /** Snap the camera straight to its target (used on respawn). */
  snapTo(target: THREE.Vector3): void {
    this.focus.set(target.x, target.y + TUNE.camera.height, target.z);
    this.desiredFocus.copy(this.focus);
  }
}
