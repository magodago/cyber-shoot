import * as THREE from 'three';

// ---------------------------------------------------------------------------
// FX: sprites, chispas, ondas de choque. Todo procedural, cero assets.
// ---------------------------------------------------------------------------

function radialTexture(stops) {
  const s = 128, c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  for (const [p, col] of stops) grd.addColorStop(p, col);
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const TEX = {
  glow: null,
  spark: null,
  smoke: null,
  column: null
};

// Columna de luz del portal: brillante abajo, se disuelve hacia arriba, con
// vetas verticales que dan sensación de energía canalizada (no un cilindro liso).
function columnTexture() {
  const w = 128, h = 256, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.28, 'rgba(255,255,255,0.16)');
  grd.addColorStop(0.7, 'rgba(255,255,255,0.62)');
  grd.addColorStop(0.95, 'rgba(255,255,255,0.95)');
  grd.addColorStop(1, 'rgba(255,255,255,0.35)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  // vetas: franjas verticales más intensas
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i++) {
    const x = Math.random() * w;
    g.fillStyle = 'rgba(255,255,255,' + (0.05 + Math.random() * 0.16).toFixed(3) + ')';
    g.fillRect(x, 0, 1 + Math.random() * 2.5, h);
  }
  g.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function initTextures() {
  if (TEX.glow) return;
  TEX.column = columnTexture();
  TEX.glow = radialTexture([[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.85)'], [0.45, 'rgba(255,255,255,0.28)'], [1, 'rgba(255,255,255,0)']]);
  TEX.spark = radialTexture([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
  TEX.smoke = radialTexture([[0, 'rgba(255,255,255,0.45)'], [0.5, 'rgba(255,255,255,0.16)'], [1, 'rgba(255,255,255,0)']]);
}

const _v = new THREE.Vector3();

class Spark {
  constructor(scene) {
    const mat = new THREE.SpriteMaterial({
      map: TEX.spark, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, opacity: 0
    });
    this.s = new THREE.Sprite(mat);
    this.s.visible = false;
    this.s.frustumCulled = false;
    scene.add(this.s);
    this.vel = new THREE.Vector3();
    this.life = 0;
    this.max = 1;
    this.size = 0.1;
    this.drag = 2.4;
    this.grav = -2.5;
  }
  reset(pos, color, speed, life, size, spread = 1) {
    this.s.position.copy(pos);
    this.s.material.color.setHex(color);
    this.s.material.opacity = 1;
    this.vel.set((Math.random() - 0.5) * 2, Math.random() * 0.85 + 0.15, (Math.random() - 0.5) * 2)
      .normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.9) * spread);
    this.life = this.max = life * (0.6 + Math.random() * 0.8);
    this.size = size * (0.6 + Math.random() * 0.9);
    this.s.scale.setScalar(this.size);
    this.s.visible = true;
  }
  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    const k = Math.max(0, this.life / this.max);
    this.vel.y += this.grav * dt;
    this.vel.multiplyScalar(1 - Math.min(0.9, this.drag * dt));
    this.s.position.addScaledVector(this.vel, dt);
    this.s.material.opacity = k * k;
    this.s.scale.setScalar(this.size * (0.4 + k * 0.9));
    if (this.life <= 0) this.s.visible = false;
  }
}

class Ring {
  constructor(scene) {
    const geo = new THREE.RingGeometry(0.88, 1, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending
    });
    this.m = new THREE.Mesh(geo, mat);
    this.m.rotation.x = -Math.PI / 2;
    this.m.visible = false;
    this.m.frustumCulled = false;
    scene.add(this.m);
    this.life = 0;
    this.max = 1;
    this.r0 = 0.2;
    this.r1 = 1;
  }
  reset(pos, color, r1, life = 0.5) {
    this.m.position.copy(pos);
    this.m.position.y += 0.03;
    this.m.material.color.setHex(color);
    this.life = this.max = life;
    this.r1 = r1;
    this.r0 = r1 * 0.15;
    this.m.visible = true;
  }
  update(dt) {
    if (this.life <= 0) return;
    this.life -= dt;
    const k = 1 - Math.max(0, this.life / this.max);
    const r = this.r0 + (this.r1 - this.r0) * k;
    this.m.scale.setScalar(r);
    this.m.material.opacity = (1 - k) * 0.85;
    if (this.life <= 0) this.m.visible = false;
  }
}

// Portal de materialización: columna de luz aditiva con vetas, disco en el
// suelo y un aro girando. Se abre (crece), se mantiene y se cierra en ~0.7 s;
// el bicho aparece dentro, así que nunca "pop" de la nada.
class Portal {
  constructor(scene) {
    this.g = new THREE.Group();
    this.g.visible = false;
    scene.add(this.g);

    this.colMat = new THREE.MeshBasicMaterial({
      map: TEX.column, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false
    });
    this.col = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.92, 3.2, 20, 1, true), this.colMat);
    this.col.position.y = 1.6;
    this.g.add(this.col);

    this.discMat = new THREE.MeshBasicMaterial({
      map: TEX.glow, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.disc = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.7), this.discMat);
    this.disc.rotation.x = -Math.PI / 2;
    this.disc.position.y = 0.05;
    this.g.add(this.disc);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    });
    this.ring = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.045, 6, 28), this.ringMat);
    this.ring.position.y = 1.5;
    this.g.add(this.ring);

    this.t = 0; this.max = 1;
  }
  reset(pos, color, life = 0.7) {
    this.g.position.copy(pos);
    this.g.position.y = Math.max(0, pos.y);
    this.colMat.color.setHex(color);
    this.discMat.color.setHex(color);
    this.ringMat.color.setHex(color);
    this.t = 0; this.max = life;
    this.g.visible = true;
    this.g.rotation.y = Math.random() * 6.28;
  }
  update(dt) {
    if (!this.g.visible) return;
    this.t += dt;
    const k = Math.min(1, this.t / this.max);
    const open = k < 0.22 ? k / 0.22 : 1;              // apertura rápida
    const close = k > 0.62 ? 1 - (k - 0.62) / 0.38 : 1;
    const fade = open * close;
    this.g.scale.set(1, 0.25 + 0.75 * open, 1);
    this.colMat.opacity = 0.9 * fade;
    this.discMat.opacity = (0.55 + 0.4 * Math.abs(Math.sin(this.t * 16))) * fade;
    this.ringMat.opacity = 0.8 * fade;
    this.col.rotation.y -= dt * 1.2;
    this.ring.rotation.z += dt * 2.6;
    this.ring.position.y = 0.5 + 1.5 * open;
    if (k >= 1) this.g.visible = false;
  }
}

