# Procedural Racer — Full Technical Documentation

This document explains **everything** about the project: what it is, how the code is
organised, the maths behind the procedural track generation, the vehicle physics model,
the rendering, the input systems (keyboard / touch / tilt), the game loop, and the test
harness. It's written so that someone who has never seen the code can understand and modify
any part of it.

> The entire game lives in a single file: **`index.html`** (HTML + CSS + JavaScript, no
> external assets). Everything below refers to code inside that file unless stated otherwise.

---

## Table of contents
1. [Concept](#1-concept)
2. [High-level architecture](#2-high-level-architecture)
3. [Seeded randomness (the foundation)](#3-seeded-randomness-the-foundation)
4. [Procedural track generation](#4-procedural-track-generation)
5. [Biomes & scenery](#5-biomes--scenery)
6. [Vehicle physics](#6-vehicle-physics)
7. [The game loop](#7-the-game-loop)
8. [Laps, checkpoints & timing](#8-laps-checkpoints--timing)
9. [Camera](#9-camera)
10. [Rendering](#10-rendering)
11. [Input systems](#11-input-systems)
12. [HUD & minimap](#12-hud--minimap)
13. [The test harness](#13-the-test-harness)
14. [Tuning guide (common tweaks)](#14-tuning-guide-common-tweaks)
15. [Extension ideas](#15-extension-ideas)
16. [Glossary](#16-glossary)

---

## 1. Concept

Procedural Racer is an arcade **top-down car racer** that fuses two classic game-dev systems:

- **Procedural generation** — every race builds a *new, unique* closed-loop track and world
  from a single integer **seed**. The same seed always reproduces the same world (so tracks
  are shareable and replayable); a new seed produces something completely different.
- **Vehicle physics** — the car is driven by a real-ish physics model (engine force, drag,
  speed-dependent steering, and a **tire-grip model** that creates understeer, oversteer,
  drift, and skid marks) rather than just moving a sprite.

The objective: complete **3 laps** as fast as possible, chasing your best lap time.

---

## 2. High-level architecture

Everything is in `index.html`, split into three parts:

| Part | What it holds |
|------|---------------|
| `<style>` | All CSS: layout, HUD, speedometer, minimap, touch controls, tilt meter |
| `<body>` | The DOM: the game `<canvas>`, the minimap `<canvas>`, HUD elements, control buttons, touch pads |
| `<script>` | All game logic (one module, no imports) |

The JavaScript is organised top-to-bottom into clearly commented sections:

```
seeded RNG (mulberry32) ......... deterministic randomness
vector helpers .................. lerp, clamp, dist, TAU
BIOMES .......................... colour/style table per biome
generateTrack() ................. builds the racetrack centreline
generateProps() ................. scatters scenery
class Car ....................... the vehicle physics model
GAME state ...................... globals: track, car, lap, timers...
buildRace() ..................... assembles a full race from a seed
input ........................... keyboard, touch, tilt
frame() ......................... the main loop (update + render)
render() / draw*() .............. all canvas drawing
updateHUD() ..................... text/DOM updates
boot ............................ resize + first buildRace + start loop
```

There is **no build step and no framework** — open the file and it runs.

---

## 3. Seeded randomness (the foundation)

Procedural generation must be **deterministic**: the same seed → the same world. JavaScript's
built-in `Math.random()` can't be seeded, so the project ships its own PRNG.

### `makeRNG(seed)` — mulberry32
A small, fast, well-distributed 32-bit pseudo-random number generator. It returns a function
that yields a new float in `[0, 1)` on each call:

```js
function makeRNG(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

Because every random decision in world generation pulls from this one seeded stream **in a
fixed order**, replaying the same seed rebuilds the identical track, biome, and scenery.

### `hashStr(s)` — words as seeds
So players can type a *word* (e.g. `"sunset"`) as a seed, `hashStr` converts any string into a
32-bit integer via the **FNV-1a** hash. Numeric input is used directly; non-numeric input is
hashed.

---

## 4. Procedural track generation

`generateTrack(rng)` builds a smooth, closed, **non-self-intersecting** racetrack in four steps.

### Step 1 — random control points around a ring
It places `11–15` points (count chosen from the seed) evenly *by angle* around a circle, but
gives each a **randomly varied radius**:

```js
const POINTS = 11 + Math.floor(rng() * 5);
const R = 1100;                                   // base radius (world units)
const rad = R * (0.55 + rng() * 0.55);            // 60.5%–121% of R
pts.push({ x: Math.cos(a) * rad, y: Math.sin(a) * rad });
```

Distributing by angle (rather than fully random positions) is what guarantees the loop never
crosses itself — the points are always in angular order around the centre.

### Step 2 — relaxation (avoid pinches)
Consecutive points that land too close together would create sharp kinks. Three relaxation
passes push neighbouring points apart until they're at least `420` units apart:

```js
const minD = 420;
if (d < minD) { /* push both points apart along their connecting line */ }
```

### Step 3 — Catmull-Rom spline smoothing
The handful of control points are turned into a **dense, smooth curve** using a Catmull-Rom
spline, which passes *through* each control point with smooth tangents. Each segment between
two control points is subdivided into `SEG = 24` samples:

```js
const t = s / SEG, t2 = t*t, t3 = t2*t;
const x = 0.5 * ((2*p1.x) + (-p0.x+p2.x)*t
        + (2*p0.x-5*p1.x+4*p2.x-p3.x)*t2
        + (-p0.x+3*p1.x-3*p2.x+p3.x)*t3);
// (same formula for y)
```

The result is `center[]`, an array of ~250–360 points forming the **track centreline**.

### Step 4 — tangents, normals, arc length
For each centreline node the code computes and stores:
- `tx, ty` — the **tangent** (direction of travel),
- `nx, ny` — the **left normal** (perpendicular, used for track width / start line),
- `s` — cumulative **arc length** from the start.

Finally the track gets a randomised **half-width**:

```js
const width = 120 + rng() * 50;   // asphalt half-width in world units
return { center, width, length: total };
```

So the returned `track` object is `{ center[], width, length }`. The road is drawn later by
stroking the centreline with a thick line (see [Rendering](#10-rendering)).

---

## 5. Biomes & scenery

### The `BIOMES` table
Four biomes (`meadow`, `desert`, `snow`, `night`) are defined as colour/style presets:

```js
meadow: { grass, grass2, road, edge, fog, sky, prop:'tree', propColor, accent }
```

`buildRace()` picks one from the seed, so the world's entire palette (ground, asphalt, curbs,
fog/vignette, accent colour, and which prop type to scatter) is seed-driven.

### `generateProps(rng, track, biome)`
Scatters scenery (`tree` / `cactus` / `pine` depending on biome). It makes `900` attempts to
place props at random polar positions, then **rejects** any that are:
- **too close to the road** (`< track.width + 55`) — keeps the asphalt clear, and
- **too far out** (`> 900` from the nearest centreline node) — avoids littering empty void.

Each surviving prop stores `{ x, y, r, sway }` (position, size, and a phase value reserved for
animation). The road-distance check samples every 3rd centreline node for speed.

---

## 6. Vehicle physics

This is the heart of the "feel". The `Car` class implements a **top-down arcade car model**.
The core idea: track world-space velocity `(vx, vy)` and a heading `angle`, then split velocity
into the part going *forward* (along the heading) and the part going *sideways* (lateral) — and
treat **how much sideways velocity is removed as the tire grip**.

### State
```
x, y          world position
angle         heading (radians)
vx, vy        world-space velocity
steer         smoothed steering input (-1..1)
skids[]       trail of skid-mark points
```

### `update(dt, throttle, steerInput, handbrake, onTrack)` — step by step

**Constants**
```js
const ENGINE = 1500;     // forward acceleration force
const MAXSPEED = 720;    // hard speed cap
const STEER_RATE = 3.4;  // how fast the heading rotates
```

**1. Smooth the steering** — input is eased toward the target so turning isn't instant:
```js
this.steer = lerp(this.steer, steerInput, 1 - Math.pow(0.0015, dt));
```
The `Math.pow(..., dt)` form makes the smoothing **frame-rate independent**.

**2. Engine / brake** — force is applied along the heading vector `(fx, fy)`. Braking
(throttle < 0 while moving forward) is 1.6× stronger than acceleration:
```js
let accel = throttle * ENGINE;
if (throttle < 0 && forwardSpeed > 5) accel = throttle * ENGINE * 1.6;
this.vx += fx * accel * dt;  this.vy += fy * accel * dt;
```

**3. Drag & rolling resistance** — much higher off-track, so grass slows you down hard:
```js
const drag = onTrack ? 0.4 : 3.2;
const roll = onTrack ? 0.015 : 0.05;
```
Then velocity is clamped to `MAXSPEED`.

**4. The tire-grip model (the important bit)** — decompose velocity into forward + lateral,
then keep only a *fraction* of the lateral part:
```js
const fwdX = fx * forwardSpeed, fwdY = fy * forwardSpeed;   // forward component
const latX = this.vx - fwdX,    latY = this.vy - fwdY;      // lateral component
let gripKeep = onTrack ? 0.12 : 0.45;   // fraction of sideways velocity RETAINED
if (handbrake) gripKeep = 0.85;         // handbrake → big slide/drift
this.vx = fwdX + latX * gripKeep;
this.vy = fwdY + latY * gripKeep;
```
- Low `gripKeep` (0.12 on asphalt) ⇒ sideways motion is mostly killed ⇒ **lots of grip**.
- Higher off-track (0.45) ⇒ the car slides ⇒ **slippery grass**.
- Handbrake (0.85) ⇒ sideways velocity is largely preserved ⇒ **drift**.

**5. Steering rotates the heading**, scaled by speed (you can't turn while stopped) and by
direction (so reversing steers correctly):
```js
const speedFactor = clamp(Math.abs(forwardSpeed) / 180, 0, 1);
const turn = this.steer * STEER_RATE * speedFactor * Math.sign(forwardSpeed || 1);
this.angle += turn * dt;
```

**6. Integrate position**: `x += vx*dt; y += vy*dt`.

**7. Skid marks** — when lateral slip is large (or the handbrake is down) and the car is moving,
a skid point is recorded; skids fade out over time and are capped at 600 entries.

The method also stores `speed`, `forwardSpeed`, and `slip` for the HUD and rendering.

### Out-of-bounds wall & collision sparks

You can slide off the asphalt into a **grass runoff zone**, but not drive endlessly into the
void. `clampToBoundary()` (called right after `car.update`) enforces an **invisible wall that
follows the track's shape** — much better than a circle, which would clip an irregular loop.

The rule: the car may not be further than `track.width + RUNOFF` (`RUNOFF = 150`) from the
nearest centreline node. On contact:

```js
const nx = dx / d, ny = dy / d;            // outward unit normal (centreline → car)
car.x = node.x + nx * MAX;                  // snap the car back onto the wall
car.y = node.y + ny * MAX;
const vOut = car.vx * nx + car.vy * ny;     // velocity component pointing outward
if (vOut > 0) { car.vx -= nx * vOut; car.vy -= ny * vOut; }  // cancel only that part
car.vx *= 0.9; car.vy *= 0.9;               // scrape friction
```

Because only the **outward** velocity is cancelled, the car **scrapes along the wall** (keeps
its tangential speed) instead of dead-stopping or punching through. The wall is drawn as inner +
outer dashed lines by `drawBoundary()` (the centreline offset by `±MAX` along each node's normal),
so players can see the limit.

**Collision sparks.** When the car hits the wall hard enough, `spawnSparks()` emits a burst of
particles at the contact point:

```js
const impact = Math.max(vOut, car.speed * 0.25);   // head-on hits spark more than shallow scrapes
if (impact > 30) spawnSparks(car.x, car.y, nx, ny, impact);
```

Each spark flies **inward along the wall** (a mix of the wall tangent and the inward normal) with
a randomised speed and a short lifetime. `updateSparks(dt)` moves them with air drag and fades
them; `drawSparks()` renders them as additive (`globalCompositeOperation = 'lighter'`) streaks
that shift colour with age — **white → orange → red** — and trail behind their motion. The count
scales with impact (1–7 per hit) and the total is capped at 220 for performance. Sparks are reset
on each new race.

---

## 7. The game loop

`frame(now)` is driven by `requestAnimationFrame` and does everything each frame:

1. **Delta time** — `dt = (now - last)/1000`, clamped to `0.033` so a stutter can't teleport the
   car through a wall.
2. **Read input** → `throttle`, `steerIn`, `handbrake` (merging keyboard + touch + tilt).
3. **On/off-track test** — `nearestCenterIdx()` finds the closest centreline node (searching a
   small window around the last known index for speed) and compares the distance to `track.width`.
4. **Update physics** — `car.update(...)` (only once the player first applies throttle, so the
   clock doesn't start prematurely), then **`clampToBoundary()`** (the out-of-bounds wall) and
   **`updateSparks(dt)`** (advance collision particles).
5. **Checkpoint / lap logic** (see next section).
6. **Camera follow** (see [Camera](#9-camera)).
7. **Toast fade**, then **`render()`** and **`updateHUD()`**.
8. `requestAnimationFrame(frame)` to schedule the next frame.

---

## 8. Laps, checkpoints & timing

The centreline is sampled into `NUM_CP = 20` evenly-spaced **checkpoints** (index 0 is the
start/finish line). The player must pass them **in order** — this prevents cutting the course:

```js
const cp = track.center[checkpoints[nextCheckpoint % NUM_CP]];
if (dist(car.x, car.y, cp.x, cp.y) < track.width + 40) {
  nextCheckpoint++;
  if (nextCheckpoint % NUM_CP === 0) { /* crossed the finish line → new lap */ }
}
```

On each completed lap the code records the **lap time** (`raceTime - lapStart`), updates
**last** and **best** lap, increments the lap counter, and shows a toast. After
`TOTAL_LAPS = 3` it shows the final time and stops the clock.

Timing starts only when the player first hits the throttle (`started` flag), so reaction time
isn't unfairly counted.

---

## 9. Camera

The camera smoothly follows the car with two nice touches:

- **Look-ahead**: it targets a point *ahead* of the car based on velocity
  (`car.x + car.vx*0.35`), so you see where you're going.
- **Speed-based zoom**: it zooms out slightly at high speed (`0.62 → 0.46`) to give more
  reaction room.

Both the position and zoom are eased with `lerp` for smoothness. `worldToScreen()` converts
world coordinates to screen pixels using the camera position and zoom.

---

## 10. Rendering

All drawing is plain **HTML5 Canvas 2D**. `render()` runs every frame:

1. Fill the background with the biome grass colour.
2. Apply the camera transform (`translate` → `scale` → `translate`).
3. Draw a subtle two-tone **ground texture** (checker bands).
4. `drawTrack()` — strokes the centreline three times with decreasing width: a light **curb**,
   the dark **asphalt**, then a dashed white **centre line**.
5. `drawBoundary()` — inner + outer dashed **out-of-bounds lines** (the wall, see §6).
6. `drawSkids()` — fading black tire marks.
7. `drawProps()` — trees / cacti / pines with little shadows (vector shapes, no images).
8. `drawStartLine()` — a checkered start/finish band, rotated to the track tangent.
9. `drawCheckpoint()` — a pulsing accent-coloured gate at the *next* checkpoint.
10. `drawCar()` — the car body (gradient), windscreen, headlights, and **wheels that visually
    turn** with the steering input.
11. `drawSparks()` — additive white→orange→red **collision spark** streaks (see §6).
12. Restore the transform and draw a **vignette** (radial gradient toward the biome fog colour).
13. `drawMinimap()` (see below).

`roundRect()` is a small helper for rounded-rectangle paths (car body, pads).

---

## 11. Input systems

Three input methods all feed the **same** `throttle` / `steerIn` / `handbrake` values, so they
behave identically.

### Keyboard
A `keys{}` map is filled on `keydown`/`keyup`. Arrow keys and Space call `preventDefault()` so
the page doesn't scroll.

| Action | Keys |
|--------|------|
| Throttle | `W` / `↑` |
| Brake / reverse | `S` / `↓` |
| Steer | `A` `D` / `←` `→` |
| Handbrake (drift) | `Space` |

### Touch (auto-shown on touch devices)
On-screen pads (`‹ ›` steer, `▲` gas, `⟂` brake, `DRIFT`) use **Pointer Events** with
`setPointerCapture`, so:
- Multi-touch works (steer + accelerate + drift simultaneously), and
- A finger sliding off a button still releases cleanly (`pointercancel` / `lostpointercapture`).

The UI appears when `(pointer: coarse)` matches or on the first `touchstart`. The page is locked
against scroll/zoom via the viewport meta tag and `touch-action: none`.

### Tilt-to-steer (toggle)
A **🎮 Touch steer / 📱 Tilt steer** button (shown only on touch devices) toggles steering mode.
Touch is the default. In tilt mode:
- It listens to `deviceorientation` and maps the correct axis to a steer value **based on screen
  orientation** (portrait uses `gamma`, each landscape uses `±beta`, etc.).
- It **calibrates** to however you're holding the phone the moment you enable it (captures a
  neutral baseline and steers by the deviation from it; `22°` of tilt = full lock).
- On **iOS 13+** it calls `DeviceOrientationEvent.requestPermission()` from the button tap
  (required by Safari), failing gracefully with a toast if denied.
- A small **tilt meter** (a green dot on a bar) shows live steering input, and the on-screen
  steer buttons hide while tilt mode is active.

---

## 12. HUD & minimap

### HUD (`updateHUD()`)
Updates DOM text each frame: race time, current/last/best lap, biome, seed, and the
**speedometer** (`car.speed * 0.18` shown as km/h) with a gear-style fill bar. In tilt mode it
also positions the tilt-meter dot.

### Minimap (`drawMinimap()`)
A second small `<canvas>` that:
- Computes the track's bounding box and **fits it** into the 160×160 (or 120×120 on mobile) box,
- Draws the full track outline in the biome accent colour,
- Marks the start line (white dot) and the **car's live position** (red dot).

---

## 13. The test harness

`test.mjs` is a **headless smoke test** using [Puppeteer](https://pptr.dev/) (a real Chromium
engine). It is dev-only — not needed to play.

What it does:
1. Loads `index.html` in headless Chromium and **captures** all `console.error`, uncaught
   `pageerror`, and failed-request events.
2. Lets the game run, then simulates `W`+`D` keypresses and confirms the car **physically moved**
   and produced finite physics values (`physicsOk`).
3. Calls `buildRace(12345)` twice and checks the seed reproduces the same biome + track length
   (**determinism**), then clicks **New Race** to confirm reseeding works.
4. Asserts the track exists (>100 centreline points), there are exactly **20 checkpoints**, and a
   biome is selected.
5. **Boundary check** — teleports the car far out of bounds, runs `clampToBoundary()`, and
   confirms it gets pulled back to within `track.width + RUNOFF` of the centreline.

Run it:
```bash
npm install     # one-time: downloads Puppeteer + Chromium
node test.mjs
```
Expected output:
```
PASS — no JS errors; track, car, checkpoints, and biome all valid.
```

---

## 14. Tuning guide (common tweaks)

All the "feel" knobs are easy to find:

| Want to change… | Edit | Notes |
|-----------------|------|-------|
| Top speed | `MAXSPEED` (in `Car.update`) | Hard velocity cap |
| Acceleration | `ENGINE` | Forward force |
| Grip / drift amount | `gripKeep` values | Lower = more grip; higher = more slide |
| How slippery grass is | the off-track `gripKeep` (0.45) and `drag` (3.2) | |
| Turn rate | `STEER_RATE` | |
| Track size | `R` (base radius) in `generateTrack` | |
| Track curviness | `POINTS` count and the radius-variation range | |
| Road width | the `width` line in `generateTrack` | |
| Grass runoff before the wall | `RUNOFF` | Bigger = more room off-track; smaller = tight walls |
| Spark amount / look | `spawnSparks()` (count, speed) and `drawSparks()` (colours) | |
| Number of laps | `TOTAL_LAPS` | |
| Number of checkpoints | `NUM_CP` | |
| Biome palettes / new biomes | the `BIOMES` table | Add a key, give it colours + a `prop` |
| Scenery density | `tries` in `generateProps` | |

---

## 15. Extension ideas

- **AI opponents** that follow the centreline with a steering controller and the same physics.
- **Ghost car** replaying your best lap (record `x, y, angle` per frame).
- **Elevation / terrain** via Perlin/Simplex noise affecting grip or visuals.
- **Weather & time of day** modulating grip and lighting.
- **Persistent leaderboards** per seed (e.g. via `localStorage`).
- **Boost pads / hazards** placed procedurally along the track.

---

## 16. Glossary

- **Seed** — an integer that deterministically drives all randomness for a race.
- **PRNG** — pseudo-random number generator (here, mulberry32).
- **Centreline** — the smooth array of points down the middle of the track.
- **Catmull-Rom spline** — a curve that passes smoothly through a set of control points.
- **Tangent / normal** — direction along the track / perpendicular to it.
- **Lateral velocity** — the sideways component of the car's velocity; the grip model removes
  most of it.
- **`gripKeep`** — fraction of lateral velocity *retained* each frame (the inverse of grip).
- **Checkpoint** — an ordered gate along the track that must be passed to count a lap.
- **dt (delta time)** — seconds elapsed since the last frame; used to keep physics
  frame-rate-independent.
- **Runoff (`RUNOFF`)** — the grass margin past the asphalt you may drive on before hitting the
  out-of-bounds wall.
- **Boundary wall** — the invisible limit at `track.width + RUNOFF` from the centreline; the car
  scrapes along it instead of leaving the world.
- **Spark** — a short-lived collision particle emitted when the car strikes the boundary wall.
