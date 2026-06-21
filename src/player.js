/**
 * player.js
 * ----------
 * First-person camera with WASD movement and mouse-look via the Pointer Lock
 * API. Movement is on a flat plane only (no jump/physics). Exposes a plain
 * camera-state snapshot for the renderer-free visibility check.
 */
import * as THREE from 'three';

export class Player {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLElement} domElement element to request pointer lock on
   * @param {object} [opts]
   */
  constructor(camera, domElement, opts = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.speed = opts.speed ?? 4.5; // metres/sec
    this.eyeHeight = opts.eyeHeight ?? 1.7;
    this.bounds = opts.bounds ?? 24; // half-size of the playable square

    this.yaw = 0; // left/right, radians
    this.pitch = 0; // up/down, radians
    this.locked = false;

    this.keys = { w: false, a: false, s: false, d: false };

    // Reused scratch objects — no per-frame allocations in the hot path.
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move = new THREE.Vector3();
    this._camState = {
      position: { x: 0, y: 0, z: 0 },
      forward: { x: 0, y: 0, z: -1 },
    };

    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(0, this.eyeHeight, 0);

    this._bindEvents();
  }

  setPosition(x, z) {
    this.camera.position.set(x, this.eyeHeight, z);
  }

  setRotation(yaw, pitch = 0) {
    this.yaw = yaw;
    this.pitch = pitch;
  }

  _bindEvents() {
    this._onKeyDown = (e) => this._setKey(e.code, true);
    this._onKeyUp = (e) => this._setKey(e.code, false);
    this._onMouseMove = (e) => {
      if (!this.locked) return;
      const sensitivity = 0.0022;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity;
      // Clamp pitch so you can't flip the camera over.
      const limit = Math.PI / 2 - 0.05;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    };

    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
  }

  _setKey(code, val) {
    switch (code) {
      case 'KeyW': case 'ArrowUp': this.keys.w = val; break;
      case 'KeyA': case 'ArrowLeft': this.keys.a = val; break;
      case 'KeyS': case 'ArrowDown': this.keys.s = val; break;
      case 'KeyD': case 'ArrowRight': this.keys.d = val; break;
    }
  }

  requestLock() {
    this.dom.requestPointerLock?.();
  }

  /** Wire pointer-lock change/error to callbacks owned by the game. */
  onLockChange(cb) {
    this._lockChangeHandler = () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) {
        // Drop held keys so we don't "slide" while paused.
        this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
      }
      cb(this.locked);
    };
    document.addEventListener('pointerlockchange', this._lockChangeHandler);
  }

  /**
   * Advance movement & apply look rotation.
   * @param {number} dt seconds
   * @param {(x:number,z:number)=>{x:number,z:number}} [collide] optional
   *        collision resolver mapping a desired position to an allowed one.
   */
  update(dt, collide) {
    // Apply look.
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    if (this.locked) {
      // Build a flat (y=0) forward/right basis from yaw only.
      this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
      this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

      this._move.set(0, 0, 0);
      if (this.keys.w) this._move.add(this._forward);
      if (this.keys.s) this._move.sub(this._forward);
      if (this.keys.d) this._move.add(this._right);
      if (this.keys.a) this._move.sub(this._right);

      if (this._move.lengthSq() > 0) {
        this._move.normalize().multiplyScalar(this.speed * dt);
        let nx = this.camera.position.x + this._move.x;
        let nz = this.camera.position.z + this._move.z;

        if (collide) {
          const resolved = collide(nx, nz);
          nx = resolved.x;
          nz = resolved.z;
        }

        // Keep inside the arena.
        nx = Math.max(-this.bounds, Math.min(this.bounds, nx));
        nz = Math.max(-this.bounds, Math.min(this.bounds, nz));

        this.camera.position.x = nx;
        this.camera.position.z = nz;
      }
    }
  }

  /**
   * Snapshot for visibility.js. Mutates and returns a reused object — callers
   * must consume it synchronously (no retained references).
   */
  getCameraState() {
    this.camera.getWorldDirection(this._forward);
    const p = this.camera.position;
    this._camState.position.x = p.x;
    this._camState.position.y = p.y;
    this._camState.position.z = p.z;
    this._camState.forward.x = this._forward.x;
    this._camState.forward.y = this._forward.y;
    this._camState.forward.z = this._forward.z;
    return this._camState;
  }

  get position() {
    return this.camera.position;
  }

  dispose() {
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
    if (this._lockChangeHandler) {
      document.removeEventListener('pointerlockchange', this._lockChangeHandler);
    }
  }
}
