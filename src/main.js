import * as THREE from 'three';
import { Sim } from './sim.js';
import { View } from './view.js';
import { Sfx } from './audio.js';
import { LEVELS, ENDING } from './levels.js';
import { PORTAL_COLORS } from './view.js';

const $ = (id) => document.getElementById(id);
const FIXED = 1 / 120;
const STORE = 'threshold.v1';

// ------------------------------------------------------------- settings

const defaults = { sens: 1, fov: 80, quality: 0.75, vol: 0.6, invert: false, fps: false, unlocked: 0 };
let settings = { ...defaults };
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(STORE) || '{}'));
} catch {}
const save = () => {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {}
};

// ------------------------------------------------------------- core

const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight, false);

const sim = new Sim();
const view = new View(renderer);
const sfx = new Sfx();
view.camera.fov = settings.fov;
view.setQuality(settings.quality);
sfx.setVolume(settings.vol);

function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  view.resize();
}
window.addEventListener('resize', onResize);

let mode = 'menu'; // menu | playing | paused | card
let current = Math.min(settings.unlocked, LEVELS.length - 1);
let captionTimer = null;

function loadLevel(i) {
  current = i;
  sim.load(i);
  view.buildLevel(sim);
  $('chamber-tag').textContent = `CHAMBER ${String(i + 1).padStart(2, '0')} / ${LEVELS[i].name.toUpperCase()}`;
  showCard(`CHAMBER ${String(i + 1).padStart(2, '0')}`, LEVELS[i].name, 1800);
  playLines(LEVELS[i].lines);
}

function playLines(lines) {
  clearTimeout(captionTimer);
  const el = $('caption');
  let k = 0;
  const next = () => {
    if (k >= lines.length) {
      el.classList.remove('show');
      return;
    }
    el.innerHTML = `<b>MERIDIAN</b>${lines[k]}`;
    el.classList.add('show');
    const ms = 2600 + lines[k].length * 45;
    k++;
    captionTimer = setTimeout(() => {
      el.classList.remove('show');
      captionTimer = setTimeout(next, 450);
    }, ms);
  };
  captionTimer = setTimeout(next, 900);
}

function showCard(title, sub, ms) {
  const c = $('card');
  c.innerHTML = `<small>${sub}</small>${title}`;
  c.classList.remove('hidden');
  c.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: ms, fill: 'forwards' });
  setTimeout(() => c.classList.add('hidden'), ms);
}

function flash(color, ms = 500) {
  const f = $('flash');
  f.style.transition = 'none';
  f.style.background = color;
  f.style.opacity = '0.55';
  requestAnimationFrame(() => {
    f.style.transition = `opacity ${ms}ms`;
    f.style.opacity = '0';
  });
}

// ------------------------------------------------------------- input

const keys = new Set();
let jumpQueued = false;

function lock() {
  sfx.init();
  const p = canvas.requestPointerLock?.();
  if (p && p.catch) p.catch(() => {});
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    if (mode === 'paused' || mode === 'menu') setMode('playing');
  } else if (mode === 'playing') {
    setMode('paused');
  }
});

document.addEventListener('mousemove', (e) => {
  if (mode !== 'playing' || document.pointerLockElement !== canvas) return;
  const k = 0.0022 * settings.sens;
  sim.yaw -= e.movementX * k;
  sim.pitch -= e.movementY * k * (settings.invert ? -1 : 1);
  sim.pitch = Math.max(-1.55, Math.min(1.55, sim.pitch));
});

