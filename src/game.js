/**
 * game.js
 * --------
 * Glue layer: scene/renderer, maze, player, Angels, decoys, collectibles +
 * beacon objective, lighting, audio, HUD, difficulty, forced blink, dread meter,
 * and win/lose. Pure logic lives in maze.js / placement.js / visibility.js /
 * difficulty.js / gameRules.js / dread.js; this is the only file touching the
 * renderer + DOM.
 */
import * as THREE from 'three';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Lighting } from './lighting.js';
import { AudioManager } from './audioManager.js';
import { isEnemySeen } from './visibility.js';
import { activeEnemies, stepInterval, angelStepDistance } from './difficulty.js';
import { computeDread } from './dread.js';
import { generateMaze } from './maze.js';
import { pickSpaced, pickFar, dist } from './placement.js';
import { isCaught, LOSE_RADIUS } from './gameRules.js';

// Maze + world.
const MAZE_COLS = 10;
const MAZE_ROWS = 10;
const CELL = 5;
const WALL_HEIGHT = 4.5;

// Objective tuning.
const NUM_OBJECTS = 5;
const PICKUP_RADIUS = 1.9;
const DELIVER_RADIUS = 3.6;
const DISCOVER_RADIUS = 9; // beacon auto-discovered within this range
const DISCOVER_SIGHT = 28; // ...or seen (clear LoS) within this range
const ANGEL_MIN_SPAWN_DIST = 26; // angels never spawn closer than this to player
const OBJECT_MIN_SPACING = 14;
const BEACON_MIN_DIST = 38;

// Forced-blink tuning.
const BLINK_MIN = 4;
const BLINK_MAX = 6;
const BLINK_DUR_MIN = 0.15;
const BLINK_DUR_MAX = 0.25;
const SILENCE_LEAD = 0.4;

export class Game {
  constructor(appEl) {
    this.app = appEl;
    this.state = 'start';
    this.elapsed = 0;
    this.clock = new THREE.Clock(false);

    this.enemies = [];
    this.decoys = [];
    this.objects = [];

    // Objective counters.
    this.heldCount = 0;
    this.objectsCollected = 0; // total ever collected (drives angel speed)
    this.placedCount = 0;

    // Reused scratch.
    this._playerFlat = { x: 0, z: 0 };
    this._enemyFlats = [];

    // Dread + blink + camera-feel state.
    this.dread = 0;
    this.blinkTimer = 0;
    this.blinkActive = false;
    this.blinkElapsed = 0;
    this.blinkDuration = 0;
    this._silenceCued = false;
    this._closeCued = false;
    this.falseCueTimer = 0;
    this._prevYaw = 0;
    this._bobT = 0;

    // Occluder closure for visibility (grid raycast — scales to the big maze).
    this._occluder = (o, p) => this.maze.segmentBlocked(o.x, o.z, p.x, p.z);

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
    this.renderer.shadowMap.enabled = false;
    this.app.appendChild(this.renderer.domElement);
  }

