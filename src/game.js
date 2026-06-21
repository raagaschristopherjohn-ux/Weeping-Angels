/**
 * game.js
 * --------
 * Glue layer: scene/renderer, arena, player, Angels, decoys, lighting, audio,
 * HUD, difficulty, forced blink, dread meter, and win/lose. All pure logic lives
 * in visibility.js / difficulty.js / gameRules.js / dread.js; this is the only
 * file that touches the renderer + DOM.
 */
import * as THREE from 'three';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Lighting } from './lighting.js';
import { AudioManager } from './audioManager.js';
import { isEnemySeen } from './visibility.js';
import { activeEnemies, stepInterval, stepDistanceFor } from './difficulty.js';
import { computeDread } from './dread.js';
import { pickExitSpot } from './exitPlacement.js';
import { evaluateGameState, SURVIVE_SECONDS, LOSE_RADIUS } from './gameRules.js';

const ARENA_HALF = 24;
const SPAWN = { x: -(ARENA_HALF - 3), z: -(ARENA_HALF - 3) };

// Forced-blink tuning.
const BLINK_MIN = 4; // seconds
const BLINK_MAX = 6;
const BLINK_DUR_MIN = 0.15;
const BLINK_DUR_MAX = 0.25;
const SILENCE_LEAD = 0.4; // seconds of near-silence before a blink

export class Game {
  constructor(appEl) {
    this.app = appEl;
    this.state = 'start'; // start | playing | paused | won | lost
    this.elapsed = 0;
    this.clock = new THREE.Clock(false);

    this.enemies = [];
    this.decoys = [];
    this.obstacleBoxes = []; // AABBs for the visibility occlusion test

    // Reused scratch (no per-frame allocation).
    this._exitFlat = { x: 0, z: 0 };
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
    this.scene.background = new THREE.Color(0x080a12);
    this.scene.fog = new THREE.FogExp2(0x080a12, 0.02);

    this.camera = new THREE.PerspectiveCamera(
      72,
      window.innerWidth / window.innerHeight,
      0.1,
      200
    );

    const floorGeo = new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x2c3242,
      roughness: 1,
      metalness: 0,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    this._addBoundaryWalls();
    this._addObstacles();
    this._addExit();
  }

