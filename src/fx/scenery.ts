/**
 * Scenery: conifers along the banks and the boulders that double as
 * obstacles. Both are instanced so the whole forest costs a handful of
 * draw calls.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { fbm2, signedNoise2 } from '../core/noise';
import { RockSpec, TreeSpec } from '../world/riverLevel';

export interface SceneryResult {
  treeMesh: THREE.InstancedMesh;
  rockMesh: THREE.InstancedMesh;
  rockBodies: RAPIER.RigidBody[];
}

function coniferGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];

  const trunk = new THREE.CylinderGeometry(0.13, 0.2, 1.5, 6);
  trunk.translate(0, 0.75, 0);
  parts.push(trunk);

  const tiers = 3;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1);
    const r = 1.25 * (1 - t * 0.62);
    const h = 2.1 * (1 - t * 0.3);
    const cone = new THREE.ConeGeometry(r, h, 8);
    cone.translate(0, 1.5 + i * 1.15 + h * 0.4, 0);
    parts.push(cone);
  }

  return mergeGeometries(parts);
}

/** Minimal geometry merge (avoids pulling in the addons build). */
function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let vertexCount = 0;
  let indexCount = 0;
  for (const g of list) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
  }
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);

  let vo = 0;
  let io = 0;
  for (const g of list) {
    const p = g.attributes.position.array as ArrayLike<number>;
    const n = g.attributes.normal.array as ArrayLike<number>;
    const count = g.attributes.position.count;
    for (let i = 0; i < count * 3; i++) {
      positions[vo * 3 + i] = p[i];
      normals[vo * 3 + i] = n[i];
    }
    if (g.index) {
      const idx = g.index.array as ArrayLike<number>;
      for (let i = 0; i < idx.length; i++) indices[io + i] = idx[i] + vo;
      io += idx.length;
    } else {
      for (let i = 0; i < count; i++) indices[io + i] = vo + i;
      io += count;
    }
    vo += count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  return out;
}

/** Irregular boulder geometry with flat shading. */
function boulderGeometry(seed: number): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm2(v.x * 1.6 + seed, v.z * 1.6 - v.y * 1.1, 3) - 0.5;
    const n2 = signedNoise2(v.x * 3.1 + seed * 0.3, v.y * 3.1);
    v.multiplyScalar(1 + n * 0.42 + n2 * 0.14);
    v.y *= 0.78;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildScenery(
  world: RAPIER.World,
  trees: TreeSpec[],
  rocks: RockSpec[],
  terrainHeightAt: (x: number, z: number) => number,
): SceneryResult {
  // ------------------------------------------------------------- trees
  const treeGeo = coniferGeometry();
  const treeMat = new THREE.MeshStandardMaterial({
    color: 0x35583a,
    roughness: 0.95,
    flatShading: true,
  });
  const treeMesh = new THREE.InstancedMesh(treeGeo, treeMat, trees.length);
  treeMesh.castShadow = true;
  treeMesh.receiveShadow = true;
  treeMesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < trees.length; i++) {
    const t = trees[i];
    const y = terrainHeightAt(t.x, t.z);
    // No trees in the river.
    if (y < 0.9) continue;
    dummy.position.set(t.x, y - 0.25, t.z);
    dummy.rotation.set(0, (t.seed % 360) * (Math.PI / 180), 0);
    dummy.scale.set(t.scale * 0.9, t.scale, t.scale * 0.9);
    dummy.updateMatrix();
    treeMesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  treeMesh.count = placed;
  treeMesh.instanceMatrix.needsUpdate = true;

  // ------------------------------------------------------------- rocks
  const rockGeo = boulderGeometry(7.3);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x7d7a72,
    roughness: 0.95,
    flatShading: true,
  });

  const rockBodies: RAPIER.RigidBody[] = [];

  for (const r of rocks) {
    const bedY = terrainHeightAt(r.x, r.z);
    const y = bedY + r.height * 0.35 - r.sink;

    // Physics: a ball is stable, cheap and rolls the way a boulder would.
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(r.x, y, r.z),
    );
    world.createCollider(
      RAPIER.ColliderDesc.ball(r.radius * 0.92)
        .setFriction(0.6)
        .setRestitution(0.22),
      body,
    );
    rockBodies.push(body);
  }

  const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, Math.max(1, rocks.length));
  rockMesh.castShadow = true;
  rockMesh.receiveShadow = true;
  const dummyR = new THREE.Object3D();
  for (let i = 0; i < rocks.length; i++) {
    const r = rocks[i];
    const bedY = terrainHeightAt(r.x, r.z);
    const y = bedY + r.height * 0.35 - r.sink;
    dummyR.position.set(r.x, y, r.z);
    dummyR.rotation.set(r.seed * 0.017, r.seed * 0.031, r.seed * 0.011);
    dummyR.scale.set(r.radius, r.height * 0.6, r.radius);
    dummyR.updateMatrix();
    rockMesh.setMatrixAt(i, dummyR.matrix);
  }
  rockMesh.count = rocks.length;
  rockMesh.instanceMatrix.needsUpdate = true;

  return { treeMesh, rockMesh, rockBodies };
}
