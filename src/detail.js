import * as THREE from 'three';

/* ---------------------------------------------------------------------------
   DETAIL: herramental de detalle para los enemigos.

   El enemigo "de caja" canta a juguete por tres motivos: aristas vivas, color
   plano y superficies perfectas. Aquí se resuelven los tres sin cargar ni un
   solo asset externo:
     - roundBox(): volumen con chaflán real (bisel de 2 segmentos), así las
       aristas recogen la luz y dejan de ser cuchillas.
     - detailSet(): juego de mapas PBR procedurales (grano, líneas de panel,
       arañazos, manchas de aceite) que se comparten entre materiales.
     - decal(), hose(), vent(), rivets(): chatarra encima del volumen.
--------------------------------------------------------------------------- */

/* -------------------------------------------------------------- geometría */

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  r = Math.max(0.0005, Math.min(r, w / 2 - 0.001, h / 2 - 0.001));
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Caja con las aristas biseladas. Mismas dimensiones exteriores que BoxGeometry. */
export function roundBox(w, h, d, r = 0.02, seg = 2) {
  const rr = Math.max(0.001, Math.min(r, Math.min(w, h, d) * 0.48));
  const shape = roundedRect(w - 2 * rr, h - 2 * rr, rr);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.001, d - 2 * rr),
    bevelEnabled: true,
    bevelThickness: rr,
    bevelSize: rr,
    bevelSegments: seg,
    curveSegments: 3,
    steps: 1
  });
  geo.center();
  return geo;
}

/* ---------------------------------------------------------------- texturas */

const SIZE = 512;
let _set = null;

function rnd(seed) {
  // LCG: mismo detalle en cada carga, nada de superficies que cambian
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function heightCanvas() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const c = cv.getContext('2d');
  const R = rnd(9137);

  // base: aleación ligeramente irregular
  c.fillStyle = '#808080';
  c.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 24000; i++) {
    const g = 118 + Math.floor(R() * 26);
    c.fillStyle = `rgb(${g},${g},${g})`;
    c.fillRect(R() * SIZE, R() * SIZE, 2, 2);
  }

  // grano fino
  const img = c.getImageData(0, 0, SIZE, SIZE);
  const px = img.data;
  for (let i = 0; i < px.length; i += 4) {
    const n = (R() - 0.5) * 16;
    px[i] += n; px[i + 1] += n; px[i + 2] += n;
  }
  c.putImageData(img, 0, 0);

  // líneas de panel: una rejilla con un par de divisiones extra, desplazada
  // para que al repetir no se note el patrón
  const seam = (x1, y1, x2, y2, w) => {
    c.strokeStyle = '#4a4a4a';
    c.lineWidth = w;
    c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
    c.strokeStyle = '#b8b8b8';
    c.lineWidth = 1;
    c.beginPath(); c.moveTo(x1 + 1.5, y1 + 1.5); c.lineTo(x2 + 1.5, y2 + 1.5); c.stroke();
  };
  for (const y of [128, 384]) seam(0, y, SIZE, y, 4);
  for (const x of [170, 340]) seam(x, 0, x, SIZE, 4);
  // remaches a lo largo de una junta
  for (let x = 12; x < SIZE; x += 34) {
    c.fillStyle = '#9a9a9a';
    c.beginPath(); c.arc(x, 128, 3.4, 0, 6.2832); c.fill();
    c.fillStyle = '#5d5d5d';
    c.beginPath(); c.arc(x + 1, 129, 1.4, 0, 6.2832); c.fill();
  }

  // arañazos
  for (let i = 0; i < 90; i++) {
    const x = R() * SIZE, y = R() * SIZE;
    const a = R() * Math.PI * 2, len = 4 + R() * 48;
    c.strokeStyle = R() < 0.5 ? '#5a5a5a' : '#adadad';
    c.lineWidth = 0.6 + R() * 1.2;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    c.stroke();
  }

  // abolladuras suaves
  for (let i = 0; i < 26; i++) {
    const x = R() * SIZE, y = R() * SIZE, r = 6 + R() * 22;
    const g = c.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, 'rgba(70,70,70,0.35)');
    g.addColorStop(1, 'rgba(128,128,128,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
  }
  return cv;
}

function normalFromHeight(hcv) {
  const hc = hcv.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const out = document.createElement('canvas');
  out.width = out.height = SIZE;
  const oc = out.getContext('2d');
  const img = oc.createImageData(SIZE, SIZE);
  const d = img.data;
  const at = (x, y) => hc[((y & (SIZE - 1)) * SIZE + (x & (SIZE - 1))) * 4] / 255;
  const strength = 1.45;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const n = new THREE.Vector3(-dx, -dy, 1).normalize();
      const i = (y * SIZE + x) * 4;
      d[i] = (n.x * 0.5 + 0.5) * 255;
      d[i + 1] = (n.y * 0.5 + 0.5) * 255;
      d[i + 2] = (n.z * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  oc.putImageData(img, 0, 0);
  return out;
}

function albedoCanvas(hcv) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const c = cv.getContext('2d');
  const R = rnd(4471);
  c.fillStyle = '#e9e9e9';
  c.fillRect(0, 0, SIZE, SIZE);

  // suciedad de calle: manchas de aceite y polvo
  for (let i = 0; i < 34; i++) {
    const x = R() * SIZE, y = R() * SIZE, r = 12 + R() * 54;
    const g = c.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, `rgba(38,34,28,${0.10 + R() * 0.16})`);
    g.addColorStop(1, 'rgba(38,34,28,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
  }
  // regueros verticales de óxido
  for (let i = 0; i < 16; i++) {
    const x = R() * SIZE, y = R() * SIZE * 0.5;
    const g = c.createLinearGradient(x, y, x + 3, y + 60 + R() * 110);
    g.addColorStop(0, 'rgba(96,58,26,0.26)');
    g.addColorStop(1, 'rgba(96,58,26,0)');
    c.fillStyle = g;
    c.fillRect(x, y, 2 + R() * 6, 60 + R() * 130);
  }
  // sombra en las juntas (lee el heightmap)
  const hd = hcv.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const id = c.getImageData(0, 0, SIZE, SIZE);
  const ad = id.data;
  for (let i = 0; i < ad.length; i += 4) {
    const h = hd[i] / 255;
    const k = 0.86 + h * 0.2;
    ad[i] = Math.min(255, ad[i] * k);
    ad[i + 1] = Math.min(255, ad[i + 1] * k);
    ad[i + 2] = Math.min(255, ad[i + 2] * k);
  }
  c.putImageData(id, 0, 0);
  return cv;
}

