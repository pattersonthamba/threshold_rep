import * as THREE from 'three';
import { PANEL, GOO } from './world.js';
import { buildLevel, LEVELS } from './levels.js';

// Pure simulation: no DOM, no WebGL. Runs at a fixed step so physics
// (and the headless test in scripts/) is deterministic.
const V3 = THREE.Vector3;

export const PHYS = {
  gravity: 20,
  jump: 7.2,
  walk: 5.5,
  groundAcc: 60,
  groundFric: 28,
  airAcc: 10,
  terminal: 40,
  holdDist: 1.6,
};

const PORTAL_HALF_W = 0.5;
const PORTAL_HALF_H = 1.0;
const R180 = new THREE.Matrix4().makeRotationY(Math.PI);
const _a = new V3(), _b = new V3(), _c = new V3(), _d = new V3();

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const halfAlong = (axis, half) =>
  Math.abs(axis.x) * half.x + Math.abs(axis.y) * half.y + Math.abs(axis.z) * half.z;

export class PortalState {
  constructor(i) {
    this.i = i;
    this.placed = false;
    this.pos = new V3();
    this.n = new V3();
    this.up = new V3();
    this.right = new V3();
    this.basis = new THREE.Matrix4();
    this.basisInv = new THREE.Matrix4();
    this.toOther = new THREE.Matrix4();
    this.toOther3 = new THREE.Matrix3();
    this.cellSet = new Set();
    this.other = null;
    this.version = 0;
  }

  get linked() {
    return this.placed && this.other.placed;
  }

  set(pos, n, up, cells, world) {
    this.pos.copy(pos);
    this.n.copy(n);
    this.up.copy(up);
    this.right.crossVectors(up, n);
    this.basis.makeBasis(this.right, this.up, this.n).setPosition(pos);
    this.basisInv.copy(this.basis).invert();
    this.cellSet = new Set(cells.map((c) => world.index(c[0], c[1], c[2])));
    this.placed = true;
    this.version++;
  }

  clear() {
    if (!this.placed) return;
    this.placed = false;
    this.cellSet.clear();
    this.version++;
  }

  // Maps space in front of this portal to space in front of the other one.
  updateTransform() {
    if (!this.linked) return;
    this.toOther.multiplyMatrices(this.other.basis, R180).multiply(this.basisInv);
    this.toOther3.setFromMatrix4(this.toOther);
  }

  local(p) {
    _d.subVectors(p, this.pos);
    return [_d.dot(this.right), _d.dot(this.up), _d.dot(this.n)];
  }
}

class Body {
  constructor(hx, hy, hz) {
    this.pos = new V3();
    this.vel = new V3();
    this.half = new V3(hx, hy, hz);
    this.onGround = false;
    this.resetPortalHistory();
  }

  resetPortalHistory() {
    this.prev = [[NaN, NaN], [NaN, NaN]];
  }
}

export class Sim {
  constructor() {
    this.portals = [new PortalState(0), new PortalState(1)];
    this.portals[0].other = this.portals[1];
    this.portals[1].other = this.portals[0];
    this.events = [];
    this.yaw = 0;
    this.pitch = 0;
  }

  get levelCount() {
    return LEVELS.length;
  }

  load(index) {
    const L = buildLevel(index);
    this.levelIndex = index;
    this.world = L.world;
    this.time = 0;
    this.state = 'playing';
    this.stateTimer = 0;
    this.events.length = 0;
    this.portals.forEach((p) => p.clear());

    this.player = new Body(0.3, 0.85, 0.3);
    this.player.pos.set(L.spawn.pos[0], L.spawn.pos[1] + 0.851, L.spawn.pos[2]);
    this.yaw = L.spawn.yaw;
    this.pitch = 0;
    this.held = null;

    this.cubes = L.cubes.map((c, k) => {
      const b = new Body(0.3, 0.3, 0.3);
      b.id = k;
      b.spawn = new V3(c[0], c[1] + 0.301, c[2]);
      b.pos.copy(b.spawn);
      b.through = false;
      return b;
    });
    this.buttons = L.buttons.map((b) => ({ cell: b.cell, id: b.id, pressed: false }));
    this.doors = L.doors.map((d) => ({ cells: d.cells, ids: d.ids, open: false, progress: 0, solid: true }));
    for (const d of this.doors) for (const c of d.cells) this.world.doors.set(this.world.index(...c), d);
    this.fields = L.fields;
    this.exits = L.exits;
    this.pads = L.pads.map((p) => ({ cell: p.cell, vel: new V3(...p.vel), cooldown: 0 }));
  }

  emit(type, data = {}) {
    this.events.push({ type, ...data });
  }