canvas.addEventListener('mousedown', (e) => {
  if (mode !== 'playing') return;
  if (document.pointerLockElement !== canvas) return lock();
  if (e.button === 0) sim.fire(0);
  else if (e.button === 2) sim.fire(1);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (mode !== 'playing') return;
  if (e.code === 'Space') {
    jumpQueued = true;
    e.preventDefault();
  }
  if (e.code === 'KeyE' || e.code === 'KeyF') sim.toggleGrab();
  if (e.code === 'KeyR') loadLevel(current);
  if (e.code === 'KeyQ') sim.fire(0);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput() {
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const jump = jumpQueued || keys.has('Space');
  jumpQueued = false;
  return { forward: f, strafe: s, jump };
}

// ------------------------------------------------------------- UI

function setMode(m) {
  mode = m;
  $('menu').classList.toggle('hidden', m !== 'menu');
  $('pause').classList.toggle('hidden', m !== 'paused');
  $('hud').classList.toggle('hidden', m === 'menu');
}

function showMenuSection(id) {
  for (const s of ['menu-main', 'menu-chambers', 'menu-settings']) $(s).classList.toggle('hidden', s !== id);
}

function buildChamberGrid() {
  const grid = $('chamber-grid');
  grid.innerHTML = '';
  LEVELS.forEach((L, i) => {
    const b = document.createElement('button');
    b.innerHTML = `${String(i + 1).padStart(2, '0')}<small>${L.name}</small>`;
    b.disabled = i > settings.unlocked;
    b.onclick = () => start(i);
    grid.appendChild(b);
  });
}

function start(i) {
  loadLevel(i);
  setMode('playing');
  lock();
}

$('btn-play').textContent = settings.unlocked > 0 ? `Continue: chamber ${String(current + 1).padStart(2, '0')}` : 'Begin';
$('btn-play').onclick = () => start(current);
$('btn-chambers').onclick = () => {
  buildChamberGrid();
  showMenuSection('menu-chambers');
};
$('btn-settings').onclick = () => showMenuSection('menu-settings');
document.querySelectorAll('.back').forEach((b) => (b.onclick = () => showMenuSection('menu-main')));
$('btn-resume').onclick = () => lock();
$('btn-restart').onclick = () => {
  loadLevel(current);
  lock();
};
$('btn-quit').onclick = () => {
  attract();
  setMode('menu');
  showMenuSection('menu-main');
};

function bindSetting(id, key, parse = Number, prop = 'value') {
  const el = $(id);
  el[prop] = settings[key];
  el.addEventListener('input', () => {
    settings[key] = parse(el[prop]);
    save();
    applySettings();
  });
}
function applySettings() {
  view.camera.fov = settings.fov;
  view.camera.updateProjectionMatrix();
  view.setQuality(settings.quality);
  sfx.setVolume(settings.vol);
  $('fps').classList.toggle('hidden', !settings.fps);
}
bindSetting('set-sens', 'sens');
bindSetting('set-fov', 'fov');
bindSetting('set-quality', 'quality');
bindSetting('set-vol', 'vol');
bindSetting('set-invert', 'invert', Boolean, 'checked');
bindSetting('set-fps', 'fps', Boolean, 'checked');
applySettings();

if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) {
  $('unsupported').classList.remove('hidden');
}

// ------------------------------------------------------------- events


function handleEvents() {
  for (const e of sim.drainEvents()) {
    sfx.play(e);
    switch (e.type) {
      case 'place':
        view.spark(e.point, PORTAL_COLORS[e.i]);
        break;
      case 'reject':
        view.spark(e.point, 0x888888);
        break;
      case 'dissolve':
        view.spark(e.point, 0x8fd6ff);
        break;
      case 'portalsCleared':
        flash('rgba(143,214,255,0.4)', 400);
        break;
      case 'death':
        flash('rgba(255,120,30,0.8)', 900);
        break;
      case 'complete':
        settings.unlocked = Math.max(settings.unlocked, Math.min(current + 1, LEVELS.length - 1));
        save();
        flash('rgba(166,255,207,0.35)', 700);
        if (current + 1 < LEVELS.length) showCard('CHAMBER CLEARED', 'MERIDIAN', 1400);
        else showCard('EVALUATION COMPLETE', 'MERIDIAN', 4000);
        break;
    }
  }
  const [a, b] = sim.portals;
  document.querySelector('#reticle .left').classList.toggle('on', a.placed);
  document.querySelector('#reticle .right').classList.toggle('on', b.placed);
}

function handleState() {
  if (sim.state === 'dead' && sim.stateTimer > 0.9) loadLevel(current);
  if (sim.state === 'complete' && sim.stateTimer > 1.5) {
    if (current + 1 < LEVELS.length) {
      loadLevel(current + 1);
    } else if (sim.stateTimer > 1.6 && mode === 'playing') {
      playLines([ENDING]);
      sim.state = 'ended';
    }
  }
}

// ------------------------------------------------------------- loop

let last = performance.now();
let acc = 0;
let fpsFrames = 0, fpsTime = 0;

// Attract scene behind the menu: chamber 1 with a live gate pair.
let attractYaw = 0;
function attract() {
  sim.load(0);
  const aimAt = (x, y, z) => {
    const d = new THREE.Vector3(x, y, z).sub(sim.eye());
    sim.yaw = Math.atan2(-d.x, -d.z);
    sim.pitch = Math.asin(d.y / d.length());
  };
  aimAt(0.9, 2.0, 4.5);
  sim.fire(1);
  aimAt(12.1, 5.5, 4.5);
  sim.fire(0);
  sim.drainEvents();
  // Watch from the ledge: the low gate shows the view out of the high one.
  sim.player.pos.set(10.2, 4.851, 4.5);
  sim.player.resetPortalHistory();
  aimAt(1, 2, 4.5);
  attractYaw = sim.yaw;
  view.buildLevel(sim);
}
attract();
// #attract hides the UI: handy for trailers, screenshots and visual checks.
if (location.hash === '#attract' || location.pathname.endsWith('/attract')) $('menu').classList.add('hidden');

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  if (mode === 'playing') {
    acc += dt;
    const input = readInput();
    let first = true;
    while (acc >= FIXED) {
      sim.step(FIXED, first ? input : { ...input, jump: input.jump && keys.has('Space') });
      first = false;
      acc -= FIXED;
    }
    handleEvents();
    handleState();
  } else {
    // Idle camera sway behind the menu.
    if (mode === 'menu') sim.yaw = attractYaw + Math.sin(now / 4000) * 0.25;
  }

  view.sync(sim, dt);
  view.render(sim);

  if (settings.fps) {
    fpsFrames++;
    fpsTime += dt;
    if (fpsTime > 0.5) {
      $('fps').textContent = `${Math.round(fpsFrames / fpsTime)} fps`;
      fpsFrames = 0;
      fpsTime = 0;
    }
  }
}
requestAnimationFrame(frame);

window.__threshold = { sim, view };