export class FX {
  constructor(scene, maxSparks = 160) {
    initTextures();
    this.scene = scene;
    this.sparks = [];
    for (let i = 0; i < maxSparks; i++) this.sparks.push(new Spark(scene));
    this.sparkIdx = 0;
    this.rings = [];
    for (let i = 0; i < 12; i++) this.rings.push(new Ring(scene));
    this.ringIdx = 0;
    this.portals = [];
    for (let i = 0; i < 8; i++) this.portals.push(new Portal(scene));
    this.portalIdx = 0;
    this.bolts = [];   // los rellena el juego (proyectiles)
  }

  // portal de materialización (enemigos de a pie, refuerzos…)
  portal(pos, color = 0x49e6ff, life = 0.7) {
    const p = this.portals[this.portalIdx++ % this.portals.length];
    p.reset(pos, color, life);
  }

  spark(pos, color, n = 6, speed = 3.4, life = 0.5, size = 0.11) {
    for (let i = 0; i < n; i++) {
      const s = this.sparks[this.sparkIdx++ % this.sparks.length];
      s.reset(pos, color, speed, life, size);
    }
  }

  ring(pos, color, radius = 1.2, life = 0.5) {
    const r = this.rings[this.ringIdx++ % this.rings.length];
    r.reset(pos, color, radius, life);
  }

  // chorro vertical de aparición: chispas + anillo en el suelo
  spawnFlash(pos, color, up = 1.6) {
    this.spark(_v.copy(pos).setY(pos.y + 0.05), color, 10, 1.2, 0.7, 0.1);
    for (let i = 0; i < 8; i++) {
      const s = this.sparks[this.sparkIdx++ % this.sparks.length];
      s.reset(_v.copy(pos).setY(pos.y + up * 0.5), color, 0.6, 0.55, 0.08);
      s.vel.set((Math.random() - 0.5) * 0.6, up * (0.8 + Math.random() * 0.9), (Math.random() - 0.5) * 0.6);
    }
    this.ring(pos, color, 1.5, 0.55);
  }

