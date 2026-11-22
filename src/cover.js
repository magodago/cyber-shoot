// Portada 3D: el nombre del juego en voxels (fuente 5x7) en dos líneas y dos
// colores de neón, con reflejo en el suelo y flotación lenta. Sin DOM: se ve
// detrás del botón de jugar y también dentro del visor.
import * as THREE from 'three';

const FONT = {
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000']
};

const CYAN = 0x49e6ff;
const MAGENTA = 0xff4fd8;

// líneas -> lista de puntos [col, row] en coordenadas de rejilla
function collect(lines) {
  const out = [];
  const gap = 3;
  let yBase = 0;
  lines.forEach((line, li) => {
    const pts = [];
    for (let ci = 0; ci < line.length; ci++) {
      const rows = FONT[line[ci]] || FONT[' '];
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 5; c++) {
          if (rows[r][c] === '1') pts.push([ci * 6 + c, yBase + (6 - r)]);
        }
      }
    }
    out.push({ pts, color: li % 2 === 0 ? CYAN : MAGENTA, w: line.length * 6 - 1 });
    yBase -= 7 + gap;
  });
  return out;
}

export function createCover(scene, opts = {}) {
  const px = opts.px || 0.16;
  const group = new THREE.Group();
  const title = new THREE.Group();
  group.add(title);

  const rows = collect(['CYBER', 'SHOOT']);
  const width = Math.max(...rows.map(r => r.w)) * px;
  const height = (7 * 2 + 3) * px;
  const geo = new THREE.BoxGeometry(px * 0.95, px * 0.95, px * 2.2);

  const build = (pts, color, offX, offY, opacity, depth) => {
    if (!pts.length) return null;
    const mat = new THREE.MeshBasicMaterial({
      color, toneMapped: false, transparent: opacity < 1, opacity
    });
    const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
    const m = new THREE.Matrix4();
    pts.forEach(([c, r], i) => {
      m.makeTranslation(offX + c * px, offY + r * px, 0);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  };

  rows.forEach((row) => {
    const ox = -(row.w * px) / 2;
    const oy = height / 2;
    const front = build(row.pts, row.color, ox, oy, 1);
    if (front) title.add(front);
  });

  // reflejo aplastado sobre el "suelo"
  rows.forEach((row) => {
    const ox = -(row.w * px) / 2;
    const oy = height / 2;
    const r = build(row.pts, row.color, ox, oy, 0.15);
    if (!r) return;
    r.scale.y = -0.5;
    r.position.set(0, -height / 2 - 0.35, 0);
    group.add(r);
  });

  // halo de fondo: da profundidad y evita que el título flote en el vacío
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture(), color: 0x2b6fff, transparent: true, opacity: 0.45,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  }));
  glow.scale.set(height * 4.2, height * 2.6, 1);
  glow.position.set(0, 0, -2.4);
  group.add(glow);

  // Botón de jugar en 3D: la portada también se ve dentro del visor, donde el
  // HTML no existe. Sin esto, volver al inicio desde el panel de muerte dejaba
  // una pantalla de título sin ninguna forma de empezar.
  const btnTex = playTexture();
  const btn = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(2.3, 0.72),
    new THREE.MeshBasicMaterial({ map: btnTex, transparent: true, toneMapped: false })
  );
  btn.add(plate);
  const btnGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture(), color: 0x49e6ff, transparent: true, opacity: 0.5,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
  }));
  btnGlow.scale.set(3.4, 1.5, 1);
  btnGlow.position.z = -0.06;
  btn.add(btnGlow);
  btn.position.set(0, -0.86, 0.35);
  group.add(btn);

  group.position.set(0, 1.72, -5.6);
  scene.add(group);

  let t = 0;
  return {
    group,
    update(dt) {
      if (!group.visible) return;
      t += dt;
      title.position.y = Math.sin(t * 0.8) * 0.07;
      title.rotation.y = Math.sin(t * 0.34) * 0.16;
      title.rotation.x = Math.sin(t * 0.5) * 0.035;
      glow.material.opacity = 0.34 + Math.sin(t * 1.5) * 0.08;
      const p = 1 + Math.sin(t * 2.2) * 0.035;
      btn.scale.set(p, p, 1);
      btnGlow.material.opacity = 0.34 + Math.sin(t * 2.2) * 0.14;
    },
    button: btn,
    show(v) { group.visible = v; document.body.classList.toggle('on-cover', !!v); }
  };
}

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grd.addColorStop(0, 'rgba(120,190,255,0.9)');
  grd.addColorStop(0.45, 'rgba(60,120,220,0.32)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Placa holográfica con la palabra JUGAR (canvas -> textura, sin DOM)
function playTexture() {
  const c = document.createElement('canvas');
  c.width = 768; c.height = 240;
  const g = c.getContext('2d');
  const w = c.width, h = c.height, r = 46;
  g.beginPath();
  g.moveTo(r, 6);
  g.arcTo(w - 6, 6, w - 6, h - 6, r);
  g.arcTo(w - 6, h - 6, 6, h - 6, r);
  g.arcTo(6, h - 6, 6, 6, r);
  g.arcTo(6, 6, w - 6, 6, r);
  g.closePath();
  const grd = g.createLinearGradient(0, 0, w, h);
  grd.addColorStop(0, 'rgba(10,32,48,0.92)');
  grd.addColorStop(1, 'rgba(6,18,32,0.92)');
  g.fillStyle = grd;
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(73,230,255,0.95)';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#d9fbff';
  g.shadowColor = 'rgba(73,230,255,0.95)';
  g.shadowBlur = 26;
  g.font = '800 96px Inter, system-ui, sans-serif';
  g.fillText('J U G A R', w / 2, h / 2 - 6);
  g.shadowBlur = 0;
  g.font = '600 26px Inter, system-ui, sans-serif';
  g.fillStyle = 'rgba(150,230,255,0.75)';
  g.fillText('GATILLO PARA EMPEZAR', w / 2, h - 42);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