  _initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x080a12);
    this.scene.fog = new THREE.FogExp2(0x080a12, 0.022);

    this.camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.1,
      300
    );

    // Maze is generated once per page load (NOT per restart — see README note).
    this.maze = generateMaze(MAZE_COLS, MAZE_ROWS, Math.random, { cell: CELL });

    // Floor sized to the maze.
    const floorGeo = new THREE.PlaneGeometry(
      this.maze.worldHalfW * 2,
      this.maze.worldHalfH * 2
    );
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2a3040,
      roughness: 1,
      metalness: 0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this._buildMazeMeshes();
    this._initObjectives();
  }

  /** One InstancedMesh for every solid cell — a single draw call for all walls. */
  _buildMazeMeshes() {
    const { gw, gh, cell, solid } = this.maze;
    let count = 0;
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) if (solid[gy][gx]) count++;

    const geo = new THREE.BoxGeometry(cell, WALL_HEIGHT, cell);
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a4257, roughness: 0.95 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        if (!solid[gy][gx]) continue;
        m.makeTranslation(this.maze.centerX(gx), WALL_HEIGHT / 2, this.maze.centerZ(gy));
        inst.setMatrixAt(i++, m);
      }
    }
    inst.instanceMatrix.needsUpdate = true;
    this.scene.add(inst);
    this.wallMesh = inst;
  }

  /** Create the 5 collectibles and the beacon (positions set in _placeObjectives). */
  _initObjectives() {
    const objGeo = new THREE.IcosahedronGeometry(0.45, 0);
    for (let i = 0; i < NUM_OBJECTS; i++) {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0a2230,
        emissive: 0x33ddff,
        emissiveIntensity: 1.7,
        roughness: 0.4,
      });
      const mesh = new THREE.Mesh(objGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.objects.push({ pos: { x: 0, z: 0 }, mesh, collected: false });
    }

    this.beacon = { pos: { x: 0, z: 0 }, discovered: false, slots: [] };
    const group = new THREE.Group();

    this.beaconPillarMat = new THREE.MeshStandardMaterial({
      color: 0x10201a,
      emissive: 0x1b3a55,
      emissiveIntensity: 0.4,
      roughness: 0.6,
    });
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.7, 0.95, 4.5, 18),
      this.beaconPillarMat
    );
    pillar.position.y = 2.25;
    group.add(pillar);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.5, 0.12, 8, 32),
      new THREE.MeshStandardMaterial({ color: 0x081018, emissive: 0x2266aa })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.25;
    group.add(ring);
    this.beaconRing = ring;

    for (let i = 0; i < NUM_OBJECTS; i++) {
      const a = (i / NUM_OBJECTS) * Math.PI * 2;
      const sx = Math.cos(a) * 2.4;
      const sz = Math.sin(a) * 2.4;
      const ped = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.42, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: 0x141a26, roughness: 0.9 })
      );
      ped.position.set(sx, 0.25, sz);
      group.add(ped);

      const markMat = new THREE.MeshStandardMaterial({
        color: 0x223040,
        emissive: 0x000000,
        emissiveIntensity: 1.2,
        roughness: 0.4,
      });
      const mark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), markMat);
      mark.position.set(sx, 0.75, sz);
      mark.visible = false;
      group.add(mark);
      this.beacon.slots.push({ mark, markMat, filled: false });
    }

    const glow = new THREE.PointLight(0x33aaff, 0, 16, 2);
    glow.position.set(0, 2.6, 0);
    group.add(glow);
    this.beaconGlow = glow;

    this.scene.add(group);
    this.beaconGroup = group;
  }

  _placeObjectives() {
    const cells = this.maze.openCellsWorld;
    const player = { x: this.player.position.x, z: this.player.position.z };

    // Beacon: far from the player (still guaranteed reachable — maze is connected).
    this.beacon.pos = pickFar(Math.random, cells, player, BEACON_MIN_DIST);
    this.beaconGroup.position.set(this.beacon.pos.x, 0, this.beacon.pos.z);

    // Objects: spaced apart, away from the player and the beacon.
    const spots = pickSpaced(Math.random, cells, NUM_OBJECTS, {
      minSpacing: OBJECT_MIN_SPACING,
      avoid: [
        { x: player.x, z: player.z, dist: 10 },
        { x: this.beacon.pos.x, z: this.beacon.pos.z, dist: 10 },
      ],
    });
    this.objects.forEach((o, i) => {
      const s = spots[i] || cells[i % cells.length];
      o.pos = { x: s.x, z: s.z };
      o.collected = false;
      o.mesh.position.set(s.x, 1.0, s.z);
      o.mesh.visible = true;
    });

    // Reset objective state.
    this.beacon.discovered = false;
    this.beacon.slots.forEach((s) => {
      s.filled = false;
      s.mark.visible = false;
      s.markMat.emissive.setHex(0x000000);
    });
    this.beaconGlow.intensity = 0;
    this.beaconPillarMat.emissiveIntensity = 0.4;
    this.heldCount = 0;
    this.objectsCollected = 0;
    this.placedCount = 0;
  }

  _initPlayerAndSystems() {
    this.player = new Player(this.camera, this.renderer.domElement, {
      bounds: this.maze.worldHalfW - 0.5,
    });
    this.lighting = new Lighting(this.scene);
    this.audio = new AudioManager();

    this.player.onLockChange((locked) => {
      if (this.state === 'playing' && !locked) this._pause();
      else if (this.state === 'paused' && locked) this._resume();
    });
  }

  _initDOM() {
    const $ = (id) => document.getElementById(id);
    this.dom = {
      crosshair: $('crosshair'),
      hud: $('hud'),
      held: $('hud-held'),
      placed: $('hud-placed'),
      beacon: $('hud-beacon'),
      angels: $('hud-angels'),
      nearest: $('hud-nearest'),
      warning: $('hud-warning'),
      start: $('overlay-start'),
      pause: $('overlay-pause'),
      lose: $('overlay-lose'),
      win: $('overlay-win'),
      loseDetail: $('lose-detail'),
      winDetail: $('win-detail'),
      vignette: $('vignette'),
      dreadTint: $('dread-tint'),
      blink: $('blink'),
      toast: $('toast'),
    };
  }

  _bindGlobalEvents() {
    window.addEventListener('resize', () => this._onResize());
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
    this.dread = 0;
    this.blinkActive = false;
    this.blinkElapsed = 0;
    this.blinkTimer = this._randBlinkInterval();
    this._silenceCued = false;
    this._closeCued = false;
    this.falseCueTimer = 4 + Math.random() * 6;
    this.clock.start();

    this._show(this.dom.start, false);
    this._show(this.dom.hud, true);
    this._show(this.dom.crosshair, true);
    this.dom.blink.style.opacity = '0';

    this.lighting.setMood('neutral');
    this.audio.startAmbient();
    this.audio.startHeartbeat();
    this.audio.startMusic();

    // Randomized player spawn (valid open cell).
    const cells = this.maze.openCellsWorld;
    const spawn = cells[Math.floor(Math.random() * cells.length)];
    this.player.setPosition(spawn.x, spawn.z);
    this.player.setRotation(Math.random() * Math.PI * 2, 0);
    this._prevYaw = this.player.yaw;

    this._placeObjectives();

    this._clearEnemies();
    this._clearDecoys();
    this._spawnDecoys();
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
    this.audio.stopAmbient();
    this.audio.loseStinger();
    this.dom.blink.style.opacity = '0';
    this._clearScreenFilter();
    this.dom.loseDetail.textContent =
      reason === 'caught'
        ? 'An Angel reached you. You never saw it move.'
        : 'You lost.';
    this._show(this.dom.lose, true);
    document.exitPointerLock?.();
  }

  _victory() {
    this.state = 'won';
    this.clock.stop();
    this.lighting.setMood('win');
    this.audio.stopAmbient();
    this.audio.winStinger();
    this.dom.blink.style.opacity = '0';
    this._clearScreenFilter();
    this.dom.winDetail.textContent =
      'All five relics placed. The beacon roars to life and the Angels freeze forever. You escaped.';
    this._show(this.dom.win, true);
    document.exitPointerLock?.();
  }

  // ---- enemies & decoys ----

  _spawnEnemy() {
    const cells = this.maze.openCellsWorld;
    const p = this.player.position;
    const far = cells.filter(
      (c) => Math.hypot(c.x - p.x, c.z - p.z) >= ANGEL_MIN_SPAWN_DIST
    );
    const pool = far.length ? far : cells;
    const spot = pool[Math.floor(Math.random() * pool.length)];
    this.enemies.push(
      new Enemy(this.scene, { position: new THREE.Vector3(spot.x, 0, spot.z) })
    );
  }

  _spawnDecoys() {
    const cells = this.maze.openCellsWorld;
    const p = this.player.position;
    const pool = cells.filter((c) => Math.hypot(c.x - p.x, c.z - p.z) > 12);
    const spots = pickSpaced(Math.random, pool.length ? pool : cells, 4, {
      minSpacing: 12,
    });
    for (const s of spots) {
      this.decoys.push(
        new Enemy(this.scene, { decoy: true, position: new THREE.Vector3(s.x, 0, s.z) })
      );
    }
  }

  _clearEnemies() {
    for (const e of this.enemies) e.dispose();
    this.enemies.length = 0;
  }

  _clearDecoys() {
    for (const d of this.decoys) d.dispose();
    this.decoys.length = 0;
  }

  // ---- main loop ----

  _animate() {
    const dt = Math.min(this.clock.getDelta(), 0.05);

    if (this.state === 'playing') {
      this.elapsed += dt;
      this._updatePlaying(dt);
    }

    this.lighting.update(dt, this.camera, this.dread);
    this._animateObjectives();

    this.renderer.render(this.scene, this.camera);
  }

  /** Spin/bob collectibles & pulse the beacon so they read as objectives. */
  _animateObjectives() {
    const tm = performance.now() * 0.001;
    for (const o of this.objects) {
      if (!o.mesh.visible) continue;
      o.mesh.rotation.y = tm * 1.5;
      o.mesh.position.y = 1.0 + Math.sin(tm * 2 + o.pos.x) * 0.18;
    }
    if (this.beaconRing) this.beaconRing.rotation.z = tm * 0.6;
    if (this.beacon && this.beacon.discovered) {
      this.beaconGlow.intensity = 1.3 + 0.5 * Math.sin(tm * 3);
    }
    for (const s of this.beacon?.slots ?? []) {
      if (s.filled) s.mark.rotation.y = tm * 2;
    }
  }

  _updatePlaying(dt) {
    const desired = activeEnemies(this.elapsed);
    while (this.enemies.length < desired) this._spawnEnemy();

    const interval = stepInterval(this.elapsed);
    // Angel speed: time-based curve + baseline bump + per-object scaling.
    const stepDist = angelStepDistance(this.elapsed, this.objectsCollected);

    this.player.update(dt, (x, z) => this._collide(x, z));

    const camState = this.player.getCameraState();
    const playerPos = this.player.position;
    this.audio.updateListener(camState.position, camState.forward);

    this._updateBlink(dt, playerPos, stepDist);

    const onSnap = (enemy) => {
      const d = enemy.distanceTo(playerPos);
      const prox = Math.max(0, Math.min(1, 1 - d / 18));
      const p = enemy.position;
      this.audio.angelMovementSound(p.x, p.y + 1, p.z, prox);
      if (Math.random() < 0.3) this.lighting.pulseFlicker(0.7);
    };

    let nearest = Infinity;
    let nearestUnseen = Infinity;

    while (this._enemyFlats.length < this.enemies.length) {
      this._enemyFlats.push({ x: 0, z: 0 });
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      const seen = isEnemySeen(camState, enemy.getSightPoint(), null, {
        fovDegrees: 80,
        maxDistance: 60,
        enemyRadius: enemy.radius,
        occluder: this._occluder, // maze grid raycast
      });

      if (!this.blinkActive) {
        enemy.update(dt, seen, playerPos, interval, stepDist, onSnap);
      } else {
        enemy.seen = false;
      }

      const d = enemy.distanceTo(playerPos);
      if (d < nearest) nearest = d;
      if (!enemy.seen && d < nearestUnseen) nearestUnseen = d;

      const flat = this._enemyFlats[i];
      flat.x = enemy.position.x;
      flat.z = enemy.position.z;
    }

    // Objectives (pickups, discovery, delivery → win).
    this._updateObjectives(playerPos);
    if (this.state !== 'playing') return; // beacon win may have fired

    // Dread + atmosphere.
    this.dread = computeDread(this.dread, dt, nearestUnseen);
    this.audio.setDread(this.dread);
    this.audio.updateHeartbeat(nearestUnseen);
    this.audio.updateMusic();
    this._applyDreadVisuals();

    if (nearestUnseen < 4 && !this._closeCued) {
      this._closeCued = true;
      this.audio.preEventSilence(0.35);
    } else if (nearestUnseen > 6) {
      this._closeCued = false;
    }

    this.falseCueTimer -= dt;
    if (this.falseCueTimer <= 0) {
      this.falseCueTimer = 6 + Math.random() * 8;
      if (nearestUnseen > 8) this.audio.falseCue(playerPos);
    }

    this._applyCameraFeel(dt);

    // Lose check (proximity). Win is handled in _updateObjectives.
    this._playerFlat.x = playerPos.x;
    this._playerFlat.z = playerPos.z;
    const activeFlats = this._enemyFlats.slice(0, this.enemies.length);
    if (isCaught(this._playerFlat, activeFlats, LOSE_RADIUS)) {
      this._gameOver('caught');
      return;
    }

    this._updateHUD(nearest, desired);
  }

  _updateObjectives(playerPos) {
    // Pickups (carry-many: just increment, no limit).
    for (const o of this.objects) {
      if (o.collected) continue;
      if (dist(playerPos, o.pos) < PICKUP_RADIUS) {
        o.collected = true;
        o.mesh.visible = false;
        this.heldCount++;
        this.objectsCollected++; // permanently raises angel speed
        this.audio.pickupCue();
        this._toast(`Relic collected — held ${this.heldCount}`);
      }
    }

    const b = this.beacon.pos;
    const bd = dist(playerPos, b);

    // Discovery: by proximity, or by clear line of sight within range.
    if (!this.beacon.discovered) {
      const seen =
        bd < DISCOVER_SIGHT && !this.maze.segmentBlocked(playerPos.x, playerPos.z, b.x, b.z);
      if (bd < DISCOVER_RADIUS || seen) {
        this.beacon.discovered = true;
        this.beaconGlow.intensity = 1.4;
        this.beaconPillarMat.emissiveIntensity = 1.3;
        this.audio.discoverCue();
        this._toast('Beacon discovered!');
      }
    }

    // Delivery: drop ALL held into the next free slots (order/batch agnostic).
    if (bd < DELIVER_RADIUS && this.heldCount > 0) {
      while (this.heldCount > 0 && this.placedCount < NUM_OBJECTS) {
        const slot = this.beacon.slots[this.placedCount];
        slot.filled = true;
        slot.mark.visible = true;
        slot.markMat.emissive.setHex(0x33ddff);
        this.audio.placeCue(this.placedCount);
        this.placedCount++;
        this.heldCount--;
      }
      this._toast(`Placed ${this.placedCount}/${NUM_OBJECTS}`);
      if (this.placedCount >= NUM_OBJECTS) {
        this.audio.beaconActivateCue();
        this._victory();
      }
    }
  }

  _randBlinkInterval() {
    return BLINK_MIN + Math.random() * (BLINK_MAX - BLINK_MIN);
  }

  _updateBlink(dt, playerPos, stepDist) {
    if (this.blinkActive) {
      this.blinkElapsed += dt;
      if (this.blinkElapsed >= this.blinkDuration) {
        this.blinkActive = false;
        this.dom.blink.style.opacity = '0';
        this.blinkTimer = this._randBlinkInterval();
        this._silenceCued = false;
      }
      return;
    }

    this.blinkTimer -= dt;

    if (!this._silenceCued && this.blinkTimer <= SILENCE_LEAD) {
      this._silenceCued = true;
      this.audio.preEventSilence(SILENCE_LEAD + 0.15);
    }

    if (this.blinkTimer <= 0) {
      this.blinkActive = true;
      this.blinkElapsed = 0;
      this.blinkDuration =
        BLINK_DUR_MIN + Math.random() * (BLINK_DUR_MAX - BLINK_DUR_MIN);
      this.dom.blink.style.opacity = '1';
      this.lighting.pulseFlicker(1);

      const onSnap = (enemy) => {
        const d = enemy.distanceTo(playerPos);
        const prox = Math.max(0, Math.min(1, 1 - d / 18));
        const p = enemy.position;
        this.audio.angelMovementSound(p.x, p.y + 1, p.z, prox);
      };
      for (const enemy of this.enemies) {
        enemy.forceStep(playerPos, stepDist, onSnap);
      }
    }
  }

  _applyDreadVisuals() {
    const v = this.dread;
    this.dom.vignette.style.boxShadow = `inset 0 0 ${180 + v * 120}px ${
      40 + v * 140
    }px rgba(0,0,0,${(0.45 + v * 0.4).toFixed(3)})`;
    this.dom.dreadTint.style.background = `radial-gradient(ellipse at center, transparent ${
      55 - v * 30
    }%, rgba(60,0,0,${(v * 0.35).toFixed(3)}) 100%)`;
    this.dom.dreadTint.style.opacity = '1';
  }

  _applyCameraFeel(dt) {
    const dyaw = Math.abs(this.player.yaw - this._prevYaw);
    this._prevYaw = this.player.yaw;
    const turnSpeed = dt > 0 ? dyaw / dt : 0;
    const blurPx = Math.min(4, turnSpeed * 0.6);
    const sat = (1 - this.dread * 0.55).toFixed(3);
    this.renderer.domElement.style.filter = `saturate(${sat}) blur(${blurPx.toFixed(
      2
    )}px)`;

    const moving =
      this.player.keys.w ||
      this.player.keys.a ||
      this.player.keys.s ||
      this.player.keys.d;
    this.audio.updateFootsteps(dt, moving && this.player.locked);
    this._bobT += dt * (moving ? 9 : 3);
    const bobAmp = (moving ? 0.03 : 0.012) + this.dread * 0.05;
    this.camera.position.y = this.player.eyeHeight + Math.sin(this._bobT) * bobAmp;
    this.camera.rotation.z = Math.sin(this._bobT * 0.5) * (0.004 + this.dread * 0.03);
  }

  _clearScreenFilter() {
    this.renderer.domElement.style.filter = 'none';
    this.dom.dreadTint.style.opacity = '0';
    this.camera.rotation.z = 0;
  }

  /** Circle-vs-grid collision with axis separation so you slide along walls. */
  _collide(x, z) {
    const r = 0.45;
    const fromX = this.player.position.x;
    const fromZ = this.player.position.z;
    let nx = x;
    let nz = z;
    if (this._circleBlocked(nx, fromZ, r)) nx = fromX;
    if (this._circleBlocked(nx, nz, r)) nz = fromZ;
    return { x: nx, z: nz };
  }

  _circleBlocked(x, z, r) {
    const m = this.maze;
    return (
      m.isSolidWorld(x + r, z) ||
      m.isSolidWorld(x - r, z) ||
      m.isSolidWorld(x, z + r) ||
      m.isSolidWorld(x, z - r) ||
      m.isSolidWorld(x, z)
    );
  }

  _updateHUD(nearest, count) {
    this.dom.held.textContent = this.heldCount;
    this.dom.placed.textContent = this.placedCount;
    this.dom.angels.textContent = count;
    this.dom.nearest.textContent =
      nearest === Infinity ? '—' : `${nearest.toFixed(1)}m`;
    if (this.beacon.discovered) {
      const bd = dist(this.player.position, this.beacon.pos);
      this.dom.beacon.textContent = `${bd.toFixed(0)}m away`;
    } else {
      this.dom.beacon.textContent = 'undiscovered';
    }
    this.dom.warning.textContent =
      nearest < LOSE_RADIUS * 2.2 ? '⚠ AN ANGEL IS CLOSE — DO NOT LOOK AWAY' : '';
  }

  /** Brief on-screen status message. */
  _toast(msg) {
    if (!this.dom.toast) return;
    this.dom.toast.textContent = msg;
    this.dom.toast.style.opacity = '1';
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      this.dom.toast.style.opacity = '0';
    }, 1500);
  }

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
