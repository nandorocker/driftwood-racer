/**
 * Driftwood Racer - entry point.
 *
 * Wires the systems together: WaterFlowSystem, FloatingBody / LogActor,
 * PlayerController (+ Grab and Paddle), CameraController, RiverLevel and the
 * debug tools, then runs a fixed-timestep simulation with an interpolated
 * renderer.
 */

import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

import { TUNE, loadTuningFromStorage, saveTuningToStorage } from './core/config';
import { Input } from './core/input';
import { buildRiverLevel, RIVER, RiverLevelData } from './world/riverLevel';
import { Terrain } from './world/terrainMesh';
import { LogActor, flatQuaternion } from './world/logActor';
import { PlayerController } from './player/playerController';
import { PlayerModel } from './player/playerModel';
import { CameraController } from './camera/cameraController';
import {
  createWaterMaterial, createCurtainMaterial, buildChannelRibbon,
  buildFallCurtain, WaterUniforms,
} from './fx/waterMaterial';
import { createSky } from './fx/skyDome';
import { buildScenery } from './fx/scenery';
import { DebugVisuals } from './fx/debugVisuals';
import { DebugPanel } from './ui/debugPanel';
import { Hud } from './ui/hud';
import { Sound } from './audio/sound';

const FIXED_DT = 1 / 60;
const MAX_STEPS = 5;

const SUN_DIR = new THREE.Vector3(-0.34, 0.86, 0.38).normalize();

