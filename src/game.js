/**
 * game.js
 * --------
 * Ties the systems together: scene/renderer, arena, player, Angels, lighting,
 * audio, HUD, difficulty scaling, and win/lose handling. The pure logic lives
 * in visibility.js / difficulty.js / gameRules.js; this file is the glue and
 * the only place that touches the renderer + DOM.
 */
import * as THREE from 'three';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Lighting } from './lighting.js';
import { AudioManager } from './audioManager.js';
import { isEnemySeen } from './visibility.js';
import { activeEnemies, speedMultiplier, stepInterval } from './difficulty.js';
import {
  evaluateGameState,
  SURVIVE_SECONDS,
  LOSE_RADIUS,
} from './gameRules.js';

const ARENA_HALF = 24;

export class Game {
  constructor(appEl) {
    this.app = appEl;
    this.state = 'start'; // start | playing | paused | won | lost
    this.elapsed = 0;
    this.clock = new THREE.Clock(false);

    this.enemies = [];
    this.obstacleBoxes = []; // AABBs for the visibility occlusion test
    this._enemyPoint = { x: 0, y: 0, z: 0 }; // scratch for sight point
    this._exitFlat = { x: 0, z: 0 };
    this._playerFlat = { x: 0, z: 0 };
    this._enemyFlats = []; // reused array of {x,z}

    this._initRenderer();
    this._initScene();
    this._initPlayerAndSystems();
    this._initDOM();
    this._bindGlobalEvents();

    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  // ---- setup ----

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false; // keep it cheap for 60fps
    this.app.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x10141f);
    // Light fog for depth/atmosphere, but thin enough to see across the arena.
    this.scene.fog = new THREE.FogExp2(0x10141f, 0.012);