  update(dt) {
    for (const s of this.sparks) s.update(dt);
    for (const r of this.rings) r.update(dt);
    for (const p of this.portals) p.update(dt);
  }
}

// ---------------------------------------------------------------------------
// materiales y texturas de la ciudad
// ---------------------------------------------------------------------------

const rand = (a, b) => a + Math.random() * (b - a);

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function facadeTexture(cols, rows, tint, seed) {
  const s = 512, c = canvas(s), g = c.getContext('2d');
  g.fillStyle = '#05070c';
  g.fillRect(0, 0, s, s);
  // ruido sutil de hormigón
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.022})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  const em = canvas(s), ge = em.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, s, s);
  const cw = s / cols, ch = s / rows;
  let n = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const px = x * cw + cw * 0.18, py = y * ch + ch * 0.2;
      const w = cw * 0.64, h = ch * 0.5;
      const lit = Math.random() < 0.42;
      const pal = ['#ffd9a0', '#bfe9ff', '#ffb2f0', '#a8ffd8'];
      const col = lit ? pal[(Math.random() * pal.length) | 0] : '#0a1018';
      g.fillStyle = lit ? 'rgba(10,14,22,1)' : 'rgba(8,11,17,1)';
      g.fillRect(px - 1, py - 1, w + 2, h + 2);
      ge.fillStyle = col;
      ge.globalAlpha = lit ? 0.55 + Math.random() * 0.45 : 0.06;
      ge.fillRect(px, py, w, h);
      ge.globalAlpha = 1;
      if (lit && Math.random() < 0.25) {
        ge.fillStyle = tint;
        ge.globalAlpha = 0.55;
        ge.fillRect(px, py + h - 2, w, 2);
        ge.globalAlpha = 1;
      }
      n++;
    }
  }
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const emissive = new THREE.CanvasTexture(em);
  emissive.colorSpace = THREE.SRGBColorSpace;
  emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
  return { map, emissive };
}

function signTexture(text, color, sub = '') {
  const w = 512, h = 256, c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = 'rgba(4,6,12,0.92)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.lineWidth = 6;
  g.strokeRect(6, 6, w - 12, h - 12);
  g.shadowColor = color; g.shadowBlur = 26;
  g.fillStyle = color;
  g.font = '800 82px Helvetica, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, sub ? h / 2 - 22 : h / 2, w - 56);
  if (sub) {
    g.font = '600 26px Helvetica, Arial, sans-serif';
    g.globalAlpha = 0.8;
    g.fillText(sub, w / 2, h / 2 + 62, w - 80);
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function asphaltTexture() {
  const s = 512, c = canvas(s), g = c.getContext('2d');
  g.fillStyle = '#0a0d13';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = `rgba(${120 + v * 80},${130 + v * 80},${150 + v * 70},${0.02 + Math.random() * 0.05})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 40; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.3})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    g.moveTo(x, y);
    for (let k = 0; k < 5; k++) { x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const PALETTES = [
  { name: 'Noche de neón', sky: [0x0a0f1e, 0x12081a, 0xff2d7a], fog: 0x0b1020, a: 0x49e6ff, b: 0xff4fd8, accent: 0xff9f43 },
  { name: 'Lluvia ácida', sky: [0x06120f, 0x0b1410, 0x5cff9d], fog: 0x081410, a: 0x5cff9d, b: 0x49e6ff, accent: 0xffe066 },
  { name: 'Distrito rojo', sky: [0x160709, 0x1a0a06, 0xff5a2a], fog: 0x140a0c, a: 0xff4fd8, b: 0xff9f43, accent: 0xff2d55 },
  { name: 'Cielo de cristal', sky: [0x070b18, 0x101a2e, 0x7ab8ff], fog: 0x0a1220, a: 0x7ab8ff, b: 0xc9a7ff, accent: 0x49e6ff },
  { name: 'Apagón', sky: [0x0a0a0c, 0x120607, 0xff2d55], fog: 0x0b0a0d, a: 0xff2d55, b: 0xffe066, accent: 0x49e6ff },
  { name: 'Amanecer sintético', sky: [0x1a0a1e, 0x2a0d18, 0xff9f43], fog: 0x14091a, a: 0xff9f43, b: 0xff4fd8, accent: 0x49e6ff }
];