class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly cam: CameraController;
  private readonly input: Input;
  private readonly hud = new Hud();
  private readonly sound = new Sound();
  private readonly debug: DebugPanel;

  private readonly world: RAPIER.World;
  private readonly level: RiverLevelData;
  private readonly terrain: Terrain;
  private readonly logs: LogActor[] = [];
  private readonly grabbables = new Set<number>();
  private readonly player: PlayerController;
  private readonly playerModel = new PlayerModel();
  private readonly debugVisuals: DebugVisuals;

  private readonly waterUniforms: WaterUniforms;
  private readonly sun: THREE.DirectionalLight;

  /** Scripted input used by the automated physics tests. */
  simInput: { x: number; y: number; jump: boolean; grab: boolean; paddle: boolean } | null = null;

  private accumulator = 0;
  private lastTime = performance.now();
  private fps = 60;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private finished = false;
  private elapsed = 0;

  private readonly wish = new THREE.Vector3();
  private readonly facing = new THREE.Vector3();
  private readonly tmpVec = new THREE.Vector3();
  private lastSubmersion = 0;

  constructor(container: HTMLElement) {
    // ------------------------------------------------------------ renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(
      TUNE.camera.fov,
      window.innerWidth / window.innerHeight,
      0.1,
      1200,
    );
    this.camera.position.set(0, 6, -10);
    this.cam = new CameraController(this.camera);

    this.scene.fog = new THREE.FogExp2(0xb9d0d8, 0.0052);

    // ------------------------------------------------------------- physics
    this.world = new RAPIER.World({ x: 0, y: -TUNE.world.gravity, z: 0 });
    this.world.timestep = FIXED_DT;
    // A few extra solver iterations keeps the logs calm in the rapids.
    this.world.numSolverIterations = 6;

    this.level = buildRiverLevel();

    // ------------------------------------------------------------ terrain
    const carve = this.level.channels.filter((c) => c.carveTerrain);
    const basin = this.level.channels.find((c) => !c.carveTerrain) ?? null;
    this.terrain = new Terrain(carve, basin);

    const terrainMesh = new THREE.Mesh(
      this.terrain.geometry,
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 }),
    );
    terrainMesh.receiveShadow = true;
    terrainMesh.castShadow = true;
    this.scene.add(terrainMesh);

    const terrainBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(this.terrain.vertices, this.terrain.indices),
      terrainBody,
    );

    // ---------------------------------------------------------------- sky
    const sky = createSky(SUN_DIR);
    this.scene.add(sky.mesh);

    // -------------------------------------------------------------- lights
    this.sun = new THREE.DirectionalLight(0xfff0d4, 2.5);
    this.sun.position.copy(SUN_DIR).multiplyScalar(90);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 220;
    this.sun.shadow.camera.left = -55;
    this.sun.shadow.camera.right = 55;
    this.sun.shadow.camera.top = 55;
    this.sun.shadow.camera.bottom = -55;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.035;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(new THREE.HemisphereLight(0xcfe9f2, 0x4a5a44, 1.75));

    const rim = new THREE.DirectionalLight(0x8fc0e0, 0.85);
    rim.position.set(0.75, 0.35, -0.55).multiplyScalar(60);
    this.scene.add(rim);

    // --------------------------------------------------------------- water
    this.waterUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: SUN_DIR.clone() },
      uSunColor: { value: new THREE.Color(0xfff1cf) },
      uDeep: { value: new THREE.Color(0x0e3542) },
      uShallow: { value: new THREE.Color(0x3f8a7c) },
      uFoam: { value: new THREE.Color(0xeaf7f2) },
      uSky: { value: new THREE.Color(0x9dc6d6) },
    };
    const waterMat = createWaterMaterial(this.waterUniforms);
    for (const ch of this.level.channels) {
      const geo = buildChannelRibbon(ch, 8);
      const mesh = new THREE.Mesh(geo, waterMat);
      mesh.renderOrder = 5;
      this.scene.add(mesh);
    }
    if (this.level.water.waterfall) {
      const fallGeo = buildFallCurtain(this.level.water.waterfall, 30, 12);
      const fallMat = createCurtainMaterial(this.waterUniforms);
      const fallMesh = new THREE.Mesh(fallGeo, fallMat);
      fallMesh.renderOrder = 6;
      this.scene.add(fallMesh);
    }

    // ------------------------------------------------------------- scenery
    const scenery = buildScenery(
      this.world,
      this.level.trees,
      this.level.rocks,
      (x, z) => this.terrain.heightAt(x, z),
    );
    this.scene.add(scenery.treeMesh);
    this.scene.add(scenery.rockMesh);

    // ---------------------------------------------------------------- logs
    for (const spawn of this.level.logs) {
      const log = new LogActor(this.world, spawn);
      this.logs.push(log);
      this.grabbables.add(log.collider.handle);
      this.scene.add(log.mesh);
    }

    // -------------------------------------------------------------- player
    const startLog = this.logs[0];
    const startPos = new THREE.Vector3(
      startLog.body.translation().x,
      startLog.body.translation().y + 1.45,
      startLog.body.translation().z,
    );
    this.player = new PlayerController(this.world, this.level.water, this.grabbables, startPos);
    this.scene.add(this.playerModel.root);

    // --------------------------------------------------------------- input
    this.input = new Input(this.renderer.domElement);
    this.input.onLockChange = (locked) => {
      this.hud.setPromptVisible(!locked);
      if (locked) this.sound.resume();
    };
    this.renderer.domElement.addEventListener('click', () => {
      if (!this.input.locked) {
        this.input.requestLock();
        this.sound.start();
      }
    });
    document.getElementById('click-to-play')?.addEventListener('click', () => {
      this.input.requestLock();
      this.sound.start();
    });

    // --------------------------------------------------------------- tools
    this.debugVisuals = new DebugVisuals(this.level.water, this.logs);
    this.scene.add(this.debugVisuals.flowArrows);
    this.scene.add(this.debugVisuals.buoyancyPoints);
    this.scene.add(this.debugVisuals.colliderLines);

    this.debug = new DebugPanel(document.getElementById('debug')!, {
      onReset: () => this.resetLogs(),
      onRespawn: () => this.respawn(),
      onTeleportLogs: () => this.teleportLogsDownstream(),
    });
    this.debug.on('flow', (v) => this.debugVisuals.setFlowVisible(v));
    this.debug.on('buoyancy', (v) => this.debugVisuals.setBuoyancyVisible(v));
    this.debug.on('colliders', (v) => this.debugVisuals.setCollidersVisible(v));
    this.debug.on('freecam', (v) => {
      if (v) this.cam.toggleFree(this.player.position);
      else this.cam.toggleFree(this.player.position);
    });

    window.addEventListener('resize', () => this.onResize());
    this.onResize();

    this.hud.setPromptVisible(true);
    this.hud.showTitle(true);
    setTimeout(() => this.hud.showTitle(false), 3200);
  }

  // ------------------------------------------------------------------ loop

  start(): void {
    this.lastTime = performance.now();
    requestAnimationFrame(() => this.loop());
  }

  private loop(): void {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.25) dt = 0.25;

    this.fpsAccum += dt;
    this.fpsFrames++;
    if (this.fpsAccum > 0.5) {
      this.fps = this.fpsFrames / this.fpsAccum;
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    this.handleHotkeys();

    // ------------------------------------------------------------- physics
    this.accumulator += dt * TUNE.world.timeScale;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < MAX_STEPS) {
      this.fixedUpdate(FIXED_DT);
      this.accumulator -= FIXED_DT;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    // -------------------------------------------------------------- render
    const alpha = THREE.MathUtils.clamp(this.accumulator / FIXED_DT, 0, 1);
    this.render(alpha, dt);

    this.input.endFrame();
  }

  private fixedUpdate(dt: number): void {
    this.elapsed += dt;
    this.level.water.update(dt);

    // --- movement intent, relative to the camera -------------------------
    this.facing.copy(this.cam.forward);
    let mx = this.input.moveX;
    let my = this.input.moveY;
    if (this.simInput) {
      mx = this.simInput.x;
      my = this.simInput.y;
    }
    this.wish.set(0, 0, 0);
    if (mx !== 0 || my !== 0) {
      const right = this.cam.right;
      this.wish
        .copy(this.facing).multiplyScalar(my)
        .addScaledVector(right, mx);
      if (this.wish.lengthSq() > 1) this.wish.normalize();
    }

    // --- the character ----------------------------------------------------
    const beforeGrounded = this.player.grounded;
    this.player.fixedUpdate(dt, this.input, this.wish, this.input.sprint, this.facing);

    // --- floating bodies --------------------------------------------------
    for (const log of this.logs) {
      log.floating.applyForces(this.level.water, TUNE.world.gravity, dt);
    }

    // --- advance the world -------------------------------------------------
    this.world.step();

    this.player.postStep(dt);
    this.player.syncFromBody();
    for (const log of this.logs) log.syncFromBody();

    // --- feedback ---------------------------------------------------------
    const snap = this.player.snapshot();
    if (!beforeGrounded && snap.grounded) this.sound.land(0.8);
    if (beforeGrounded && !snap.grounded && snap.velocity.y > 1) this.sound.jump();
    if (snap.submersion > 0.15 && this.lastSubmersion <= 0.15) this.sound.splash(Math.min(1, snap.velocity.length() / 8));
    if (snap.state === 'grabbing' && !this.player.grab.active) this.sound.grab();
    this.lastSubmersion = snap.submersion;

    // --- finish line ------------------------------------------------------
    if (!this.finished && snap.position.z > RIVER.finishZ) {
      this.finished = true;
      this.hud.showFinish(true);
      this.hud.toast('you made it to the end of the river', 4);
    }
  }

  private render(alpha: number, dt: number): void {
    // --- interpolate the visuals ------------------------------------------
    for (const log of this.logs) log.transform.applyTo(log.mesh, alpha);
    this.player.transform.applyTo(this.playerModel.root, alpha);

    const playerPos = this.playerModel.root.position;
    this.tmpVec.copy(playerPos);
    this.tmpVec.y += 0.2;

    // --- the character model ----------------------------------------------
    const snap = this.player.snapshot();
    const localVel = this.tmpVec.copy(this.player.velocity);
    if (this.player.groundBody) {
      localVel.sub(this.player.platformVel);
    }
    this.playerModel.update(dt, {
      speed: Math.hypot(localVel.x, localVel.z),
      grounded: this.player.grounded,
      swimming: this.player.swimming,
      grabbing: this.player.grab.active,
      climbing: this.player.grab.climbing,
      localVelocity: localVel,
      worldVelocity: this.player.velocity,
      facingYaw: this.cam.yaw,
      verticalSpeed: this.player.velocity.y,
    });

    // --- the camera --------------------------------------------------------
    this.cam.exclude = this.player.groundBody;
    if (this.cam.free) {
      this.cam.updateFree(dt, this.input);
    } else {
      this.cam.update(dt, this.input, playerPos, this.world);
    }

    // --- the sun follows the player so the shadow map stays tight ---------
    this.sun.target.position.copy(playerPos);
    this.sun.position.copy(playerPos).addScaledVector(SUN_DIR, 90);
    this.sun.target.updateMatrixWorld();

    // --- water uniforms ----------------------------------------------------
    this.waterUniforms.uTime.value = this.elapsed;

    // --- debug visualisations ----------------------------------------------
    this.debugVisuals.update(dt, playerPos, this.world);

    // --- ambience -----------------------------------------------------------
    const near = this.level.water.sampleWater(playerPos.x, playerPos.y + 0.4, playerPos.z);
    const flow = near.present ? THREE.MathUtils.clamp(near.flowSpeed / 6, 0, 1) : 0;
    const fallDist = Math.abs(playerPos.z - RIVER.lipZ);
    const fall = THREE.MathUtils.clamp(1 - fallDist / 55, 0, 1);
    this.sound.setAmbience(flow, fall * fall);

    // --- HUD ----------------------------------------------------------------
    this.hud.update(dt, {
      state: snap.state,
      speed: this.player.velocity.length(),
      logDrift: this.player.groundBody
        ? `${this.player.platformVel.length().toFixed(1)} m/s`
        : '—',
      altitude: playerPos.y,
      distance: playerPos.z - RIVER.lipZ + 140,
      fps: this.fps,
    });

    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Advance the simulation without rendering.
   * Used by the automated tests so the physics can be validated without
   * waiting on the renderer.
   */
  simulate(steps: number, dt = FIXED_DT): void {
    for (let i = 0; i < steps; i++) this.fixedUpdate(dt);
  }

  // ------------------------------------------------------------- utilities

  private handleHotkeys(): void {
    if (this.input.pressed('Tab')) this.debug.toggle();
    if (this.input.pressed('KeyR')) this.respawn();
    if (this.input.pressed('F1')) this.debugVisuals.setFlowVisible(!this.debugVisuals.flowArrows.visible);
    if (this.input.pressed('F2')) this.debugVisuals.setBuoyancyVisible(!this.debugVisuals.buoyancyPoints.visible);
    if (this.input.pressed('F3')) this.debugVisuals.setCollidersVisible(!this.debugVisuals.colliderLines.visible);
    if (this.input.pressed('F4')) {
      this.cam.toggleFree(this.player.position);
    }
    if (this.input.pressed('KeyH')) {
      const el = document.getElementById('hud-help');
      el?.classList.toggle('hidden');
    }
  }

  private respawn(): void {
    const log = this.logs[0];
    const t = log.body.translation();
    const p = new THREE.Vector3(t.x, t.y + 1.45, t.z);
    this.player.teleport(p);
    this.cam.snapTo(p);
    this.finished = false;
    this.hud.showFinish(false);
    this.hud.toast('back to the start');
  }

  /** Put every log back on its spawn marker and the player back on log 0. */
  resetLevel(): void {
    this.resetLogs();
    const log = this.logs[0];
    const t = log.body.translation();
    const p = new THREE.Vector3(t.x, t.y + 1.6, t.z);
    this.player.teleport(p);
    this.cam.snapTo(p);
  }

  private resetLogs(): void {
    for (let i = 0; i < this.logs.length; i++) {
      const spawn = this.level.logs[i];
      const log = this.logs[i];
      log.body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
      log.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      log.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      log.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
    this.hud.toast('logs reset');
  }

  private teleportLogsDownstream(): void {
    for (const log of this.logs) {
      const t = log.body.translation();
      log.body.setTranslation({ x: t.x, y: t.y, z: t.z + 30 }, true);
    }
    this.hud.toast('logs shifted 30 m downstream');
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }
}

async function boot(): Promise<void> {
  loadTuningFromStorage();
  await RAPIER.init();
  const container = document.getElementById('app')!;
  const game = new Game(container);
  game.start();

  // Persist tuning whenever the panel closes.
  window.addEventListener('beforeunload', () => saveTuningToStorage());

  // Expose a handle for automated testing.
  (window as any).__driftwood = game;
  (window as any).__THREE = THREE;
  (window as any).__TUNE = TUNE;
  (window as any).__input = (game as unknown as { input: Input }).input;
  (window as any).__flatQuaternion = flatQuaternion;
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('click-to-play');
  if (el) {
    el.innerHTML = `<div class="big">Failed to start</div><div class="sub">${String(err)}</div>`;
  }
});
