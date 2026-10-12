import * as THREE from 'three';

// Cell types. Everything in a chamber is a 1m voxel; this keeps collision,
// raycasts and portal placement O(1) per cell instead of BSP/mesh queries.
export const AIR = 0, PANEL = 1, METAL = 2, GLASS = 3, GOO = 4;

const isOpaqueType = (t) => t === PANEL || t === METAL;
const isSolidType = (t) => t === PANEL || t === METAL || t === GLASS;

const AXES = ['x', 'y', 'z'];
const EPS = 1e-4;
const SKIN = 1e-3;
const AO_CURVE = [0.52, 0.7, 0.86, 1.0];

// Per-face corner layout, wound CCW when viewed from outside.
const FACES = [];
for (const [axis, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
  const n = [0, 0, 0];
  n[axis] = s;
  let ua = axis === 0 ? 1 : axis === 1 ? 2 : 0;
  let va = axis === 0 ? 2 : axis === 1 ? 0 : 1;
  if (s < 0) [ua, va] = [va, ua];
  const corners = [];
  const sides = [];
  for (const [cu, cv] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
    const c = [0, 0, 0];
    c[axis] = s > 0 ? 1 : 0;
    c[ua] = cu;
    c[va] = cv;
    corners.push(c);
    const a = [0, 0, 0];
    a[ua] = cu ? 1 : -1;
    const b = [0, 0, 0];
    b[va] = cv ? 1 : -1;
    sides.push([a, b]);
  }
  FACES.push({ n, axis, corners, sides });
}

export class World {
  constructor(w, h, d) {
    this.w = w;
    this.h = h;
    this.d = d;
    this.cells = new Uint8Array(w * h * d);
    this.doors = new Map(); // cell index -> door state (solid while closed)
  }

  inBounds(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.h && z < this.d;
  }

  index(x, y, z) {
    return x + this.w * (z + this.d * y);
  }

  get(x, y, z) {
    return this.inBounds(x, y, z) ? this.cells[this.index(x, y, z)] : METAL;
  }

  set(x, y, z, t) {
    if (this.inBounds(x, y, z)) this.cells[this.index(x, y, z)] = t;
  }

  isOpaque(x, y, z) {
    return isOpaqueType(this.get(x, y, z));
  }

  isSolid(x, y, z) {
    if (!this.inBounds(x, y, z)) return true;
    const i = this.index(x, y, z);
    if (isSolidType(this.cells[i])) return true;
    const door = this.doors.get(i);
    return door ? door.solid : false;
  }

  // Moves an AABB along one axis and resolves against solid cells.
  // `ignore(x, y, z)` lets portals open a hole in the wall behind them.
  sweep(pos, half, axis, delta, ignore) {
    if (delta === 0) return false;
    const k = AXES[axis];
    pos[k] += delta;
    const x0 = Math.floor(pos.x - half.x + EPS), x1 = Math.floor(pos.x + half.x - EPS);
    const y0 = Math.floor(pos.y - half.y + EPS), y1 = Math.floor(pos.y + half.y - EPS);
    const z0 = Math.floor(pos.z - half.z + EPS), z1 = Math.floor(pos.z + half.z - EPS);
    let hit = false;
    let limit = delta > 0 ? Infinity : -Infinity;
    for (let y = y0; y <= y1; y++) {
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (!this.isSolid(x, y, z) || (ignore && ignore(x, y, z))) continue;
          const c = axis === 0 ? x : axis === 1 ? y : z;
          if (delta > 0) limit = Math.min(limit, c - half[k] - SKIN);
          else limit = Math.max(limit, c + 1 + half[k] + SKIN);
          hit = true;
        }
      }
    }
    if (hit) pos[k] = limit;
    return hit;
  }

  overlapsSolid(pos, half) {
    const x0 = Math.floor(pos.x - half.x + EPS), x1 = Math.floor(pos.x + half.x - EPS);
    const y0 = Math.floor(pos.y - half.y + EPS), y1 = Math.floor(pos.y + half.y - EPS);
    const z0 = Math.floor(pos.z - half.z + EPS), z1 = Math.floor(pos.z + half.z - EPS);
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) if (this.isSolid(x, y, z)) return true;
    return false;
  }

  // Amanatides-Woo voxel traversal. Returns the first solid cell hit.
  raycast(origin, dir, maxDist = 128) {
    let x = Math.floor(origin.x), y = Math.floor(origin.y), z = Math.floor(origin.z);
    const sx = dir.x > 0 ? 1 : -1, sy = dir.y > 0 ? 1 : -1, sz = dir.z > 0 ? 1 : -1;
    const dx = dir.x !== 0 ? Math.abs(1 / dir.x) : Infinity;
    const dy = dir.y !== 0 ? Math.abs(1 / dir.y) : Infinity;
    const dz = dir.z !== 0 ? Math.abs(1 / dir.z) : Infinity;
    let tx = dir.x !== 0 ? (dir.x > 0 ? x + 1 - origin.x : origin.x - x) * dx : Infinity;
    let ty = dir.y !== 0 ? (dir.y > 0 ? y + 1 - origin.y : origin.y - y) * dy : Infinity;
    let tz = dir.z !== 0 ? (dir.z > 0 ? z + 1 - origin.z : origin.z - z) * dz : Infinity;
    let t = 0;
    let normal = [0, 0, 0];
    for (let i = 0; i < 1024; i++) {
      if (this.isSolid(x, y, z)) {
        return {
          cell: [x, y, z],
          normal,
          t,
          point: new THREE.Vector3().copy(origin).addScaledVector(dir, t),
          type: this.get(x, y, z),
        };
      }
      if (tx < ty && tx < tz) {
        x += sx; t = tx; tx += dx; normal = [-sx, 0, 0];
      } else if (ty < tz) {
        y += sy; t = ty; ty += dy; normal = [0, -sy, 0];
      } else {
        z += sz; t = tz; tz += dz; normal = [0, 0, -sz];
      }
      if (t > maxDist) return null;
    }
    return null;
  }

  // One merged, face-culled mesh per material with baked vertex AO.
  // A whole chamber renders in ~3 draw calls.
  buildGeometry(type) {
    const pos = [], nor = [], uv = [], col = [], idx = [];
    for (let y = 0; y < this.h; y++) {
      for (let z = 0; z < this.d; z++) {
        for (let x = 0; x < this.w; x++) {
          if (this.cells[this.index(x, y, z)] !== type) continue;
          for (const f of FACES) {
            const nx = x + f.n[0], ny = y + f.n[1], nz = z + f.n[2];
            if (!this.inBounds(nx, ny, nz)) continue;
            const nt = this.get(nx, ny, nz);
            if (isOpaqueType(nt)) continue;
            if (type === GLASS && nt === GLASS) continue;
            const base = pos.length / 3;
            const ao = [];
            for (let k = 0; k < 4; k++) {
              const c = f.corners[k];
              const px = x + c[0], py = y + c[1], pz = z + c[2];
              pos.push(px, py, pz);
              nor.push(f.n[0], f.n[1], f.n[2]);
              if (f.axis === 1) uv.push(px, pz);
              else if (f.axis === 0) uv.push(pz, py);
              else uv.push(px, py);
              let level = 3;
              if (type !== GLASS) {
                const [a, b] = f.sides[k];
                const s1 = this.isOpaque(nx + a[0], ny + a[1], nz + a[2]) ? 1 : 0;
                const s2 = this.isOpaque(nx + b[0], ny + b[1], nz + b[2]) ? 1 : 0;
                const cc = this.isOpaque(nx + a[0] + b[0], ny + a[1] + b[1], nz + a[2] + b[2]) ? 1 : 0;
                level = s1 && s2 ? 0 : 3 - (s1 + s2 + cc);
              }
              ao.push(level);
              const v = AO_CURVE[level];
              col.push(v, v, v);
            }
            if (ao[0] + ao[2] >= ao[1] + ao[3]) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
            else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
          }
        }
      }
    }
    if (!idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
}
