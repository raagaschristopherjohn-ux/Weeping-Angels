# Weeping Angels — *Don't Look Away*

A first-person stealth-horror game in the browser. One or more "Angels" stalk
you across a dark space. **They are frozen for as long as you are looking at
them** — the instant they leave your view, they take a step closer. The threat
is never in what you can see. It's in looking away.

Built with **Vite + vanilla JS + Three.js**.

> **Why Vite + vanilla JS?** Vite gives instant ES-module dev serving with HMR
> and a zero-config production build, and its bundled Vitest runs the pure logic
> tests in Node with no browser. Vanilla JS (no framework) keeps the render loop
> and the game state directly in our hands, which matters for a 60fps hot path.

---

## Setup

```bash
npm install
```

## Run

```bash
npm run dev
```

Then open the printed URL (default <http://localhost:5173>) and **click to lock
the cursor and begin**.

Production build / preview:

```bash
npm run build
npm run preview
```

## Tests

The visibility check, difficulty curves, and win/lose rules are pure functions
with no DOM/renderer dependency, so they run headless in Node:

```bash
npm test          # one-shot (vitest run)
npm run test:watch
```

Current status: **63 tests passing** across `tests/visibility.test.js`,
`tests/difficulty.test.js`, `tests/dread.test.js`, and
`tests/exitPlacement.test.js`.

---

## Controls

| Input            | Action                              |
| ---------------- | ----------------------------------- |
| **W A S D** / Arrows | Move (flat plane, no jumping)   |
| **Mouse**        | Look (Pointer Lock)                 |
| **Esc**          | Release cursor → pauses the game    |
| **Click**        | Start / resume / restart            |

---

## How it works

### "Being watched" detection — exact rule (`src/visibility.js`)

`isEnemySeen(cameraState, enemyPosition, obstacles, options)` is a **pure
function** (no Three.js) returning a boolean. An enemy is *seen* only if **both**:

1. **FOV cone** — its sight point lies within the player's field-of-view cone
   (default 80°), computed from the angle between the camera's forward vector
   and the direction to the enemy.
2. **Clear line of sight** — an analytic ray (ray-vs-AABB slab test) from the
   camera to the enemy reaches it with no obstacle in between.

Edge cases handled and commented in-source:

- **Enemy half in frame** — we only have the enemy's center point, so the cone
  is widened by the enemy's *angular radius* (`atan(radius / distance)`), so an
  Angel whose body edge pokes into view still counts as seen.
- **Multiple enemies at once** — the function is per-enemy; the game calls it
  once per Angel, each with its own independent `seen` state. Angels do **not**
  occlude each other (one can't hide behind another) — only static geometry
  occludes.
- **Degenerate cases** — enemy on top of the camera (distance ≈ 0) counts as
  seen; enemy beyond `maxDistance` counts as unseen; zero-vector normalize is
  guarded.

### Enemy AI (`src/enemy.js`)

Each Angel tracks its own observed state. While **unseen**, it **snaps** a
discrete distance toward the player's last-known position on a timer — it does
**not** glide, so the instant it re-enters view it visibly occupies a new spot.
The moment it is **seen**, it freezes. It remembers where you were each time it's
observed and lunges toward that spot. The model is a hunched, asymmetric figure
mid-reach (`buildAngelMesh`), reused for inert **decoy statues** (`opts.decoy`)
that never move — so you have to actually watch rather than pattern-match.

### Difficulty scaling — exact curve (`src/difficulty.js`)

Isolated, testable formulas, guarded against `t ≤ 0` / non-finite input:

- **Enemy count:** `activeEnemies(t) = clamp(1 + floor(t / 20), 1, 6)`
  → start at 1, **+1 every 20s, capped at 6**. (≥3 Angels by midgame.)
- **Speed:** `speedMultiplier(t) = 1 + 0.05 * floor(t / 15)`
  → **+5% every 15s**.
- **Step distance:** `stepDistanceFor(t) = 1.7 * speedMultiplier(t)`
  → base **1.7 m** per snap, growing 5%/15s. The base is large enough that one
  missed glance is genuinely costly.
- **Step cadence:** `stepInterval(t) = max(0.4, 0.8 / speedMultiplier(t))`
  → steps quicken over time but never below 0.4s, so motion stays legible.

### Forced blink, dread & level design (`src/game.js`, `src/dread.js`)

- **Forced blink:** every **4–6s** the screen blacks out for **150–250ms** (you
  can't prevent it) and **every** Angel gets one free move while you're blind —
  preceded by a silence cue and a synced light flicker.
- **Dread meter** (`computeDread`, pure + tested): rises while an Angel is close
  **and** unseen (within 14 m), decays when safe, clamped to [0, 1]. Drives a
  tightening/darkening vignette, desaturation, camera sway, and the audio dread
  layers.
- **Level design:** staggered walls create pockets so you can't keep multiple
  Angels in view from one spot (line-of-sight contention is the main difficulty).
- **Randomized exit** (`src/exitPlacement.js`, pure + tested): the green beacon is
  placed in a fresh spot **every run / page load** via edge-biased rejection
  sampling — always in the **outer ring** (never the open centre), far from spawn,
  clear of walls, and hidden from both the spawn point and the arena centre by an
  obstacle. So finding it always means exploring and turning away from danger.

### Win / Lose (`src/gameRules.js`)

- **Lose:** any Angel comes within `LOSE_RADIUS` (1.6m) of the player → *Game
  Over*. Loss takes priority over a simultaneous win.
- **Win (both implemented, first to trigger):**
  - **Survive 90 seconds**, or
  - **reach the green exit beacon** in the far corner.

### Sound (`src/audioManager.js`)

100% procedural via the Web Audio API — **no audio files**. Layers:

1. **Ambient bed** — 55/56.5/110 Hz detuned oscillators through an LFO-swept lowpass.
2. **Dread layers** — a dissonant pad + noise hiss that crossfade in with the dread meter.
3. **Silence as a cue** — the whole atmosphere ducks to near-zero for ~300–500ms
   before a forced blink or a close unseen-Angel event, so the stinger lands in silence.
4. **Angel movement** — a bandpass-swept noise "stone grind" (~100ms) + sub-bass
   thump, fired exactly on the snap frame.
5. **Spatial audio** — movement/false cues run through HRTF `PannerNode`s placed
   at the Angel's world position (with the listener tracking the camera), so you
   can sense movement behind you.
6. **Heartbeat** — scheduled against `AudioContext.currentTime` (not `setInterval`),
   BPM rising from ~48 to ~140 as the nearest unseen Angel closes in.
7. **False cues** — occasional faint grind from a random direction with no real
   Angel behind it.
8. **Background music** — a clearly-audible, looping, minor-key horror score: a
   triangle arpeggio + shifting sub-bass through a 4-bar progression (Am–F–C–Em)
   with a sparse ringing high tone, sequenced against `AudioContext.currentTime`.
   Routed straight to master so it plays continuously. Also procedural — no files.
9. **Footsteps** — soft scuff (low-passed noise) + body thud on a walking
   cadence whenever the player moves, with slight left/right weight variation.

The `AudioContext` is created on the first click (to begin) to satisfy browser
autoplay policy — so the music and ambience kick in the moment the round starts.

### Lighting (`src/lighting.js`)

Low ambient + a faint directional fill, plus a narrow **flashlight-style
spotlight** bound to the camera, so the periphery is genuinely dark and you only
ever light what you look at directly. A sharp flicker is `pulseFlicker`-ed on the
exact frames Angels are allowed to move (forced blink, some snaps), so you can't
tell movement from a failing bulb. Flicker depth scales with the dread meter;
tints red on loss, green on win.

### Robustness & performance

- **Pointer-lock loss** (Esc / focus loss) auto-pauses and shows a "click to
  resume" overlay; held movement keys are dropped so you don't slide while paused.
- **Window resize** updates camera aspect + renderer size and pixel ratio.
- **Difficulty t=0 guard** — formulas return base values for `t ≤ 0` and
  non-finite input (unit-tested).
- **No per-frame allocation in hot paths** — player/enemy/lighting reuse scratch
  vectors and a reused camera-state object; visibility uses analytic ray-AABB
  math instead of allocating a `THREE.Raycaster` per check; the frame delta is
  clamped to avoid huge jumps after a pause. Targets a stable 60fps with 6 Angels.

---

## Project structure

```
index.html
src/
  main.js          entry point
  game.js          orchestration (only file touching renderer + DOM)
  player.js        FPS camera, pointer lock, WASD
  enemy.js         Angel AI (snap stepping, freeze-on-sight) + decoy statues
  visibility.js    pure "is this enemy seen?" (FOV + occlusion)
  difficulty.js    pure scaling curves
  dread.js         pure dread-meter logic
  exitPlacement.js pure random-exit placement (valid + hidden)
  gameRules.js     pure win/lose evaluation
  audioManager.js  procedural Web Audio (ambient, dread, spatial, heartbeat…)
  lighting.js      low ambient + camera-bound flashlight
tests/
  visibility.test.js
  difficulty.test.js   (also covers gameRules win/lose logic)
  dread.test.js
  exitPlacement.test.js
README.md
```

---

## Verification performed

- `npm test` → **63/63 passing**.
- `npm run build` → clean production bundle.
- Headless **Playwright** end-to-end (`--use-gl=swiftshader`): page loads, the
  How-to-Play start screen shows, clicking starts the game and the HUD goes live,
  the flashlight cone + lunging Angel render, a forced blink fires, and the
  win → restart → lose flow all work with **zero console errors / page errors**.

> Pointer Lock can't engage in headless mode, so mouse-look was verified
> manually in a desktop browser: lock on click, look with mouse, Esc releases
> and pauses, re-click resumes.

---

## Known limitations / next steps

- **Collision** is simple AABB push-out; fast diagonal movement into a corner
  can feel slightly sticky. A swept-capsule resolver would be smoother.
- Angels currently path in a straight line to your last-known position — they
  don't navigate *around* obstacles, so one can briefly bunch up behind a box.
  A nav-grid / A* step target is the natural next step.
- No mobile/touch controls (Pointer Lock is desktop-oriented).
- Visuals are deliberate geometric placeholders (cones + spheres). Swapping in
  proper Angel models and a textured environment is purely cosmetic.
- Audio is intentionally minimal; positional (panned) stingers per Angel would
  sharpen the "where did that come from?" tension.
- Difficulty is purely time-based; could factor in player skill (e.g. near-miss
  count) for a dynamic curve.
- `playwright` is included as a devDependency only for the optional smoke test;
  remove it if you don't need automated browser verification.
