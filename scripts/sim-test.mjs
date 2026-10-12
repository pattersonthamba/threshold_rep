// Headless playthrough: drives the pure simulation with scripted inputs and
// asserts that every chamber is solvable with the intended route.
import * as THREE from 'three';
import { Sim } from '../src/sim.js';

const DT = 1 / 120;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const idle = { forward: 0, strafe: 0, jump: false };

let log = [];
function step(sim, input = idle) {
  sim.step(DT, input);
  for (const e of sim.drainEvents()) {
    log.push(e.type);
    if (process.env.TRACE && (e.type === 'drop' || e.type === 'dissolve'))
      console.log(`    ${e.type} t=${sim.time.toFixed(2)} player ${fmt(sim.player.pos)} vel ${fmt(sim.player.vel)} cubes ${sim.cubes.map((c) => fmt(c.pos)).join(' ')} ${e.point ? 'at ' + fmt(e.point) : ''}`);
  }
}

function aim(sim, p) {
  const d = p.clone().sub(sim.eye());
  sim.yaw = Math.atan2(-d.x, -d.z);
  sim.pitch = Math.asin(d.y / d.length());
}

function wait(sim, seconds, until) {
  for (let t = 0; t < seconds; t += DT) {
    step(sim);
    if (until && until()) return true;
  }
  return false;
}

// Walk toward (x, z) until within tol, a teleport happens (optional) or timeout.
function walkTo(sim, x, z, { tol = 0.25, stopOnTeleport = false, seconds = 8, keepPitch = true } = {}) {
  const start = log.length;
  for (let t = 0; t < seconds; t += DT) {
    const dx = x - sim.player.pos.x, dz = z - sim.player.pos.z;
    if (Math.hypot(dx, dz) < tol) return 'arrived';
    const pitch = sim.pitch;
    sim.yaw = Math.atan2(-dx, -dz);
    if (keepPitch) sim.pitch = pitch;
    step(sim, { forward: 1, strafe: 0, jump: false });
    if (stopOnTeleport && log.slice(start).includes('teleport')) return 'teleported';
    if (sim.state !== 'playing') return sim.state;
  }
  return 'timeout';
}

// Step off a ledge toward +z, then brake with air control so we drop
// roughly straight down, the way a player taps back after walking off.
function stepOff(sim) {
  const start = log.length;
  const pitch = sim.pitch;
  sim.yaw = Math.PI;
  for (let t = 0; t < 4; t += DT) {
    sim.pitch = pitch;
    const h = Math.hypot(sim.player.vel.x, sim.player.vel.z);
    const airborne = !sim.player.onGround;
    const forward = airborne ? (h > 0.4 ? -1 : 0) : 1;
    step(sim, { forward, strafe: 0, jump: false });
    if (log.slice(start).includes('teleport')) return 'teleported';
    if (sim.state !== 'playing') return sim.state;
  }
  return 'timeout';
}

// Look forward and down off a ledge (toward +z) so a held core hangs past the edge.
function lookOver(sim) {
  sim.yaw = Math.PI;
  sim.pitch = -0.35;
  wait(sim, 0.4);
}

const anyPressed = (sim, id) => sim.buttons.some((b) => b.id === id && b.pressed);

function fire(sim, i, p) {
  aim(sim, p);
  const ok = sim.fire(i);
  for (const e of sim.drainEvents()) log.push(e.type);
  if (!ok) throw new Error(`portal ${i} rejected at ${p.toArray()}`);
}

function grabAt(sim, p) {
  aim(sim, p);
  sim.toggleGrab();
  for (const e of sim.drainEvents()) log.push(e.type);
  if (!sim.held) throw new Error('grab failed');
}

function drop(sim) {
  if (!sim.held) throw new Error('nothing held to drop');
  sim.toggleGrab();
  wait(sim, 1.0);
}

const fmt = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;

