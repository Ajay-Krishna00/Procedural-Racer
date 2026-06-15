# 🏎️ Procedural Racer

An arcade car-racing game where **every race is a brand-new world**. It combines two
systems:

1. **Procedural generation** — a seeded random number generator builds a unique
   closed-loop race track (random points → relaxed → smoothed with a Catmull-Rom
   spline), then picks a **biome** (meadow / desert / snow / night) and scatters
   matching scenery (trees, cacti, snowy pines). Same seed = same world, so tracks
   are shareable and replayable.
2. **Vehicle physics** — a top-down car model with engine force, drag, speed-scaled
   steering, and a **tire-grip model** that splits velocity into forward vs. lateral
   components. Killing most of the lateral velocity *is* grip — reduce it and you get
   real understeer/oversteer, plus a **handbrake drift** with skid marks.

Race **3 laps** against the clock and chase your best lap time.

---

## ▶️ How to run locally

The game is a single self-contained `index.html` — **no build step, no dependencies**
needed to play.

### Option 1 — just open the file (fastest)
Double-click `index.html`, or open it in your browser:

```
# Windows
start index.html
```

That's it. Everything (graphics, physics, procedural generation) runs in the browser.

### Option 2 — local web server (recommended for phones / sharing)
Opening a raw file won't load on another device. Serve the folder over your network:

```bash
# from inside the ProceduralRacer/ folder
python -m http.server 8000
```

Then visit:
- On this PC: <http://localhost:8000>
- On your phone (same Wi-Fi): `http://<your-PC-IP>:8000`
  (find the IP with `ipconfig` on Windows)

Any static server works (`npx serve`, VS Code Live Server, etc.).

---

## 🎮 Controls

### Keyboard
| Key | Action |
|-----|--------|
| `W` / `↑` | Throttle |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake (drift) |

### Touch (phones / tablets — controls appear automatically)
- On-screen **‹ ›** steer buttons, **▲** gas, **⟂** brake, and a **DRIFT** pad.
- Multi-touch: hold gas + steer + drift at the same time.
- **Steering toggle** (top of screen): switch between **🎮 Touch steer** (default) and
  **📱 Tilt steer**, which uses the phone's accelerometer. Tilt mode calibrates to
  however you're holding the device the moment you enable it.

---

## 🔁 Tracks & seeds

- **↻ New Race** — generate a fresh random track + biome.
- **⟲ Restart** — replay the *current* track from the start line.
- Type a **seed** (a number or any word) in the seed box, then **New Race**, to load a
  specific reproducible world. Share the seed and a friend gets the exact same track.

---

## 🧪 Running the test (optional, dev only)

A headless smoke test confirms there are no JS errors and that the track, physics,
checkpoints, biome, and seed-determinism all work. It uses
[Puppeteer](https://pptr.dev/) (a real Chromium engine):

```bash
npm install     # installs Puppeteer (downloads Chromium, one-time)
node test.mjs
```

Expected output:

```
PASS — no JS errors; track, car, checkpoints, and biome all valid.
```

> `node_modules/` is git-ignored — it's only needed for the test, not to play.

---

## 📁 Files

| File | Purpose |
|------|---------|
| `index.html` | The entire game (rendering, physics, procedural generation, input) |
| `test.mjs` | Headless Puppeteer smoke test |
| `package.json` | Dev dependency (Puppeteer) for the test |
| `.gitignore` | Ignores `node_modules/`, caches, OS/editor cruft |

---

## 🛠️ Tech

Plain HTML5 `<canvas>` + vanilla JavaScript. No frameworks, no assets — all graphics
are drawn procedurally at runtime.
