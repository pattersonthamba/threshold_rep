import * as THREE from 'three';

// All textures are generated at startup: zero image downloads.
function makeCanvas(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  draw(g, size);
  return c;
}

function grain(g, s, amount, seed) {
  const img = g.getImageData(0, 0, s, s);
  const d = img.data;
  let r = seed;
  for (let i = 0; i < d.length; i += 4) {
    r = (r * 16807) % 2147483647;
    const n = (r / 2147483647 - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

function toTexture(canvas, repeat = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function makeTextures() {
  const panel = makeCanvas(256, (g, s) => {
    g.fillStyle = '#e4e6e1';
    g.fillRect(0, 0, s, s);
    grain(g, s, 12, 7);
    const gr = g.createLinearGradient(0, 0, s, s);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)');
    gr.addColorStop(1, 'rgba(0,0,0,0.07)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(30,36,42,0.55)';
    g.lineWidth = 5;
    g.strokeRect(2, 2, s - 4, s - 4);
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 2;
    g.strokeRect(8, 8, s - 16, s - 16);
    g.fillStyle = 'rgba(30,36,42,0.18)';
    g.fillRect(s / 2 - 1, 12, 2, s - 24);
  });

  const metal = makeCanvas(256, (g, s) => {
    g.fillStyle = '#353b42';
    g.fillRect(0, 0, s, s);
    grain(g, s, 18, 13);
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 3;
    for (let i = -s; i < s * 2; i += 28) {
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + s, s);
      g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.6)';
    g.lineWidth = 6;
    g.strokeRect(3, 3, s - 6, s - 6);
    g.strokeStyle = 'rgba(140,155,170,0.25)';
    g.lineWidth = 2;
    g.strokeRect(9, 9, s - 18, s - 18);
    g.fillStyle = '#5b646e';
    for (const [x, y] of [[20, 20], [s - 20, 20], [20, s - 20], [s - 20, s - 20]]) {
      g.beginPath();
      g.arc(x, y, 5, 0, Math.PI * 2);
      g.fill();
    }
  });

  // Mass core: an original faceted design, not based on any existing prop.
  const core = makeCanvas(128, (g, s) => {
    g.fillStyle = '#b9bdb6';
    g.fillRect(0, 0, s, s);
    grain(g, s, 10, 3);
    g.fillStyle = '#2b3036';
    g.fillRect(0, 0, s, 16);
    g.fillRect(0, s - 16, s, 16);
    g.fillRect(0, 0, 16, s);
    g.fillRect(s - 16, 0, 16, s);
    g.save();
    g.translate(s / 2, s / 2);
    g.rotate(Math.PI / 4);
    g.fillStyle = '#20262c';
    g.fillRect(-26, -26, 52, 52);
    g.fillStyle = '#f2c14e';
    g.fillRect(-16, -16, 32, 32);
    g.restore();
  });

  const glow = makeCanvas(64, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });

  return {
    panel: toTexture(panel),
    metal: toTexture(metal),
    core: toTexture(core, false),
    glow: toTexture(glow, false),
  };
}
