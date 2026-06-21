# Weeping Angels — *Don't Look Away*

A first-person stealth-horror game in the browser. "Angels" stalk you through a
dark **maze**. **They are frozen for as long as you are looking at them** — the
instant they leave your view, they snap closer. Explore the maze, collect **5
relics**, and place them in the **beacon** to escape — but every relic you grab
makes the Angels faster. The threat is never in what you can see. It's in looking
away.

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

Current status: **67 tests passing** across `tests/visibility.test.js`,
`tests/difficulty.test.js`, `tests/dread.test.js`, `tests/maze.test.js`, and
`tests/placement.test.js`.

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
- **Angel snap distance:** `angelStepDistance(t, objects) = 1.53 * 1.25 * 0.975 *
  speedMultiplier(t) * (1 + 0.10 * objects)`
  → base **1.53 m**, a **+25% baseline bump**, a **global −2.5%** scale, the time
  curve, **and +10% per relic collected** (≈+50% at 5). Difficulty tracks *player
  progress*, not just time. The two phasing angels apply an extra **×0.98**.

### Movement rule (`src/enemy.js`)

- **Seen-first:** a normal angel may only move *after the player has seen it at
  least once*. Until then it stays frozen, even during a forced blink.
- **Two phasing exceptions:** the first two angels may move while unseen even
  before they're ever seen (they hunt your live position) — but pay a speed
  penalty (`speedFactor ≈ 0.95`) for the privilege.

### Death jumpscare (`src/game.js`, `src/enemy.js`, `src/audioManager.js`)

When an angel reaches you, the camera **snaps to face it**, the angel's face
**lunges into view** (scaled up, eyes blazing) with a strobing red flash and a
loud procedural **screech** (`audio.jumpscare()`), then the Game Over screen
appears. The angels have **creepy faces** — glowing red eyes set in dark sunken
sockets, a gaping maw, and a furrowed brow.
- **Step cadence:** `stepInterval(t) = max(0.4, 0.8 / speedMultiplier(t))`
  → steps quicken over time but never below 0.4s, so motion stays legible.

### Maze, spawns & objectives (`src/maze.js`, `src/placement.js`, `src/game.js`)

- **Maze** (`generateMaze`, pure + tested): a ~105×105 grid maze (recursive
  backtracker + light braiding for loops/alternate routes & dead ends). Rendered
  as a **single InstancedMesh** (1 draw call); occlusion & collision use a grid
  **DDA raycast / cell lookup** (`segmentBlocked`, `isSolidWorld`) that scales to
  any map size instead of looping wall AABBs. A braided maze is fully connected,
  so the beacon and all relics are **guaranteed reachable** (`allOpenReachable`
  asserts this in tests). Generated once per page load.
- **Randomized spawns** (`pickSpaced`/`pickFar`, pure + tested): on each run the
  **player**, **angels**, **relics**, and **beacon** are placed on random valid
  open cells — never inside walls, angels never within **26 m** of the player,
  relics spaced apart and away from the beacon.
- **Objectives:** collect **5 glowing relics** (carry as many as you like), then
  place them in the beacon's **5 slots**. The beacon tracks total slots filled
  regardless of order/batching — so *collect-all-then-deliver* and *deliver
  incrementally* both work. The beacon only appears on the HUD once **discovered**
  (proximity or line of sight). HUD shows held/placed; toasts + audio cues fire on
  pickup, discovery, each placement, and activation.
- **Beacon safe zone:** within `BEACON_SAFE_RADIUS` (5 m, shown as a green floor
  ring) angels **cannot catch you** — the proximity check is disabled there.
- **Beacon events:**
  - **First discovery:** all angels are banished to their original spawn points,
    and phasing angels are **frozen for 4 s**.
  - **Each placement:** all angels reset to spawn again, and phasing angels freeze
    for **6 s per object** — and it **stacks**, so placing 2 at once freezes them
    for 12 s, 3 for 18 s, etc.
