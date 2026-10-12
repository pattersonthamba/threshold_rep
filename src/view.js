import * as THREE from 'three';
import { PANEL, METAL, GLASS, GOO } from './world.js';
import { makeTextures } from './textures.js';

export const PORTAL_COLORS = [0x2ee6c9, 0xff4f8b];

const AVATAR_LAYER = 1;

const portalVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The portal surface samples the off-screen view in screen space, so the
// view lines up with perspective without any per-portal projection math.
const portalFrag = /* glsl */ `
  uniform sampler2D map;
  uniform vec2 res;
  uniform vec3 tint;
  uniform float time;
  uniform float linked;
  varying vec2 vUv;
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    vec3 view = texture2D(map, gl_FragCoord.xy / res).rgb;
    float swirl = 0.5 + 0.5 * sin(atan(p.y, p.x) * 5.0 + time * 2.5 - r * 9.0);
    vec3 closed = tint * (0.35 + 0.25 * swirl * r);
    vec3 col = mix(closed, view, linked);
    col = mix(col, tint, smoothstep(0.72, 1.0, r) * (0.55 + 0.3 * swirl));
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

const ringFrag = /* glsl */ `
  uniform vec3 tint;
  uniform float time;
  varying vec2 vUv;
  void main() {
    float a = vUv.x;
    float band = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float flick = 0.75 + 0.25 * sin(a * 40.0 + time * 7.0) * sin(a * 13.0 - time * 3.0);
    gl_FragColor = vec4(tint * (1.6 * flick), band * band);
    #include <colorspace_fragment>
  }
`;

const gooVert = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const gooFrag = /* glsl */ `
  uniform float time;
  uniform vec3 deep;
  uniform vec3 hot;
  varying vec3 vWorld;
  void main() {
    vec2 q = vWorld.xz * 1.3;
    float n = sin(q.x * 1.7 + time * 0.9) * sin(q.y * 1.3 - time * 0.7)
            + 0.5 * sin(q.x * 3.1 - q.y * 2.3 + time * 1.6);
    float m = smoothstep(-0.6, 1.2, n);
    gl_FragColor = vec4(mix(deep, hot, m * m), 1.0);
    #include <colorspace_fragment>
  }
`;

const fieldFrag = /* glsl */ `
  uniform float time;
  uniform vec3 tint;
  varying vec2 vUv;
  void main() {
    float lines = 0.5 + 0.5 * sin(vUv.y * 60.0 - time * 6.0);
    float drift = 0.5 + 0.5 * sin(vUv.x * 9.0 + time * 1.7);
    float edge = smoothstep(0.42, 0.5, abs(vUv.x - 0.5)) + smoothstep(0.42, 0.5, abs(vUv.y - 0.5));
    float a = 0.08 + 0.18 * lines * drift + 0.5 * edge;
    gl_FragColor = vec4(tint * (1.0 + edge), a);
    #include <colorspace_fragment>
  }
`;

const beamFrag = /* glsl */ `
  uniform float time;
  uniform vec3 tint;
  varying vec2 vUv;
  void main() {
    float a = (1.0 - vUv.y) * (0.35 + 0.15 * sin(vUv.y * 20.0 - time * 4.0));
    gl_FragColor = vec4(tint, a);
    #include <colorspace_fragment>
  }