  _addBoundaryWalls() {
    const h = 4.5;
    const mat = new THREE.MeshStandardMaterial({ color: 0x232838, roughness: 1 });
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
      color: 0x3c4458,
      roughness: 0.95,
    });
    // Layout goals: (a) a central wall blocks the spawn->exit diagonal so the
    // exit is never visible from the start; (b) staggered walls create pockets so
    // you cannot keep multiple angels in view from one spot — line-of-sight
    // contention is the main difficulty. [cx, cz, sx, sz, height]
    const defs = [
      [0, 0, 20, 1.5, 4], // central diagonal blocker (through origin)
      [-8, -12, 1.5, 14, 4], // vertical wall near spawn
      [8, 12, 1.5, 14, 4], // vertical wall mid-north
      [16, 17, 13, 1.5, 4], // screen hiding the exit corner from the south
      [-15, 5, 4, 4, 3.5], // cover blocks
      [14, -6, 4, 4, 3.5],
      [-3, 16, 4, 4, 3.5],
      [4, -16, 4, 4, 3.5],
    ];
    for (const [cx, cz, sx, sz, hy] of defs) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, hy, sz), mat);
      mesh.position.set(cx, hy / 2, cz);
      this.scene.add(mesh);
      this.obstacleBoxes.push({
        min: { x: cx - sx / 2, y: 0, z: cz - sz / 2 },
        max: { x: cx + sx / 2, y: hy, z: cz + sz / 2 },
      });
    }
  }

  _addExit() {
    // Position is randomized per run in _placeExit(); start at a placeholder.
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

    // Short-range glow so it doesn't light the whole map (keeps it hidden).
    const glow = new THREE.PointLight(0x33ff88, 1.4, 9, 2);
    glow.position.set(this.exitPos.x, 2.5, this.exitPos.z);
    this.scene.add(glow);
    this.exitGlow = glow;
  }

  /**
   * Randomly place the exit: a fresh, valid spot every run (and every page
   * load), far from spawn, clear of walls, and hidden from the spawn point.
   */
  _placeExit() {
    const spot = pickExitSpot(Math.random, SPAWN, this.obstacleBoxes, {
      bounds: ARENA_HALF - 2,
      minDistFromSpawn: 28,
      clearance: 1.8,
      minPerimeter: (ARENA_HALF - 2) * 0.62, // keep it out of the open centre
      alsoHiddenFrom: [{ x: 0, z: 0 }], // tucked away from the arena centre too
    });
    this.exitPos.set(spot.x, 0, spot.z);
    this.exitBeacon.position.set(spot.x, 2, spot.z);
    this.exitGlow.position.set(spot.x, 2.5, spot.z);
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
    const $ = (id) => document.getElementById(id);
    this.dom = {
      crosshair: $('crosshair'),
      hud: $('hud'),
      time: $('hud-time'),
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

    // Spawn in the SW corner; the exit is randomized (and hidden) each run.
    this.player.setPosition(SPAWN.x, SPAWN.z);
    this.player.setRotation(Math.PI * 0.25, 0); // look NE-ish into the arena
    this._prevYaw = this.player.yaw;
    this._placeExit();

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

  _victory(reason) {
    this.state = 'won';
    this.clock.stop();
    this.lighting.setMood('win');
    this.audio.stopAmbient();
    this.audio.winStinger();
    this.dom.blink.style.opacity = '0';
    this._clearScreenFilter();
    this.dom.winDetail.textContent =
      reason === 'exit'
        ? 'You reached the beacon. The Angels freeze, mid-reach, forever.'
        : `You survived ${SURVIVE_SECONDS} seconds. The Angels never caught you.`;
    this._show(this.dom.win, true);
    document.exitPointerLock?.();
  }

  // ---- enemies & decoys ----

  _spawnEnemy() {
    const p = this.player.position;
    let best = null;
    let bestDist = -Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = Math.cos(a) * (ARENA_HALF - 3);
      const z = Math.sin(a) * (ARENA_HALF - 3);
      const d = Math.hypot(x - p.x, z - p.z);
      if (d > bestDist) {
        bestDist = d;
        best = { x, z };
      }
    }
    const enemy = new Enemy(this.scene, {
      position: new THREE.Vector3(best.x, 0, best.z),
    });
    this.enemies.push(enemy);
  }

  _spawnDecoys() {
    // Inert statues in open spots — identical at a glance, never move.
    const spots = [
      [-13, 2],
      [13, 2],
      [-2, -8],
      [6, -13],
    ];
    for (const [x, z] of spots) {
      this.decoys.push(
        new Enemy(this.scene, { decoy: true, position: new THREE.Vector3(x, 0, z) })
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

    if (this.exitGlow) {
      this.exitGlow.intensity = 1.2 + 0.4 * Math.sin(performance.now() * 0.004);
    }

    this.renderer.render(this.scene, this.camera);
  }

  _updatePlaying(dt) {
    const desired = activeEnemies(this.elapsed);
    while (this.enemies.length < desired) this._spawnEnemy();

    const interval = stepInterval(this.elapsed);
    const stepDist = stepDistanceFor(this.elapsed);

    this.player.update(dt, (x, z) => this._collide(x, z));

    const camState = this.player.getCameraState();
    const playerPos = this.player.position;
    this.audio.updateListener(camState.position, camState.forward);

    // Forced blink scheduling (drives free moves + silence + light pulse).
    this._updateBlink(dt, playerPos, stepDist);

    const onSnap = (enemy) => {
      const d = enemy.distanceTo(playerPos);
      const prox = Math.max(0, Math.min(1, 1 - d / 18));
      const p = enemy.position;
      this.audio.angelMovementSound(p.x, p.y + 1, p.z, prox);
      // Sometimes flicker the light on a move, so you can't be sure what moved.
      if (Math.random() < 0.3) this.lighting.pulseFlicker(0.7);
    };

    let nearest = Infinity;
    let nearestUnseen = Infinity;

    while (this._enemyFlats.length < this.enemies.length) {
      this._enemyFlats.push({ x: 0, z: 0 });
    }

    for (let i = 0; i < this.enemies.length; i++) {
      const enemy = this.enemies[i];
      const seen = isEnemySeen(camState, enemy.getSightPoint(), this.obstacleBoxes, {
        fovDegrees: 80,
        maxDistance: 60,
        enemyRadius: enemy.radius,
      });

      // During a blink the whole screen is black: the free move already happened
      // at blink start, so skip normal stepping to avoid a double move.
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

    // Dread meter from nearest UNSEEN angel; drive audio + visuals.
    this.dread = computeDread(this.dread, dt, nearestUnseen);
    this.audio.setDread(this.dread);
    this.audio.updateHeartbeat(nearestUnseen);
    this.audio.updateMusic();
    this._applyDreadVisuals();

    // "Silence before a close unseen-angel event" cue.
    if (nearestUnseen < 4 && !this._closeCued) {
      this._closeCued = true;
      this.audio.preEventSilence(0.35);
    } else if (nearestUnseen > 6) {
      this._closeCued = false;
    }

    // False audio cues when relatively safe, to keep the player uneasy.
    this.falseCueTimer -= dt;
    if (this.falseCueTimer <= 0) {
      this.falseCueTimer = 6 + Math.random() * 8;
      if (nearestUnseen > 8) this.audio.falseCue(playerPos);
    }

    // Camera feel: bob/sway (amplified by dread) + motion blur on fast turns.
    this._applyCameraFeel(dt);

    // Win/lose evaluation via pure rules (decoys excluded — they never catch).
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

    // Cut the atmosphere to near-silence just before the blink.
    if (!this._silenceCued && this.blinkTimer <= SILENCE_LEAD) {
      this._silenceCued = true;
      this.audio.preEventSilence(SILENCE_LEAD + 0.15);
    }

    if (this.blinkTimer <= 0) {
      // Start the blink: black out, flicker, and give EVERY angel a free move.
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
    // Tighten + darken the vignette as dread rises.
    this.dom.vignette.style.boxShadow = `inset 0 0 ${180 + v * 120}px ${
      40 + v * 140
    }px rgba(0,0,0,${(0.45 + v * 0.4).toFixed(3)})`;
    // Reddish unease tint.
    this.dom.dreadTint.style.background = `radial-gradient(ellipse at center, transparent ${
      55 - v * 30
    }%, rgba(60,0,0,${(v * 0.35).toFixed(3)}) 100%)`;
    this.dom.dreadTint.style.opacity = '1';
  }

  _applyCameraFeel(dt) {
    // Motion blur from fast camera turns.
    const dyaw = Math.abs(this.player.yaw - this._prevYaw);
    this._prevYaw = this.player.yaw;
    const turnSpeed = dt > 0 ? dyaw / dt : 0;
    const blurPx = Math.min(4, turnSpeed * 0.6);
    // Desaturate with dread.
    const sat = (1 - this.dread * 0.55).toFixed(3);
    this.renderer.domElement.style.filter = `saturate(${sat}) blur(${blurPx.toFixed(
      2
    )}px)`;

    // Subtle bob/sway, amplified by dread.
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

  _collide(x, z) {
    const r = 0.4;
    for (const box of this.obstacleBoxes) {
      if (
        x > box.min.x - r &&
        x < box.max.x + r &&
        z > box.min.z - r &&
        z < box.max.z + r
      ) {
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
    this.dom.warning.textContent =
      nearest < LOSE_RADIUS * 2.2 ? '⚠ AN ANGEL IS CLOSE — DO NOT LOOK AWAY' : '';
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