function roughCanvas(hcv) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = SIZE;
  const c = cv.getContext('2d');
  const R = rnd(7723);
  c.fillStyle = '#c8c8c8';
  c.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 300; i++) {
    const x = R() * SIZE, y = R() * SIZE, r = 2 + R() * 16;
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.20 + R() * 0.4})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fill();
  }
  const hd = hcv.getContext('2d').getImageData(0, 0, SIZE, SIZE).data;
  const id = c.getImageData(0, 0, SIZE, SIZE);
  const ad = id.data;
  for (let i = 0; i < ad.length; i += 4) {
    const h = hd[i] / 255;
    const v = Math.max(120, Math.min(255, 200 + (0.5 - h) * 90));
    ad[i] = ad[i + 1] = ad[i + 2] = v;
  }
  c.putImageData(id, 0, 0);
  return cv;
}

/** Juego de mapas PBR compartido por todos los enemigos. */
export function detailSet(repeat = 1) {
  if (!_set) {
    const hcv = heightCanvas();
    const tex = (cv, srgb) => {
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 4;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      return t;
    };
    _set = {
      map: tex(albedoCanvas(hcv), true),
      normalMap: tex(normalFromHeight(hcv), false),
      roughnessMap: tex(roughCanvas(hcv), false)
    };
  }
  if (repeat === 1) return _set;
  const key = 'r' + repeat;
  if (!_set[key]) {
    _set[key] = {};
    for (const k of ['map', 'normalMap', 'roughnessMap']) {
      const t = _set[k].clone();
      t.needsUpdate = true;
      t.repeat.set(repeat, repeat);
      _set[key][k] = t;
    }
  }
  return _set[key];
}

/* ------------------------------------------------------------------ piezas */

/** Tubo flexible entre dos puntos (latiguillos, cables, mangueras). */
export function hose(a, b, r, mat, sag = 0.06) {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= sag;
  const curve = new THREE.CatmullRomCurve3([a, mid, b]);
  const geo = new THREE.TubeGeometry(curve, 12, r, 5, false);
  return new THREE.Mesh(geo, mat);
}

/** Rejilla de ventilación: láminas hundidas en un marco. */
export function vent(w, h, n, mat, frame) {
  const g = new THREE.Group();
  const back = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.012), frame || mat);
  g.add(back);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(w * 0.86, h / (n * 2.4), 0.02), mat);
    s.position.set(0, (i / (n - 1) - 0.5) * h * 0.72, 0.006);
    g.add(s);
  }
  return g;
}

/** Fila de remaches sobre un eje. */
export function rivets(n, gap, r, mat, axis = 'x') {
  const g = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(r, 6, 4), mat);
    m.position[axis] = (i - (n - 1) / 2) * gap;
    g.add(m);
  }
  return g;
}

let _decalCache = new Map();

/** Calca de chapa: texto de unidad, banda de peligro, número de serie. */
export function decal(kind, w, h, opts = {}) {
  const key = kind + '|' + (opts.text || '') + '|' + (opts.color || '');
  let tex = _decalCache.get(key);
  if (!tex) {
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 128;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, 256, 128);
    if (kind === 'hazard') {
      c.fillStyle = opts.color || '#d8b13a';
      c.fillRect(0, 0, 256, 128);
      c.fillStyle = '#151515';
      for (let x = -128; x < 384; x += 34) {
        c.save();
        c.translate(x, 0);
        c.rotate(-0.42);
        c.fillRect(0, -80, 14, 300);
        c.restore();
      }
      // desgaste: la banda no está nueva
      c.globalAlpha = 0.35;
      c.fillStyle = '#2a2a2a';
      for (let i = 0; i < 60; i++) c.fillRect(Math.random() * 256, Math.random() * 128, 3, 2);
      c.globalAlpha = 1;
    } else if (kind === 'grille') {
      c.fillStyle = '#0b0d10';
      c.fillRect(0, 0, 256, 128);
      c.fillStyle = opts.color || '#7f8b99';
      for (let y = 8; y < 128; y += 12) c.fillRect(6, y, 244, 5);
    } else {
      c.fillStyle = 'rgba(0,0,0,0)';
      c.fillRect(0, 0, 256, 128);
      c.strokeStyle = opts.color || '#cfd6df';
      c.fillStyle = opts.color || '#cfd6df';
      c.lineWidth = 5;
      c.font = '700 58px system-ui, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(opts.text || 'NEO-7', 128, 60);
      c.globalAlpha = 0.55;
      c.lineWidth = 2;
      c.strokeRect(10, 14, 236, 100);
      c.globalAlpha = 1;
    }
    tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    _decalCache.set(key, tex);
  }
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: tex, transparent: true, roughness: 0.62, metalness: 0.25,
      polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false,
      envMapIntensity: 0.8
    })
  );
  return m;
}
