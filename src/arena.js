import * as THREE from 'three';
import { TEX, initTextures } from './fx.js';

// ---------------------------------------------------------------------------
// ARENA: plaza exterior cyberpunk. Rascacielos alrededor, balcones, anuncios
// de neón, lluvia, coches voladores y niebla. Nada de pasillos cerrados.
// ---------------------------------------------------------------------------

const PAL_BG = 0x05070c;

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function facade(cols, rows, tint, kind = 'grid') {
  const s = 512, c = canvas(s), g = c.getContext('2d');
  g.fillStyle = '#04060a';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 2200; i++) {
    g.fillStyle = `rgba(255,255,255,${Math.random() * 0.02})`;
    g.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }
  const em = canvas(s), ge = em.getContext('2d');
  ge.fillStyle = '#000';
  ge.fillRect(0, 0, s, s);
  const cw = s / cols, ch = s / rows;
  // cada arquetipo de fachada tiene su propio patrón de ventanas: sin esto todas
  // las torres comparten la misma trama y la calle se lee repetida
  const warm = ['#ffd9a0', '#ffe9c9', '#ffc27a', '#ffe9c9'];
  const cool = ['#bfe9ff', '#e6f4ff', '#a8d8ff', '#d6ecff'];
  const neonP = ['#ffb2f0', '#a8ffd8', '#ffd9a0', '#bfe9ff', '#ffe9c9'];
  const pal = (kind === 'glass' || kind === 'band') ? cool
    : kind === 'pixel' ? neonP
    : kind === 'dark' ? ['#c9d8e8', '#9fb4c8', '#ffd9a0']
    : warm;
  const litP = kind === 'dark' ? 0.1 : kind === 'glass' ? 0.62
    : kind === 'band' ? 0.55 : kind === 'pixel' ? 0.5 : 0.4;
  const xn = kind === 'band' ? 1 : cols;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < xn; x++) {
      let px, py, w, h;
      if (kind === 'glass') {          // paño continuo de oficinas
        px = x * cw + cw * 0.12; py = y * ch + ch * 0.06;
        w = cw * 0.76; h = ch * 0.88;
      } else if (kind === 'band') {    // forjados horizontales corridos
        px = 2; py = y * ch + ch * 0.28;
        w = s - 4; h = ch * 0.4;
      } else if (kind === 'pixel') {   // ventanas pequeñas tipo pantalla LED
        px = x * cw + cw * 0.32; py = y * ch + ch * 0.34;
        w = cw * 0.36; h = ch * 0.32;
      } else {                         // trama clásica
        px = x * cw + cw * 0.2; py = y * ch + ch * 0.22;
        w = cw * 0.6; h = ch * 0.46;
      }
      const lit = Math.random() < litP;
      g.fillStyle = '#080b11';
      g.fillRect(px - 1, py - 1, w + 2, h + 2);
      ge.fillStyle = lit ? pal[(Math.random() * pal.length) | 0] : '#0a1018';
      ge.globalAlpha = lit ? (kind === 'dark' ? 0.3 : 0.5) + Math.random() * 0.5 : 0.05;
      ge.fillRect(px, py, w, h);
      ge.globalAlpha = 1;
      if (lit && Math.random() < 0.3) {
        ge.fillStyle = tint;
        ge.globalAlpha = 0.5;
        ge.fillRect(px, py + h - 1.5, w, 1.5);
        ge.globalAlpha = 1;
      }
      if (!lit && kind === 'dark') {   // ventanas cegadas / en ruina
        g.fillStyle = `rgba(10,14,20,${0.5 + Math.random() * 0.4})`;
        g.fillRect(px, py, w, h);
      }
    }
  }
  // regueros de suciedad: las fachadas lisas se veían de plástico
  if (kind === 'dark' || Math.random() < 0.4) {
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * s, w = 1 + Math.random() * 5;
      g.fillStyle = `rgba(0,0,0,${0.12 + Math.random() * 0.25})`;
      g.fillRect(x, Math.random() * s * 0.4, w, s);
    }
  }
  const make = (cv) => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  };
  return { map: make(c), emissive: make(em) };
}