  eye(out = new V3()) {
    return out.copy(this.player.pos).setY(this.player.pos.y + 0.65);
  }

  forward(out = new V3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  // ---------------------------------------------------------------- portals

  fire(i) {
    if (this.state !== 'playing') return false;
    let origin = this.eye(new V3());
    let f = this.forward(new V3());
    let hit = this.world.raycast(origin, f, 160);
    // A shot that enters the partner gate continues out of the gate being
    // fired, so surfaces only visible through a gate can still be reached.
    for (let hop = 0; hop < 4 && hit; hop++) {
      const through = this.gateAt(hit);
      if (!through || through.i === i) break;
      origin = hit.point.clone().applyMatrix4(through.toOther);
      f = f.clone().applyMatrix3(through.toOther3).normalize();
      origin.addScaledVector(f, 0.01);
      hit = this.world.raycast(origin, f, 160);
    }
    this.emit('shoot', { i });
    if (!hit || (hit.normal[0] === 0 && hit.normal[1] === 0 && hit.normal[2] === 0)) return false;
    const placement = hit.type === PANEL ? this.placement(hit, f, i) : null;
    if (!placement) {
      this.emit('reject', { i, point: hit.point });
      return false;
    }
    const p = this.portals[i];
    p.set(placement.pos, placement.n, placement.up, placement.cells, this.world);
    this.portals.forEach((q) => q.updateTransform());
    for (const b of this.bodies()) b.resetPortalHistory();
    this.emit('place', { i, point: placement.pos.clone() });
    return true;
  }

  gateAt(hit) {
    const idx = this.world.index(hit.cell[0], hit.cell[1], hit.cell[2]);
    for (const p of this.portals) {
      if (!p.linked || !p.cellSet.has(idx)) continue;
      if (p.n.x !== hit.normal[0] || p.n.y !== hit.normal[1] || p.n.z !== hit.normal[2]) continue;
      const [lr, lu] = p.local(hit.point);
      if (Math.abs(lr) <= PORTAL_HALF_W && Math.abs(lu) <= PORTAL_HALF_H) return p;
    }
    return null;
  }

  placement(hit, f, i) {
    const n = new V3(...hit.normal);
    if (n.y === 0) return this.placeAlong(hit, n, new V3(0, 1, 0), i);
    // Floor and ceiling gates follow the view axis, falling back to the
    // other horizontal axis when the surface is too narrow that way.
    const alongX = Math.abs(f.x) > Math.abs(f.z);
    const ax = new V3(Math.sign(f.x) || 1, 0, 0), az = new V3(0, 0, Math.sign(f.z) || 1);
    return this.placeAlong(hit, n, alongX ? ax : az, i) || this.placeAlong(hit, n, alongX ? az : ax, i);
  }

  placeAlong(hit, n, up, i) {
    const w = this.world;
    const axis = up.x !== 0 ? 0 : up.y !== 0 ? 1 : 2;
    const nAxis = n.x !== 0 ? 0 : n.y !== 0 ? 1 : 2;
    const c = hit.cell;
    const frac = hit.point.getComponent(axis) - c[axis];
    const orders = frac >= 0.5 ? [[0, 1], [-1, 0]] : [[-1, 0], [0, 1]];
    const other = this.portals[1 - i];
    for (const offsets of orders) {
      const cells = offsets.map((o) => {
        const cc = c.slice();
        cc[axis] += o;
        return cc;
      });
      const ok = cells.every(
        (cc) => w.get(cc[0], cc[1], cc[2]) === PANEL && !w.isSolid(cc[0] + n.x, cc[1] + n.y, cc[2] + n.z),
      );
      if (!ok) continue;
      if (other.placed && other.n.equals(n) && cells.some((cc) => other.cellSet.has(w.index(cc[0], cc[1], cc[2])))) continue;
      const pos = new V3();
      for (let k = 0; k < 3; k++) {
        if (k === nAxis) pos.setComponent(k, n.getComponent(k) > 0 ? c[k] + 1 : c[k]);
        else pos.setComponent(k, (cells[0][k] + cells[1][k] + 1) / 2);
      }
      return { pos, n, up, cells };
    }
    return null;
  }

  clearPortals() {
    const had = this.portals.some((p) => p.placed);
    this.portals.forEach((p) => p.clear());
    if (had) this.emit('portalsCleared');
  }

  inOpening(p, b, margin) {
    const [lr, lu, ln] = p.local(b.pos);
    const hr = halfAlong(p.right, b.half), hu = halfAlong(p.up, b.half);
    return (
      Math.abs(lr) <= PORTAL_HALF_W - hr + margin &&
      Math.abs(lu) <= PORTAL_HALF_H - hu + margin &&
      ln < 1.5 && ln > -1.5
    );
  }

  // The hole behind a gate is a few cells deep (including out-of-bounds
  // cells), so a body at terminal velocity can overshoot the gate plane for a
  // step without hitting whatever is behind the wall.
  ignoreCell(b, x, y, z) {
    const w = this.world;
    for (const p of this.portals) {
      if (!p.linked) continue;
      for (let k = 0; k < 3; k++) {
        const cx = x + p.n.x * k, cy = y + p.n.y * k, cz = z + p.n.z * k;
        if (w.inBounds(cx, cy, cz) && p.cellSet.has(w.index(cx, cy, cz))) {
          if (this.inOpening(p, b, 0.06)) return true;
          break;
        }
      }
    }
    return false;
  }

  // Gently centres a body that is heading into an opening so it does not
  // snag on the wall around the portal.
  assist(b, dt) {
    for (const p of this.portals) {
      if (!p.linked) continue;
      const [lr, lu, ln] = p.local(b.pos);
      const inward = -b.vel.dot(p.n);
      if (inward <= 0) continue;
      // Fast bodies get a deeper capture zone so a long fall still lines up.
      if (ln <= 0 || ln > 1.2 + inward * 0.15 || Math.abs(lr) > PORTAL_HALF_W || Math.abs(lu) > PORTAL_HALF_H) continue;
      const k = Math.min(1, 14 * dt);
      const mr = Math.max(0, PORTAL_HALF_W - halfAlong(p.right, b.half) - 0.01);
      b.pos.addScaledVector(p.right, (clamp(lr, -mr, mr) - lr) * k);
      if (Math.abs(p.up.y) < 0.5) {
        const mu = Math.max(0, PORTAL_HALF_H - halfAlong(p.up, b.half) - 0.01);
        b.pos.addScaledVector(p.up, (clamp(lu, -mu, mu) - lu) * k);
      }
    }
  }

  checkTeleport(b, offsets) {
    for (const p of this.portals) {
      if (!p.linked) continue;
      for (let k = 0; k < offsets.length; k++) {
        _a.copy(b.pos);
        _a.y += offsets[k];
        const [lr, lu, ln] = p.local(_a);
        const prev = b.prev[p.i][k];
        b.prev[p.i][k] = ln;
        if (prev >= 0 && ln < 0 && Math.abs(lr) <= PORTAL_HALF_W + 0.1 && Math.abs(lu) <= PORTAL_HALF_H + 0.1) {
          this.teleport(b, p);
          return p;
        }
      }
    }
    return null;
  }

  teleport(b, p) {
    const q = p.other;
    b.pos.applyMatrix4(p.toOther);
    b.vel.applyMatrix3(p.toOther3);
    const [lr, lu, ln] = q.local(b.pos);
    const hn = halfAlong(q.n, b.half), hr = halfAlong(q.right, b.half), hu = halfAlong(q.up, b.half);
    const mr = Math.max(0, PORTAL_HALF_W - hr), mu = Math.max(0, PORTAL_HALF_H - hu);
    b.pos
      .addScaledVector(q.n, Math.max(0, hn + 0.02 - ln))
      .addScaledVector(q.right, clamp(lr, -mr, mr) - lr)
      .addScaledVector(q.up, clamp(lu, -mu, mu) - lu);
    b.resetPortalHistory();
    // A held core re-forms at the hold point on the far side.
    if (b === this.player && this.held) this.held.through = true;
    if (b === this.player) {
      const f = this.forward(_b).applyMatrix3(p.toOther3);
      this.pitch = Math.asin(clamp(f.y, -1, 1));
      if (Math.abs(f.y) < 0.999) {
        this.yaw = Math.atan2(-f.x, -f.z);
      } else {
        const r = _c.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw)).applyMatrix3(p.toOther3);
        this.yaw = Math.atan2(-r.z, r.x);
      }
      this.pitch = clamp(this.pitch, -1.55, 1.55);
      this.emit('teleport', { i: p.i });
    }
  }

  moveBody(b, dt, offsets) {
    this.assist(b, dt);
    const ignore = (x, y, z) => this.ignoreCell(b, x, y, z);
    const w = this.world;
    b.onGround = false;
    if (w.sweep(b.pos, b.half, 0, b.vel.x * dt, ignore)) b.vel.x = 0;
    if (w.sweep(b.pos, b.half, 2, b.vel.z * dt, ignore)) b.vel.z = 0;
    if (w.sweep(b.pos, b.half, 1, b.vel.y * dt, ignore)) {
      if (b.vel.y < 0) b.onGround = true;
      b.vel.y = 0;
    }
    return offsets.length ? this.checkTeleport(b, offsets) : null;
  }

  // ---------------------------------------------------------------- objects

  *bodies() {
    yield this.player;
    yield* this.cubes;
  }

  toggleGrab() {
    if (this.state !== 'playing') return;
    if (this.held) {
      this.held.vel.copy(this.player.vel);
      this.held = null;
      this.emit('drop');
      return;
    }
    const eye = this.eye(new V3());
    const f = this.forward(new V3());
    const wall = this.world.raycast(eye, f, 3);
    let best = null, bestT = wall ? wall.t : 2.6;
    for (const c of this.cubes) {
      _a.subVectors(c.pos, eye);
      const t = _a.dot(f);
      if (t <= 0 || t > Math.min(bestT, 2.6)) continue;
      if (_a.addScaledVector(f, -t).length() < 0.5) {
        best = c;
        bestT = t;
      }
    }
    if (best) {
      this.held = best;
      best.through = false;
      this.emit('grab');
    }
  }

  respawnCube(c) {
    if (this.held === c) this.held = null;
    this.emit('dissolve', { point: c.pos.clone() });
    c.pos.copy(c.spawn);
    c.vel.set(0, 0, 0);
    c.through = false;
    c.resetPortalHistory();
  }

  stepHeld(dt) {
    const c = this.held;
    const eye = this.eye(_a);
    const f = this.forward(_b);
    const target = _c.copy(eye).addScaledVector(f, PHYS.holdDist);
    let through = null;
    for (const p of this.portals) {
      if (!p.linked) continue;
      const d0 = p.local(eye)[2];
      const d1 = p.local(target)[2];
      if (d0 > 0 && d1 <= 0) {
        const x = _d.copy(eye).lerp(target, d0 / (d0 - d1));
        const [lr, lu] = p.local(x);
        if (Math.abs(lr) <= PORTAL_HALF_W && Math.abs(lu) <= PORTAL_HALF_H) {
          through = p;
          break;
        }
      }
    }
    if (through) {
      c.pos.copy(target).applyMatrix4(through.toOther);
      c.vel.set(0, 0, 0);
      c.through = true;
      c.resetPortalHistory();
      return;
    }
    // Keep the hold point out of walls so the core never starts inside one.
    const wall = this.world.raycast(eye, f, PHYS.holdDist + 0.5);
    if (wall && wall.t < PHYS.holdDist + 0.35) target.copy(eye).addScaledVector(f, Math.max(0.35, wall.t - 0.35));
    if (c.through) {
      c.pos.copy(target);
      c.vel.copy(this.player.vel);
      c.through = false;
      c.resetPortalHistory();
      return;
    }
    c.vel.subVectors(target, c.pos).multiplyScalar(14).add(this.player.vel);
    if (c.vel.length() > 45) c.vel.setLength(45);
    this.moveBody(c, dt, []);
    if (c.pos.distanceTo(target) > 3.4) {
      this.held = null;
      this.emit('drop');
    }
  }

  stepCube(c, dt) {
    c.vel.y = Math.max(c.vel.y - PHYS.gravity * dt, -PHYS.terminal);
    if (c.onGround) {
      const s = Math.hypot(c.vel.x, c.vel.z);
      const k = s > 0 ? Math.max(0, s - 12 * dt) / s : 0;
      c.vel.x *= k;
      c.vel.z *= k;
    }
    this.moveBody(c, dt, [0]);
  }

  // ---------------------------------------------------------------- player

  stepPlayer(dt, input) {
    const p = this.player;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    let wx = fx * input.forward + rx * input.strafe;
    let wz = fz * input.forward + rz * input.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) {
      wx /= wl;
      wz /= wl;
    }
    if (p.onGround) {
      const tx = wx * PHYS.walk, tz = wz * PHYS.walk;
      const speed = Math.hypot(p.vel.x, p.vel.z);
      const rate = (speed > PHYS.walk * 1.05 ? PHYS.groundFric : PHYS.groundAcc) * dt;
      const dx = tx - p.vel.x, dz = tz - p.vel.z;
      const dl = Math.hypot(dx, dz);
      if (dl <= rate) {
        p.vel.x = tx;
        p.vel.z = tz;
      } else {
        p.vel.x += (dx / dl) * rate;
        p.vel.z += (dz / dl) * rate;
      }
      if (input.jump) {
        p.vel.y = PHYS.jump;
        p.onGround = false;
        this.emit('jump');
      }
    } else if (wl > 0) {
      const add = PHYS.walk - (p.vel.x * wx + p.vel.z * wz);
      if (add > 0) {
        const a = Math.min(add, PHYS.airAcc * dt);
        p.vel.x += wx * a;
        p.vel.z += wz * a;
      }
    }
    p.vel.y = Math.max(p.vel.y - PHYS.gravity * dt, -PHYS.terminal);
    this.moveBody(p, dt, [0, 0.65]);
  }

  // ---------------------------------------------------------------- tick

  step(dt, input) {
    this.time += dt;
    if (this.state !== 'playing') {
      this.stateTimer += dt;
      return;
    }

    this.stepPlayer(dt, input);
    if (this.held) this.stepHeld(dt);
    for (const c of this.cubes) if (c !== this.held) this.stepCube(c, dt);

    this.stepPads(dt);
    this.stepHazards();
    this.stepButtonsAndDoors(dt);

    for (const e of this.exits) {
      const [x, y, z] = e.cell, pp = this.player.pos;
      if (pp.x > x && pp.x < x + 1 && pp.z > z && pp.z < z + 1 && pp.y > y && pp.y < y + 2) {
        this.state = 'complete';
        this.stateTimer = 0;
        this.emit('complete');
      }
    }
  }

  stepPads(dt) {
    for (const pad of this.pads) {
      pad.cooldown = Math.max(0, pad.cooldown - dt);
      if (pad.cooldown > 0) continue;
      const [x, y, z] = pad.cell;
      for (const b of this.bodies()) {
        if (b === this.held) continue;
        const feet = b.pos.y - b.half.y;
        if (b.pos.x > x && b.pos.x < x + 1 && b.pos.z > z && b.pos.z < z + 1 && feet >= y - 0.05 && feet < y + 0.25 && b.vel.y <= 0.5) {
          b.pos.x = x + 0.5;
          b.pos.z = z + 0.5;
          b.vel.copy(pad.vel);
          b.onGround = false;
          pad.cooldown = 0.35;
          this.emit('launch');
        }
      }
    }
  }

  inField(pos) {
    for (const f of this.fields) {
      if (
        pos.x >= f.min[0] && pos.x <= f.max[0] + 1 &&
        pos.y >= f.min[1] && pos.y <= f.max[1] + 1 &&
        pos.z >= f.min[2] && pos.z <= f.max[2] + 1
      ) return true;
    }
    return false;
  }

  inGoo(b) {
    const w = this.world;
    return w.get(Math.floor(b.pos.x), Math.floor(b.pos.y - b.half.y + 0.05), Math.floor(b.pos.z)) === GOO;
  }

  stepHazards() {
    const p = this.player;
    if (this.inField(p.pos)) this.clearPortals();
    for (const c of this.cubes) {
      const lost = c.pos.y < -4 || c.pos.y > this.world.h + 2;
      if (this.inField(c.pos) || this.inGoo(c) || lost) this.respawnCube(c);
    }
    if (this.inGoo(p) || p.pos.y < -4) {
      this.state = 'dead';
      this.stateTimer = 0;
      this.held = null;
      this.emit('death');
    }
  }

  overlapsCellBox(b, x0, y0, z0, x1, y1, z1) {
    const { pos, half } = b;
    return (
      pos.x + half.x > x0 && pos.x - half.x < x1 &&
      pos.y + half.y > y0 && pos.y - half.y < y1 &&
      pos.z + half.z > z0 && pos.z - half.z < z1
    );
  }

  stepButtonsAndDoors(dt) {
    for (const btn of this.buttons) {
      const [x, y, z] = btn.cell;
      let pressed = false;
      for (const b of this.bodies()) {
        if (this.overlapsCellBox(b, x + 0.08, y - 0.1, z + 0.08, x + 0.92, y + 0.25, z + 0.92)) pressed = true;
      }
      if (pressed !== btn.pressed) {
        btn.pressed = pressed;
        this.emit('button', { on: pressed });
      }
    }
    for (const d of this.doors) {
      const want = d.ids.every((id) => this.buttons.some((b) => b.id === id && b.pressed));
      if (want !== d.open) {
        d.open = want;
        this.emit('door', { open: want });
      }
      d.progress = clamp(d.progress + (d.open ? 2.5 : -2.5) * dt, 0, 1);
      const solid = d.progress <= 0.5;
      if (solid && !d.solid) {
        // Never close on top of something.
        let blocked = false;
        for (const b of this.bodies()) {
          for (const [x, y, z] of d.cells) if (this.overlapsCellBox(b, x, y, z, x + 1, y + 1, z + 1)) blocked = true;
        }
        if (blocked) continue;
      }
      d.solid = solid;
    }
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
