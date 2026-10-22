/**
 * The character's visual body.
 *
 * A small stylised adventurer built from primitives, animated procedurally
 * from the controller state: a walk cycle driven by speed, a swim stroke, an
 * airborne tuck and a reaching pose while grabbing.
 */

import * as THREE from 'three';

export interface PlayerModelState {
  speed: number;
  grounded: boolean;
  swimming: boolean;
  grabbing: boolean;
  climbing: boolean;
  localVelocity: THREE.Vector3;
  worldVelocity: THREE.Vector3;
  facingYaw: number;
  /** Vertical speed, used for the landing squash. */
  verticalSpeed: number;
}

export class PlayerModel {
  readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Group;
  private readonly armL = new THREE.Group();
  private readonly armR = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly scarf: THREE.Mesh;

  private phase = 0;
  private lean = new THREE.Vector2();
  private squash = 1;

  constructor() {
    const jacket = new THREE.MeshStandardMaterial({ color: 0xe2653a, roughness: 0.75 });
    const jacketDark = new THREE.MeshStandardMaterial({ color: 0xb8481f, roughness: 0.8 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x36414f, roughness: 0.9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0xe8b48c, roughness: 0.7 });
    const hat = new THREE.MeshStandardMaterial({ color: 0x2f5d63, roughness: 0.85 });
    const pack = new THREE.MeshStandardMaterial({ color: 0x7a5a3a, roughness: 0.9 });
    const scarfMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.85 });

    this.root.add(this.body);
    this.body.position.y = -0.87;   // the body's origin is at the feet

    // Torso
    const torsoGeo = new THREE.CapsuleGeometry(0.24, 0.34, 4, 12);
    this.torso = new THREE.Mesh(torsoGeo, jacket);
    this.torso.position.y = 0.62;
    this.torso.scale.set(1.12, 1, 0.85);
    this.torso.castShadow = true;
    this.body.add(this.torso);

    // Belt
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.045, 6, 16), jacketDark);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = 0.4;
    belt.scale.set(1.1, 1, 0.9);
    this.body.add(belt);

    // Backpack
    const bag = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.36, 0.16), pack);
    bag.position.set(0, 0.66, 0.26);
    bag.castShadow = true;
    this.body.add(bag);

    // Head + hat
    this.head = new THREE.Group();
    this.head.position.y = 1.02;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.185, 14, 12), skin);
    skull.castShadow = true;
    this.head.add(skull);
    const beanie = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.58),
      hat,
    );
    beanie.position.y = 0.03;
    beanie.castShadow = true;
    this.head.add(beanie);
    const brim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.035, 6, 16), hat);
    brim.rotation.x = Math.PI / 2;
    brim.position.y = 0.035;
    this.head.add(brim);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
    nose.position.set(0, -0.01, 0.18);
    this.head.add(nose);
    this.body.add(this.head);

    // Scarf
    this.scarf = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.055, 6, 14), scarfMat);
    this.scarf.rotation.x = Math.PI / 2;
    this.scarf.position.y = 0.86;
    this.body.add(this.scarf);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.3, 0.05), scarfMat);
    tail.position.set(0.1, 0.72, -0.2);
    tail.rotation.z = 0.25;
    this.body.add(tail);

    // Arms
    const armGeo = new THREE.CapsuleGeometry(0.075, 0.34, 4, 8);
    const buildArm = (group: THREE.Group, side: number) => {
      const upper = new THREE.Mesh(armGeo, jacket);
      upper.position.y = -0.2;
      upper.castShadow = true;
      group.add(upper);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.085, 8, 6), skin);
      hand.position.y = -0.42;
      group.add(hand);
      group.position.set(side * 0.3, 0.82, 0);
    };
    buildArm(this.armL, -1);
    buildArm(this.armR, 1);
    this.body.add(this.armL, this.armR);

    // Legs
    const legGeo = new THREE.CapsuleGeometry(0.095, 0.36, 4, 8);
    const buildLeg = (group: THREE.Group, side: number) => {
      const thigh = new THREE.Mesh(legGeo, trousers);
      thigh.position.y = -0.23;
      thigh.castShadow = true;
      group.add(thigh);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.26), jacketDark);
      boot.position.set(0, -0.46, 0.04);
      boot.castShadow = true;
      group.add(boot);
      group.position.set(side * 0.13, 0.4, 0);
    };
    buildLeg(this.legL, -1);
    buildLeg(this.legR, 1);
    this.body.add(this.legL, this.legR);
  }

  update(dt: number, s: PlayerModelState): void {
    const speed = Math.hypot(s.localVelocity.x, s.localVelocity.z);
    const moving = speed > 0.35;

    // --- walk cycle -------------------------------------------------------
    const stride = THREE.MathUtils.clamp(speed / 4.4, 0, 1.6);
    if (s.grounded && moving) {
      this.phase += dt * (3.4 + stride * 5.4);
    } else {
      this.phase += dt * 1.1;
    }
    const swing = Math.sin(this.phase) * Math.min(0.85, 0.22 + stride * 0.5);
    const swing2 = Math.sin(this.phase + Math.PI) * Math.min(0.85, 0.22 + stride * 0.5);

    // --- poses ------------------------------------------------------------
    let legLA = swing;
    let legRA = swing2;
    let armLA = swing2 * 0.8;
    let armRA = swing * 0.8;
    let armLZ = 0.12;
    let armRZ = -0.12;
    let bodyPitch = 0;
    let bodyRoll = 0;
    let bodyY = 0;

    if (s.swimming) {
      legLA = -0.5; legRA = -0.5;
      armLA = -1.5 + Math.sin(this.phase * 1.6) * 1.1;
      armRA = -1.5 + Math.sin(this.phase * 1.6 + Math.PI) * 1.1;
      armLZ = 0.55; armRZ = -0.55;
      bodyPitch = -1.15;
      bodyY = 0.1;
    } else if (s.grabbing || s.climbing) {
      legLA = -0.75; legRA = -0.25;
      armLA = -2.0; armRA = -2.0;
      armLZ = 0.35; armRZ = -0.35;
      bodyPitch = -0.18;
    } else if (!s.grounded) {
      const fall = THREE.MathUtils.clamp(-s.verticalSpeed / 9, -0.6, 0.6);
      legLA = 0.55 + fall * 0.5; legRA = 0.2 - fall * 0.3;
      armLA = -0.9 - fall; armRA = -0.5 - fall * 0.6;
      armLZ = 0.5; armRZ = -0.4;
      bodyPitch = fall * 0.22;
    } else {
      bodyPitch = stride * 0.16;
      bodyRoll = Math.sin(this.phase) * stride * 0.06;
    }

    // Smooth the limb angles.
    const k = 1 - Math.exp(-16 * dt);
    this.legL.rotation.x += (legLA - this.legL.rotation.x) * k;
    this.legR.rotation.x += (legRA - this.legR.rotation.x) * k;
    this.armL.rotation.x += (armLA - this.armL.rotation.x) * k;
    this.armR.rotation.x += (armRA - this.armR.rotation.x) * k;
    this.armL.rotation.z += (armLZ - this.armL.rotation.z) * k;
    this.armR.rotation.z += (armRZ - this.armR.rotation.z) * k;

    // --- body lean from local acceleration ---------------------------------
    const targetLeanX = THREE.MathUtils.clamp(s.localVelocity.x * 0.035, -0.25, 0.25);
    const targetLeanZ = THREE.MathUtils.clamp(-s.localVelocity.z * 0.035, -0.25, 0.25);
    this.lean.x += (targetLeanX - this.lean.x) * (1 - Math.exp(-9 * dt));
    this.lean.y += (targetLeanZ - this.lean.y) * (1 - Math.exp(-9 * dt));

    // --- landing squash ----------------------------------------------------
    const targetSquash = s.grounded ? 1 : 1.06;
    this.squash += (targetSquash - this.squash) * (1 - Math.exp(-12 * dt));

    this.body.rotation.x = bodyPitch + this.lean.y;
    this.body.rotation.z = bodyRoll + this.lean.x;
    this.body.position.y = -0.87 + bodyY;
    this.body.scale.set(1 / Math.sqrt(this.squash), this.squash, 1 / Math.sqrt(this.squash));

    // Head looks slightly towards where the player is going.
    this.head.rotation.y = Math.sin(this.phase * 0.5) * 0.18;
    this.head.rotation.x = THREE.MathUtils.clamp(-bodyPitch * 0.6, -0.5, 0.5);

    // The scarf trails behind.
    this.scarf.rotation.z = Math.sin(this.phase * 0.9) * 0.12 + this.lean.x * 0.6;
  }
}
