/**
 * Debug visualisations for the physics sandbox.
 *
 *  - flow arrows: where the current is pushing, sampled on a grid
 *  - buoyancy points: the sample cloud every floating body is integrated over
 *  - colliders: Rapier's own wireframe debug render
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { WaterFlowSystem } from '../world/waterFlowSystem';
import { LogActor } from '../world/logActor';

export class DebugVisuals {
  readonly flowArrows: THREE.InstancedMesh;
  readonly buoyancyPoints: THREE.InstancedMesh;
  readonly colliderLines: THREE.LineSegments;

  private readonly dummy = new THREE.Object3D();
  private readonly q = new THREE.Quaternion();
  private readonly arrowDir = new THREE.Vector3();
  private flowTimer = 0;

  private readonly arrowGeo: THREE.BufferGeometry;
  private readonly pointGeo: THREE.BufferGeometry;

  constructor(private readonly water: WaterFlowSystem, private readonly logs: LogActor[]) {
    // --- flow arrows -------------------------------------------------------
    this.arrowGeo = new THREE.ConeGeometry(0.16, 0.6, 6);
    this.arrowGeo.rotateX(Math.PI / 2);   // point along +Z
    const arrowMat = new THREE.MeshBasicMaterial({ color: 0x63f0c8, transparent: true, opacity: 0.85 });
    this.flowArrows = new THREE.InstancedMesh(this.arrowGeo, arrowMat, 40 * 40);
    this.flowArrows.count = 0;
    this.flowArrows.frustumCulled = false;
    this.flowArrows.visible = false;

    // --- buoyancy points ---------------------------------------------------
    this.pointGeo = new THREE.SphereGeometry(0.09, 6, 5);
    const pointMat = new THREE.MeshBasicMaterial({ color: 0xffc861 });
    const maxPoints = logs.length * 40;
    this.buoyancyPoints = new THREE.InstancedMesh(this.pointGeo, pointMat, Math.max(1, maxPoints));
    this.buoyancyPoints.count = 0;
    this.buoyancyPoints.frustumCulled = false;
    this.buoyancyPoints.visible = false;

    // --- collider wireframe ------------------------------------------------
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3), 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false, transparent: true, opacity: 0.9 });
    this.colliderLines = new THREE.LineSegments(geo, mat);
    this.colliderLines.frustumCulled = false;
    this.colliderLines.visible = false;
    this.colliderLines.renderOrder = 999;
  }

  setFlowVisible(v: boolean): void {
    this.flowArrows.visible = v;
  }

  setBuoyancyVisible(v: boolean): void {
    this.buoyancyPoints.visible = v;
  }

  setCollidersVisible(v: boolean): void {
    this.colliderLines.visible = v;
  }

  update(dt: number, focus: THREE.Vector3, world: RAPIER.World): void {
    if (this.flowArrows.visible) {
      this.flowTimer -= dt;
      if (this.flowTimer <= 0) {
        this.flowTimer = 0.2;
        this.rebuildFlow(focus);
      }
    }
    if (this.buoyancyPoints.visible) this.rebuildBuoyancy();
    if (this.colliderLines.visible) this.rebuildColliders(world);
  }

  private rebuildFlow(focus: THREE.Vector3): void {
    const spacing = 4.0;
    const span = 30;                     // grid is span x span cells
    const n = Math.floor(span / spacing);
    let count = 0;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = focus.x + (i - n / 2) * spacing;
        const z = focus.z + (j - n / 2) * spacing;
        const s = this.water.sampleWater(x, 0.05, z);
        if (!s.present || s.flowSpeed < 0.05) continue;

        this.arrowDir.set(s.vx, 0, s.vz);
        const len = Math.min(3.2, s.flowSpeed * 0.55);
        if (this.arrowDir.lengthSq() < 1e-6) continue;
        this.arrowDir.normalize();
        this.q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this.arrowDir);

        this.dummy.position.set(x, s.surfaceY + 0.18, z);
        this.dummy.quaternion.copy(this.q);
        this.dummy.scale.set(1, 1, Math.max(0.35, len));
        this.dummy.updateMatrix();
        this.flowArrows.setMatrixAt(count, this.dummy.matrix);
        count++;
      }
    }
    this.flowArrows.count = count;
    this.flowArrows.instanceMatrix.needsUpdate = true;
  }

  private rebuildBuoyancy(): void {
    let count = 0;
    for (const log of this.logs) {
      for (const p of log.floating.worldSamples) {
        this.dummy.position.copy(p);
        this.dummy.quaternion.identity();
        this.dummy.scale.setScalar(1);
        this.dummy.updateMatrix();
        this.buoyancyPoints.setMatrixAt(count, this.dummy.matrix);
        count++;
        if (count >= this.buoyancyPoints.instanceMatrix.count) break;
      }
    }
    this.buoyancyPoints.count = count;
    this.buoyancyPoints.instanceMatrix.needsUpdate = true;
  }

  private rebuildColliders(world: RAPIER.World): void {
    const buffers = world.debugRender();
    const geo = this.colliderLines.geometry;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const col = geo.getAttribute('color') as THREE.BufferAttribute;
    const vCount = buffers.vertices.length / 3;
    if (pos.count !== vCount) {
      geo.setAttribute('position', new THREE.BufferAttribute(buffers.vertices.slice(), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(buffers.colors.slice(), 4));
    } else {
      (pos.array as Float32Array).set(buffers.vertices);
      (col.array as Float32Array).set(buffers.colors);
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
    geo.computeBoundingSphere();
  }
}