- **Forced blink:** every **4–6s** the screen blacks out for **150–250ms** (you
  can't prevent it) and **every** Angel gets one free move — preceded by a silence
  cue and a synced light flicker.
- **Dread meter** (`computeDread`, pure + tested): rises while an Angel is close
  **and** unseen, decays when safe; drives vignette, desaturation, camera sway,
  and the audio dread layers.

### Win / Lose (`src/game.js`, `src/gameRules.js`)

- **Lose:** any Angel comes within `LOSE_RADIUS` (0.8m) of the player → *Game Over*.
- **Win:** place all **5 relics** in the beacon → it activates → *You Escaped*.
  (This replaces the old survive-timer / fixed-exit win.)

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
8. **Background music** — a slow, dissonant, *melody-free* horror score: a
   shifting low drone with detuned beating + minor-2nd clusters, occasional bowed
   tritone swells and faint high "shivers", through a dark lowpass. Sequenced
   against `AudioContext.currentTime`. Also procedural — no files.
9. **Footsteps** — soft scuff (low-passed noise) + body thud on a walking
   cadence whenever the player moves, with slight left/right weight variation.
10. **Objective cues** — pickup / placement / beacon-discovery / activation chimes.

The whole mix runs **louder** now (ambient, music and footstep gains raised)
through a master **limiter** (`DynamicsCompressor` tuned as a brickwall limiter)
so the louder bus doesn't clip. The `AudioContext` is created on the first click
(to begin) to satisfy browser autoplay policy.

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
  vectors and a reused camera-state object; the frame delta is clamped to avoid
  huge jumps after a pause.
- **Scales to the bigger maze** — all walls render in a **single InstancedMesh**
  (1 draw call), and occlusion/collision use **O(path-length) grid DDA** lookups
  rather than iterating hundreds of wall AABBs. Targets a stable 60fps.

---

## Project structure

```
index.html
src/
  main.js          entry point
  game.js          orchestration (only file touching renderer + DOM)
  player.js        FPS camera, pointer lock, WASD
  enemy.js         Angel AI (snap stepping, freeze-on-sight) + decoy statues
  maze.js          pure maze generation + grid raycast/occlusion (no Three.js)
  placement.js     pure randomized spawn/object placement
  visibility.js    pure "is this enemy seen?" (FOV + occlusion/occluder)
  difficulty.js    pure scaling curves (incl. per-object angel speed)
  dread.js         pure dread-meter logic
  gameRules.js     pure lose (proximity) evaluation
  audioManager.js  procedural Web Audio (ambient, music, spatial, heartbeat…)
  lighting.js      low ambient + camera-bound flashlight
tests/
  visibility.test.js
  difficulty.test.js   (also covers gameRules win/lose logic)
  dread.test.js
  maze.test.js         (reachability guarantee + grid queries)
  placement.test.js
README.md
```

---

## Verification performed

- `npm test` → **67/67 passing**.
- `npm run build` → clean production bundle.
- Headless **Playwright** end-to-end (`--use-gl=swiftshader`): randomized spawns
  never place the player/angels/relics/beacon inside walls; nearest angel respects
  the 26 m rule; **both** delivery playstyles (collect-all-then-deliver and
  incremental) activate the beacon → *won*; per-object speed scaling increments
  correctly; walls render in 1 draw call — all with **zero console errors**.

> Software-rendered (swiftshader) FPS in headless is not representative of real
> hardware; the perf design (single instanced-mesh draw call + O(path) grid
> raycast) is what holds 60fps on a GPU.

> Pointer Lock can't engage in headless mode, so mouse-look was verified
> manually in a desktop browser: lock on click, look with mouse, Esc releases
> and pauses, re-click resumes.

---

## Known limitations / next steps

- **Angels phase through walls.** They snap straight toward your last-known
  position and ignore maze walls (supernatural). Visibility *does* respect walls.
  Normal angels only move once you've seen them; the two phasing exceptions move
  while unseen (at −2% speed). A nav-grid / A* path would make them corridor-bound
  instead — flag if you'd prefer that.
- **The maze regenerates per page load, not per restart.** "Play Again" reshuffles
  spawns/relics/beacon within the same maze; reload for a brand-new maze. Easy to
  switch to per-restart regeneration if you'd rather.
- **Collision** is grid cell lookup with axis separation; fast diagonal moves into
  a corner can feel slightly sticky.
- No mobile/touch controls (Pointer Lock is desktop-oriented).
- Visuals are deliberate geometric placeholders (cones + spheres). Swapping in
  proper Angel models and a textured environment is purely cosmetic.
- Audio is intentionally minimal; positional (panned) stingers per Angel would
  sharpen the "where did that come from?" tension.
- Difficulty is purely time-based; could factor in player skill (e.g. near-miss
  count) for a dynamic curve.
- `playwright` is included as a devDependency only for the optional smoke test;
  remove it if you don't need automated browser verification.
