// Viñetas de historia: página de cómic 3D dibujada en canvas y anclada a la
// cabeza (funciona en pantalla y en el visor). Cada panel trae una ilustración
// en perspectiva, trama de semitono, rótulo y texto que se escribe solo.
import * as THREE from 'three';

const W = 1600, H = 900;          // resolución de la página
const F = 780;                    // distancia focal del dibujo en perspectiva

/* ------------------------------------------------------------ utilidades */
function makeRng(seed) {
  let x = (seed | 0) || 7;
  return () => {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    return ((x >>> 0) % 100000) / 100000;
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function ease(t) { return 1 - Math.pow(1 - clamp(t, 0, 1), 3); }

/* trama de puntos (semitono) reutilizable */
const HALFTONE = (() => {
  const c = document.createElement('canvas');
  c.width = 12; c.height = 12;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(0,0,0,0.55)';
  g.beginPath(); g.arc(6, 6, 2.1, 0, Math.PI * 2); g.fill();
  return c;
})();

const GRAIN = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 220;
  const g = c.getContext('2d');
  const img = g.createImageData(c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 120 + Math.random() * 135;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 18;
  }
  g.putImageData(img, 0, 0);
  return c;
})();

export function createStory(scene, camera) {
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const art = document.createElement('canvas');
  art.width = W; art.height = H;
  const actx = art.getContext('2d');

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;

  const mat = new THREE.MeshBasicMaterial({
    // el color atenúa la página por debajo del umbral de bloom: si no, el papel
    // crema se quema y el texto se pierde contra el resplandor
    color: 0xc2beb2, map: tex, transparent: true, depthTest: false, depthWrite: false,
    toneMapped: false
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plane.renderOrder = 900;
  const group = new THREE.Group();
  group.add(plane);
  group.visible = false;
  scene.add(group);

  let panels = [];
  let idx = 0;
  let onDone = null;
  let t = 0;
  let lines = [];
  let total = 0;
  let artKey = 'city';

  /* ---------------------------------------------------------- tipografía */
  const DISPLAY = 'Impact, "Arial Black", "Franklin Gothic Heavy", system-ui, sans-serif';
  const BODY = 'Inter, system-ui, "Segoe UI", sans-serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

  function wrap(text, max, font) {
    ctx.save();
    ctx.font = font;
    const out = [];
    for (const para of String(text).split('\n')) {
      let cur = '';
      for (const word of para.split(' ')) {
        const test = cur ? cur + ' ' + word : word;
        if (ctx.measureText(test).width > max && cur) { out.push(cur); cur = word; }
        else cur = test;
      }
      if (cur) out.push(cur);
    }
    ctx.restore();
    return out;
  }

  function say(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/\s+/g, ' '));
      const v = (window.speechSynthesis.getVoices() || [])
        .filter(x => /^es[-_]/i.test(x.lang))
        .sort((a, b) => (b.lang === 'es-ES') - (a.lang === 'es-ES'))[0];
      if (v) u.voice = v;
      u.lang = 'es-ES';
      u.rate = 0.98; u.pitch = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) { /* voz opcional */ }
  }

  /* ================================================ dibujo de perspectivas */
  // cámara de la ilustración: altura de ojos y guiñada (para encuadres en 3/4)
  const cam = { x: 0, y: 1.75, yaw: 0, pitch: 0 };

  function proj(x, y, z) {
    // z negativo = delante. Guiñada ligera alrededor del eje Y.
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const rx = x * cy - z * sy;
    const rz = x * sy + z * cy;
    const d = Math.max(0.45, -rz);
    const px = W / 2 + (rx - cam.x) * F / d;
    const py = H / 2 + (cam.y - y) * F / d - cam.pitch * F / d;
    return { x: px, y: py, s: F / d, d };
  }

  function poly(g, pts, fill, stroke, lw) {
    g.beginPath();
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw || 3; g.stroke(); }
  }

  function glow(g, x, y, r, color, alpha) {
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, color);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.save();
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = alpha === undefined ? 1 : alpha;
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    g.restore();
  }

  // caja en perspectiva: cara frontal + lateral + techo
  function box3d(g, x, y, z, w, h, d, face, side, top) {
    const hw = w / 2, hd = d / 2;
    const f = [proj(x - hw, y, z + hd), proj(x + hw, y, z + hd), proj(x + hw, y + h, z + hd), proj(x - hw, y + h, z + hd)];
    const b = [proj(x - hw, y, z - hd), proj(x + hw, y, z - hd), proj(x + hw, y + h, z - hd), proj(x - hw, y + h, z - hd)];
    poly(g, [f[1], b[1], b[2], f[2]], side);
    poly(g, [f[3], b[3], b[2], f[2]], top || side);
    poly(g, f, face);
    return { f, b };
  }

  /* ------------------------------------------------------------- escenas */
  const SCENES = {};

  // fachada con ventanas encendidas
  function tower(g, rnd, x, z, w, h, d, tint) {
    const c = box3d(g, x, 0, z, w, h, d, '#0b1020', '#080c18', '#101828');
    // ventanas en la cara frontal
    const cols = Math.max(3, Math.round(w / 2.4));
    const rows = Math.max(5, Math.round(h / 2.8));
    const f0 = c.f[0], f1 = c.f[1], f3 = c.f[3];
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        if (rnd() < 0.52) continue;
        const u = (i + 0.5) / cols, v = (j + 0.5) / rows;
        const px = lerp(lerp(f0.x, f1.x, u), lerp(f3.x, c.f[2].x, u), v);
        const py = lerp(lerp(f0.y, f1.y, u), lerp(f3.y, c.f[2].y, u), v);
        const sw = Math.max(1.2, (c.f[1].x - c.f[0].x) / cols * 0.42);
        const sh = Math.max(1.2, (c.f[0].y - c.f[3].y) / rows * 0.4);
        g.fillStyle = tint === 'warm'
          ? (rnd() < 0.5 ? 'rgba(255,196,110,0.85)' : 'rgba(255,120,60,0.55)')
          : (rnd() < 0.5 ? 'rgba(120,230,255,0.8)' : 'rgba(255,79,216,0.55)');
        g.globalAlpha = 0.55 + rnd() * 0.45;
        g.fillRect(px - sw / 2, py - sh / 2, sw, sh);
      }
    }
    g.globalAlpha = 1;
    // neón vertical en el filo
    if (rnd() < 0.6) {
      g.strokeStyle = rnd() < 0.5 ? 'rgba(73,230,255,0.8)' : 'rgba(255,79,216,0.8)';
      g.lineWidth = Math.max(1.5, 3 * c.f[1].s / 60);
      g.beginPath();
      g.moveTo(c.f[3].x + 2, c.f[3].y);
      g.lineTo(c.f[0].x + 2, c.f[0].y);
      g.stroke();
    }
    return c;
  }

  function skyline(g, rnd, baseY, alpha, hue) {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = hue;
    g.beginPath();
    g.moveTo(0, H);
    let x = 0;
    while (x < W) {
      const bw = 40 + rnd() * 110;
      const bh = 40 + rnd() * 230;
      g.lineTo(x, baseY - bh);
      g.lineTo(x + bw, baseY - bh);
      x += bw;
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    g.restore();
  }

  // calle en fuga con carriles, farolas y lluvia de fondo
  function street(g, rnd, opts) {
    const horizon = H * (opts.horizon || 0.47);
    // cielo
    const sky = g.createLinearGradient(0, 0, 0, horizon + 80);
    sky.addColorStop(0, opts.skyTop || '#070a18');
    sky.addColorStop(0.62, opts.skyMid || '#1b1038');
    sky.addColorStop(1, opts.skyLow || '#5a1f4e');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, horizon + 80);

    // resplandor en el punto de fuga
    const vp = proj(0, 0, -160);
    glow(g, W / 2, horizon, W * 0.62, opts.haze || 'rgba(255,79,216,0.30)', 0.9);

    // skylines lejanos
    skyline(g, rnd, horizon + 6, 0.5, '#0a0f22');
    skyline(g, rnd, horizon + 30, 0.75, '#070a15');

    // suelo
    const road = g.createLinearGradient(0, horizon, 0, H);
    road.addColorStop(0, '#0a0e1a');
    road.addColorStop(1, '#05070d');
    g.fillStyle = road;
    g.fillRect(0, horizon, W, H - horizon);

    // líneas de carril en fuga
    g.lineWidth = 3;
    for (let z = -6; z > -120; z -= 9) {
      const a = proj(-2.6, 0.02, z), b = proj(-2.2, 0.02, z - 4);
      if (a.d < 3) continue;
      g.strokeStyle = `rgba(73,230,255,${clamp(0.55 - a.d / 260, 0.06, 0.55)})`;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }
    // arcén magenta
    for (let z = -4; z > -130; z -= 6) {
      const a = proj(6.4, 0.02, z), b = proj(6.4, 0.02, z - 5);
      g.strokeStyle = `rgba(255,79,216,${clamp(0.5 - a.d / 300, 0.05, 0.5)})`;
      g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.stroke();
    }

    // torres laterales
    const rnd2 = makeRng(opts.seed || 3);
    for (let side of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const z = -14 - i * 15 - rnd2() * 6;
        const x = side * (11 + rnd2() * 6 + i * 1.2);
        const w = 7 + rnd2() * 7;
        const h = 16 + rnd2() * 42;
        tower(g, rnd2, x, z, w, h, 7 + rnd2() * 6, rnd2() < 0.3 ? 'warm' : 'cool');
      }
    }

    // farolas cercanas
    for (let side of [-1, 1]) {
      for (let i = 1; i <= 3; i++) {
        const z = -8 - i * 11;
        const px = proj(side * 7.4, 0, z);
        const py = proj(side * 7.4, 6, z);
        g.strokeStyle = 'rgba(10,14,24,0.95)';
        g.lineWidth = Math.max(1.5, px.s * 0.09);
        g.beginPath(); g.moveTo(px.x, px.y); g.lineTo(py.x, py.y); g.stroke();
        glow(g, py.x, py.y, Math.max(8, px.s * 1.5), side < 0 ? 'rgba(73,230,255,0.85)' : 'rgba(255,159,67,0.85)', 0.75);
      }
    }
    return { horizon, vp };
  }

  // silueta del operador con dos pistolas, de espaldas
  function operator(g, cx, cy, hh, rim) {
    const s = hh / 210;
    g.save();
    g.translate(cx, cy);
    g.scale(s, s);
    // piernas
    g.fillStyle = '#04060c';
    g.fillRect(-38, -70, 30, 74);
    g.fillRect(6, -70, 30, 74);
    // torso
    g.beginPath();
    g.moveTo(-46, -184); g.lineTo(46, -184);
    g.lineTo(38, -62); g.lineTo(-38, -62);
    g.closePath(); g.fill();
    // cabeza
    g.beginPath(); g.arc(0, -205, 24, 0, Math.PI * 2); g.fill();
    // brazos extendidos con pistolas
    for (const sgn of [-1, 1]) {
      g.save();
      g.translate(sgn * 22, -150);
      g.rotate(sgn * 0.16);
      g.fillRect(0, -9, sgn * 74, 18);
      g.fillRect(sgn * 60, -14, sgn * 40, 14);
      g.fillRect(sgn * 62, -2, sgn * 12, 22);
      g.restore();
    }
    // filo de luz
    if (rim) {
      g.strokeStyle = rim;
      g.lineWidth = 2.6;
      g.beginPath();
      g.moveTo(-46, -184); g.lineTo(-38, -62); g.lineTo(-8, -62);
      g.moveTo(0, -229); g.arc(0, -205, 24, Math.PI, Math.PI * 1.55);
      g.stroke();
    }
    g.restore();
  }

  function rainOverlay(g, seed, density, alpha) {
    const rnd = makeRng(seed);
    g.save();
    g.strokeStyle = `rgba(180,220,255,${alpha})`;
    g.lineWidth = 1.6;
    for (let i = 0; i < density; i++) {
      const x = rnd() * W, y = rnd() * H, len = 22 + rnd() * 60;
      g.globalAlpha = 0.12 + rnd() * 0.4;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x - len * 0.16, y + len); g.stroke();
    }
    g.restore();
  }

  /* --- 1. la ciudad apagada ------------------------------------------- */
  SCENES.city = (g, seed) => {
    cam.x = 0; cam.yaw = 0; cam.pitch = 0;
    const rnd = makeRng(seed);
    const { horizon } = street(g, rnd, { seed, skyLow: '#4a1a52', haze: 'rgba(255,79,216,0.34)' });
    // luna velada
    glow(g, W * 0.74, horizon - 150, 190, 'rgba(255,214,170,0.30)', 0.9);
    g.fillStyle = 'rgba(255,236,214,0.75)';
    g.beginPath(); g.arc(W * 0.74, horizon - 150, 58, 0, Math.PI * 2); g.fill();
    // todo en penumbra: la ciudad está apagada
    g.fillStyle = 'rgba(4,7,16,0.42)';
    g.fillRect(0, 0, W, H);
    operator(g, W * 0.30, H * 0.97, 330, 'rgba(73,230,255,0.9)');
    rainOverlay(g, seed + 1, 150, 0.5);
  };

  /* --- 2. el enjambre -------------------------------------------------- */
  SCENES.swarm = (g, seed) => {
    cam.x = 0; cam.yaw = 0.10; cam.pitch = 0;
    const rnd = makeRng(seed);
    const { horizon } = street(g, rnd, { seed, skyLow: '#6b1738', skyMid: '#200d2c', haze: 'rgba(255,45,85,0.40)' });
    // drones en formación, cada vez más grandes
    for (let i = 0; i < 26; i++) {
      const z = -18 - rnd() * 90;
      const x = (rnd() - 0.5) * 26;
      const y = 2 + rnd() * 14;
      const p = proj(x, y, z);
      const r = clamp(p.s * 0.32, 4, 42);
      g.fillStyle = '#080b14';
      g.beginPath(); g.ellipse(p.x, p.y, r, r * 0.55, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#0d1220';
      g.fillRect(p.x - r * 0.75, p.y - r * 0.16, r * 1.5, r * 0.32);
      for (const sgn of [-1, 1]) {
        glow(g, p.x + sgn * r * 0.5, p.y + r * 0.05, r * 0.9, 'rgba(255,45,85,0.9)', 0.8);
        g.fillStyle = '#ff2d55';
        g.beginPath(); g.arc(p.x + sgn * r * 0.5, p.y + r * 0.05, Math.max(1.5, r * 0.14), 0, Math.PI * 2); g.fill();
      }
      // haz de búsqueda
      if (i % 5 === 0 && p.y < H * 0.8) {
        g.save();
        g.globalCompositeOperation = 'lighter';
        const grd = g.createLinearGradient(p.x, p.y, p.x + r * 2, H);
        grd.addColorStop(0, 'rgba(255,45,85,0.20)');
        grd.addColorStop(1, 'rgba(255,45,85,0)');
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x + r * 5, H); g.lineTo(p.x - r * 3, H); g.closePath(); g.fill();
        g.restore();
      }
    }
    operator(g, W * 0.5, H * 1.0, 300, 'rgba(255,79,216,0.95)');
    rainOverlay(g, seed + 2, 110, 0.4);
  };

  /* --- 3. dos pistolas ------------------------------------------------- */
  SCENES.pistols = (g, seed) => {
    const rnd = makeRng(seed);
    // fondo de chispas en perspectiva
    const bg = g.createRadialGradient(W * 0.5, H * 0.45, 60, W * 0.5, H * 0.45, W * 0.8);
    bg.addColorStop(0, '#2a0f38');
    bg.addColorStop(0.5, '#120a22');
    bg.addColorStop(1, '#05070d');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * W, y = rnd() * H, r = 1 + rnd() * 3;
      glow(g, x, y, r * 9, rnd() < 0.5 ? 'rgba(73,230,255,0.55)' : 'rgba(255,79,216,0.55)', 0.7);
    }
    // cañones cruzados en primer plano
    function gun(mirror) {
      g.save();
      g.translate(W * 0.5, H * 0.52);
      g.scale(mirror ? -1 : 1, 1);
      g.rotate(-0.16);
      g.translate(-40, -60);
      g.fillStyle = '#0a0e18';
      g.strokeStyle = 'rgba(73,230,255,0.85)';
      g.lineWidth = 5;
      g.beginPath();
      g.roundRect(-30, -40, 520, 120, 18);
      g.fill(); g.stroke();
      // corredera
      g.fillStyle = '#131a2b';
      g.beginPath(); g.roundRect(80, -64, 330, 56, 12); g.fill();
      // cañón
      g.fillStyle = '#05070d';
      g.beginPath(); g.roundRect(392, -46, 120, 44, 10); g.fill();
      // franja neón
      g.fillStyle = 'rgba(255,79,216,0.9)';
      g.fillRect(40, 26, 300, 10);
      g.fillRect(120, -56, 140, 6);
      // empuñadura
      g.save();
      g.translate(10, 60); g.rotate(0.30);
      g.fillStyle = '#0a0e18';
      g.beginPath(); g.roundRect(0, 0, 120, 190, 14); g.fill();
      g.strokeStyle = 'rgba(73,230,255,0.5)'; g.lineWidth = 4; g.stroke();
      g.restore();
      // boca del cañón encendida
      glow(g, 520, -24, 120, 'rgba(255,214,120,0.9)', 0.95);
      g.fillStyle = '#fff6d8';
      g.beginPath(); g.arc(520, -24, 16, 0, Math.PI * 2); g.fill();
      g.restore();
    }
    gun(false); gun(true);
    // chispas
    for (let i = 0; i < 60; i++) {
      const a = rnd() * Math.PI * 2, d = 60 + rnd() * 460;
      const x = W * 0.5 + Math.cos(a) * d, y = H * 0.5 + Math.sin(a) * d * 0.6;
      g.fillStyle = rnd() < 0.5 ? 'rgba(255,214,120,0.9)' : 'rgba(255,120,60,0.8)';
      g.fillRect(x, y, 2 + rnd() * 4, 2 + rnd() * 4);
    }
  };

  /* --- 4. la puerta del titán ----------------------------------------- */
  SCENES.door = (g, seed) => {
    cam.x = 0; cam.yaw = 0; cam.pitch = 0;
    const rnd = makeRng(seed);
    // nave industrial en penumbra
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0a0d18');
    bg.addColorStop(1, '#04060b');
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    // suelo mojado
    g.fillStyle = '#070a12'; g.fillRect(0, H * 0.72, W, H * 0.28);

    // puerta blindada
    const dx = W * 0.5 - 330, dy = H * 0.12, dw = 660, dh = H * 0.62;
    g.fillStyle = '#101726';
    g.fillRect(dx, dy, dw, dh);
    g.strokeStyle = 'rgba(120,160,210,0.35)';
    g.lineWidth = 3;
    for (let i = 1; i < 9; i++) {
      g.beginPath(); g.moveTo(dx, dy + (dh / 9) * i); g.lineTo(dx + dw, dy + (dh / 9) * i); g.stroke();
    }
    // franjas de peligro
    g.save();
    g.beginPath(); g.rect(dx, dy + dh - 54, dw, 54); g.clip();
    for (let x = dx - 60; x < dx + dw + 60; x += 70) {
      g.fillStyle = '#ff9f43';
      g.beginPath(); g.moveTo(x, dy + dh); g.lineTo(x + 34, dy + dh - 54); g.lineTo(x + 66, dy + dh - 54); g.lineTo(x + 32, dy + dh); g.closePath(); g.fill();
    }
    g.restore();
    // luces rojas de alarma
    for (let i = 0; i < 4; i++) {
      const lx = dx + 80 + i * (dw - 160) / 3;
      glow(g, lx, dy + 40, 150, 'rgba(255,45,85,0.75)', 1);
      g.fillStyle = '#ff2d55';
      g.beginPath(); g.arc(lx, dy + 40, 12, 0, Math.PI * 2); g.fill();
    }
    // junta central luminosa
    g.save();
    g.globalCompositeOperation = 'lighter';
    const seam = g.createLinearGradient(dx + dw / 2 - 8, 0, dx + dw / 2 + 8, 0);
    seam.addColorStop(0, 'rgba(255,45,85,0)');
    seam.addColorStop(0.5, 'rgba(255,120,140,0.95)');
    seam.addColorStop(1, 'rgba(255,45,85,0)');
    g.fillStyle = seam;
    g.fillRect(dx + dw / 2 - 8, dy, 16, dh);
    g.restore();
    // reflejo en el charco
    g.save();
    g.globalAlpha = 0.28;
    g.scale(1, -1);
    g.translate(0, -H * 1.46);
    g.fillStyle = '#ff2d55';
    g.fillRect(dx + dw / 2 - 6, dy, 12, dh * 0.5);
    g.restore();

    // operador diminuto frente a la puerta
    operator(g, W * 0.5, H * 0.94, 210, 'rgba(73,230,255,0.9)');
    rainOverlay(g, seed + 3, 90, 0.35);
  };

  /* --- 5. el titán ----------------------------------------------------- */
  SCENES.titan = (g, seed) => {
    cam.x = 0; cam.yaw = 0; cam.pitch = 0;
    const rnd = makeRng(seed);
    const { horizon } = street(g, rnd, { seed, skyTop: '#0a0510', skyMid: '#2a0a1c', skyLow: '#7a1a24', haze: 'rgba(255,45,85,0.45)' });
    g.fillStyle = 'rgba(4,5,10,0.35)'; g.fillRect(0, 0, W, H);

    const bx = W * 0.58, groundY = H * 0.93;
    const S = 1.0;
    // piernas hidráulicas
    g.fillStyle = '#0a0d16';
    g.strokeStyle = 'rgba(255,45,85,0.55)';
    g.lineWidth = 4;
    for (const s of [-1, 1]) {
      g.beginPath(); g.roundRect(bx + s * 118 - 42, groundY - 300, 84, 300, 12); g.fill(); g.stroke();
      g.beginPath(); g.roundRect(bx + s * 132 - 50, groundY - 26, 130, 26, 8); g.fill();
    }
    // torso enorme
    const torsoW = 420, torsoH = 330, torsoY = groundY - 630;
    const tg = g.createLinearGradient(bx - torsoW / 2, torsoY, bx + torsoW / 2, torsoY + torsoH);
    tg.addColorStop(0, '#232f47');
    tg.addColorStop(0.5, '#141b29');
    tg.addColorStop(1, '#080b12');
    g.fillStyle = tg;
    g.beginPath(); g.roundRect(bx - torsoW / 2, torsoY, torsoW, torsoH, 26); g.fill();
    g.strokeStyle = 'rgba(255,159,67,0.45)'; g.lineWidth = 5; g.stroke();

    // hombros y cañones
    for (const s of [-1, 1]) {
      g.fillStyle = '#1a2334';
      g.beginPath(); g.roundRect(bx + s * 250 - 70, torsoY + 20, 140, 120, 18); g.fill();
      g.fillStyle = '#070a11';
      g.fillRect(bx + s * 250 - 34, torsoY + 120, 68, 150);
      glow(g, bx + s * 250, torsoY + 272, 90, 'rgba(255,159,67,0.55)', 0.9);
      g.strokeStyle = 'rgba(255,159,67,0.9)'; g.lineWidth = 7;
      g.beginPath(); g.arc(bx + s * 250, torsoY + 272, 30, 0, Math.PI * 2); g.stroke();
    }

    // núcleo: el punto débil
    glow(g, bx, torsoY + 170, 210, 'rgba(255,45,85,0.75)', 1);
    g.fillStyle = '#fff0f3';
    g.beginPath(); g.arc(bx, torsoY + 170, 40, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,45,85,0.95)'; g.lineWidth = 8;
    g.beginPath(); g.arc(bx, torsoY + 170, 62, 0, Math.PI * 2); g.stroke();

    // cabeza con visor
    g.fillStyle = '#0d121d';
    g.beginPath(); g.roundRect(bx - 96, torsoY - 108, 192, 118, 16); g.fill();
    g.strokeStyle = 'rgba(255,45,85,0.6)'; g.lineWidth = 4; g.stroke();
    glow(g, bx, torsoY - 52, 120, 'rgba(255,45,85,0.85)', 1);
    g.fillStyle = '#ff2d55';
    g.fillRect(bx - 74, torsoY - 62, 148, 16);

    // polvo al pie
    for (let i = 0; i < 40; i++) {
      const x = bx + (rnd() - 0.5) * 620, y = groundY - rnd() * 70;
      glow(g, x, y, 40 + rnd() * 60, 'rgba(255,159,67,0.10)', 0.7);
    }

    // el operador, diminuto, a los pies
    operator(g, W * 0.18, H * 1.02, 190, 'rgba(73,230,255,0.95)');
    rainOverlay(g, seed + 4, 130, 0.45);
  };

  /* --- 6. la plaza respira --------------------------------------------- */
  SCENES.dawn = (g, seed) => {
    cam.x = 0; cam.yaw = -0.06; cam.pitch = 0;
    const rnd = makeRng(seed);
    const horizon = H * 0.52;
    const sky = g.createLinearGradient(0, 0, 0, horizon + 90);
    sky.addColorStop(0, '#0b1024');
    sky.addColorStop(0.45, '#3a2050');
    sky.addColorStop(0.78, '#c25a4a');
    sky.addColorStop(1, '#ffb066');
    g.fillStyle = sky; g.fillRect(0, 0, W, horizon + 90);
    glow(g, W * 0.62, horizon - 20, W * 0.7, 'rgba(255,180,110,0.55)', 1);
    skyline(g, rnd, horizon + 8, 0.85, '#1a1526');
    skyline(g, rnd, horizon + 26, 1, '#0b0d18');

    // suelo
    const grd = g.createLinearGradient(0, horizon, 0, H);
    grd.addColorStop(0, '#2a2030');
    grd.addColorStop(1, '#0d0b14');
    g.fillStyle = grd; g.fillRect(0, horizon, W, H - horizon);

    // escombros del titán
    for (let i = 0; i < 16; i++) {
      const x = W * 0.45 + (rnd() - 0.5) * 900;
      const y = H * (0.78 + rnd() * 0.18);
      const w = 60 + rnd() * 190, h = 20 + rnd() * 60;
      g.fillStyle = '#10141f';
      g.save(); g.translate(x, y); g.rotate((rnd() - 0.5) * 0.5);
      g.fillRect(-w / 2, -h, w, h);
      g.fillStyle = 'rgba(255,159,67,0.35)';
      g.fillRect(-w / 2, -h, w, 4);
      g.restore();
    }
    // humo
    for (let i = 0; i < 22; i++) {
      const x = W * 0.55 + (rnd() - 0.5) * 700, y = H * (0.55 + rnd() * 0.2);
      glow(g, x, y, 90 + rnd() * 160, 'rgba(120,120,150,0.14)', 0.8);
    }
    // operador caminando, de espaldas
    operator(g, W * 0.26, H * 0.98, 250, 'rgba(255,180,110,0.95)');
    // polvo dorado
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W, y = H * (0.3 + rnd() * 0.7);
      g.fillStyle = `rgba(255,200,140,${0.15 + rnd() * 0.5})`;
      g.fillRect(x, y, 2, 2);
    }
  };

  /* -------------------------------------------------- composición del panel */
  function drawArt(key, seed) {
    actx.save();
    actx.clearRect(0, 0, W, H);
    const fn = SCENES[key] || SCENES.city;
    fn(actx, seed || 11);
    actx.restore();
  }

  function frame(g) {
    // marco negro grueso + filete interior
    g.save();
    g.strokeStyle = '#04060c';
    g.lineWidth = 26;
    g.strokeRect(13, 13, W - 26, H - 26);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.lineWidth = 2;
    g.strokeRect(30, 30, W - 60, H - 60);
    g.restore();
  }

  function caption(g, text, x, y, maxW, opts) {
    const font = opts.font;
    const size = opts.size;
    g.save();
    g.font = font;
    const w = Math.min(maxW, g.measureText(text).width + size * 1.3);
    const h = size * 1.85;
    g.fillStyle = opts.bg || 'rgba(4,6,12,0.9)';
    g.fillRect(x, y, w, h);
    g.strokeStyle = opts.border || 'rgba(255,255,255,0.85)';
    g.lineWidth = 3;
    g.strokeRect(x, y, w, h);
    g.fillStyle = opts.fg || '#ffffff';
    g.textBaseline = 'middle';
    g.fillText(text, x + size * 0.65, y + h / 2 + 1);
    g.restore();
  }

  function titleBlock(g, p) {
    const txt = String(p.title || '').toUpperCase();
    let size = 108;
    g.save();
    g.font = `italic 900 ${size}px ${DISPLAY}`;
    while (g.measureText(txt).width > W - 240 && size > 48) {
      size -= 6;
      g.font = `italic 900 ${size}px ${DISPLAY}`;
    }
    const tw = g.measureText(txt).width;
    const x = 84, y = H - 250;
    // sombra magenta desplazada
    g.fillStyle = 'rgba(255,79,216,0.85)';
    g.fillText(txt, x + 8, y + 8);
    // relleno
    g.lineJoin = 'round';
    g.strokeStyle = '#04060c';
    g.lineWidth = 14;
    g.strokeText(txt, x, y);
    const grd = g.createLinearGradient(0, y - size, 0, y + 10);
    grd.addColorStop(0, '#ffffff');
    grd.addColorStop(1, '#bfe9ff');
    g.fillStyle = grd;
    g.fillText(txt, x, y);
    g.restore();
    return { y, size, tw };
  }

  /* --------------------------------------------------------- página cómic */
  const INK = '#06070c';
  const CREAM = '#f7e8c6';
  const RED = '#ff2d55';
  const CYAN = '#49e6ff';

  const M = 30;
  const HERO_Y = 26;
  const HERO_H = Math.round(H * 0.605);
  const BOT_Y = HERO_Y + HERO_H + 16;
  const BOT_H = H - M - BOT_Y;
  const INSET_W = Math.round(W * 0.30);
  const CAP_X = M + INSET_W + 16;
  const CAP_W = W - M - CAP_X;
  const CAP_FONT = `600 36px ${BODY}`;
  const CAP_LH = 46;
  const CAP_PAD = 36;

  const page = document.createElement('canvas');
  page.width = W; page.height = H;
  const pg = page.getContext('2d');
  let builtFor = -1;

  function cover(g, img, x, y, w, h, zoom, cx, cy) {
    const iw = img.width, ih = img.height;
    const s = Math.max(w / iw, h / ih) * (zoom || 1);
    const dw = iw * s, dh = ih * s;
    const ox = x + (w - dw) * (cx === undefined ? 0.5 : cx);
    const oy = y + (h - dh) * (cy === undefined ? 0.5 : cy);
    g.drawImage(img, ox, oy, dw, dh);
  }

  function halftone(g, x, y, w, h, alpha) {
    g.save();
    g.globalAlpha = alpha === undefined ? 0.16 : alpha;
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = g.createPattern(HALFTONE, 'repeat');
    g.translate(x, y);
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  /* marco de tinta: trazo grueso negro + filete crema */
  function inked(g, x, y, w, h, lw) {
    g.save();
    g.strokeStyle = INK;
    g.lineWidth = lw || 16;
    g.strokeRect(x - (lw || 16) / 2, y - (lw || 16) / 2, w + (lw || 16), h + (lw || 16));
    g.strokeStyle = 'rgba(247,232,198,0.5)';
    g.lineWidth = 2;
    g.strokeRect(x - 3, y - 3, w + 6, h + 6);
    g.restore();
  }

  /* titán dibujado a tinta: silueta en contrapicado, núcleo y luces de alarma */
  function titanLayer(g, x, y, w, h) {
    // el titán se ensancha un 24%: a tamaño natural quedaba como un palo
    const X = (u) => x + (0.5 + (u - 0.5) * 1.24) * w;
    const Y = (v) => y + v * h;
    const poly = (pts, fill) => {
      g.beginPath();
      g.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Y(pts[i][1]));
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      // arista crema: sin esto la silueta se funde con el fondo nocturno
      g.strokeStyle = 'rgba(247,232,198,0.30)';
      g.lineWidth = 2.2;
      g.lineJoin = 'round';
      g.stroke();
    };
    const edge = (pts, color, lw) => {
      g.beginPath();
      g.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (let i = 1; i < pts.length; i++) g.lineTo(X(pts[i][0]), Y(pts[i][1]));
      g.strokeStyle = color;
      g.lineWidth = lw;
      g.lineJoin = 'round';
      g.stroke();
    };

    // aliento rojo detrás
    const hz = g.createRadialGradient(X(0.62), Y(0.34), 0, X(0.62), Y(0.36), w * 0.44);
    hz.addColorStop(0, 'rgba(255,45,85,0.32)');
    hz.addColorStop(0.45, 'rgba(255,110,50,0.12)');
    hz.addColorStop(1, 'rgba(255,45,85,0)');
    g.fillStyle = hz;
    g.fillRect(x, y, w, h);

    // haces de alarma
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (const s of [-1, 1]) {
      const grd = g.createLinearGradient(X(0.62), Y(0.30), X(0.62 + s * 0.44), Y(-0.02));
      grd.addColorStop(0, 'rgba(255,45,85,0.20)');
      grd.addColorStop(1, 'rgba(255,45,85,0)');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(X(0.62), Y(0.31));
      g.lineTo(X(0.62 + s * 0.48), Y(-0.04));
      g.lineTo(X(0.62 + s * 0.26), Y(0.02));
      g.closePath();
      g.fill();
    }
    g.restore();

    // líneas de velocidad tipo cómic
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.09)';
    g.lineWidth = 3;
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      g.beginPath();
      g.moveTo(X(0.62) + Math.cos(a) * w * 0.26, Y(0.36) + Math.sin(a) * h * 0.26);
      g.lineTo(X(0.62) + Math.cos(a) * w * 0.80, Y(0.36) + Math.sin(a) * h * 0.80);
      g.stroke();
    }
    g.restore();

    const base = '#222f47', mid = '#2d3f5e', lit = '#48658f', dark = '#131b28';

    // piernas
    poly([[0.495, 0.54], [0.568, 0.54], [0.588, 0.90], [0.556, 0.99], [0.488, 0.99], [0.468, 0.90]], base);
    poly([[0.662, 0.54], [0.735, 0.54], [0.762, 0.90], [0.700, 0.99], [0.634, 0.99], [0.658, 0.90]], base);
    // rodillas
    poly([[0.500, 0.70], [0.578, 0.70], [0.582, 0.785], [0.505, 0.785]], lit);
    poly([[0.658, 0.70], [0.736, 0.70], [0.728, 0.785], [0.654, 0.785]], lit);
    // pies
    poly([[0.468, 0.95], [0.590, 0.95], [0.602, 1.0], [0.436, 1.0]], dark);
    poly([[0.652, 0.95], [0.774, 0.95], [0.802, 1.0], [0.644, 1.0]], dark);
    // torso
    poly([[0.474, 0.20], [0.746, 0.20], [0.714, 0.565], [0.506, 0.565]], base);
    poly([[0.474, 0.20], [0.556, 0.20], [0.542, 0.565], [0.506, 0.565]], mid);
    poly([[0.700, 0.20], [0.746, 0.20], [0.714, 0.565], [0.678, 0.565]], lit);
    edge([[0.746, 0.20], [0.714, 0.565]], 'rgba(73,230,255,0.55)', 5);
    // placa pectoral
    poly([[0.522, 0.245], [0.698, 0.245], [0.682, 0.478], [0.538, 0.478]], dark);
    poly([[0.540, 0.272], [0.680, 0.272], [0.668, 0.352], [0.552, 0.352]], '#101a27');
    // hombreras
    poly([[0.436, 0.205], [0.516, 0.168], [0.528, 0.278], [0.450, 0.302]], lit);
    poly([[0.704, 0.168], [0.784, 0.205], [0.770, 0.302], [0.692, 0.278]], lit);
    poly([[0.436, 0.205], [0.462, 0.192], [0.470, 0.288], [0.450, 0.302]], base);
    // brazos
    poly([[0.448, 0.288], [0.512, 0.268], [0.520, 0.520], [0.462, 0.540]], base);
    poly([[0.708, 0.268], [0.772, 0.288], [0.758, 0.540], [0.700, 0.520]], mid);
    // antebrazos + puños-cañón
    poly([[0.452, 0.520], [0.524, 0.500], [0.532, 0.700], [0.462, 0.716]], mid);
    poly([[0.696, 0.500], [0.768, 0.520], [0.758, 0.716], [0.688, 0.700]], lit);
    poly([[0.444, 0.700], [0.536, 0.680], [0.540, 0.792], [0.446, 0.808]], dark);
    poly([[0.684, 0.680], [0.776, 0.700], [0.774, 0.808], [0.680, 0.792]], dark);
    // bocas de cañón
    g.fillStyle = '#05070b';
    g.beginPath(); g.ellipse(X(0.492), Y(0.762), w * 0.013, h * 0.020, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(X(0.730), Y(0.762), w * 0.013, h * 0.020, 0, 0, Math.PI * 2); g.fill();
    // cuello y cabeza
    poly([[0.588, 0.168], [0.632, 0.168], [0.636, 0.196], [0.584, 0.196]], dark);
    poly([[0.566, 0.058], [0.656, 0.058], [0.660, 0.162], [0.562, 0.162]], base);
    poly([[0.566, 0.058], [0.596, 0.058], [0.596, 0.162], [0.562, 0.162]], mid);
    edge([[0.660, 0.062], [0.660, 0.162]], 'rgba(73,230,255,0.5)', 4);
    // visor encendido
    const vy = Y(0.117), vh = h * 0.022;
    g.fillStyle = 'rgba(255,45,85,0.35)';
    g.fillRect(X(0.578), vy - vh, w * 0.072, vh * 3);
    g.fillStyle = '#ff5c78';
    g.fillRect(X(0.578), vy - vh / 2, w * 0.072, vh);
    g.fillStyle = '#fff2f5';
    g.fillRect(X(0.578), vy - vh / 2, w * 0.072, vh * 0.34);

    // antenas
    edge([[0.586, 0.058], [0.556, 0.014]], 'rgba(73,230,255,0.7)', 3);
    edge([[0.636, 0.058], [0.666, 0.014]], 'rgba(73,230,255,0.7)', 3);
    g.fillStyle = RED;
    g.beginPath(); g.arc(X(0.556), Y(0.014), 4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(X(0.666), Y(0.014), 4, 0, Math.PI * 2); g.fill();

    // núcleo
    const cx = X(0.612), cy = Y(0.398), r = w * 0.052;
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, r * 3.6);
    halo.addColorStop(0, 'rgba(255,240,240,0.95)');
    halo.addColorStop(0.18, 'rgba(255,90,110,0.85)');
    halo.addColorStop(0.55, 'rgba(255,45,85,0.28)');
    halo.addColorStop(1, 'rgba(255,45,85,0)');
    g.fillStyle = halo;
    g.beginPath(); g.arc(cx, cy, r * 3.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff4d6d';
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff6f7';
    g.beginPath(); g.arc(cx - r * 0.22, cy - r * 0.24, r * 0.46, 0, Math.PI * 2); g.fill();
    // anillo de contención
    g.strokeStyle = 'rgba(255,159,67,0.9)';
    g.lineWidth = 4;
    g.beginPath(); g.arc(cx, cy, r * 1.55, 0, Math.PI * 2); g.stroke();
    // cables del núcleo al torso
    g.strokeStyle = 'rgba(255,159,67,0.35)';
    g.lineWidth = 2;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(cx + s * r * 1.5, cy);
      g.quadraticCurveTo(cx + s * r * 2.4, cy - h * 0.06, cx + s * r * 3.2, cy - h * 0.10);
      g.stroke();
    }

    // suelo: reflejos y escala humana
    g.fillStyle = 'rgba(4,6,11,0.75)';
    g.fillRect(x, Y(0.955), w, h * 0.045);
    g.save();
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 22; i++) {
      const u = 0.06 + i * 0.041;
      const grd = g.createLinearGradient(0, Y(0.96), 0, Y(1.0));
      grd.addColorStop(0, i % 3 ? 'rgba(73,230,255,0.12)' : 'rgba(255,45,85,0.16)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(X(u), Y(0.955), w * 0.006, h * 0.045);
    }
    g.restore();
    // coches diminutos: referencia de escala
    for (const u of [0.10, 0.19, 0.86]) {
      g.fillStyle = '#070a11';
      g.fillRect(X(u), Y(0.938), w * 0.030, h * 0.020);
      g.fillStyle = 'rgba(255,214,160,0.9)';
      g.fillRect(X(u) + 2, Y(0.943), w * 0.007, h * 0.006);
      g.fillStyle = 'rgba(255,45,85,0.9)';
      g.fillRect(X(u) + w * 0.022, Y(0.943), w * 0.005, h * 0.005);
    }

    // humo bajo
    g.save();
    g.globalCompositeOperation = 'screen';
    const sm = g.createLinearGradient(0, Y(0.86), 0, Y(1.0));
    sm.addColorStop(0, 'rgba(60,40,60,0)');
    sm.addColorStop(1, 'rgba(90,30,50,0.35)');
    g.fillStyle = sm;
    g.fillRect(x, Y(0.86), w, h * 0.14);
    g.restore();
  }

  function titleComic(g, txt, x, y, maxW) {
    let size = 104;
    g.font = `italic 900 ${size}px ${DISPLAY}`;
    while (g.measureText(txt).width > maxW && size > 50) {
      size -= 4;
      g.font = `italic 900 ${size}px ${DISPLAY}`;
    }
    g.save();
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';
    for (let i = 14; i > 0; i--) {
      g.fillStyle = i > 8 ? '#33091a' : '#12060c';
      g.fillText(txt, x + i, y + i);
    }
    g.strokeStyle = INK;
    g.lineWidth = 11;
    g.strokeText(txt, x, y);
    const grd = g.createLinearGradient(0, y - size, 0, y + 10);
    grd.addColorStop(0, '#fffdf6');
    grd.addColorStop(0.55, '#ffe9b8');
    grd.addColorStop(1, '#ffb057');
    g.fillStyle = grd;
    g.fillText(txt, x, y);
    g.restore();
  }

  function buildPage() {
    const p = panels[idx] || {};
    pg.clearRect(0, 0, W, H);
    pg.fillStyle = '#080a10';
    pg.fillRect(0, 0, W, H);

    /* ---- viñeta héroe ---- */
    const hw = W - M * 2;
    pg.save();
    pg.beginPath();
    pg.rect(M, HERO_Y, hw, HERO_H);
    pg.clip();
    pg.filter = 'contrast(1.14) saturate(1.22) brightness(1.12)';
    cover(pg, art, M, HERO_Y, hw, HERO_H, 1.07, 0.5, 0.5);
    pg.filter = 'none';
    if (/titan/i.test(artKey)) {
      pg.fillStyle = 'rgba(4,6,12,0.42)';
      pg.fillRect(M, HERO_Y, hw, HERO_H);
      titanLayer(pg, M, HERO_Y, hw, HERO_H);
    }
    const gg = pg.createLinearGradient(0, HERO_Y, 0, HERO_Y + HERO_H);
    gg.addColorStop(0, 'rgba(0,0,0,0.62)');
    gg.addColorStop(0.30, 'rgba(0,0,0,0)');
    gg.addColorStop(0.78, 'rgba(2,4,10,0.35)');
    gg.addColorStop(1, 'rgba(2,4,10,0.9)');
    pg.fillStyle = gg;
    pg.fillRect(M, HERO_Y, hw, HERO_H);
    halftone(pg, M, HERO_Y, hw, HERO_H, 0.13);
    pg.restore();
    inked(pg, M, HERO_Y, hw, HERO_H, 18);

    /* rótulo de sector: etiqueta crema */
    if (p.tag) {
      const tagTxt = String(p.tag).toUpperCase();
      pg.save();
      pg.font = `700 28px ${MONO}`;
      const tw = pg.measureText(tagTxt).width;
      pg.fillStyle = CREAM;
      pg.fillRect(M + 34, HERO_Y + 34, tw + 44, 56);
      pg.strokeStyle = INK;
      pg.lineWidth = 8;
      pg.strokeRect(M + 34, HERO_Y + 34, tw + 44, 56);
      pg.fillStyle = '#0b0d14';
      pg.textBaseline = 'middle';
      pg.fillText(tagTxt, M + 56, HERO_Y + 63);
      pg.restore();
    }

    /* título */
    if (p.title) titleComic(pg, p.title, M + 46, HERO_Y + 208, hw - 380);

    /* ---- viñeta inserto (detalle) ---- */
    const isTitan = /titan/i.test(artKey);
    pg.save();
    pg.beginPath();
    pg.rect(M, BOT_Y, INSET_W, BOT_H);
    pg.clip();
    pg.filter = 'contrast(1.2) saturate(1.3) brightness(1.05)';
    cover(pg, art, M, BOT_Y, INSET_W, BOT_H, isTitan ? 2.6 : 1.9, isTitan ? 0.615 : 0.5, isTitan ? 0.40 : 0.5);
    pg.filter = 'none';
    pg.fillStyle = 'rgba(3,5,10,0.28)';
    pg.fillRect(M, BOT_Y, INSET_W, BOT_H);
    halftone(pg, M, BOT_Y, INSET_W, BOT_H, 0.2);
    const ig = pg.createLinearGradient(0, BOT_Y, 0, BOT_Y + BOT_H);
    ig.addColorStop(0, 'rgba(2,4,10,0.55)');
    ig.addColorStop(0.5, 'rgba(0,0,0,0)');
    ig.addColorStop(1, 'rgba(2,4,10,0.75)');
    pg.fillStyle = ig;
    pg.fillRect(M, BOT_Y, INSET_W, BOT_H);
    pg.restore();
    inked(pg, M, BOT_Y, INSET_W, BOT_H, 16);

    // etiqueta del inserto
    pg.save();
    pg.font = `700 20px ${MONO}`;
    const cap = isTitan ? 'EL TITÁN · NÚCLEO' : 'ARCHIVO NEO · ' + String(artKey).toUpperCase();
    const cw = pg.measureText(cap).width;
    pg.fillStyle = RED;
    pg.fillRect(M + 16, BOT_Y + BOT_H - 52, cw + 26, 34);
    pg.fillStyle = '#fff6f7';
    pg.textBaseline = 'middle';
    pg.fillText(cap, M + 29, BOT_Y + BOT_H - 34);
    pg.restore();

    /* ---- caja de narración ---- */
    pg.save();
    pg.fillStyle = CREAM;
    pg.fillRect(CAP_X, BOT_Y, CAP_W, BOT_H);
    pg.fillStyle = RED;
    pg.fillRect(CAP_X, BOT_Y, 14, BOT_H);
    pg.strokeStyle = INK;
    pg.lineWidth = 14;
    pg.strokeRect(CAP_X + 7, BOT_Y + 7, CAP_W - 14, BOT_H - 14);
    // esquinas de archivo
    pg.strokeStyle = 'rgba(16,16,24,0.28)';
    pg.lineWidth = 2;
    pg.strokeRect(CAP_X + 26, BOT_Y + 26, CAP_W - 52, BOT_H - 52);
    pg.restore();

    // pista fija
    pg.save();
    pg.font = `700 19px ${MONO}`;
    pg.fillStyle = 'rgba(16,16,24,0.55)';
    pg.textAlign = 'right';
    pg.textBaseline = 'alphabetic';
    pg.fillText(`${idx + 1}/${panels.length}  ·  DISPARA PARA PASAR`, CAP_X + CAP_W - CAP_PAD, BOT_Y + BOT_H - 24);
    pg.restore();

    // grano de papel sobre todo
    pg.save();
    pg.globalAlpha = 0.45;
    pg.fillStyle = pg.createPattern(GRAIN, 'repeat');
    pg.fillRect(0, 0, W, H);
    pg.restore();
  }

  function renderPanel() {
    const p = panels[idx] || {};
    const T = t;
    if (builtFor !== idx) { buildPage(); builtFor = idx; }

    const inT = ease(T / 0.55);
    ctx.clearRect(0, 0, W, H);
    const z = 1 + (1 - inT) * 0.07;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate((1 - inT) * -0.018);
    ctx.scale(z, z);
    ctx.translate(-W / 2, -H / 2 + (1 - inT) * 46);
    ctx.drawImage(page, 0, 0);
    ctx.restore();

    // narración mecanografiada
    const speed = 68;
    let budget = Math.floor(Math.max(0, T - 0.22) * speed);
    ctx.save();
    ctx.font = CAP_FONT;
    ctx.fillStyle = '#12121a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    let y = BOT_Y + 78;
    for (const ln of lines) {
      if (budget <= 0) break;
      const show = ln.slice(0, budget);
      budget -= ln.length;
      ctx.fillText(show, CAP_X + CAP_PAD, y);
      y += CAP_LH;
    }
    // cursor
    if (budget > 0 && Math.floor(T * 3) % 2 === 0) {
      ctx.fillStyle = RED;
      ctx.fillRect(CAP_X + CAP_PAD, y - 26, 14, 22);
    }
    ctx.restore();

    // barra de avance
    const reveal = total / speed;
    const hold = Math.max(4.5, Math.min(13, total * 0.05));
    const prog = clamp(T / (reveal + hold), 0, 1);
    ctx.save();
    ctx.fillStyle = 'rgba(16,16,24,0.16)';
    ctx.fillRect(CAP_X + CAP_PAD, BOT_Y + BOT_H - 74, CAP_W - CAP_PAD * 2 - 26, 6);
    ctx.fillStyle = RED;
    ctx.fillRect(CAP_X + CAP_PAD, BOT_Y + BOT_H - 74, (CAP_W - CAP_PAD * 2 - 26) * prog, 6);
    ctx.restore();

    // línea de barrido al entrar
    if (inT < 1) {
      const sx = W * inT;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const lg = ctx.createLinearGradient(sx - 190, 0, sx + 40, 0);
      lg.addColorStop(0, 'rgba(73,230,255,0)');
      lg.addColorStop(0.78, 'rgba(73,230,255,0.5)');
      lg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(sx - 190, 0, 230, H);
      ctx.restore();
    }

    tex.needsUpdate = true;
  }

  /* ------------------------------------------------------------- control */
  function start(i) {
    idx = i;
    t = 0;
    builtFor = -1;   // cada entrada recompone la página: el arte y el título son nuevos
    const p = panels[idx] || {};
    artKey = p.art || ['city', 'swarm', 'pistols', 'door', 'titan', 'dawn'][i % 6];
    drawArt(artKey, 31 + i * 17);
    ctx.font = `500 34px ${BODY}`;
    lines = wrap(p.text || '', CAP_W - CAP_PAD * 2, CAP_FONT);
    total = lines.reduce((n, l) => n + l.length, 0);
    renderPanel();
    const voice = p.voice === undefined ? p.text : p.voice;
    if (voice) say(voice);
    else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  /* ------------------------------------------------------------- anclaje 3D */
  // La viñeta se coloca UNA vez delante del jugador y se queda en el mundo:
  // antes seguía a la cabeza cada frame y a 2 m era ilegible (y mareaba).
  let anchor = false;
  const qTmp = new THREE.Quaternion();

  function placePanel() {
    const p = new THREE.Vector3();
    camera.getWorldPosition(p);
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    const gaze = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    let fx = gaze.x, fz = gaze.z;
    const fl = Math.hypot(fx, fz) || 1;
    fx /= fl; fz /= fl;
    // A 5 m y 26º de alto la página se lee como un cartel en la pared. Antes
    // estaba a 3,2 m y ocupaba 44ºx76º: se comía todo el campo de visión, se
    // veía como si estuviera pegada a la cara y no había forma de leerla.
    const D = 5.0;
    group.position.set(p.x + fx * D, p.y + 0.02, p.z + fz * D);
    group.lookAt(p.x, p.y - 0.06, p.z);   // de pie, no inclinada con la cabeza

    // tamaño por ángulo, no por frame: 26º de alto y 46º de ancho como máximo
    const tanV = Math.tan(13 * Math.PI / 180) * 2 * D;
    const tanH = Math.tan(23 * Math.PI / 180) * 2 * D;
    let hh = tanV, ww = hh * W / H;
    if (ww > tanH) { ww = tanH; hh = ww * H / W; }
    plane.scale.set(ww, hh, 1);
    anchor = true;
  }

  return {
    group,
    get playing() { return group.visible; },
    play(list, done) {
      panels = list || [];
      onDone = done || null;
      if (!panels.length) { if (onDone) onDone(); return; }
      group.visible = true;
      anchor = false;
      start(0);
    },
    skip() {
      if (!group.visible) return;
      if (t < 4.6) t = 4.6;
      else next();
    },
    stop() {
      group.visible = false;
      panels = [];
      onDone = null;
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    },
    update(dt) {
      if (!group.visible) return;
      t += dt;

      const p = new THREE.Vector3();
      camera.getWorldPosition(p);

      // anclaje fijo en el mundo: NO se recoloca al girar la cabeza, solo si la
      // dejas a la espalda o te alejas tanto que ya no la leerías
      if (!anchor) placePanel();
      const gz = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(qTmp));
      const flat = new THREE.Vector3(gz.x, 0, gz.z);
      if (flat.lengthSq() > 1e-4) flat.normalize();
      const toP = new THREE.Vector3().subVectors(group.position, p);
      toP.y = 0;
      const distP = toP.length();
      if (distP > 1e-4 && (toP.normalize().dot(flat) < -0.3 || distP > 9 || distP < 2.4)) placePanel();

      // vida propia mínima: se mece como una pantalla colgada, no sigue la cabeza
      plane.rotation.z = Math.sin(t * 0.5) * 0.004;

      renderPanel();

      const revealTime = total / 68;
      // tiempo de lectura de verdad (antes pasaba demasiado rápido)
      const hold = Math.max(4.5, Math.min(13, total * 0.05));
      if (t > revealTime + hold) next();
    }
  };

  function next() {
    if (!group.visible) return;
    if (idx + 1 < panels.length) return start(idx + 1);
    const fn = onDone;
    group.visible = false;
    panels = [];
    onDone = null;
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (fn) fn();
  }
}