const solutions = [
  // 01 Calibration
  (s) => {
    fire(s, 1, V(0.9, 2.0, 4.5));
    fire(s, 0, V(12.1, 5.5, 4.5));
    if (walkTo(s, -1, 4.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter portal');
    wait(s, 0.6);
    return walkTo(s, 10.5, 4.5);
  },
  // 02 Counterweight
  (s) => {
    fire(s, 1, V(0.9, 2.0, 6.5));
    fire(s, 0, V(14.1, 5.5, 5.5));
    if (walkTo(s, -1, 6.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter portal');
    wait(s, 0.6);
    walkTo(s, 12.6, 5.5);
    grabAt(s, s.cubes[0].pos.clone());
    if (walkTo(s, 15, 5.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not return');
    if (!s.held) throw new Error('lost cube on the way back');
    wait(s, 0.3);
    walkTo(s, 4.5, 5.0);
    aim(s, V(4.5, 1.3, 3.5));
    wait(s, 0.4);
    drop(s);
    if (!s.buttons[0].pressed) throw new Error(`button not pressed, cube at ${fmt(s.cubes[0].pos)}`);
    wait(s, 0.6);
    walkTo(s, 6.5, 9.5);
    return walkTo(s, 6.5, 12.5);
  },
  // 03 Static Veil
  (s) => {
    walkTo(s, 8, 5);
    walkTo(s, 8, 9);
    if (s.portals.some((p) => p.placed)) throw new Error('portals should be clear');
    fire(s, 0, V(6.5, 2.0, 12.1));
    fire(s, 1, V(8.0, 2.0, 0.9));
    walkTo(s, 11.2, 9.5);
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 6.5, 10.5);
    if (walkTo(s, 6.5, 13, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter north portal');
    if (!s.held) throw new Error('lost cube');
    wait(s, 0.3);
    walkTo(s, 3.5, 5.0);
    aim(s, V(3.5, 1.3, 3.5));
    wait(s, 0.4);
    drop(s);
    if (!s.buttons[0].pressed) throw new Error(`button not pressed, cube at ${fmt(s.cubes[0].pos)}`);
    wait(s, 0.6);
    walkTo(s, 15.5, 3.5);
    return walkTo(s, 19.5, 3.5);
  },
  // 04 Momentum
  (s) => {
    walkTo(s, 3.5, 3.9, { tol: 0.05 });
    fire(s, 0, V(3.5, 0.95, 6.5));
    fire(s, 1, V(0.9, 8.0, 5.5));
    if (stepOff(s) !== 'teleported') throw new Error(`missed floor portal at ${fmt(s.player.pos)}`);
    const out = s.player.vel.clone();
    wait(s, 3, () => s.player.onGround);
    console.log(`    fling exit velocity ${fmt(out)}, landed at ${fmt(s.player.pos)}`);
    if (s.state !== 'playing') return s.state;
    return walkTo(s, 18.5, 5.5);
  },
  // 05 Updraft
  (s) => {
    fire(s, 0, V(2.5, 8.05, 4.6));
    fire(s, 1, V(0.9, 6.0, 4.5));
    walkTo(s, 2.5, 4.5, { tol: 0.1, stopOnTeleport: true, seconds: 4 });
    wait(s, 3, () => log.at(-1) === 'teleport' || s.state !== 'playing');
    const out = s.player.vel.clone();
    wait(s, 3, () => s.player.onGround);
    console.log(`    launch exit velocity ${fmt(out)}, landed at ${fmt(s.player.pos)}`);
    if (s.state !== 'playing') return s.state;
    return walkTo(s, 16.5, 4.5);
  },
  // 06 Convergence
  (s) => {
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 3.5, 3.9, { tol: 0.05 });
    fire(s, 0, V(3.5, 0.95, 6.5));
    fire(s, 1, V(0.9, 8.0, 5.5));
    aim(s, V(3.5, 0.95, 7));
    if (stepOff(s) !== 'teleported') throw new Error(`missed floor portal at ${fmt(s.player.pos)}`);
    wait(s, 3, () => s.player.onGround);
    console.log(`    landed at ${fmt(s.player.pos)}, holding cube: ${!!s.held}`);
    if (s.state !== 'playing') return s.state;
    if (!s.held) throw new Error(`lost cube in flight, cube at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 18.5, 4.0);
    aim(s, V(18.5, 1.3, 2.5));
    wait(s, 0.4);
    drop(s);
    if (!s.buttons[0].pressed) throw new Error(`button not pressed, cube at ${fmt(s.cubes[0].pos)}`);
    wait(s, 0.6);
    walkTo(s, 20.5, 7.4);
    return walkTo(s, 20.5, 10.5);
  },
  // 07 Twin Keys
  (s) => {
    walkTo(s, 4.5, 4.5);
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 8.5, 5.0);
    aim(s, V(8.5, 1.3, 3.5));
    wait(s, 0.4);
    drop(s);
    if (!s.buttons[1].pressed) throw new Error(`button b not pressed, cube at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 6.5, 1.5);
    fire(s, 0, V(13.5, 4.5, 12.1));
    fire(s, 1, V(0.9, 2.0, 6.5));
    walkTo(s, 2, 6.5);
    if (walkTo(s, -1, 6.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter west portal');
    wait(s, 1.0);
    walkTo(s, 13.5, 10.6);
    grabAt(s, s.cubes[1].pos.clone());
    walkTo(s, 12.5, 10.8);
    fire(s, 0, V(12.5, 2.0, 12.1));
    if (walkTo(s, 12.5, 13, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not leave the alcove');
    if (!s.held) throw new Error('lost cube leaving the alcove');
    wait(s, 0.3);
    walkTo(s, 4.5, 11.0);
    aim(s, V(4.5, 1.3, 9.5));
    wait(s, 0.4);
    drop(s);
    if (!s.buttons[0].pressed) throw new Error(`button a not pressed, cube at ${fmt(s.cubes[1].pos)}`);
    wait(s, 0.6);
    walkTo(s, 15.5, 3.5);
    return walkTo(s, 19.5, 3.5);
  },
  // 08 Delivery
  (s) => {
    walkTo(s, 2.0, 1.5);
    grabAt(s, s.cubes[0].pos.clone());
    fire(s, 1, V(11.5, 8.05, 4.6));
    fire(s, 0, V(2.5, 0.95, 4.8));
    walkTo(s, 2.5, 3.2, { tol: 0.1 });
    aim(s, V(2.5, 1.4, 5.2));
    wait(s, 0.4);
    drop(s);
    wait(s, 1.0);
    if (!s.buttons.some((b) => b.pressed)) throw new Error(`island button not pressed, cube at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 1.5, 3.2);
    walkTo(s, 1.5, 7.0);
    walkTo(s, 2.5, 7.4);
    return walkTo(s, 2.5, 10.5);
  },
  // 09 Periscope
  (s) => {
    fire(s, 0, V(0.9, 10.0, 6.0));
    fire(s, 1, V(0.9, 2.0, 2.0));
    walkTo(s, 6, 2.5);
    aim(s, V(1.0, 2.5, 2.5));
    const before = s.portals[0].pos.clone();
    if (!s.fire(0)) throw new Error('shot through gate rejected');
    s.drainEvents();
    if (s.portals[0].pos.x < 20) throw new Error(`gate did not land in sealed room: ${fmt(s.portals[0].pos)} (was ${fmt(before)})`);
    if (walkTo(s, -1, 2.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter low gate');
    wait(s, 1.5, () => s.player.onGround);
    return walkTo(s, 20.5, 4.5);
  },
  // 10 Sluice
  (s) => {
    walkTo(s, 3, 5);
    walkTo(s, 3, 8);
    walkTo(s, 13.2, 9.5);
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 3, 9);
    fire(s, 1, V(3.0, 2.0, 0.9));
    fire(s, 0, V(10.5, 2.0, 12.1));
    walkTo(s, 10.5, 10.5);
    if (walkTo(s, 10.5, 13, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter north gate');
    if (!s.held) throw new Error('lost cube');
    wait(s, 0.3);
    fire(s, 0, V(2.0, 0.95, 3.6));
    fire(s, 1, V(13.3, 8.05, 3.5));
    walkTo(s, 2.5, 2.3, { tol: 0.1 });
    aim(s, V(2.5, 1.3, 4.5));
    wait(s, 0.4);
    drop(s);
    wait(s, 1.0);
    if (!s.buttons[0].pressed) throw new Error(`island button not pressed, cube at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 4.5, 2.3);
    walkTo(s, 3.6, 5.3);
    walkTo(s, 3, 8);
    walkTo(s, 5.5, 11.4);
    return walkTo(s, 5.5, 14.5);
  },
  // 11 Terminal Velocity
  (s) => {
    fire(s, 1, V(2.5, 15.1, 4.6));
    fire(s, 0, V(2.5, 0.9, 4.6));
    wait(s, 2.2);
    console.log(`    loop speed ${s.player.vel.length().toFixed(1)} m/s`);
    fire(s, 1, V(0.9, 10.0, 4.5));
    const start = log.length;
    wait(s, 2, () => log.slice(start).includes('teleport') && s.player.vel.x > 5);
    const out = s.player.vel.clone();
    wait(s, 3, () => s.player.onGround);
    console.log(`    fling exit velocity ${fmt(out)}, landed at ${fmt(s.player.pos)}`);
    if (s.state !== 'playing') return s.state;
    return walkTo(s, 30.5, 4.5);
  },
  // 12 Keystone
  (s) => {
    fire(s, 0, V(0.9, 10.0, 6.0));
    fire(s, 1, V(0.9, 2.0, 2.0));
    walkTo(s, 6, 2.5);
    aim(s, V(1.0, 2.5, 2.5));
    if (!s.fire(0)) throw new Error('shot through gate rejected');
    s.drainEvents();
    if (walkTo(s, -1, 2.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter low gate');
    wait(s, 1.5, () => s.player.onGround);
    walkTo(s, 19.2, 4.5);
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 22, 4.5);
    fire(s, 0, V(25.1, 2.0, 4.5));
    if (walkTo(s, 27, 4.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not leave sealed room');
    if (!s.held) throw new Error('lost cube');
    wait(s, 0.3);
    walkTo(s, 8.5, 5.5);
    aim(s, V(8.5, 1.3, 4.5));
    wait(s, 0.4);
    drop(s);
    if (!s.buttons[0].pressed) throw new Error(`button not pressed, cube at ${fmt(s.cubes[0].pos)}`);
    wait(s, 0.6);
    walkTo(s, 10.5, 7.4);
    return walkTo(s, 10.5, 10.5);
  },
  // 13 Mail Slot
  (s) => {
    walkTo(s, 3.5, 2.5);
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 4.5, 4.8, { tol: 0.05 });
    fire(s, 1, V(0.9, 10.0, 6.5));
    fire(s, 0, V(4.5, 0.95, 7.0));
    lookOver(s);
    drop(s);
    wait(s, 3, () => anyPressed(s, 'a'));
    if (!anyPressed(s, 'a')) throw new Error(`core missed the slot, at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 1.5, 4.5);
    if (stepOff(s) === 'teleported') throw new Error('fell into the drop gate');
    wait(s, 1, () => s.player.onGround);
    walkTo(s, 1.5, 9.0);
    walkTo(s, 4.5, 9.4);
    return walkTo(s, 4.5, 12.5);
  },
  // 14 Freefall Courier
  (s) => {
    walkTo(s, 6.0, 3.0);
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 5.5, 4.5, { tol: 0.1 });
    fire(s, 1, V(5.5, 15.1, 4.6));
    fire(s, 0, V(5.5, 0.9, 4.6));
    wait(s, 2.2);
    if (!s.held) throw new Error('dropped core during the fall loop');
    fire(s, 1, V(3.9, 10.0, 4.5));
    const start = log.length;
    wait(s, 2, () => log.slice(start).includes('teleport') && s.player.vel.x > 5);
    wait(s, 3, () => s.player.onGround);
    console.log(`    landed at ${fmt(s.player.pos)}, holding core: ${!!s.held}`);
    if (s.state !== 'playing') return s.state;
    if (!s.held) throw new Error(`lost core in flight, at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 34.5, 6.6);
    aim(s, V(34.5, 1.3, 5.5));
    wait(s, 0.4);
    drop(s);
    if (!anyPressed(s, 'a')) throw new Error(`plate a not pressed, core at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 32.2, 3.5);
    grabAt(s, s.cubes[1].pos.clone());
    walkTo(s, 31.5, 3.0, { tol: 0.1 });
    aim(s, V(31.5, 1.3, 1.5));
    wait(s, 0.4);
    drop(s);
    wait(s, 4, () => anyPressed(s, 'b'));
    if (!anyPressed(s, 'b')) throw new Error(`core 2 did not reach the slot plate, at ${fmt(s.cubes[1].pos)}`);
    wait(s, 0.6);
    walkTo(s, 33.5, 7.4);
    return walkTo(s, 33.5, 10.5);
  },
  // 15 Blind Courier
  (s) => {
    walkTo(s, 5, 4.5);
    fire(s, 0, V(0.9, 10.0, 6.0));
    fire(s, 1, V(0.9, 2.0, 2.0));
    walkTo(s, 6, 2.5);
    aim(s, V(1.0, 2.5, 2.5));
    if (!s.fire(0)) throw new Error('shot through gate rejected');
    s.drainEvents();
    if (s.portals[0].pos.x < 20) throw new Error('periscope shot did not reach the sealed room');
    if (walkTo(s, -1, 2.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not enter low gate');
    wait(s, 1.5, () => s.player.onGround);
    walkTo(s, 22.2, 4.5);
    grabAt(s, s.cubes[0].pos.clone());
    fire(s, 0, V(20.5, 0.95, 4.6));
    const t0 = log.length;
    walkTo(s, 20.5, 4.5, { stopOnTeleport: true });
    wait(s, 1.5, () => log.slice(t0).includes('teleport'));
    if (!log.slice(t0).includes('teleport')) throw new Error(`did not drop into floor gate, at ${fmt(s.player.pos)}`);
    if (!s.held) throw new Error('lost core leaving the sealed room');
    wait(s, 0.5);
    fire(s, 0, V(15.1, 2.0, 4.5));
    if (walkTo(s, -1, 2.5, { stopOnTeleport: true }) !== 'teleported') throw new Error('did not bypass the veil');
    if (!s.held) throw new Error('lost core bypassing the veil');
    if (s.player.pos.x < 9) throw new Error('ended up on the wrong side of the veil');
    wait(s, 0.3);
    walkTo(s, 12.5, 5.0);
    aim(s, V(12.5, 1.3, 6.6));
    wait(s, 0.4);
    drop(s);
    if (!anyPressed(s, 'a')) throw new Error(`plate not pressed, core at ${fmt(s.cubes[0].pos)}`);
    wait(s, 0.6);
    walkTo(s, 12.5, 7.4);
    return walkTo(s, 12.5, 10.5);
  },
  // 16 Event Horizon
  (s) => {
    walkTo(s, 3.5, 2.6);
    grabAt(s, s.cubes[0].pos.clone());
    walkTo(s, 4.5, 4.8, { tol: 0.05 });
    fire(s, 1, V(0.9, 10.0, 6.5));
    fire(s, 0, V(4.5, 0.95, 7.0));
    lookOver(s);
    drop(s);
    wait(s, 3, () => anyPressed(s, 'a'));
    if (!anyPressed(s, 'a')) throw new Error(`core A missed the slot, at ${fmt(s.cubes[0].pos)}`);
    walkTo(s, 2.5, 2.6);
    grabAt(s, s.cubes[1].pos.clone());
    walkTo(s, 4.5, 4.8, { tol: 0.05 });
    fire(s, 1, V(12.5, 17.05, 1.6));
    lookOver(s);
    drop(s);
    wait(s, 3, () => anyPressed(s, 'b'));
    if (!anyPressed(s, 'b')) throw new Error(`core B missed the island, at ${fmt(s.cubes[1].pos)}`);
    walkTo(s, 1.5, 4.5);
    if (stepOff(s) === 'teleported') throw new Error('fell into the drop gate');
    wait(s, 1, () => s.player.onGround);
    walkTo(s, 1.5, 9.0);
    walkTo(s, 4.5, 9.4);
    return walkTo(s, 4.5, 12.5);
  },
];

let failed = 0;
const sim = new Sim();
const only = process.env.ONLY ? process.env.ONLY.split(',').map(Number) : null;
for (let i = 0; i < sim.levelCount; i++) {
  if (only && !only.includes(i + 1)) continue;
  log = [];
  sim.load(i);
  wait(sim, 0.5);
  let result;
  try {
    result = solutions[i](sim);
    if (sim.state === 'playing') wait(sim, 0.5, () => sim.state !== 'playing');
    result = sim.state;
  } catch (err) {
    result = `error: ${err.message}`;
  }
  const ok = result === 'complete';
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} chamber ${i + 1}: ${result} | player ${fmt(sim.player.pos)} | events ${[...new Set(log)].join(',')}`);
}
process.exit(failed ? 1 : 0);
