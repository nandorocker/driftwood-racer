import * as THREE from 'three';

/**
 * Keeps two transform snapshots so the renderer can interpolate between
 * physics steps. The simulation runs at a fixed rate; the display does not.
 */
export class InterpolatedTransform {
  readonly prevPos = new THREE.Vector3();
  readonly prevQuat = new THREE.Quaternion();
  readonly currPos = new THREE.Vector3();
  readonly currQuat = new THREE.Quaternion();

  private initialised = false;

  init(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    this.prevPos.copy(pos);
    this.currPos.copy(pos);
    this.prevQuat.copy(quat);
    this.currQuat.copy(quat);
    this.initialised = true;
  }

  /** Called once per physics step, after the world has stepped. */
  capture(pos: THREE.Vector3, quat: THREE.Quaternion): void {
    if (!this.initialised) {
      this.init(pos, quat);
      return;
    }
    this.prevPos.copy(this.currPos);
    this.prevQuat.copy(this.currQuat);
    this.currPos.copy(pos);
    this.currQuat.copy(quat);
  }

  applyTo(object: THREE.Object3D, alpha: number): void {
    if (!this.initialised) return;
    object.position.lerpVectors(this.prevPos, this.currPos, alpha);
    object.quaternion.slerpQuaternions(this.prevQuat, this.currQuat, alpha);
  }
}
