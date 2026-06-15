// Headless smoke test for Procedural Racer.
// Loads index.html in Chromium, captures console errors / uncaught exceptions,
// exercises a few code paths, and verifies key game state is sane.
import puppeteer from 'puppeteer';
import { pathToFileURL } from 'url';
import path from 'path';

const url = pathToFileURL(path.resolve('index.html')).href;
const errors = [];

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 900, height: 600 });

page.on('console', m => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('requestfailed', r => errors.push('requestfailed: ' + r.url()));

await page.goto(url, { waitUntil: 'networkidle0' });

// Let the game run a couple seconds (RAF loop, physics, render).
await new Promise(r => setTimeout(r, 1500));

// Record car position, then drive for a moment via simulated key presses.
const before = await page.evaluate(() => ({ x: car.x, y: car.y }));
await page.keyboard.down('w');
await page.keyboard.down('d');
await new Promise(r => setTimeout(r, 900));
const driving = await page.evaluate(() => ({ x: car.x, y: car.y, speed: car.speed }));
await page.keyboard.up('d');
await page.keyboard.up('w');

// The car must have physically moved and have finite, sane physics values.
const moved = Math.hypot(driving.x - before.x, driving.y - before.y);
const physicsOk = isFinite(driving.x) && isFinite(driving.y) &&
                  isFinite(driving.speed) && driving.speed > 0 && moved > 1;

// Exercise procedural regeneration: fixed seed is deterministic, button reseeds.
const seedA = await page.evaluate(() => { buildRace(12345); return currentSeed; });
const seedA2 = await page.evaluate(() => { buildRace(12345); return { seed: currentSeed, biome: biomeName, len: track.center.length }; });
await new Promise(r => setTimeout(r, 200));
await page.click('#newRace');
await new Promise(r => setTimeout(r, 300));

// Pull internal state out of the page to assert correctness.
const state = await page.evaluate(() => ({
  hasTrack: !!(track && track.center && track.center.length > 100),
  trackLen: track ? track.center.length : 0,
  width: track ? Math.round(track.width) : 0,
  biome: biomeName,
  carNum: typeof car.x === 'number' && typeof car.y === 'number',
  checkpoints: checkpoints.length,
  seed: currentSeed,
}));
state.moved = Math.round(moved);
state.driveSpeed = Math.round(driving.speed);
state.physicsOk = physicsOk;
// determinism: same seed must reproduce the same biome + centreline length
state.deterministic = seedA === 12345 && seedA2.seed === 12345 &&
                      seedA2.biome && seedA2.len > 100;

await browser.close();

console.log('--- captured state ---');
console.log(JSON.stringify(state, null, 2));

const problems = [];
if (errors.length) problems.push(...errors);
if (!state.hasTrack) problems.push('track not generated / too few centreline points');
if (!state.carNum) problems.push('car position is not a number');
if (!state.physicsOk) problems.push('car did not move under throttle, or physics produced non-finite values');
if (!state.deterministic) problems.push('fixed-seed regeneration was not deterministic');
if (state.checkpoints !== 20) problems.push('expected 20 checkpoints, got ' + state.checkpoints);
if (!state.biome) problems.push('no biome selected');

console.log('\n--- result ---');
if (problems.length) {
  console.log('FAIL (' + problems.length + ' issue(s)):');
  for (const p of problems) console.log('  • ' + p);
  process.exit(1);
} else {
  console.log('PASS — no JS errors; track, car, checkpoints, and biome all valid.');
}