function signTex(text, color, sub = '') {
  const w = 512, h = 256, c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = 'rgba(3,5,10,0.9)';
  g.fillRect(0, 0, w, h);
  g.strokeStyle = color; g.lineWidth = 5;
  g.strokeRect(8, 8, w - 16, h - 16);
  g.shadowColor = color; g.shadowBlur = 30;
  g.fillStyle = color;
  g.font = '800 76px Helvetica, Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, sub ? h / 2 - 24 : h / 2, w - 64);
  if (sub) {
    g.font = '600 24px Helvetica, Arial, sans-serif';
    g.globalAlpha = 0.85;
    g.fillText(sub, w / 2, h / 2 + 60, w - 90);
    g.globalAlpha = 1;
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function asphalt() {
  const s = 512, c = canvas(s), g = c.getContext('2d');
  g.fillStyle = '#080b11';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 8000; i++) {
    const v = Math.random();
    g.fillStyle = `rgba(${110 + v * 90},${120 + v * 90},${150 + v * 80},${0.02 + Math.random() * 0.05})`;
    g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 30; i++) {
    g.strokeStyle = `rgba(0,0,0,${0.2 + Math.random() * 0.4})`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    g.moveTo(x, y);
    for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 80; y += (Math.random() - 0.5) * 80; g.lineTo(x, y); }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(16, 16);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// paso de cebra: una sola malla con textura transparente
function zebraTex() {
  const w = 512, h = 128, c = canvas(w, h), g = c.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.fillStyle = 'rgba(226,240,255,0.5)';
  for (let i = 0; i < 8; i++) g.fillRect(14 + i * 62, 8, 30, h - 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// cono/lámpara de farola colgante sobre la calzada
function lampTex() {
  const s = 128, c = canvas(s), g = c.getContext('2d');
  const grd = g.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,238,200,1)');
  grd.addColorStop(0.25, 'rgba(255,214,140,0.55)');
  grd.addColorStop(1, 'rgba(255,180,80,0)');
  g.fillStyle = grd; g.fillRect(0, 0, s, s);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// nube suave: varias puffs radiales sumadas; se usa en sprites aditivos
function cloudTex() {
  const s = 256, c = canvas(s), g = c.getContext('2d');
  g.clearRect(0, 0, s, s);
  for (let i = 0; i < 22; i++) {
    const x = s / 2 + (Math.random() - 0.5) * s * 0.66;
    const y = s / 2 + (Math.random() - 0.5) * s * 0.34;
    const r = s * (0.09 + Math.random() * 0.17);
    const a = 0.32 + Math.random() * 0.3;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(255,255,255,${a})`);
    grd.addColorStop(0.55, `rgba(255,255,255,${a * 0.6})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// disco de luna/planeta con halo
function moonTex() {
  const s = 256, c = canvas(s), g = c.getContext('2d');
  const R = s * 0.32;
  // halo tenue por fuera del disco
  const halo = g.createRadialGradient(s / 2, s / 2, R * 0.92, s / 2, s / 2, s / 2);
  halo.addColorStop(0, 'rgba(150,180,230,0.22)');
  halo.addColorStop(0.5, 'rgba(110,150,215,0.07)');
  halo.addColorStop(1, 'rgba(80,130,255,0)');
  g.fillStyle = halo; g.fillRect(0, 0, s, s);

  // disco: gris azulado, NUNCA blanco puro (el bloom lo quemaría)
  const disc = g.createRadialGradient(s / 2 - R * 0.3, s / 2 - R * 0.32, R * 0.05, s / 2, s / 2, R);
  disc.addColorStop(0, 'rgba(206,216,232,1)');
  disc.addColorStop(0.55, 'rgba(176,188,210,1)');
  disc.addColorStop(0.88, 'rgba(126,140,168,1)');
  disc.addColorStop(1, 'rgba(86,98,124,0.92)');
  g.beginPath(); g.arc(s / 2, s / 2, R, 0, Math.PI * 2); g.fillStyle = disc; g.fill();

  g.save();
  g.beginPath(); g.arc(s / 2, s / 2, R, 0, Math.PI * 2); g.clip();

  // mares: manchas grandes y oscuras
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R * 0.62;
    const rr = R * (0.26 + Math.random() * 0.22);
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
    const gg = g.createRadialGradient(x, y, 0, x, y, rr);
    gg.addColorStop(0, 'rgba(74,86,114,0.42)');
    gg.addColorStop(0.7, 'rgba(84,96,124,0.22)');
    gg.addColorStop(1, 'rgba(90,102,130,0)');
    g.fillStyle = gg; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }

  // cráteres: borde claro + fondo oscuro, para que se lean a tamaño pequeño
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * R * 0.86;
    const rr = R * (0.035 + Math.random() * 0.11);
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
    g.beginPath(); g.arc(x, y, rr * 1.25, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(226,236,250,0.30)'; g.lineWidth = Math.max(1, rr * 0.22); g.stroke();
    const gg = g.createRadialGradient(x, y, 0, x, y, rr);
    gg.addColorStop(0, 'rgba(58,70,96,0.55)');
    gg.addColorStop(1, 'rgba(70,82,110,0)');
    g.fillStyle = gg; g.beginPath(); g.arc(x, y, rr, 0, Math.PI * 2); g.fill();
  }
  // sombra de terminador en el borde inferior derecho
  const term = g.createRadialGradient(s / 2 + R * 0.5, s / 2 + R * 0.55, R * 0.2, s / 2, s / 2, R * 1.05);
  term.addColorStop(0, 'rgba(40,48,70,0.35)');
  term.addColorStop(1, 'rgba(40,48,70,0)');
  g.fillStyle = term; g.fillRect(0, 0, s, s);
  g.restore();

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shopfrontTex() {
  const w = 256, h = 128, c = canvas(w, h), g = c.getContext('2d');
  g.fillStyle = '#05070b'; g.fillRect(0, 0, w, h);
  // interior iluminado
  const grd = g.createLinearGradient(0, 20, 0, h);
  const hue = [ '255,180,90', '120,230,255', '255,110,200', '150,255,170' ][(Math.random() * 4) | 0];
  grd.addColorStop(0, `rgba(${hue},0.85)`);
  grd.addColorStop(0.6, `rgba(${hue},0.18)`);
  grd.addColorStop(1, 'rgba(0,0,0,0.9)');
  g.fillStyle = grd; g.fillRect(8, 14, w - 16, h - 26);
  // montantes
  g.fillStyle = '#05070b';
  for (let x = 8; x < w - 10; x += 34) g.fillRect(x, 14, 5, h - 26);
  // puerta
  const dx = 20 + Math.random() * (w - 90);
  g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(dx, 40, 44, h - 40);
  g.fillStyle = `rgba(${hue},0.5)`; g.fillRect(dx + 4, 44, 36, h - 48);
  // rótulo lineal
  g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(8, 6, w - 16, 5);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const PALETTES = [
  { name: 'NEÓN', sky: [0x080d1a, 0x0d0716, 0xff2d7a], fog: 0x0a0f1e, a: 0x49e6ff, b: 0xff4fd8, accent: 0xff9f43, rain: 0.7 },
  { name: 'LLUVIA ÁCIDA', sky: [0x04120e, 0x07140f, 0x5cff9d], fog: 0x06120e, a: 0x5cff9d, b: 0x49e6ff, accent: 0xffe066, rain: 1 },
  { name: 'DISTRITO ROJO', sky: [0x160608, 0x1a0a06, 0xff5a2a], fog: 0x120809, a: 0xff4fd8, b: 0xff9f43, accent: 0xff2d55, rain: 0.5 },
  { name: 'CRISTAL', sky: [0x060a17, 0x0d1626, 0x7ab8ff], fog: 0x0a1020, a: 0x7ab8ff, b: 0xc9a7ff, accent: 0x49e6ff, rain: 0.85 },
  { name: 'APAGÓN', sky: [0x08080a, 0x120607, 0xff2d55], fog: 0x0a090c, a: 0xff2d55, b: 0xffe066, accent: 0x49e6ff, rain: 0.6 },
  { name: 'AMANECER', sky: [0x1a0a1e, 0x2a0d18, 0xff9f43], fog: 0x14091a, a: 0xff9f43, b: 0xff4fd8, accent: 0x49e6ff, rain: 0.35 }
];

const _v = new THREE.Vector3();

export class Arena {
  constructor(scene) {
    initTextures();
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'arena';
    scene.add(this.root);
    this.nodes = [];
    this.cars = [];
    this.steam = [];
    this.beacons = [];
    this.t = 0;

    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        cTop: { value: new THREE.Color(0x080d1a) },
        cMid: { value: new THREE.Color(0x0d0716) },
        cBot: { value: new THREE.Color(0xff2d7a) }
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 cTop, cMid, cBot; varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          // base muy oscura: el neón del horizonte solo aporta una insinuación
          vec3 c = mix(cBot * 0.14, cMid, smoothstep(0.44, 0.62, h));
          c = mix(c, cTop, smoothstep(0.58, 0.98, h));
          // línea de luz pegada al horizonte
          float band = exp(-pow((h - 0.505) * 34.0, 2.0));
          c += cBot * band * 0.30;
          // halo difuso de ciudad
          float glow = exp(-pow((h - 0.5) * 10.0, 2.0));
          c += cBot * glow * 0.05;
          gl_FragColor = vec4(c, 1.0);
        }`
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), this.skyMat);
    this.sky.frustumCulled = false;
    this.root.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0x9dc4ff, 0x241530, 0.9);
    scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xbfd8ff, 0.85);
    this.key.position.set(-8, 20, 6);
    scene.add(this.key);
    this.neonLights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0x49e6ff, 0, 26, 2);
      l.position.set(Math.cos(i * 1.256) * 11, 5.5, Math.sin(i * 1.256) * 11);
      scene.add(l);
      this.neonLights.push(l);
    }

    this._ground();
    this._road();
    this._street();
    this._skybridges();
    this._sidewalks();
    this._shopfronts();
    this._streetLamps();
    this._props();
    this._cables();
    this._roadmarks();
    this._wetStreaks();
    this._skyline();
    this._clouds();
    this._moon();
    this._stars();
    this._airTraffic();
    this._searchlights();
    this._rain();
    this._cars();
    this._steamVents();
    this._track();
  }

  // ------------------------------------------------------------------ pasillo
  // Pilares y arcos ABSOLUTOS (no hijos del root): el root sigue al jugador para
  // mantener la plaza alrededor, pero estos elementos se reciclan en z y dan el
  // paralaje real de ir avanzando por la calle.
  _track() {
    this.trackProps = [];
    const pillarGeo = new THREE.BoxGeometry(0.42, 7, 0.42);
    const stripGeo = new THREE.BoxGeometry(0.1, 6.2, 0.1);
    const archGeo = new THREE.BoxGeometry(20, 0.32, 0.32);
    const archGlowGeo = new THREE.BoxGeometry(19.2, 0.08, 0.08);
    const dark = new THREE.MeshStandardMaterial({ color: 0x0e1420, roughness: 0.55, metalness: 0.85 });

    for (let i = 0; i < 18; i++) {
      const g = new THREE.Group();
      g.userData.strips = [];
      for (const s of [-1, 1]) {
        const p = new THREE.Mesh(pillarGeo, dark);
        p.position.set(s * 10.4, 3.5, 0);
        g.add(p);
        const st = new THREE.Mesh(stripGeo, new THREE.MeshBasicMaterial({
          color: 0x49e6ff, toneMapped: false, transparent: true, opacity: 0.85
        }));
        st.position.set(s * 10.02, 3.2, 0.2);
        g.add(st);
        g.userData.strips.push(st);
      }
      if (i % 3 === 0) {
        const a = new THREE.Mesh(archGeo, dark);
        a.position.set(0, 6.95, 0);
        g.add(a);
        const ag = new THREE.Mesh(archGlowGeo, new THREE.MeshBasicMaterial({
          color: 0xff4fd8, toneMapped: false
        }));
        ag.position.set(0, 6.75, 0);
        g.add(ag);
        g.userData.strips.push(ag);
      }
      this.scene.add(g);
      this.trackProps.push(g);
    }
    this._lightZ = this.neonLights.map(l => l.position.z);
  }

  // root sigue al jugador; el suelo se desplaza por textura y los pilares se reciclan
  setPlayerZ(z, travel = 0) {
    this.playerZ = z;
    this.root.position.z = z;
    this.neonLights.forEach((l, i) => { l.position.z = this._lightZ[i] + z; });
    // 16 repeticiones sobre 160 m -> 10 m por baldosa
    if (this.floorMat.map) this.floorMat.map.offset.y = (travel / 10) % 1;
    this._layoutBlocks(travel);
    const N = this.trackProps.length, SP = 9, CYCLE = N * SP;
    const from = z - 70;
    for (let i = 0; i < N; i++) {
      let d = (i * SP - from) % CYCLE;
      if (d < 0) d += CYCLE;
      this.trackProps[i].position.z = from + d;
    }
  }

  // ------------------------------------------------------------------ suelo
  _ground() {
    const tex = asphalt();
    this.floorMat = new THREE.MeshStandardMaterial({
      map: tex, color: 0x9aa7bb, roughness: 0.28, metalness: 0.55,
      envMapIntensity: 1.2
    });
    tex.repeat.set(40, 40);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(420, 420), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.root.add(floor);

    // charcos de neón: planos aditivos que reflectan la paleta
    this.puddles = [];
    const pgeo = new THREE.CircleGeometry(1, 24);
    for (let i = 0; i < 14; i++) {
      const m = new THREE.Mesh(pgeo, new THREE.MeshBasicMaterial({
        color: 0x49e6ff, transparent: true, opacity: 0.13,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 12;
      m.position.set(Math.cos(a) * r, 0.012 + Math.random() * 0.01, Math.sin(a) * r);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = Math.random() * Math.PI;
      m.scale.set(1.4 + Math.random() * 3.2, 1.4 + Math.random() * 2.6, 1);
      this.root.add(m);
      this.puddles.push(m);
    }

    // rejillas / desagües
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.3, r = 6.5 + Math.random() * 8;
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.55),
        new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.6, metalness: 0.8 }));
      g.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      g.rotation.y = a;
      this.root.add(g);
    }
  }

  _road() {
    // calzada: eje discontinuo + bordes de neón. Todo hijo del root (sigue al
    // jugador) pero el grupo del eje se desplaza con el avance para dar velocidad.
    this.dashGroup = new THREE.Group();
    const dashMat = new THREE.MeshBasicMaterial({
      color: 0x49e6ff, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    const dashGeo = new THREE.PlaneGeometry(0.16, 2.8);
    for (let i = 0; i < 30; i++) {
      const d = new THREE.Mesh(dashGeo, dashMat);
      d.rotation.x = -Math.PI / 2;
      d.position.set(0, 0.022, 24 - i * 9);
      this.dashGroup.add(d);
    }
    this.root.add(this.dashGroup);

    for (const sx of [-1, 1]) {
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(0.1, 260),
        new THREE.MeshBasicMaterial({
          color: 0xff4fd8, transparent: true, opacity: 0.4,
          blending: THREE.AdditiveBlending, depthWrite: false
        })
      );
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(sx * 9.4, 0.023, -100);
      this.root.add(edge);
    }
    // el temblor del anillo antiguo pasa a ser el pulso del asfalto
    this.rim = this.dashGroup;
    this.rimGlow = dashMat;
  }

  // ------------------------------------------------------------------- calle
  // Dos filas de edificios a los lados; cada bloque se recicla en z con el
  // avance, así la calle nunca se acaba. Los balcones y azoteas guardan sus
  // puntos de aparición (en local) para que los enemigos nazcan ahí.
  _street() {
    this.blocks = [];
    this.blockN = 16;
    this.blockSP = 14;
    this.banners = this.banners || [];
    this.beacons = this.beacons || [];
    const glowGeo = new THREE.PlaneGeometry(1, 1);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x0d131b, roughness: 0.7, metalness: 0.6 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a333f, roughness: 0.4, metalness: 0.8 });
    const slabMat = new THREE.MeshStandardMaterial({ color: 0x1b232e, roughness: 0.5, metalness: 0.6 });
    const railMat = new THREE.MeshBasicMaterial({ color: 0x49e6ff, toneMapped: false });

    for (let slot = 0; slot < this.blockN; slot++) {
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        // arquetipos: torre alta, rascacielos escalonado, bloque bajo comercial,
        // edificio medio. Rompen la silueta repetida de la calle.
        const roll = Math.random();
        let style, w, d, h;
        if (roll < 0.16) {
          style = 'tower';
          w = 8.5 + Math.random() * 4; d = 11 + Math.random() * 3; h = 30 + Math.random() * 26;
        } else if (roll < 0.34) {
          style = 'setback';
          w = 11 + Math.random() * 6; d = 12 + Math.random() * 4; h = 18 + Math.random() * 20;
        } else if (roll < 0.5) {
          style = 'podium';
          w = 14 + Math.random() * 7; d = 12 + Math.random() * 4; h = 7 + Math.random() * 6;
        } else if (roll < 0.68) {
          style = 'mid';
          w = 10 + Math.random() * 7; d = 12 + Math.random() * 4; h = 12 + Math.random() * 14;
        } else if (roll < 0.84) {
          // torre cilíndrica: única silueta redonda de la calle
          style = 'round';
          w = 9 + Math.random() * 5; d = w; h = 20 + Math.random() * 30;
        } else {
          // torre troncopiramidal: se afila hacia arriba
          style = 'taper';
          w = 11 + Math.random() * 6; d = 11 + Math.random() * 6; h = 16 + Math.random() * 26;
        }
        const inset = 11.6 + Math.random() * 2.4;  // fachada respecto al eje
        const cx = side * (inset + w / 2);
        const tints = ['#49e6ff', '#ff4fd8', '#ffe066', '#5cff9d', '#ff9f43', '#9ec4ff'];
        const tint = tints[(Math.random() * tints.length) | 0];

        const kinds = ['grid', 'grid', 'glass', 'band', 'pixel', 'dark'];
        const kind = kinds[(Math.random() * kinds.length) | 0];
        const f = facade(4 + ((Math.random() * 4) | 0), 8 + ((Math.random() * 10) | 0), tint, kind);
        const rX = style === 'round' ? Math.max(2, Math.round(Math.PI * w / 3.2)) : Math.max(1, d / 3);
        f.map.repeat.set(rX, Math.max(1, h / 4));
        f.emissive.repeat.copy(f.map.repeat);
        // cuerpo del edificio: hormigón, ladrillo viejo, acero oscuro... no todos iguales
        const bodies = [0x2a3444, 0x33404e, 0x3a3230, 0x252b38, 0x2f2a3a, 0x1f2a2c];
        const mat = new THREE.MeshStandardMaterial({
          map: f.map, emissiveMap: f.emissive, emissive: 0xffffff,
          emissiveIntensity: kind === 'dark' ? 0.5 : 0.95 + Math.random() * 0.7,
          roughness: 0.55 + Math.random() * 0.25, metalness: 0.3 + Math.random() * 0.35,
          color: bodies[(Math.random() * bodies.length) | 0]
        });
        let b;
        if (style === 'round') {
          b = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.5, w * 0.53, h, 22, 1), mat);
        } else if (style === 'taper') {
          // 4 caras + giro 45º = tronco de pirámide de base cuadrada
          b = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.30, w * 0.42, h, 4, 1), mat);
          b.rotation.y = Math.PI / 4;
        } else {
          b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        }
        b.position.set(cx, h / 2, 0);
        b.receiveShadow = true;
        g.add(b);

        if (style === 'round') {
          // azotea circular con anillo de neón: se lee como torre desde lejos
          const capR = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.54, w * 0.54, 0.7, 22), capMat);
          capR.position.set(cx, h + 0.35, 0);
          g.add(capR);
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(w * 0.56, 0.1, 6, 28),
            new THREE.MeshBasicMaterial({ color: tint, toneMapped: false }));
          ring.rotation.x = Math.PI / 2;
          ring.position.set(cx, h + 0.12, 0);
          g.add(ring);
        } else {
          const cw = style === 'taper' ? w * 0.5 : w * 0.72;
          const cap = new THREE.Mesh(new THREE.BoxGeometry(cw, 0.6, cw * 0.86), capMat);
          cap.position.set(cx, h + 0.3, 0);
          g.add(cap);
        }

        // --- silueta según arquetipo ------------------------------------
        const neon = new THREE.MeshBasicMaterial({ color: tint, toneMapped: false });
        if (style === 'setback') {
          const tiers = 1 + ((Math.random() * 2) | 0);
          let tw = w, td = d, ty = h;
          for (let t = 0; t < tiers; t++) {
            tw *= 0.6 + Math.random() * 0.16;
            td *= 0.7 + Math.random() * 0.14;
            const th = 5 + Math.random() * 13;
            const tier = new THREE.Mesh(new THREE.BoxGeometry(tw, th, td), mat);
            tier.position.set(cx, ty + th / 2, 0);
            tier.receiveShadow = true;
            g.add(tier);
            const band = new THREE.Mesh(new THREE.BoxGeometry(tw + 0.25, 0.16, td + 0.25), neon);
            band.position.set(cx, ty + th - 0.25, 0);
            g.add(band);
            ty += th;
          }
          if (Math.random() < 0.55) {
            const ah = 3 + Math.random() * 8;
            const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.45, ah, 6), metal);
            spire.position.set(cx, ty + ah / 2, 0);
            g.add(spire);
            const tip = new THREE.Sprite(new THREE.SpriteMaterial({
              map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0.9,
              blending: THREE.AdditiveBlending, depthWrite: false
            }));
            tip.position.set(cx, ty + ah, 0);
            tip.scale.setScalar(1.3);
            g.add(tip);
            this.beacons.push({ s: tip, ph: Math.random() * 6.28 });
          }
        } else if (style === 'tower') {
          // aletas verticales que escalonan la fachada
          const fins = 3 + ((Math.random() * 3) | 0);
          for (let k = 0; k < fins; k++) {
            const fin = new THREE.Mesh(
              new THREE.BoxGeometry(0.45, h * (0.45 + Math.random() * 0.5), 0.16), metal);
            fin.position.set(side * (inset + 0.02), h * 0.52, (k / (fins - 1) - 0.5) * d * 0.8);
            g.add(fin);
          }
          // corona luminosa en el borde superior
          for (const zs of [-1, 1]) {
            const bar = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, 0.12, 0.28), neon);
            bar.position.set(cx, h - 0.18, zs * d / 2);
            g.add(bar);
          }
          const bar2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.12, d * 1.01), neon);
          bar2.position.set(side * (inset + 0.02), h - 0.18, 0);
          g.add(bar2);
        } else if (style === 'podium') {
          // marquesina de calle sobre la acera
          const awn = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.16, d * 0.84), slabMat);
          awn.position.set(side * (inset - 1.15), 4.2, 0);
          g.add(awn);
          const eg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.09, d * 0.84), neon);
          eg.position.set(side * (inset - 2.5), 4.13, 0);
          g.add(eg);
          // equipo de azotea
          for (let k = 0; k < 4; k++) {
            const bw = 1.2 + Math.random() * 2.4, bh = 0.7 + Math.random() * 1.5;
            const box = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bw * 0.8), metal);
            box.position.set(cx + (Math.random() - 0.5) * w * 0.45, h + bh / 2 + 0.6,
              (Math.random() - 0.5) * d * 0.45);
            g.add(box);
          }
        } else if (style === 'round') {
          // dos aros de luz ceñidos al cilindro
          for (let k = 0; k < 2; k++) {
            const ry = h * (0.42 + Math.random() * 0.4);
            const hoop = new THREE.Mesh(
              new THREE.TorusGeometry(w * 0.51, 0.08, 6, 26), neon);
            hoop.rotation.x = Math.PI / 2;
            hoop.position.set(cx, ry, 0);
            g.add(hoop);
          }
        } else if (style === 'taper') {
          // aristas de neón de la pirámide truncada
          const ribY = h * 0.5, ribR = w * 0.36;
          for (let k = 0; k < 4; k++) {
            const a = Math.PI / 4 + k * Math.PI / 2;
            const rib = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.1), neon);
            rib.position.set(cx + Math.cos(a) * ribR, ribY, Math.sin(a) * ribR);
            g.add(rib);
          }
        } else {
          const mid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.18, 0.13, d + 0.18), neon);
          mid.position.set(cx, h * (0.55 + Math.random() * 0.2), 0);
          g.add(mid);
        }

        // depósito de agua en azotea: silueta inconfundible
        if (Math.random() < 0.3) {
          const tank = new THREE.Group();
          const body = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 2.1, 10), metal);
          body.position.y = 1.05;
          const cone = new THREE.Mesh(new THREE.ConeGeometry(1.25, 0.75, 10), metal);
          cone.position.y = 2.5;
          tank.add(body, cone);
          for (const lx of [-0.65, 0.65]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, 1.5, 0.09), metal);
            leg.position.set(lx, -0.7, 0);
            tank.add(leg);
          }
          tank.position.set(cx + (Math.random() - 0.5) * w * 0.35, h + 0.7,
            (Math.random() - 0.5) * d * 0.35);
          g.add(tank);
        }

        // antena con baliza roja
        if (Math.random() < 0.6) {
          const ah = 1.5 + Math.random() * 3.5;
          const az = (Math.random() - 0.5) * d * 0.4;
          const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.07, ah, 6), metal);
          ant.position.set(cx, h + ah / 2 + 0.6, az);
          g.add(ant);
          const beacon = new THREE.Sprite(new THREE.SpriteMaterial({
            map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0.85,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
          beacon.position.set(cx, h + ah + 0.9, az);
          beacon.scale.setScalar(1.4);
          g.add(beacon);
          this.beacons.push({ s: beacon, ph: Math.random() * 6.28 });
        }

        // grúa torre de obra: la silueta industrial más reconocible del skyline
        if ((style === 'mid' || style === 'tower' || style === 'setback') && Math.random() < 0.2) {
          const crane = new THREE.Group();
          const mastH = Math.min(10 + Math.random() * 12, h * 0.8);
          const mast = new THREE.Mesh(new THREE.BoxGeometry(0.55, mastH, 0.55), metal);
          mast.position.y = mastH / 2;
          crane.add(mast);
          // celosía de la torre: travesaños horizontales
          for (let k = 1; k < Math.floor(mastH / 2.2); k++) {
            const tie = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.09, 0.09), metal);
            tie.position.y = k * 2.2;
            crane.add(tie);
          }
          const jibL = 12 + Math.random() * 7;
          const jib = new THREE.Mesh(new THREE.BoxGeometry(jibL, 0.42, 0.42), metal);
          jib.position.set(-side * jibL * 0.5, mastH, 0);
          crane.add(jib);
          const back = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.38, 0.38), metal);
          back.position.set(side * 2.1, mastH, 0);
          crane.add(back);
          const cab = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.1), metal);
          cab.position.set(side * 0.4, mastH - 0.9, 0);
          crane.add(cab);
          // cables y gancho colgando sobre la calle
          const hx = -side * jibL * (0.55 + Math.random() * 0.35);
          const drop = 3 + Math.random() * 5;
          for (const dz of [-0.16, 0.16]) {
            const cable = new THREE.Mesh(new THREE.BoxGeometry(0.04, drop, 0.04), metal);
            cable.position.set(hx + dz * 0.5, mastH - drop / 2, dz);
            crane.add(cable);
          }
          const hook = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.5), capMat);
          hook.position.set(hx, mastH - drop, 0);
          crane.add(hook);
          const cTip = new THREE.Sprite(new THREE.SpriteMaterial({
            map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
          cTip.position.set(-side * jibL, mastH + 0.3, 0);
          cTip.scale.setScalar(1.2);
          crane.add(cTip);
          this.beacons.push({ s: cTip, ph: Math.random() * 6.28 });
          crane.position.set(cx + (Math.random() - 0.5) * w * 0.3, h + 0.6,
            (Math.random() - 0.5) * d * 0.5);
          g.add(crane);
        }

        // panel publicitario en azotea: rompe la línea de cornisas y da puntos
        // de referencia distintos según avanzas por la calle
        if (h > 15 && Math.random() < 0.55) {
          const pTexts = [
            ['ZEN-9', '#49e6ff', 'CLINICA'], ['KIRA', '#ff4fd8', 'HOTEL CAPSULA'],
            ['NOODLE', '#ffe066', '24 HORAS'], ['ARC', '#5cff9d', 'IMPLANTES'],
            ['SOMA', '#ff9f43', 'FARMACIA'], ['VEIL', '#9ec4ff', 'MEMORIA']
          ];
          const [pt, pc, ps] = pTexts[(Math.random() * pTexts.length) | 0];
          const pw = Math.min(d * 0.85, 9) * (0.8 + Math.random() * 0.4);
          const ph2 = pw * (0.42 + Math.random() * 0.22);
          const panel = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
            map: signTex(pt, pc, ps), transparent: true, toneMapped: false
          }));
          panel.scale.set(pw, ph2, 1);
          panel.position.set(cx + (Math.random() - 0.5) * w * 0.25, h + ph2 / 2 + 1.2,
            (Math.random() - 0.5) * d * 0.25);
          panel.rotation.y = (side < 0 ? 1 : -1) * (0.75 + Math.random() * 0.5);
          g.add(panel);
          this.banners.push(panel);
          const pgl = new THREE.Sprite(new THREE.SpriteMaterial({
            map: TEX.glow, color: new THREE.Color(pc), transparent: true, opacity: 0.18,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
          pgl.scale.set(pw * 1.5, ph2 * 1.9, 1);
          pgl.position.copy(panel.position);
          g.add(pgl);
        }

        // franjas verticales de neón en las esquinas de la fachada
        if (style !== 'round' && style !== 'taper' && Math.random() < 0.85) {
          const col = PALETTES[(Math.random() * 6) | 0].a;
          const sMat = new THREE.MeshBasicMaterial({ color: col, toneMapped: false });
          for (const zs of [-1, 1]) {
            const strip = new THREE.Mesh(new THREE.BoxGeometry(0.09, h * 0.92, 0.09), sMat);
            strip.position.set(side * (inset + 0.06), h * 0.5, zs * (d / 2 - 0.3));
            g.add(strip);
          }
        }

        // balcones hacia la calle: puntos de aparición a media altura
        const bals = [];
        const floors = (style === 'round' || style === 'taper')
          ? 0 : Math.min(7, Math.max(1, Math.floor((h - 3) / 3.05)));
        for (let fl = 1; fl <= floors; fl++) {
          if (Math.random() > 0.55) continue;
          const y = fl * 3.05 + 0.6;
          const bw = 2.4 + Math.random() * 2.6;
          const bz = (Math.random() - 0.5) * (d - 4);
          const bal = new THREE.Group();
          const slab = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.16, bw), slabMat);
          bal.add(slab);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, bw), railMat);
          rail.position.set(-side * 0.5, 0.55, 0);
          bal.add(rail);
          for (const zs of [-1, 1]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.55, 0.05), railMat);
            post.position.set(-side * 0.5, 0.28, zs * (bw / 2 - 0.03));
            bal.add(post);
          }
          bal.position.set(side * (inset - 0.55), y, bz);
          g.add(bal);
          // pies sobre la losa (slab de 0.16 centrada en y => superficie y+0.08).
          // Antes iba en y+0.92: el francotirador flotaba un metro sobre el balcón,
          // pegado a la fachada y a oscuras -> invisible y la oleada se bloqueaba.
          bals.push({ x: side * (inset - 0.55), y: y + 0.08, z: bz });
        }

        // cartel de neón
        if (Math.random() < 0.45 && h > 11) {
          const texts = [
            ['CYBER', '#49e6ff', 'SHOOT'], ['NEO', '#ff4fd8', 'LABS'], ['24H', '#ffe066', 'NOODLES'],
            ['SECTOR 07', '#ff4fd8', 'PROHIBIDO'], ['SYNTH', '#5cff9d', 'BAR'], ['HOTEL', '#ff9f43', 'KIRA'],
            ['DATA', '#49e6ff', 'CLINIC'], ['SUSHI', '#ff2d55', 'DRON']
          ];
          const [txt, col, sub] = texts[(Math.random() * texts.length) | 0];
          const sw = Math.min(d * 0.7, 6), sh = sw * 0.5;
          const sign = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({
            map: signTex(txt, col, sub), transparent: true, toneMapped: false
          }));
          sign.scale.set(sw, sh, 1);
          const sy = 6.5 + Math.random() * (h * 0.25);
          sign.position.set(side * (inset - 0.08), sy, (Math.random() - 0.5) * d * 0.4);
          sign.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
          g.add(sign);
          this.banners.push(sign);

          const gl = new THREE.Sprite(new THREE.SpriteMaterial({
            map: TEX.glow, color: new THREE.Color(col), transparent: true, opacity: 0.22,
            blending: THREE.AdditiveBlending, depthWrite: false
          }));
          gl.scale.set(sw * 1.7, sh * 2.1, 1);
          gl.position.copy(sign.position);
          gl.position.x -= side * 0.3;
          g.add(gl);

          // charco de luz del rótulo sobre el asfalto: reflejo alargado
          const ref = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color(col), transparent: true, opacity: 0.13,
              blending: THREE.AdditiveBlending, depthWrite: false
            }));
          ref.rotation.x = -Math.PI / 2;
          ref.scale.set(sw * 0.55, 16 + Math.random() * 10, 1);
          ref.position.set(side * (inset - 3.2), 0.017, sign.position.z + 4);
          g.add(ref);
        }

        this.root.add(g);
        this.blocks.push({ g, side, inset, cx, w, d, h, slot, bals });
      }
    }
    this._layoutBlocks(0);
  }

  // recoloca los bloques según lo recorrido: la calle fluye hacia el jugador
  _layoutBlocks(travel) {
    const CYCLE = this.blockN * this.blockSP;
    const t = ((travel % CYCLE) + CYCLE) % CYCLE;
    const from = -112;
    for (const b of this.blocks) {
      b.g.position.z = from + ((b.slot * this.blockSP + t) % CYCLE);
    }
    if (this.dashGroup) this.dashGroup.position.z = -(((travel % 9) + 9) % 9);
    if (this.bridgeGroup) {
      const bs = 44 * 3;
      this.bridgeGroup.position.z = -(((travel % bs) + bs) % bs);
    }
    if (this.cableGroup) {
      const cs = this.cableN * this.cableSP;
      this.cableGroup.position.z = -110 + ((travel % cs) + cs) % cs;
    }
    if (this.crossGroup) {
      const cs = this.crossSP * this.crossGroup.children.length;
      this.crossGroup.position.z = -(((travel % cs) + cs) % cs);
    }
    if (this.wetGroup) {
      const ws = 124;
      this.wetGroup.position.z = -(((travel % ws) + ws) % ws);
    }
  }

  // pasarelas peatonales entre edificios: cruzan la calle y enmarcan el avance
  _skybridges() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.45, metalness: 0.85 });
    const kids = new THREE.MeshStandardMaterial({ color: 0x2b3441, roughness: 0.5, metalness: 0.7 });
    this.bridgeGroup = new THREE.Group();
    const SP = 44;
    for (let i = 0; i < 3; i++) {
      const y = 13 + Math.random() * 10;
      const len = 25 + Math.random() * 5;
      const wide = 1.9 + Math.random() * 1.5;
      const hh = 2.2 + Math.random() * 1.3;
      const col = PALETTES[(Math.random() * 6) | 0].a;
      const tube = new THREE.Mesh(new THREE.BoxGeometry(len, hh, wide), kids);
      tube.position.set(0, y, -i * SP);
      this.bridgeGroup.add(tube);

      // banda luminosa en el bajo de la pasarela
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(len * 0.98, 0.1, 0.12),
        new THREE.MeshBasicMaterial({ color: col, toneMapped: false })
      );
      strip.position.set(0, y - hh / 2, wide / 2 + 0.01);
      this.bridgeGroup.add(strip);

      // ventanas encendidas en el lateral que mira al jugador
      const winMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0, toneMapped: false, transparent: true, opacity: 0.65 });
      const n = 10 + ((Math.random() * 6) | 0);
      for (let k = 0; k < n; k++) {
        const win = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.7), winMat);
        win.position.set(-len / 2 + 1.4 + k * ((len - 2.8) / (n - 1)), y + 0.25, wide / 2 + 0.02);
        this.bridgeGroup.add(win);
      }

      // apoyos verticales hasta la calle en los extremos
      for (const xs of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, y, 0.5), metal);
        post.position.set(xs * (len / 2 - 0.6), y / 2, 0);
        this.bridgeGroup.add(post);
      }
    }
    this.root.add(this.bridgeGroup);
  }


  // skyline lejano en DOS capas: media (silueta cercana) y lejana (recorte limpio
  // sobre el cielo para que quede hueco visible entre torre y torre).
  _skyline() {
    const midMat = new THREE.MeshStandardMaterial({
      color: 0x0b1220, emissive: 0x0a1830, emissiveIntensity: 0.6, roughness: 0.9
    });
    const farMat = new THREE.MeshBasicMaterial({ color: 0x111c33, fog: false });
    const farWin = new THREE.MeshBasicMaterial({ color: 0x2a4a7a, fog: false });
    // ventana angular despejada para que la luna no quede tapada por el skyline
    // (el barrido de colisión dio el hueco de cielo real a lo largo de la calle: azimut 0)
    const aMoon = -Math.PI / 2;
    const clear = a => {
      const d = Math.abs(((a - aMoon + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      return d > 0.16;
    };

    for (let i = 0; i < 44; i++) {
      const a = (i / 44) * Math.PI * 2 + Math.random() * 0.12;
      if (!clear(a)) continue;
      const r = 58 + Math.random() * 18;
      const w = 5 + Math.random() * 11, h = 9 + Math.random() * 20, d = 5 + Math.random() * 11;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), midMat);
      m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
      m.rotation.y = Math.random() * Math.PI;
      this.root.add(m);
    }

    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2 + Math.random() * 0.14;
      if (!clear(a)) continue;
      const r = 108 + Math.random() * 26;
      const w = 7 + Math.random() * 13, h = 26 + Math.random() * 46, d = 7 + Math.random() * 13;
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), farMat);
      m.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
      m.rotation.y = Math.random() * Math.PI;
      this.root.add(m);
      // remate de luces: una franja fina de ventanas en la corona
      if (Math.random() < 0.6) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.5, d * 0.92), farWin);
        band.position.set(m.position.x, h - 3.5, m.position.z);
        band.rotation.y = m.rotation.y;
        this.root.add(band);
      }
    }
  }

  // ------------------------------------------------------------------ cielo
  // Nubes aditivas repartidas por la cúpula (ángulo áureo para que no se apelotonen):
  // altas frías, medias y bajas encendidas por el neón de la calle.
  _clouds() {
    const tex = cloudTex();
    this.clouds = [];
    let ang = 0;
    const add = (layer, color, op, wideMin, wideMax, yMin, yMax, rMin, rMax) => {
      const m = new THREE.SpriteMaterial({
        map: tex, color, transparent: true, opacity: op,
        depthWrite: false, blending: THREE.AdditiveBlending, fog: false
      });
      const s = new THREE.Sprite(m);
      const wide = wideMin + Math.random() * (wideMax - wideMin);
      s.scale.set(wide, wide * 0.34, 1);
      ang += 2.39996 + Math.random() * 0.35;
      const r = rMin + Math.random() * (rMax - rMin);
      s.position.set(
        Math.cos(ang) * r,
        yMin + Math.random() * (yMax - yMin),
        Math.sin(ang) * r
      );
      this.root.add(s);
      this.clouds.push({ s, layer, vx: (0.25 + Math.random() * 0.7) * (Math.random() < 0.5 ? -1 : 1) });
    };

    // capa alta: jirones finos
    for (let i = 0; i < 14; i++) {
      add('hi', 0x9cc0ff, 0.10 + Math.random() * 0.10, 70, 135, 44, 70, 95, 138);
    }
    // capa media: masas que cruzan el hueco de la calle
    for (let i = 0; i < 9; i++) {
      add('mid', 0xbfd4ff, 0.08 + Math.random() * 0.09, 55, 100, 26, 44, 75, 125);
    }
    // capa baja: vientres teñidos de rosa por las luces de abajo
    for (let i = 0; i < 7; i++) {
      add('low', 0xff7cc0, 0.06 + Math.random() * 0.07, 60, 115, 14, 26, 60, 100);
    }

    // nubes en el hueco de cielo que queda sobre el fondo de la calle:
    // sin estas, el único trozo de cielo visible siempre está vacío
    // La luna ocupa ~14º de cielo centrada a 21,5º de elevación: las nubes van por
    // DEBAJO (11–14,5º) o muy por ENCIMA (31–36º) para no taparle el disco, que es
    // el único detalle del cielo. NormalBlending, no aditivo: sobre el azul oscuro
    // el aditivo se iba a negro y las nubes no se veían.
    const aMoon = -Math.PI / 2;
    const puff = (az, elDeg, wide, color, op) => {
      const m = new THREE.SpriteMaterial({
        map: tex, color, transparent: true, opacity: op,
        depthWrite: false, blending: THREE.NormalBlending, fog: false
      });
      const s = new THREE.Sprite(m);
      s.scale.set(wide, wide * (0.24 + Math.random() * 0.12), 1);
      const el = elDeg * Math.PI / 180;
      const r = 62 + Math.random() * 46;
      s.position.set(Math.cos(az) * r * Math.cos(el), r * Math.sin(el), Math.sin(az) * r * Math.cos(el));
      this.root.add(s);
      this.clouds.push({ s, layer: 'mid', vx: (0.2 + Math.random() * 0.5) * (Math.random() < 0.5 ? -1 : 1) });
    };
    // banco bajo: jirones rosas justo sobre las cornisas, bajo el disco
    for (let i = 0; i < 5; i++) {
      puff(aMoon + (Math.random() - 0.5) * 0.55, 10.5 + Math.random() * 3.6,
        46 + Math.random() * 44, i % 2 ? 0x8a6f96 : 0x5f6f9a, 0.30 + Math.random() * 0.2);
    }
    // cirros altos, cruzando por encima de la luna
    for (let i = 0; i < 4; i++) {
      puff(aMoon + (Math.random() - 0.5) * 1.1, 31 + Math.random() * 5,
        70 + Math.random() * 70, i % 2 ? 0x7688ad : 0x9a86a8, 0.20 + Math.random() * 0.16);
    }
  }

  _moon() {
    const tex = moonTex();
    // color y opacidad bajos a propósito: con bloom threshold 0.72 un blanco puro
    // se convierte en un fogonazo sin cráteres. Este valor queda justo por debajo.
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0xa8c4ee, transparent: true, opacity: 0.62,
      depthWrite: false, blending: THREE.NormalBlending, fog: false
    }));
    this.moon.scale.set(30, 30, 1);
    // 50 de alto: por debajo de ~44 el skyline le come la mitad inferior del disco
    this.moon.position.set(0, 50, -122);
    this.root.add(this.moon);

    this.moonHalo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: 0x6f9dff, transparent: true, opacity: 0.16,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    }));
    this.moonHalo.scale.set(54, 54, 1);
    this.moonHalo.position.copy(this.moon.position);
    this.root.add(this.moonHalo);
  }

  _stars() {
    const N = 420;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2;
      const y = 0.16 + Math.random() * 0.84;
      const r = 128;
      const h = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(a) * h * r;
      pos[i * 3 + 1] = y * r;
      pos[i * 3 + 2] = Math.sin(a) * h * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xbcd8ff, size: 0.75, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true, fog: false
    }));
    this.root.add(this.stars);
  }

  // Tráfico aéreo lejano: luces cruzando el cielo entre los edificios.
  _airTraffic() {
    this.air = [];
    const cols = [0x49e6ff, 0xff4fd8, 0xffe066, 0xff9f43];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.SpriteMaterial({
        map: TEX.lamp, color: cols[i % cols.length], transparent: true,
        opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
      });
      const s = new THREE.Sprite(m);
      const sc = 0.9 + Math.random() * 1.5;
      s.scale.set(sc, sc, 1);
      s.position.set(
        (Math.random() - 0.5) * 150,
        16 + Math.random() * 30,
        -20 - Math.random() * 80
      );
      this.root.add(s);
      this.air.push({
        s,
        vx: (2.2 + Math.random() * 5.5) * (Math.random() < 0.5 ? -1 : 1),
        ph: Math.random() * 6.28
      });
    }
  }

  // Haces de búsqueda desde azoteas + relámpago lejano.
  _searchlights() {
    const mat = () => new THREE.MeshBasicMaterial({
      color: 0x7fb8ff, transparent: true, opacity: 0.045,
      depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false
    });
    this.beams = [];
    const spots = [[-15, 22, -8, -0.35], [16, 26, -26, 0.42], [-13, 20, 20, 0.3]];
    for (const [x, y, z, tilt] of spots) {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 5.5, 58, 14, 1, true), mat());
      cone.position.y = 29;
      g.add(cone);
      g.rotation.z = tilt;
      this.root.add(g);
      this.beams.push({ g, tilt, ph: Math.random() * 6.28 });
    }

    this.stormFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.lamp, color: 0xcfe4ff, transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    }));
    this.stormFlash.scale.set(150, 90, 1);
    this.stormFlash.position.set(30, 40, -110);
    this.root.add(this.stormFlash);
    this.flashT = 6;
    this.flashA = 0;
  }


  // puntos de aparición POR DELANTE del jugador, ya en coordenadas de mundo
  pickNodeAhead(rng, kind, taken, minDist, aheadMin = 10, aheadMax = 34, player) {
    const pz = this.playerZ || 0;
    const cands = [];
    const any = !kind || kind === 'any';
    const wantGround = any || kind === 'ground';
    const wantAir = any || kind === 'air';
    const wantHigh = any || kind === 'roof' || kind === 'ledge' || kind === 'balcony';

    if (wantGround) {
      for (let i = 0; i < 8; i++) {
        const dz = aheadMin + rng() * (aheadMax - aheadMin);
        const x = (rng() < 0.5 ? -1 : 1) * (2.2 + rng() * 6.6);
        cands.push({ pos: new THREE.Vector3(x, 0, pz - dz), kind: 'ground' });
      }
    }
    if (wantAir) {
      for (let i = 0; i < 8; i++) {
        const dz = aheadMin + rng() * (aheadMax - aheadMin);
        const x = (rng() < 0.5 ? -1 : 1) * (2.2 + rng() * 7.2);
        cands.push({ pos: new THREE.Vector3(x, 4.2 + rng() * 4.6, pz - dz), kind: 'air' });
      }
    }
    if (wantHigh) {
      const lo = pz - aheadMax, hi = pz - aheadMin;
      for (const b of this.blocks) {
        const bz = pz + b.g.position.z;
        if (bz < lo || bz > hi) continue;
        if (kind !== 'ledge' && kind !== 'balcony') {
          for (let i = 0; i < 3; i++) {
            cands.push({
              pos: new THREE.Vector3(b.cx, b.h + 0.4, bz + (rng() - 0.5) * b.d * 0.6),
              kind: 'roof'
            });
          }
        }
        for (const bal of b.bals) {
          // Un enemigo de balcón tiene que verse desde la calle: si aparece
          // fuera del cono de visión, alto o lejos, se queda invisible y la
          // oleada no avanza. Filtramos por distancia, ángulo y altura.
          const dz = pz - (bz + bal.z);
          if (bal.y < 2.2 || bal.y > 11.5) continue;
          if (dz < Math.max(9, aheadMin) || dz > 23) continue;
          if (Math.abs(Math.atan2(bal.x, dz)) > 0.52) continue;
          cands.push({ pos: new THREE.Vector3(bal.x, bal.y, bz + bal.z), kind: 'balcony' });
        }
      }
    }
    if (!cands.length) return null;

    let best = null;
    for (let tries = 0; tries < 20; tries++) {
      const c = cands[(rng() * cands.length) | 0];
      const cand = {
        pos: c.pos.clone(),
        kind: c.kind,
        dir: player.clone().sub(c.pos).normalize()
      };
      if (!best) best = cand;
      let ok = true;
      for (const t of taken) {
        if (t.distanceToSquared(cand.pos) < minDist * minDist) { ok = false; break; }
      }
      if (ok) return cand;
    }
    return best;
  }

  // ------------------------------------------------------------------ lluvia
  _rain() {
    const N = 2200;
    const pos = new Float32Array(N * 6);
    this.rainVel = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (Math.random() - 0.5) * 90, y = Math.random() * 34, z = (Math.random() - 0.5) * 90;
      const l = 0.5 + Math.random() * 0.8;
      pos[i * 6 + 0] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
      pos[i * 6 + 3] = x + 0.1; pos[i * 6 + 4] = y - l; pos[i * 6 + 5] = z;
      this.rainVel[i] = 16 + Math.random() * 14;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.LineBasicMaterial({
      color: 0x9fd8ff, transparent: true, opacity: 0.28,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    this.rain = new THREE.LineSegments(geo, this.rainMat);
    this.rain.frustumCulled = false;
    this.root.add(this.rain);
  }

  _cars() {
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 0.9),
        new THREE.MeshStandardMaterial({ color: 0x11161f, metalness: 0.9, roughness: 0.3 }));
      g.add(body);
      const col = [0x49e6ff, 0xff4fd8, 0xffe066][i % 3];
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.8),
        new THREE.MeshBasicMaterial({ color: col }));
      tail.position.set(-1.1, 0, 0);
      g.add(tail);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.glow, color: col, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      glow.scale.setScalar(2.6);
      glow.position.set(-1.3, 0, 0);
      g.add(glow);
      g.position.set((Math.random() - 0.5) * 70, 15 + Math.random() * 16, (Math.random() - 0.5) * 60);
      g.userData = {
        speed: (Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 8),
        y: g.position.y, ph: Math.random() * 6.28
      };
      this.root.add(g);
      this.cars.push(g);
    }
  }

  _steamVents() {
    for (let i = 0; i < 14; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.smoke, color: 0x8fb6d8, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      const a = Math.random() * Math.PI * 2, r = 7 + Math.random() * 12;
      s.position.set(Math.cos(a) * r, Math.random() * 3, Math.sin(a) * r);
      s.scale.setScalar(1.2 + Math.random());
      this.root.add(s);
      this.steam.push({ s, ph: Math.random() * 6.28, speed: 0.25 + Math.random() * 0.5, baseY: s.position.y });
    }
  }

  // paleta por nivel
  setPalette(p) {
    this.pal = p;
    this.skyMat.uniforms.cTop.value.setHex(p.sky[0]);
    this.skyMat.uniforms.cMid.value.setHex(p.sky[1]);
    this.skyMat.uniforms.cBot.value.setHex(p.sky[2]);
    this.scene.fog = new THREE.FogExp2(p.fog, 0.014);
    this.scene.background = new THREE.Color(p.fog);
    if (this.rimGlow) this.rimGlow.color.setHex(p.a);
    this.rainMat.color.setHex(p.a === 0xff9f43 ? 0xffd0a0 : 0x9fd8ff);
    this.puddles.forEach((m, i) => m.material.color.setHex(i % 2 ? p.a : p.b));
    this.banners.forEach((m, i) => {
      const c = i % 2 ? p.a : p.b;
      m.material.color.setHex(0xffffff);
      if (m.material.map) m.material.map.needsUpdate = true;
      m.userData.neon = c;
    });
    this.neonLights.forEach((l, i) => {
      l.color.setHex(i % 2 ? p.a : p.b);
      l.intensity = 22;
    });
    this.hemi.color.setHex(p.a);
    this.hemi.groundColor.setHex(p.b);
    this.hemi.intensity = 0.7;

    // cielo: nubes y luna se tiñen con la paleta del tramo
    if (this.clouds) {
      const tc = new THREE.Color();
      this.clouds.forEach(c => {
        if (c.layer === 'low') tc.setHex(0xff7cc0).lerp(new THREE.Color(p.a), 0.22);
        else if (c.layer === 'mid') tc.setHex(0xbfd4ff).lerp(new THREE.Color(p.b), 0.28);
        else tc.setHex(0x9cc0ff).lerp(new THREE.Color(p.a), 0.35);
        c.s.material.color.copy(tc);
      });
    }
    // nada de blanco puro: el bloom lo convertía en un fogonazo sin cráteres
    if (this.moon) this.moon.material.color.setHex(0xc2d2ea);
    if (this.moonHalo) this.moonHalo.material.color.setHex(p.a);
    if (this.beams) this.beams.forEach((b, i) => {
      b.g.children[0].material.color.setHex(i % 2 ? p.a : p.b);
    });
    if (this.stars) this.stars.material.color.setHex(p.a);
  }

  _sidewalks() {
    const walkMat = new THREE.MeshStandardMaterial({ color: 0x1a212c, roughness: 0.7, metalness: 0.35 });
    const curbMat = new THREE.MeshBasicMaterial({ color: 0x49e6ff, toneMapped: false, transparent: true, opacity: 0.75 });
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.26, 320), walkMat);
      w.position.set(s * 10.9, 0.13, -110);
      w.receiveShadow = true;
      this.root.add(w);
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 320), curbMat);
      c.position.set(s * 9.5, 0.27, -110);
      this.root.add(c);
    }
  }

  // reflejos largos de neón sobre el asfalto mojado (baratos: planos aditivos)
  _wetStreaks() {
    this.wetGroup = new THREE.Group();
    this.wet = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0x49e6ff, transparent: true, opacity: 0.07,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      m.rotation.x = -Math.PI / 2;
      const side = Math.random() < 0.5 ? -1 : 1;
      m.position.set(side * (3 + Math.random() * 6), 0.016, 20 - i * 8);
      const len = 8 + Math.random() * 16;
      m.scale.set(0.7 + Math.random() * 1.6, len, 1);
      this.wetGroup.add(m);
      this.wet.push(m);
    }
    this.root.add(this.wetGroup);
  }

  // cables y lámparas colgando entre fachadas
  _cables() {
    this.cableGroup = new THREE.Group();
    this.cableN = 12;
    this.cableSP = 15;
    const mat = new THREE.LineBasicMaterial({ color: 0x05080e, transparent: true, opacity: 0.95 });
    const lampGeo = new THREE.SphereGeometry(0.12, 8, 6);
    for (let i = 0; i < this.cableN; i++) {
      const y0 = 6.4 + Math.random() * 2.2, sag = 0.7 + Math.random() * 1.2;
      const pts = [];
      for (let k = 0; k <= 12; k++) {
        const u = k / 12;
        const x = -12.4 + u * 24.8;
        pts.push(new THREE.Vector3(x, y0 - Math.sin(u * Math.PI) * sag, 0));
      }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
      this.cableGroup.add(line);
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: 0xffe9b0, toneMapped: false }));
      lamp.position.set((Math.random() - 0.5) * 6, y0 - sag - 0.2, 0);
      this.cableGroup.add(lamp);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.glow, color: 0xffd27a, transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      halo.position.copy(lamp.position);
      halo.scale.setScalar(2.2);
      this.cableGroup.add(halo);
    }
    this.root.add(this.cableGroup);
  }

  // escaparates a pie de calle: las fachadas se anclan visualmente al suelo
  _shopfronts() {
    for (const b of this.blocks) {
      const sw = Math.min(b.d * 0.86, 11);
      const front = new THREE.Mesh(new THREE.PlaneGeometry(sw, 3.0),
        new THREE.MeshBasicMaterial({ map: shopfrontTex(), toneMapped: false }));
      front.position.set(b.side * (b.inset - 0.03), 1.55, 0);
      front.rotation.y = b.side < 0 ? Math.PI / 2 : -Math.PI / 2;
      b.g.add(front);
      b.front = front;
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.6, sw * 0.8),
        new THREE.MeshBasicMaterial({
          color: 0xffc98a, transparent: true, opacity: 0.1,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(b.side * (b.inset - 1.6), 0.017, 0);
      b.g.add(pool);
    }
  }

  // líneas laterales continuas + pasos de cebra que fluyen con el avance
  _roadmarks() {
    const lineMat = new THREE.MeshBasicMaterial({
      color: 0xdfe9ff, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    for (const s of [-1, 1]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 340), lineMat);
      l.rotation.x = -Math.PI / 2;
      l.position.set(s * 8.7, 0.015, -110);
      this.root.add(l);
    }
    const zt = zebraTex();
    this.crossGroup = new THREE.Group();
    this.crossSP = 46;
    for (let i = 0; i < 4; i++) {
      const z = new THREE.Mesh(new THREE.PlaneGeometry(17.4, 3.4),
        new THREE.MeshBasicMaterial({ map: zt, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
      z.rotation.x = -Math.PI / 2;
      z.position.set(0, 0.018, -i * this.crossSP);
      this.crossGroup.add(z);
    }
    this.root.add(this.crossGroup);
  }

  // farolas de pie: poste + cabezal + charco de luz en el asfalto
  _streetLamps() {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x1f2731, roughness: 0.45, metalness: 0.85 });
    const lmap = lampTex();
    for (const b of this.blocks) {
      if (Math.random() > 0.45) continue;
      const x = b.side * 9.9;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5.2, 6), poleMat);
      pole.position.set(x, 2.6, 0);
      b.g.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.09), poleMat);
      arm.position.set(x - b.side * 0.7, 5.15, 0);
      b.g.add(arm);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.14, 0.28),
        new THREE.MeshBasicMaterial({ color: 0xffe6b8, toneMapped: false }));
      head.position.set(x - b.side * 1.4, 5.05, 0);
      b.g.add(head);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: lmap, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false
      }));
      halo.position.set(x - b.side * 1.4, 4.95, 0);
      halo.scale.setScalar(3.4);
      b.g.add(halo);
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(6.2, 9),
        new THREE.MeshBasicMaterial({
          map: lmap, transparent: true, opacity: 0.3, color: 0xffcf8a,
          blending: THREE.AdditiveBlending, depthWrite: false
        }));
      pool.rotation.x = -Math.PI / 2;
      pool.position.set(x - b.side * 1.6, 0.019, 0);
      b.g.add(pool);
    }
  }

  // mobiliario y vida a pie de calle: máquinas expendedoras, cubos, cajas de aire
  _props() {
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c232c, roughness: 0.6, metalness: 0.5 });
    const rust = new THREE.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.85, metalness: 0.2 });
    for (const b of this.blocks) {
      const n = 1 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const z = (Math.random() - 0.5) * (b.d - 3);
        const r = Math.random();
        if (r < 0.4) {
          // máquina expendedora con frente luminosa
          const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.0, 1.15), dark);
          const x = b.side * (b.inset - 0.5);
          m.position.set(x, 1.0, z);
          b.g.add(m);
          const f = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 1.55),
            new THREE.MeshBasicMaterial({
              map: shopfrontTex(), toneMapped: false, transparent: true, opacity: 0.9
            }));
          f.position.set(x - b.side * 0.42, 1.12, z);
          f.rotation.y = b.side < 0 ? Math.PI / 2 : -Math.PI / 2;
          b.g.add(f);
        } else if (r < 0.72) {
          // cubo de basura
          const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 1.0, 8), rust);
          m.position.set(b.side * (b.inset - 0.75), 0.5, z);
          b.g.add(m);
        } else {
          // cajas de aire acondicionado colgadas de la fachada
          for (let k = 0; k < 3; k++) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.8), dark);
            m.position.set(b.side * (b.inset - 0.28), 4.5 + k * 3.05 + Math.random(), z + (Math.random() - 0.5) * 2);
            b.g.add(m);
          }
        }
      }
    }
  }

  update(dt, t) {
    this.t += dt;
    // lluvia
    const p = this.rain.geometry.attributes.position.array;
    const sp = (this.pal && this.pal.rain) || 0.7;
    for (let i = 0; i < this.rainVel.length; i++) {
      const k = i * 6;
      const d = this.rainVel[i] * dt * sp;
      p[k + 1] -= d; p[k + 4] -= d;
      p[k] += d * 0.08; p[k + 3] += d * 0.08;
      if (p[k + 1] < 0) {
        const y = 30 + Math.random() * 6;
        const x = (Math.random() - 0.5) * 90, z = (Math.random() - 0.5) * 90;
        const l = 0.5 + Math.random() * 0.8;
        p[k] = x; p[k + 1] = y; p[k + 2] = z;
        p[k + 3] = x + 0.1; p[k + 4] = y - l; p[k + 5] = z;
      }
    }
    this.rain.geometry.attributes.position.needsUpdate = true;

    // cielo vivo: nubes a la deriva, tráfico aéreo, haces y relámpagos
    if (this.clouds) for (const c of this.clouds) {
      c.s.position.x += c.vx * dt;
      if (c.s.position.x > 150) c.s.position.x = -150;
      if (c.s.position.x < -150) c.s.position.x = 150;
    }
    if (this.air) for (const a of this.air) {
      a.s.position.x += a.vx * dt;
      if (a.s.position.x > 95) a.s.position.x = -95;
      if (a.s.position.x < -95) a.s.position.x = 95;
      a.s.material.opacity = 0.45 + 0.45 * Math.abs(Math.sin(t * 2.6 + a.ph));
    }
    if (this.beams) for (const b of this.beams) {
      b.g.rotation.z = b.tilt + Math.sin(t * 0.19 + b.ph) * 0.55;
      b.g.rotation.x = Math.sin(t * 0.13 + b.ph * 2) * 0.22;
    }
    if (this.moonHalo) this.moonHalo.material.opacity = 0.13 + Math.sin(t * 0.7) * 0.04;
    if (this.stormFlash) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.flashT = 9 + Math.random() * 14;
        this.flashA = 1;
        this.stormFlash.position.x = -60 + Math.random() * 120;
        this.stormFlash.position.y = 34 + Math.random() * 18;
      }
      this.flashA = Math.max(0, this.flashA - dt * 3.2);
      const f = this.flashA * (0.55 + 0.45 * Math.abs(Math.sin(t * 47)));
      this.stormFlash.material.opacity = f * 0.5;
    }

    // coches
    for (const c of this.cars) {
      c.position.x += c.userData.speed * dt;
      c.position.y = c.userData.y + Math.sin(t * 0.7 + c.userData.ph) * 0.35;
      if (c.position.x > 46) c.position.x = -46;
      if (c.position.x < -46) c.position.x = 46;
    }

    // vapor
    for (const v of this.steam) {
      v.s.position.y += v.speed * dt;
      if (v.s.position.y > v.baseY + 4.5) v.s.position.y = v.baseY;
      const k = (v.s.position.y - v.baseY) / 4.5;
      v.s.material.opacity = Math.sin(k * Math.PI) * 0.12;
      v.s.position.x += Math.sin(t * 0.6 + v.ph) * 0.004;
    }

    // balizas
    for (const b of this.beacons) {
      const k = 0.5 + 0.5 * Math.sin(t * 2.4 + b.ph);
      b.s.material.opacity = 0.25 + k * 0.75;
      b.s.scale.setScalar(0.7 + k * 0.9);
    }

    // pulso de la calzada
    if (this.rimGlow) this.rimGlow.opacity = 0.22 + Math.sin(t * 1.6) * 0.1;
  }
}