`;

const simpleVert = portalVert;

// Ellipse ring in the portal's local XY plane, uv.x = angle, uv.y = band.
function ringGeometry(a, b, inner, outer, segments = 72) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pos.push(c * (a - inner), s * (b - inner), 0, c * (a + outer), s * (b + outer), 0);
    uv.push(i / segments, 0, i / segments, 1);
    if (i < segments) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

class PortalView {
  constructor(i, scene) {
    this.i = i;
    this.color = new THREE.Color(PORTAL_COLORS[i]);
    this.version = -1;
    this.open = 0;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    scene.add(this.group);

    this.rt = new THREE.WebGLRenderTarget(8, 8, { depthBuffer: true });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;

    this.viewMat = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: this.rt.texture },
        res: { value: new THREE.Vector2(1, 1) },
        tint: { value: this.color },
        time: { value: 0 },
        linked: { value: 0 },
      },
      vertexShader: portalVert,
      fragmentShader: portalFrag,
    });
    // Used inside other portals' views: avoids sampling a texture that is
    // currently being rendered (one level of recursion is plenty here).
    this.flatMat = new THREE.MeshBasicMaterial({ color: this.color.clone().multiplyScalar(0.6) });

    this.surface = new THREE.Mesh(new THREE.CircleGeometry(1, 48), this.viewMat);
    this.surface.scale.set(0.5, 1, 1);
    this.group.add(this.surface);

    this.ringMat = new THREE.ShaderMaterial({
      uniforms: { tint: { value: this.color }, time: { value: 0 } },
      vertexShader: simpleVert,
      fragmentShader: ringFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.ring = new THREE.Mesh(ringGeometry(0.5, 1.0, 0.03, 0.07), this.ringMat);
    this.ring.position.z = 0.003;
    this.group.add(this.ring);

    this.sphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
  }
}

export class View {
  constructor(renderer) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x11161b);
    this.scene.fog = new THREE.Fog(0x11161b, 30, 80);
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.02, 200);
    this.camera.rotation.order = 'YXZ';
    this.portalCam = new THREE.PerspectiveCamera();
    this.portalCam.matrixAutoUpdate = false;
    this.portalCam.matrixWorldAutoUpdate = false;
    this.portalCam.layers.enable(AVATAR_LAYER);
    this.quality = 0.75;
    this.time = 0;

    this.tex = makeTextures();
    this.mats = {
      panel: new THREE.MeshLambertMaterial({ map: this.tex.panel, vertexColors: true }),
      metal: new THREE.MeshLambertMaterial({ map: this.tex.metal, vertexColors: true }),
      glass: new THREE.MeshLambertMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.18, depthWrite: false }),
      core: new THREE.MeshLambertMaterial({ map: this.tex.core, emissive: 0x332200, emissiveIntensity: 0.4 }),
      dark: new THREE.MeshLambertMaterial({ color: 0x23282e }),
      fixture: new THREE.MeshBasicMaterial({ color: 0xf4f1e6 }),
      door: new THREE.MeshLambertMaterial({ map: this.tex.metal, color: 0xb7c2cc }),
      doorStripe: new THREE.MeshBasicMaterial({ color: 0xf2c14e }),
    };

    this.scene.add(new THREE.HemisphereLight(0xf4f6ff, 0x404650, 2.1));
    const sun = new THREE.DirectionalLight(0xffffff, 1.3);
    sun.position.set(0.4, 1, 0.25);
    this.scene.add(sun);

    this.portals = [new PortalView(0, this.scene), new PortalView(1, this.scene)];
    this.level = null;
    this.avatar = this.makeAvatar();
    this.scene.add(this.avatar);
    this.sparks = [];
    this._m = new THREE.Matrix4();
    this._s = new THREE.Matrix4();
    this._frustum = new THREE.Frustum();
    this._v = new THREE.Vector3();
    this._res = new THREE.Vector2();
    this.clipPlane = new THREE.Plane();
  }

  // Original avatar: a lean capsule-bodied test unit with a single visor.
  // Only portal cameras see it, so the player can watch themselves.
  makeAvatar() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 1.0, 6, 12), new THREE.MeshLambertMaterial({ color: 0xd8dcd4 }));
    body.position.y = -0.1;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.12), new THREE.MeshBasicMaterial({ color: 0x2ee6c9 }));
    visor.position.set(0, 0.5, -0.22);
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.18), this.mats.dark);
    pack.position.set(0, 0.05, 0.24);
    const emitter = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.5), this.mats.dark);
    emitter.position.set(0.3, 0.05, -0.25);
    g.add(body, visor, pack, emitter);
    g.traverse((o) => o.layers.set(AVATAR_LAYER));
    return g;
  }

  setQuality(q) {
    this.quality = q;
    this.resize();
  }

  resize() {
    const r = this.renderer;
    const w = r.domElement.clientWidth, h = r.domElement.clientHeight;
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
    r.getDrawingBufferSize(this._res);
    const pw = Math.max(64, Math.floor(this._res.x * this.quality));
    const ph = Math.max(64, Math.floor(this._res.y * this.quality));
    for (const p of this.portals) {
      p.rt.setSize(pw, ph);
      p.viewMat.uniforms.res.value.copy(this._res);
    }
  }

  // ------------------------------------------------------------ level build

  buildLevel(sim) {
    if (this.level) this.disposeLevel();
    const w = sim.world;
    const L = new THREE.Group();
    this.level = L;
    this.scene.add(L);

    for (const [type, mat] of [[PANEL, this.mats.panel], [METAL, this.mats.metal], [GLASS, this.mats.glass]]) {
      const geo = w.buildGeometry(type);
      if (geo) L.add(new THREE.Mesh(geo, mat));
    }

    // Ceiling light fixtures, instanced into one draw call.
    const spots = [];
    for (let z = 1; z < w.d - 1; z++)
      for (let x = 1; x < w.w - 1; x++)
        for (let y = w.h - 2; y > 0; y--) {
          if (w.isSolid(x, y, z)) break;
          if (w.isOpaque(x, y + 1, z) && w.get(x, y + 1, z) === METAL && (x + z) % 4 === 0 && y + 1 === w.h - 1) spots.push([x, y + 1, z]);
        }
    if (spots.length) {
      const fx = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.7), this.mats.fixture, spots.length);
      const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));
      spots.forEach(([x, y, z], k) => fx.setMatrixAt(k, m.compose(new THREE.Vector3(x + 0.5, y - 0.005, z + 0.5), q, new THREE.Vector3(1, 1, 1))));
      L.add(fx);
    }

    // Hazard pools.
    const gooQuads = [];
    for (let y = 0; y < w.h; y++)
      for (let z = 0; z < w.d; z++)
        for (let x = 0; x < w.w; x++) if (w.get(x, y, z) === GOO) gooQuads.push([x, y + 0.7, z]);
    this.gooMat = null;
    if (gooQuads.length) {
      const pos = [], idx = [];
      gooQuads.forEach(([x, y, z], k) => {
        pos.push(x, y, z, x, y, z + 1, x + 1, y, z + 1, x + 1, y, z);
        const b = k * 4;
        idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      this.gooMat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, deep: { value: new THREE.Color(0x2a1204) }, hot: { value: new THREE.Color(0xff8a1f) } },
        vertexShader: gooVert,
        fragmentShader: gooFrag,
      });
      L.add(new THREE.Mesh(g, this.gooMat));
    }

    // Veils.
    this.fieldMats = [];
    for (const f of sim.fields) {
      const size = [0, 1, 2].map((k) => f.max[k] - f.min[k] + 1);
      const thin = size.indexOf(Math.min(...size));
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, tint: { value: new THREE.Color(0x8fd6ff) } },
        vertexShader: simpleVert,
        fragmentShader: fieldFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.fieldMats.push(mat);
      const pw = thin === 0 ? size[2] : size[0];
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, size[1]), mat);
      mesh.position.set(f.min[0] + size[0] / 2, f.min[1] + size[1] / 2, f.min[2] + size[2] / 2);
      if (thin === 0) mesh.rotation.y = Math.PI / 2;
      L.add(mesh);
    }

    // Buttons.
    this.buttonViews = sim.buttons.map((b) => {
      const [x, y, z] = b.cell;
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.1, 24), this.mats.dark);
      base.position.set(x + 0.5, y + 0.05, z + 0.5);
      const plateMat = new THREE.MeshBasicMaterial({ color: 0xff5a4a });
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.08, 24), plateMat);
      plate.position.set(x + 0.5, y + 0.14, z + 0.5);
      L.add(base, plate);
      return { plate, plateMat, y: y + 0.14 };
    });

    // Doors: a shutter that rolls up into the lintel.
    this.doorViews = sim.doors.map((d) => {
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (const c of d.cells) for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], c[k]);
        max[k] = Math.max(max[k], c[k] + 1);
      }
      const size = [0, 1, 2].map((k) => max[k] - min[k]);
      const g = new THREE.Group();
      const slab = new THREE.Mesh(new THREE.BoxGeometry(size[0] * 0.98, size[1], size[2] * 0.98), this.mats.door);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(size[0] * 1.0, 0.12, size[2] * 1.0), this.mats.doorStripe);
      stripe.position.y = -size[1] / 2 + 0.25;
      g.add(slab, stripe);
      g.position.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
      L.add(g);
      return { g, top: max[1], h: size[1] };
    });

    // Exit beacons.
    this.beamMats = [];
    for (const e of sim.exits) {
      const [x, y, z] = e.cell;
      const mat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 }, tint: { value: new THREE.Color(0xa6ffcf) } },
        vertexShader: simpleVert,
        fragmentShader: beamFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.beamMats.push(mat);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 3, 24, 1, true), mat);
      beam.position.set(x + 0.5, y + 1.5, z + 0.5);
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.04, 24), new THREE.MeshBasicMaterial({ color: 0x7dffb8 }));
      disc.position.set(x + 0.5, y + 0.02, z + 0.5);
      L.add(beam, disc);
    }

    // Launch plates.
    this.padViews = sim.pads.map((p) => {
      const [x, y, z] = p.cell;
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.96, 0.12, 0.96), this.mats.dark);
      base.position.set(x + 0.5, y + 0.06, z + 0.5);
      const mat = new THREE.MeshBasicMaterial({ color: 0x5fd0ff });
      const top = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 6), mat);
      top.position.set(x + 0.5, y + 0.14, z + 0.5);
      L.add(base, top);
      return { mat, top };
    });

    // Mass cores.
    this.cubeViews = sim.cubes.map(() => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), this.mats.core);
      L.add(m);
      return m;
    });

    for (const p of this.portals) {
      p.version = -1;
      p.group.visible = false;
    }
  }

  disposeLevel() {
    this.level.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !Object.values(this.mats).includes(o.material)) o.material.dispose();
    });
    this.scene.remove(this.level);
    this.level = null;
  }

  // ------------------------------------------------------------ effects

  spark(point, color) {
    const mat = new THREE.SpriteMaterial({ map: this.tex.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.position.copy(point);
    s.scale.setScalar(0.6);
    this.scene.add(s);
    this.sparks.push({ s, life: 0.35, max: 0.35 });
  }

  // ------------------------------------------------------------ per frame

  sync(sim, dt) {
    this.time += dt;
    const t = this.time;
    const eye = sim.eye(this._v);
    this.camera.position.copy(eye);
    this.camera.rotation.set(sim.pitch, sim.yaw, 0);
    this.camera.updateMatrixWorld();

    this.avatar.position.copy(sim.player.pos);
    this.avatar.rotation.y = sim.yaw;

    sim.cubes.forEach((c, k) => {
      this.cubeViews[k].position.copy(c.pos);
      this.mats.core.emissiveIntensity = sim.held ? 0.9 : 0.4;
    });
    sim.buttons.forEach((b, k) => {
      const v = this.buttonViews[k];
      v.plate.position.y = v.y - (b.pressed ? 0.05 : 0);
      v.plateMat.color.setHex(b.pressed ? 0x7dffb8 : 0xff5a4a);
    });
    sim.doors.forEach((d, k) => {
      const v = this.doorViews[k];
      const s = Math.max(0.02, 1 - d.progress);
      v.g.scale.y = s;
      v.g.position.y = v.top - (v.h * s) / 2;
    });
    sim.pads.forEach((p, k) => {
      const v = this.padViews[k];
      const pulse = p.cooldown > 0 ? 1 : 0.5 + 0.5 * Math.sin(t * 4);
      v.mat.color.setRGB(0.25 + 0.5 * pulse, 0.7 + 0.3 * pulse, 1);
    });
    if (this.gooMat) this.gooMat.uniforms.time.value = t;
    for (const m of this.fieldMats) m.uniforms.time.value = t;
    for (const m of this.beamMats) m.uniforms.time.value = t;

    sim.portals.forEach((ps, k) => {
      const pv = this.portals[k];
      if (pv.version !== ps.version) {
        pv.version = ps.version;
        pv.open = 0;
      }
      pv.group.visible = ps.placed;
      if (!ps.placed) return;
      pv.open = Math.min(1, pv.open + dt * 5);
      const e = 1 - Math.pow(1 - pv.open, 3);
      this._m.copy(ps.basis);
      this._m.multiply(this._s.makeTranslation(0, 0, 0.004));
      this._m.multiply(this._s.makeScale(e, e, 1));
      pv.group.matrix.copy(this._m);
      pv.group.matrixWorldNeedsUpdate = true;
      pv.sphere.center.copy(ps.pos);
      pv.viewMat.uniforms.time.value = t;
      pv.viewMat.uniforms.linked.value = ps.linked ? Math.min(1, pv.open * 1.5) : 0;
      pv.ringMat.uniforms.time.value = t;
    });

    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const sp = this.sparks[i];
      sp.life -= dt;
      const k = Math.max(0, sp.life / sp.max);
      sp.s.material.opacity = k;
      sp.s.scale.setScalar(0.6 + (1 - k) * 0.8);
      if (sp.life <= 0) {
        this.scene.remove(sp.s);
        sp.s.material.dispose();
        this.sparks.splice(i, 1);
      }
    }
  }

  render(sim) {
    const r = this.renderer;
    const cam = this.camera;
    const [A, B] = sim.portals;
    const linked = A.linked;

    if (linked) {
      this._m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      this._frustum.setFromProjectionMatrix(this._m);
      for (const pv of this.portals) pv.surface.material = pv.flatMat;
      for (let k = 0; k < 2; k++) {
        const ps = sim.portals[k], pv = this.portals[k];
        pv.needed = false;
        if (!this._frustum.intersectsSphere(pv.sphere)) continue;
        if (this._v.subVectors(cam.position, ps.pos).dot(ps.n) < -0.05) continue;
        pv.needed = true;
        const q = ps.other;
        const vc = this.portalCam;
        vc.projectionMatrix.copy(cam.projectionMatrix);
        vc.projectionMatrixInverse.copy(cam.projectionMatrixInverse);
        vc.matrixWorld.multiplyMatrices(ps.toOther, cam.matrixWorld);
        vc.matrixWorldInverse.copy(vc.matrixWorld).invert();
        // Clip everything behind the exit portal's wall.
        this.clipPlane.setFromNormalAndCoplanarPoint(q.n, this._v.copy(q.pos).addScaledVector(q.n, -0.01));
        r.clippingPlanes = [this.clipPlane];
        r.setRenderTarget(pv.rt);
        r.clear();
        r.render(this.scene, vc);
      }
      r.clippingPlanes = [];
      r.setRenderTarget(null);
      for (const pv of this.portals) pv.surface.material = pv.needed ? pv.viewMat : pv.flatMat;
    } else {
      for (const pv of this.portals) pv.surface.material = pv.viewMat;
    }
    r.render(this.scene, cam);
  }
}