    this.camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );

    // Floor.
    const floorGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x3a4152,
      roughness: 1,
      metalness: 0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Outer walls (visual boundary).
    this._addBoundaryWalls();

    // Box obstacles — these also occlude the line of sight.
    this._addObstacles();

    // Exit beacon (the win point).
    this._addExit();
  }

  _addBoundaryWalls() {
    const h = 4;
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a3040, roughness: 1 });
    const mk = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, h / 2, z);
      this.scene.add(m);
    };
    const s = ARENA_HALF;
    mk(s * 2, 0.5, 0, -s);
    mk(s * 2, 0.5, 0, s);
    mk(0.5, s * 2, -s, 0);
    mk(0.5, s * 2, s, 0);
  }

  _addObstacles() {
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4a5266,
      roughness: 0.95,
    });
    // [centerX, centerZ, sizeX, sizeZ, height]
    const defs = [
      [-8, -6, 4, 4, 3],
      [7, -10, 5, 3, 3.5],
      [10, 6, 3, 6, 3],
      [-10, 9, 4, 3, 3],
      [0, 2, 3, 3, 2.5],
      [-3, 14, 5, 2, 3],
    ];
    for (const [cx, cz, sx, sz, hy] of defs) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, hy, sz), mat);
      mesh.position.set(cx, hy / 2, cz);
      this.scene.add(mesh);
      // Matching AABB for occlusion (full height range).
      this.obstacleBoxes.push({
        min: { x: cx - sx / 2, y: 0, z: cz - sz / 2 },
        max: { x: cx + sx / 2, y: hy, z: cz + sz / 2 },
      });
    }
  }

  _addExit() {
    this.exitPos = new THREE.Vector3(ARENA_HALF - 3, 0, ARENA_HALF - 3);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x10301a,
      emissive: 0x33ff88,
      emissiveIntensity: 1.4,
    });
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 4, 16), mat);
    pillar.position.set(this.exitPos.x, 2, this.exitPos.z);
    this.scene.add(pillar);
    this.exitBeacon = pillar;

    // A soft green light to make it a visible goal.
    const glow = new THREE.PointLight(0x33ff88, 1.2, 14, 2);
    glow.position.set(this.exitPos.x, 2.5, this.exitPos.z);
    this.scene.add(glow);
    this.exitGlow = glow;
  }

  _initPlayerAndSystems() {
    this.player = new Player(this.camera, this.renderer.domElement, {
      bounds: ARENA_HALF - 1,
    });
    this.lighting = new Lighting(this.scene);
    this.audio = new AudioManager();

    this.player.onLockChange((locked) => {
      if (this.state === 'playing' && !locked) this._pause();
      else if (this.state === 'paused' && locked) this._resume();
    });
  }

  _initDOM() {
    this.dom = {
      crosshair: document.getElementById('crosshair'),
      hud: document.getElementById('hud'),
      time: document.getElementById('hud-time'),
      angels: document.getElementById('hud-angels'),
      nearest: document.getElementById('hud-nearest'),
      warning: document.getElementById('hud-warning'),
      start: document.getElementById('overlay-start'),
      pause: document.getElementById('overlay-pause'),
      lose: document.getElementById('overlay-lose'),
      win: document.getElementById('overlay-win'),
      loseDetail: document.getElementById('lose-detail'),
      winDetail: document.getElementById('win-detail'),
    };
  }

  _bindGlobalEvents() {
    window.addEventListener('resize', () => this._onResize());

    // A single click handler drives start / resume / restart.
    this.app.addEventListener('click', () => {
      this.audio.init();
      if (this.state === 'start') this._start();
      else if (this.state === 'paused') this.player.requestLock();
      else if (this.state === 'won' || this.state === 'lost') this._restart();
    });
  }

  // ---- state transitions ----

  _start() {
    this.state = 'playing';
    this.elapsed = 0;
    this.clock.start();

    this._show(this.dom.start, false);
    this._show(this.dom.hud, true);
    this._show(this.dom.crosshair, true);

    this.lighting.setMood('neutral');
    this.audio.startDrone();

    // Reset player to the corner opposite the exit.
    this.player.setPosition(-(ARENA_HALF - 3), -(ARENA_HALF - 3));
    this.player.setRotation(Math.PI * 0.75, 0);

    this._clearEnemies();
    this._spawnEnemy(); // start with one (activeEnemies(0) === 1)

    this.player.requestLock();
  }

  _restart() {
    this._show(this.dom.win, false);
    this._show(this.dom.lose, false);
    this._start();
  }

  _pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.clock.stop();
    this.audio.suspend();
    this._show(this.dom.pause, true);
  }

  _resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.clock.start();
    this.audio.resume();
    this._show(this.dom.pause, false);
  }

  _gameOver(reason) {
    this.state = 'lost';
    this.clock.stop();
    this.lighting.setMood('lose');
    this.audio.stopDrone();
    this.audio.loseStinger();
    this.dom.loseDetail.textContent =
      reason === 'caught' ? 'An Angel reached you. You never saw it move.' : 'You lost.';
    this._show(this.dom.lose, true);
    document.exitPointerLock?.();
  }

  _victory(reason) {
    this.state = 'won';
    this.clock.stop();
    this.lighting.setMood('win');
    this.audio.stopDrone();
    this.audio.winStinger();
    this.dom.winDetail.textContent =
      reason === 'exit'
        ? 'You reached the beacon. The Angels freeze, mid-reach, forever.'
        : `You survived ${SURVIVE_SECONDS} seconds. The Angels never caught you.`;
    this._show(this.dom.win, true);
    document.exitPointerLock?.();
  }

  // ---- enemies ----

  _spawnEnemy() {
    // Spawn on the perimeter, far from the player, away from the exit.
    const p = this.player.position;
    let best = null;
    let bestDist = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = Math.cos(a) * (ARENA_HALF - 2);
      const z = Math.sin(a) * (ARENA_HALF - 2);
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > bestDist) {
        bestDist = d;
        best = { x, z };
      }
    }
    const enemy = new Enemy(this.scene, {
      position: new THREE.Vector3(best.x, 0, best.z),
      stepDistance: 1.0 + Math.random() * 0.3,
    });
    this.enemies.push(enemy);
  }

  _clearEnemies() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
  }

  // ---- main loop ----

  _animate() {
    const dt = Math.min(this.clock.getDelta(), 0.05); // clamp huge frame gaps

    if (this.state === 'playing') {
      this.elapsed += dt;
      this._updatePlaying(dt);
    }

    // Lighting flickers even on overlays for atmosphere.
    this.lighting.update(dt, this.player.position);

    // Gentle beacon pulse.
    if (this.exitGlow) {
      this.exitGlow.intensity = 1.0 + 0.4 * Math.sin(performance.now() * 0.004);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _updatePlaying(dt) {
    // Difficulty: scale enemy count & speed by elapsed time.
    const desired = activeEnemies(this.elapsed);
    while (this.enemies.length < desired) this._spawnEnemy();

    const speedMult = speedMultiplier(this.elapsed);
    const interval = stepInterval(this.elapsed);

    this.player.update(dt, (x, z) => this._collide(x, z));

    const camState = this.player.getCameraState();
    const playerPos = this.player.position;

    let nearest = Infinity;

    // Ensure the reusable flats array is the right length.
    while (this._enemyFlats.length < this.enemies.length) {
      this._enemyFlats.push({ x: 0, z: 0 });
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      const sight = enemy.getSightPoint();

      // Each Angel's "seen" state is evaluated independently.
      const seen = isEnemySeen(camState, sight, this.obstacleBoxes, {
        fovDegrees: 80,
        maxDistance: 60,
        enemyRadius: enemy.radius,
      });

      const before = enemy.position.x; // (cheap change-detect not needed; use callback)
      enemy.update(dt, seen, playerPos, interval, speedMult, () => {
        // Movement stinger pitched by proximity.
        const d = enemy.distanceTo(playerPos);
        const prox = Math.max(0, Math.min(1, 1 - d / 18));
        this.audio.movementStinger(prox);
      });
      void before;

      const d = enemy.distanceTo(playerPos);
      if (d < nearest) nearest = d;

      const flat = this._enemyFlats[i];
      flat.x = enemy.position.x;
      flat.z = enemy.position.z;
    }

    // Win/lose evaluation via pure rules.
    this._playerFlat.x = playerPos.x;
    this._playerFlat.z = playerPos.z;
    this._exitFlat.x = this.exitPos.x;
    this._exitFlat.z = this.exitPos.z;
    const activeFlats = this._enemyFlats.slice(0, this.enemies.length);

    const result = evaluateGameState({
      playerPos: this._playerFlat,
      enemyPositions: activeFlats,
      exitPos: this._exitFlat,
      elapsed: this.elapsed,
    });

    this._updateHUD(nearest, desired);

    if (result.status === 'lost') this._gameOver(result.reason);
    else if (result.status === 'won') this._victory(result.reason);
  }

  /** Push the player out of obstacle AABBs (simple axis resolution). */
  _collide(x, z) {
    const r = 0.4;
    for (const box of this.obstacleBoxes) {
      if (
        x > box.min.x - r &&
        x < box.max.x + r &&
        z > box.min.z - r &&
        z < box.max.z + r
      ) {
        // Resolve along the smaller penetration axis.
        const px = x < (box.min.x + box.max.x) / 2 ? box.min.x - r : box.max.x + r;
        const pz = z < (box.min.z + box.max.z) / 2 ? box.min.z - r : box.max.z + r;
        if (Math.abs(x - px) < Math.abs(z - pz)) x = px;
        else z = pz;
      }
    }
    return { x, z };
  }

  _updateHUD(nearest, count) {
    const remaining = Math.max(0, Math.ceil(SURVIVE_SECONDS - this.elapsed));
    this.dom.time.textContent = remaining;
    this.dom.angels.textContent = count;
    this.dom.nearest.textContent =
      nearest === Infinity ? '—' : `${nearest.toFixed(1)}m`;

    if (nearest < LOSE_RADIUS * 2.2) {
      this.dom.warning.textContent = '⚠ AN ANGEL IS CLOSE — DO NOT LOOK AWAY';
    } else {
      this.dom.warning.textContent = '';
    }
  }

  // ---- misc ----

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  _show(el, visible) {
    if (!el) return;
    el.classList.toggle('hidden', !visible);
  }
}
