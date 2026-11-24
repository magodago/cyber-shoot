import * as THREE from 'three';
import { TEX } from './fx.js';

// ---------------------------------------------------------------------------
// ARMAS: dos pistolas de plasma, una por mano. Recarga apuntando al suelo.
// Sin assets: todo geometría + emisivos.
// ---------------------------------------------------------------------------

const GUN_COL = {
  body: 0x394e66,
  metal: 0x5b7590,
  neonA: 0x49e6ff,
  neonB: 0xff4fd8
};

function mat(color, { metal = 0.85, rough = 0.35, emis = 0x000000, ei = 0 } = {}) {
  return new THREE.MeshStandardMaterial({
    color, metalness: metal, roughness: rough,
    emissive: new THREE.Color(emis), emissiveIntensity: ei, envMapIntensity: 1.4
  });
}

// textura de la empuñadura: picado antideslizante, grano de polímero y desgaste
function gripTex() {
  const w = 128, h = 256, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  // cachas de oro con picado: el dibujo es dorado, el metal lo pone el material
  const grd0 = g.createLinearGradient(0, 0, w, h);
  grd0.addColorStop(0, '#d8a63a');
  grd0.addColorStop(0.35, '#f3cd75');
  grd0.addColorStop(0.62, '#c9962c');
  grd0.addColorStop(1, '#e8bb55');
  g.fillStyle = grd0; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) {
    const v = 150 + Math.random() * 90;
    g.fillStyle = `rgba(${v},${v * 0.82 | 0},${v * 0.36 | 0},${0.10 + Math.random() * 0.18})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
  // picado: puntos hundidos con un filo claro arriba a la izquierda
  for (let y = 8; y < h - 8; y += 7) {
    for (let x = 8 + (((y / 7) | 0) % 2) * 3.5; x < w - 8; x += 7) {
      g.fillStyle = 'rgba(70,44,6,0.72)';
      g.beginPath(); g.arc(x, y, 2.2, 0, 6.2832); g.fill();
      g.fillStyle = 'rgba(255,238,190,0.55)';
      g.beginPath(); g.arc(x - 0.7, y - 0.8, 1.1, 0, 6.2832); g.fill();
    }
  }
  const grd = g.createLinearGradient(0, 0, w, 0);
  grd.addColorStop(0, 'rgba(255,242,205,0.22)');
  grd.addColorStop(0.14, 'rgba(0,0,0,0)');
  grd.addColorStop(0.86, 'rgba(0,0,0,0)');
  grd.addColorStop(1, 'rgba(255,242,205,0.22)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Perfil lateral extruido en X: da cantos biselados, no bloques. */
function plate(pts, w, bevel = 0.0016, hole = null) {
  const sh = new THREE.Shape();
  pts.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
  sh.closePath();
  if (hole) {
    const h = new THREE.Path();
    hole.forEach((p, i) => (i ? h.lineTo(p[0], p[1]) : h.moveTo(p[0], p[1])));
    h.closePath();
    sh.holes.push(h);
  }
  const geo = new THREE.ExtrudeGeometry(sh, {
    depth: w, steps: 1, bevelEnabled: true,
    bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 5
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(w / 2, 0, 0);
  geo.computeVertexNormals();
  return geo;
}

/** Pistola de servicio 1:1 (~19 cm). Empuñadura en el origen, cañón hacia -Z. */
function buildPistol(accent, side = 1, finish = 'gold') {
  const g = new THREE.Group();
  const body = new THREE.Group();
  g.add(body);

  // Las DOS pistolas enteras en oro: no hay partes de polímero ni acero
  // vistas, todo el arma es metal dorado pulido. El color base es el del oro
  // real (1.00, 0.77, 0.34) y el brillo sale del entorno PMREM de la escena.
  const gold = true; // las dos pistolas son de oro, sin acero ni polímero a la vista
  const steel  = mat(0xe8b23c, { metal: 1.00, rough: 0.24 });   // cuerpo
  const steelL = mat(0xffe7a8, { metal: 1.00, rough: 0.09 });   // aristas pulidas
  const trim   = mat(0xa87a24, { metal: 1.00, rough: 0.36 });   // rebajes
  const poly   = mat(0xc9972f, { metal: 0.98, rough: 0.30 });   // armazón
  const poly2  = mat(0xb98a28, { metal: 0.94, rough: 0.52 });   // cachas
  const dark   = mat(0x4a3008, { metal: 0.90, rough: 0.40 });   // ánima y huecos
  const neon   = mat(accent, { metal: 0.3, rough: 0.35, emis: accent, ei: 1.5 });

  // --- corredera: perfil con chaflán delantero y lomo rebajado ------------
  const slide = new THREE.Mesh(plate([
    [0.092, -0.0046], [0.092, 0.0212], [-0.078, 0.0212],
    [-0.094, 0.0178], [-0.100, 0.0102], [-0.100, -0.0046]
  ], 0.0264, 0.0026), steel);
  body.add(slide);

  // ranuras de agarre traseras, inclinadas (no rectángulos planos)
  for (let i = 0; i < 9; i++) {
    const z = 0.0530 + i * 0.0042;
    for (const sx of [-1, 1]) {
      const sl = new THREE.Mesh(new THREE.BoxGeometry(0.0018, 0.0215, 0.0022), steelL);
      sl.position.set(sx * 0.0134, 0.0084, z);
      sl.rotation.x = 0.24;
      body.add(sl);
    }
  }
  // ventana de expulsión + extractor
  const port = new THREE.Mesh(plate([
    [-0.020, 0.0035], [0.026, 0.0035], [0.026, 0.0165], [-0.020, 0.0165]
  ], 0.0008, 0.0002), dark);
  port.position.x = 0.0133;
  body.add(port);
  const extractor = new THREE.Mesh(new THREE.BoxGeometry(0.0012, 0.0032, 0.030), steelL);
  extractor.position.set(0.0133, 0.0172, 0.006);
  body.add(extractor);

  // --- alza y punto de mira ---------------------------------------------
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.0056, 0.0105, 0.0062), steel);
    post.position.set(sx * 0.0072, 0.0262, 0.0855);
    body.add(post);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), neon);
    dot.position.set(sx * 0.0072, 0.0228, 0.0822);
    body.add(dot);
  }
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(0.0032, 0.0075, 0.005), steel);
  frontSight.position.set(0, 0.0248, -0.0855);
  body.add(frontSight);
  const fsDot = new THREE.Mesh(new THREE.SphereGeometry(0.0013, 8, 6), neon);
  fsDot.position.set(0, 0.0225, -0.0828);
  body.add(fsDot);

  // --- armazón: polvo, rail y mandos ------------------------------------
  const frame = new THREE.Mesh(plate([
    [0.092, -0.0042], [-0.070, -0.0042], [-0.074, -0.0092],
    [-0.068, -0.0205], [0.030, -0.0205], [0.092, -0.0125]
  ], 0.0268, 0.0018), poly2);
  body.add(frame);

  for (let i = 0; i < 3; i++) {
    const rib = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.0026, 0.0034), trim);
    rib.position.set(0, -0.0214, -0.050 - i * 0.0072);
    body.add(rib);
  }
  // --- detalles de arma de calidad: lomo pulido, incrustaciones y tornillos
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.0118, 0.0014, 0.138), steelL);
  spine.position.set(0, 0.0219, 0.006);
  body.add(spine);
  for (const sx of [-1, 1]) {
    // incrustación lateral pulida sobre la corredera
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.0010, 0.0092, 0.052), steelL);
    inlay.position.set(sx * 0.0139, 0.0102, 0.028);
    body.add(inlay);
    // tres cortes de grabado en el frente de la corredera
    for (let i = 0; i < 3; i++) {
      const cut = new THREE.Mesh(new THREE.BoxGeometry(0.0011, 0.0135, 0.0030), trim);
      cut.position.set(sx * 0.0139, 0.0072, -0.034 - i * 0.0085);
      cut.rotation.x = -0.22;
      body.add(cut);
    }
    // tornillos del armazón
    for (const zz of [-0.030, 0.026]) {
      const scr = new THREE.Mesh(new THREE.CylinderGeometry(0.0026, 0.0026, 0.0014, 12), trim);
      scr.rotation.z = Math.PI / 2;
      scr.position.set(sx * 0.0140, -0.0112, zz);
      body.add(scr);
    }
  }
  // bocallave de la aguja percutora, en metal mate
  const pinHole = new THREE.Mesh(new THREE.CylinderGeometry(0.0021, 0.0021, 0.0012, 12), trim);
  pinHole.rotation.z = Math.PI / 2;
  pinHole.position.set(0, 0.0158, 0.0905);
  body.add(pinHole);

  // retén de corredera (izq.) y liberación de cargador
  const stop = new THREE.Mesh(plate([
    [0.006, -0.0125], [0.040, -0.0125], [0.042, -0.0182], [0.006, -0.0196]
  ], 0.0018, 0.0006), steelL);
  stop.position.x = -0.0138;
  body.add(stop);
  for (const sx of [-1, 1]) {
    const rel = new THREE.Mesh(new THREE.CylinderGeometry(0.0042, 0.0042, 0.0026, 14), steelL);
    rel.rotation.z = Math.PI / 2;
    rel.position.set(sx * 0.0138, -0.0165, 0.0105);
    body.add(rel);
  }

  // --- guardamonte real (aro, no alambre) -------------------------------
  const guard = new THREE.Mesh(plate([
    [-0.006, -0.0192], [-0.046, -0.0192], [-0.050, -0.0300],
    [-0.043, -0.0455], [-0.020, -0.0512], [0.006, -0.0505],
    [0.014, -0.0380], [0.013, -0.0192]
  ], 0.0245, 0.0020, [
    [-0.004, -0.0235], [-0.040, -0.0235], [-0.043, -0.0305],
    [-0.037, -0.0410], [-0.019, -0.0455], [0.002, -0.0450],
    [0.0085, -0.0350], [0.008, -0.0235]
  ]), poly2);
  body.add(guard);

  const trigger = new THREE.Mesh(plate([
    [0.0055, -0.0255], [0.0072, -0.0315], [0.0062, -0.0395],
    [0.0030, -0.0448], [0.0002, -0.0430], [0.0006, -0.0345], [0.0028, -0.0265]
  ], 0.0062, 0.0009), steel);
  body.add(trigger);

  // --- empuñadura con curva de palma y ranuras --------------------------
  const gt = gripTex();
  gt.wrapS = gt.wrapT = THREE.RepeatWrapping;
  gt.repeat.set(9, 9);
  const gripMat = new THREE.MeshStandardMaterial({
    map: gt, color: 0xffffff, metalness: 1.0, roughness: 0.38,
    envMapIntensity: 1.0
  });
  const grip = new THREE.Mesh(plate([
    [-0.0062, -0.0175], [-0.0022, -0.0320], [-0.0028, -0.0430],
    [0.0010, -0.0480], [0.0002, -0.0540], [0.0040, -0.0592],
    [0.0032, -0.0650], [0.0072, -0.0702], [0.0066, -0.0760],
    [0.0108, -0.0815], [0.0128, -0.0930], [0.0180, -0.1060],
    [0.0205, -0.1175], [0.0620, -0.1195], [0.0700, -0.1080],
    [0.0748, -0.0900], [0.0798, -0.0700], [0.0846, -0.0480],
    [0.0888, -0.0300], [0.0915, -0.0155], [0.0905, -0.0080]
  ], 0.0286, 0.0030), gripMat);
  body.add(grip);

  // cargador: base con labio y franja de acento
  const base = new THREE.Mesh(plate([
    [0.0195, -0.1170], [0.0225, -0.1205], [0.0640, -0.1225],
    [0.0685, -0.1145], [0.0645, -0.1120], [0.0225, -0.1105]
  ], 0.0330, 0.0018), poly);
  body.add(base);
  const mark = new THREE.Mesh(new THREE.BoxGeometry(0.0332, 0.0016, 0.0030), neon);
  mark.position.set(0, -0.1195, 0.0605);
  mark.rotation.x = 0.16;
  body.add(mark);

  // --- cañón, guía y boca ------------------------------------------------
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.0082, 0.0082, 0.017, 20), steelL);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.0042, -0.0975);
  body.add(barrel);
  const crown = new THREE.Mesh(new THREE.TorusGeometry(0.0082, 0.0009, 8, 20), steelL);
  crown.position.set(0, 0.0042, -0.1058);
  body.add(crown);
  const bore = new THREE.Mesh(new THREE.CylinderGeometry(0.0050, 0.0050, 0.020, 20, 1, true), dark);
  bore.rotation.x = Math.PI / 2;
  bore.position.set(0, 0.0042, -0.0972);
  const boreFace = new THREE.Mesh(new THREE.CircleGeometry(0.0050, 20), dark);
  boreFace.position.set(0, 0.0042, -0.0885);
  body.add(boreFace);
  body.add(bore);
  const guide = new THREE.Mesh(new THREE.CylinderGeometry(0.0030, 0.0030, 0.026, 12), dark);
  guide.rotation.x = Math.PI / 2;
  guide.position.set(0, -0.0126, -0.0790);
  body.add(guide);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.0042, -0.108);
  body.add(muzzle);

  // --- fogonazo: tres capas de fuego + pétalos y una luz que ilumina la calle
  const glowTex = TEX ? TEX.glow : null;
  const fireSprite = (color, scale) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false
    }));
    sp.position.copy(muzzle.position);
    sp.scale.setScalar(scale);
    sp.visible = false;
    body.add(sp);
    return sp;
  };
  // halo exterior rojo-naranja, llama media naranja y núcleo amarillo
  const flash = fireSprite(0xff4a08, 0.34);
  const flashMid = fireSprite(0xff9c14, 0.22);
  flashMid.position.z -= 0.008;
  const flashCore = fireSprite(0xfff3b8, 0.12);
  flashCore.position.z -= 0.016;

  // pétalos de llama que salen hacia delante desde la boca del cañón
  const petals = new THREE.Group();
  petals.position.copy(muzzle.position);
  petals.visible = false;
  body.add(petals);
  const petalGeo = new THREE.ConeGeometry(0.0145, 0.150, 5, 1, true);
  petalGeo.translate(0, 0.075, 0);
  petalGeo.rotateX(-Math.PI / 2);
  const petalMat = new THREE.MeshBasicMaterial({
    color: 0xff8a1e, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  });
  for (let i = 0; i < 5; i++) {
    const pt = new THREE.Mesh(petalGeo, petalMat);
    const a = (i / 5) * Math.PI * 2;
    pt.rotation.z = a;
    pt.rotation.x = (i % 2 ? 1 : -1) * 0.16;
    pt.scale.set(0.85, 0.75 + Math.random() * 0.5, 1);
    petals.add(pt);
  }
  // chispas de pólvora que escapan de la boca
  const sparks = new THREE.Group();
  sparks.position.copy(muzzle.position);
  sparks.visible = false;
  body.add(sparks);
  const sparkMat = new THREE.MeshBasicMaterial({
    color: 0xffd27a, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false
  });
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Mesh(new THREE.SphereGeometry(0.0022, 5, 4), sparkMat);
    sp.position.set((Math.random() - 0.5) * 0.03, (Math.random() - 0.5) * 0.03, -0.02 - Math.random() * 0.05);
    sparks.add(sp);
  }
  // lengua de fuego larga: conos alineados con el cañón. Un sprite siempre
  // mira a cámara, así que el fogonazo largo tiene que ser geometría.
  const tongueGroup = new THREE.Group();
  tongueGroup.position.copy(muzzle.position);
  tongueGroup.visible = false;
  body.add(tongueGroup);
  const tongueGeo = new THREE.ConeGeometry(0.030, 0.42, 9, 2, true);
  tongueGeo.translate(0, 0.21, 0);
  tongueGeo.rotateX(-Math.PI / 2);
  const tongue = new THREE.Mesh(tongueGeo, new THREE.MeshBasicMaterial({
    color: 0xff5a08, transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
  tongueGroup.add(tongue);
  const tongueCoreGeo = new THREE.ConeGeometry(0.014, 0.24, 9, 2, true);
  tongueCoreGeo.translate(0, 0.12, 0);
  tongueCoreGeo.rotateX(-Math.PI / 2);
  const tongueCore = new THREE.Mesh(tongueCoreGeo, new THREE.MeshBasicMaterial({
    color: 0xffe8a8, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
  }));
  tongueGroup.add(tongueCore);

  // luz real: el fogonazo alumbra el arma y el suelo durante un instante
  const flashLight = new THREE.PointLight(0xff7a18, 0, 3.4, 2);
  flashLight.position.copy(muzzle.position);
  body.add(flashLight);

  // indicador de munición: arco fino pegado a la base del cargador
  const ammoRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.0155, 0.0013, 6, 20, Math.PI * 1.7),
    new THREE.MeshStandardMaterial({ color: accent, emissive: new THREE.Color(accent), emissiveIntensity: 0.9, metalness: 0.2, roughness: 0.4 })
  );
  ammoRing.position.set(0, -0.1125, 0.0415);
  ammoRing.rotation.set(-0.24 + Math.PI / 2, 0, -Math.PI * 0.35);
  body.add(ammoRing);

  // la empuñadura (centro de la mano) queda en el origen del grupo
  body.position.set(0, 0.062, 0.004);
  g.scale.setScalar(1.15);

  // Piezas propias del arma (sin efectos): si llega un modelo escaneado se
  // apagan todas y el fogonazo sigue naciendo del mismo muzzle.
  const efectos = new Set([muzzle, flash, flashMid, flashCore, petals, sparks, tongueGroup, flashLight]);
  const gunParts = body.children.filter((c) => !efectos.has(c) && !c.isLight);

  return { group: g, body, gunParts, muzzle, flash, flashMid, flashCore, petals, sparks, tongueGroup, tongue, tongueCore, flashLight, ammoRing };
}

export class WeaponSystem {
  constructor({ scene, camera, audio, fx, hitTest, onShot, onHit, onDry }) {
    this.scene = scene;
    this.camera = camera;
    // ?dbg=1 muestra un panel dentro del visor con el estado de cada mando
    this.dbg = typeof location !== 'undefined' && /[?&]dbg=1/.test(location.search);
    this.audio = audio;
    this.fx = fx;
    this.hitTest = hitTest;
    this.onShot = onShot || (() => {});
    this.onHit = onHit || (() => {});
    this.onDry = onDry || (() => {});

    this.upgrades = { dmg: 0, mag: 0, rate: 0, reload: 0, pierce: 0, crit: 0 };

    this.hands = {};
    for (const hand of ['L', 'R']) {
      const accent = hand === 'R' ? GUN_COL.neonA : GUN_COL.neonB;
      // derecha en oro, izquierda en plata (dos piezas distintas en la mano)
      const built = buildPistol(accent, hand === 'R' ? 1 : -1, 'gold'); // las dos manos en oro
      scene.add(built.group);
      this.hands[hand] = {
        hand,
        ...built,
        accent,
        ammo: 14,
        reloading: false,
        reloadT: 0,
        cool: 0,
        kick: 0,
        flashT: 0, flashDur: 0.11,
        controller: null,
        attached: null,
        base: {
          p: new THREE.Vector3(0, 0.005, 0.02),
          q: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06, 0, 0))
        },
        aimDownT: 0,
        shots: 0
      };
    }

    // proyectiles láser: cilindros gruesos que viajan (no líneas finas)
    this.tracers = [];
    const coreGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
    coreGeo.rotateX(Math.PI / 2);                      // eje sobre +Z
    for (let i = 0; i < 16; i++) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0, toneMapped: false,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      const halo = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({
        color: 0x35d6ff, transparent: true, opacity: 0, toneMapped: false,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      g.add(halo, core);
      g.visible = false;
      scene.add(g);
      this.tracers.push({
        g, core, halo, life: 0, max: 0.2, dist: 1, prog: 1,
        a: new THREE.Vector3(), dir: new THREE.Vector3()
      });
    }
    this.tracerIdx = 0;

    // miras láser: haz tenue desde la boca del arma, solo en VR
    this.sights = {};
    for (const hand of ['L', 'R']) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
        color: hand === 'R' ? GUN_COL.neonA : GUN_COL.neonB,
        transparent: true, opacity: 0.34, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false
      }));
      line.frustumCulled = false;
      line.visible = false;
      scene.add(line);
      this.sights[hand] = line;
    }

    this.tmpV = new THREE.Vector3();
    this.tmpQ = new THREE.Quaternion();
    this.lastAim = new THREE.Vector3(0, 0, -1);
    this.enabled = true;
    this.time = 0;
    this.sens = 1;
  }

  get magSize() { return 60 + this.upgrades.mag * 10; }
  get reloadTime() { return Math.max(0.20, 0.34 - this.upgrades.reload * 0.03); }
  get fireDelay() { return Math.max(0.045, 0.075 - this.upgrades.rate * 0.004); }
  get damage() { return 16 + this.upgrades.dmg * 5; }

  attachControllers(renderer) {
    this.renderer = renderer;
    for (let i = 0; i < 2; i++) {
      const c = renderer.xr.getController(i);
      const grip = renderer.xr.getControllerGrip(i);
      this.scene.add(c);
      this.scene.add(grip);

      c.addEventListener('connected', (e) => {
        const hand = e.data.handedness === 'left' ? 'L' : 'R';
        c.userData.hand = hand;
        c.userData.inputSource = e.data;
        const h = this.hands[hand];
        h.controller = c;
        // Anclaje propio: cada frame copiamos la pose XR del mando a este nodo.
        // No colgamos el arma del nodo grip de three.js porque su .visible solo
        // pasa a true si llega pose de gripSpace: en Quest (manos + mandos, o
        // pérdida puntual de tracking) se queda false y el arma se iba a la vista.
        let anchor = h.anchor;
        if (!anchor) {
          anchor = new THREE.Group();
          anchor.matrixAutoUpdate = false;
          this.scene.add(anchor);
          h.anchor = anchor;
        }
        anchor.add(h.group);
        h.group.position.copy(h.base.p);
        h.group.quaternion.copy(h.base.q);
        h.group.scale.setScalar(1);
        h.group.visible = true;
        h.attached = anchor;
      });

      c.addEventListener('disconnected', () => {
        const h = this.hands[c.userData.hand];
        if (!h) return;
        h.controller = null;
        h.attached = null;
        h.group.visible = false;
      });
    }
  }

  setUpgrades(u) {
    Object.assign(this.upgrades, u || {});
    for (const hand of ['L', 'R']) {
      this.hands[hand].ammo = Math.min(this.hands[hand].ammo, this.magSize);
    }
  }

  reload(hand, force = false) {
    const h = this.hands[hand];
    if (!h || h.reloading) return false;
    if (h.ammo >= this.magSize && !force) return false;
    h.reloading = true;
    h.reloadT = 0;
    if (this.audio && this.audio.reload) this.audio.reload();
    return true;
  }

  fire(hand) {
    if (!this.enabled) return false;
    const h = this.hands[hand];
    if (!h || h.reloading || h.cool > 0) return false;
    if (h.ammo <= 0) {
      // Munición automática: al vaciar el cargador se rellena solo (sin botón).
      this.reload(hand, true);
      return false;
    }
    h.ammo--;
    // Cadencia anclada al TIEMPO, no al frame: se arrastra el sobrante del
    // frame anterior (x2) en vez de reiniciar el contador. Antes, con frames
    // que oscilaban alrededor de fireDelay, el ritmo salía irregular (0.06 /
    // 0.09 / 0.06...) y al mantener el gatillo se notaban tirones.
    h.cool = Math.min(this.fireDelay, h.cool + this.fireDelay);
    h.kick = 1;
    h.flashT = h.flashDur;
    h.shots++;

    const origin = h.muzzle.getWorldPosition(new THREE.Vector3());
    const dir = this.getAimDir(h, origin);
    this.lastAim.copy(dir);

    // en pantalla el impacto se calcula desde el centro de la vista (lo que apunta la mira),
    // no desde la boca del arma: si no, el desvío del cañón hace fallar tiros centrados
    let rayO = origin, rayD = dir;
    if (!h.controller) {
      rayO = this.camera.getWorldPosition(new THREE.Vector3());
      const cq = this.camera.getWorldQuaternion(new THREE.Quaternion());
      rayD = new THREE.Vector3(0, 0, -1).applyQuaternion(cq).normalize();
    }
    const res = this.hitTest ? this.hitTest(rayO, rayD, h) : null;
    const end = res ? res.point : origin.clone().addScaledVector(dir, 45);

    this.spawnTracer(origin, end, h.accent);
    if (this.audio && this.audio.shot) this.audio.shot(hand === 'R' ? 1 : 0.92);
    if (this.fx) this.fx.spark(origin, h.accent, 3, 2.0, 0.22, 0.07);
    this.haptic(h, 0.55, 40);
    this.onShot(hand, h, res);
    if (res) this.onHit(res, hand, h);
    return true;
  }

  getAimDir(h, origin) {
    const q = new THREE.Quaternion();
    h.group.getWorldQuaternion(q);
    const local = new THREE.Vector3(0, 0, -1).applyQuaternion(q).normalize();
    if (h.controller) return local;

    // pantalla: el rayo converge al centro de la vista a 18 m
    const cq = this.camera.getWorldQuaternion(new THREE.Quaternion());
    const target = new THREE.Vector3(0, 0, -1).applyQuaternion(cq).multiplyScalar(18)
      .add(this.camera.getWorldPosition(new THREE.Vector3()));
    return target.sub(origin).normalize();
  }

  haptic(h, strength, ms) {
    const c = h.controller;
    if (!c) return;
    const src = c.userData.inputSource;
    const act = src && src.gamepad && src.gamepad.hapticActuators;
    if (act && act.length) act[0].pulse(strength, ms);
  }

  spawnTracer(a, b, color) {
    const t = this.tracers[this.tracerIdx++ % this.tracers.length];
    t.a.copy(a);
    t.dir.copy(b).sub(a);
    t.dist = Math.max(0.5, t.dir.length());
    t.dir.divideScalar(t.dist);
    t.prog = 0;
    t.max = Math.min(0.7, t.dist / 150 + 0.16);
    t.life = t.max;
    t.g.position.copy(a);
    t.g.lookAt(b);                                   // +Z apuntando al impacto
    t.core.material.color.setHex(0xffffff);
    t.halo.material.color.setHex(color);
    t.core.material.opacity = 0.95;
    t.halo.material.opacity = 0.55;
    t.g.visible = true;
  }

  // Lee la pose de las manos directamente del frame XR. Así el arma sigue al
  // mando de verdad, sin depender de los nodos internos de three.js.
  sampleXR(frame, presenting) {
    const out = this._xrPose || (this._xrPose = { L: null, R: null, viewInv: null });
    out.L = out.R = null;
    out.viewInv = null;
    if (!presenting || !frame) return out;
    const xr = this.renderer.xr;
    const session = (xr.getSession && xr.getSession()) || frame.session || null;
    const ref = xr.getReferenceSpace ? xr.getReferenceSpace() : null;
    if (!session || !ref || !session.inputSources) return out;

    // Pose de la cabeza en la MISMA referencia que los mandos. Las manos se
    // pasan a espacio relativo a la cabeza: el rig (posición y yaw del mundo)
    // transforma a la cámara, así que una pose absoluta del mando dentro del
    // rig acaba desplazada y el arma se iba a la vista.
    let viewer = null;
    try { viewer = frame.getViewerPose ? frame.getViewerPose(ref) : null; } catch (err) { viewer = null; }
    if (!viewer) return out;
    const vi = this._viewInv || (this._viewInv = new THREE.Matrix4());
    vi.fromArray(viewer.transform.matrix).invert();
    out.viewInv = vi;
    const info = this._srcInfo || (this._srcInfo = []);
    info.length = 0;
    for (const src of session.inputSources) {
      const hand = src.handedness === 'left' ? 'L' : (src.handedness === 'right' ? 'R' : null);
      if (!hand) continue;
      info.push((hand === 'L' ? 'L' : 'R') + (src.gripSpace ? 'g' : '-') + (src.targetRayMode === 'tracked-pointer' ? 't' : '-'));
      const space = src.gripSpace || src.targetRaySpace;
      if (!space) continue;
      let pose = null, aim = null;
      try { pose = frame.getPose(space, ref); } catch (err) { pose = null; }
      if (!pose) continue;
      // el rayo de apuntado (-Z) es la dirección real del mando: orienta el
      // arma con él y la coloca en la empuñadura (pose de grip)
      if (src.gripSpace && src.targetRaySpace) {
        try { aim = frame.getPose(src.targetRaySpace, ref); } catch (err) { aim = null; }
      }
      // mandos reales (gripSpace + tracked-pointer) tienen prioridad sobre manos
      const score = (src.gripSpace ? 2 : 0) + (src.targetRayMode === 'tracked-pointer' ? 1 : 0);
      if (!out[hand] || score > out[hand].score) {
        const mats = this._hmats || (this._hmats = { L: { m: new THREE.Matrix4(), r: new THREE.Matrix4() }, R: { m: new THREE.Matrix4(), r: new THREE.Matrix4() } });
        const slot = mats[hand];
        slot.m.fromArray(pose.transform.matrix);
        slot.r.fromArray((aim || pose).transform.matrix);
        out[hand] = { score, m: slot.m, r: slot.r };
      }
    }
    return out;
  }

  update(dt, xrFrame) {
    this.time += dt;
    const presenting = !!(this.renderer && this.renderer.xr.isPresenting);
    const xrPose = this.sampleXR(xrFrame, presenting);

    for (const hand of ['L', 'R']) {
      const h = this.hands[hand];
      // El enfriamiento puede quedar en negativo (crédito del frame) para que
      // la cadencia se recupere exacta al disparar; se acota para no acumular.
      h.cool = Math.max(-0.5, h.cool - dt);
      h.kick = Math.max(0, h.kick - dt * 6.5);
      h.flashT = Math.max(0, h.flashT - dt);

      // al salir de VR el arma vuelve a colgar de la escena (vista en primera persona)
      if (!presenting && h.group.parent !== this.scene) {
        this.scene.add(h.group);
        h.attached = null;
        h.group.position.set(0, 0, 0);
        h.group.quaternion.identity();
        h.group.visible = true;
      }

      const pose = xrPose[hand];
      let held = false;
      if (presenting && pose && xrPose.viewInv) {
        if (!h.anchor) {
          h.anchor = new THREE.Group();
          h.anchor.matrixAutoUpdate = false;
          this.camera.add(h.anchor);
          h.anchor.add(h.group);
        }
        if (h.anchor.parent !== this.camera) this.camera.add(h.anchor);
        // mano en espacio de la cabeza: (empuñadura + rayo de apuntado)
        // premultiplicado por la inversa del visor. Así el rig que mueve y
        // gira el mundo no desplaza el arma fuera de la mano.
        const pm = this._pm || (this._pm = new THREE.Matrix4());
        const qm = this._qm || (this._qm = new THREE.Quaternion());
        const hp = this._hp || (this._hp = new THREE.Vector3());
        const one = this._one || (this._one = new THREE.Vector3(1, 1, 1));
        pm.compose(hp.setFromMatrixPosition(pose.m), qm.setFromRotationMatrix(pose.r), one);
        pm.premultiply(xrPose.viewInv);
        h.anchor.matrix.copy(pm);
        h.anchor.updateMatrixWorld(true);
        // cordura: un mando a media calle de la cabeza es un dato roto
        const rel = this._rel || (this._rel = new THREE.Vector3());
        rel.setFromMatrixPosition(pm);
        held = !(rel.z > 0.3 || rel.z < -1.4 || Math.abs(rel.x) > 0.9 || Math.abs(rel.y) > 1.0);
        h.dbgZ = rel.z;
      }

      let useView = !held;

      if (held) {
        if (h.group.parent !== h.anchor) h.anchor.add(h.group);
        // el padre ya trae la pose del mando: aquí solo el ajuste base,
        // para que retroceso y recarga no se acumulen frame a frame
        h.group.matrixAutoUpdate = true;
        h.group.position.copy(h.base.p);
        h.group.quaternion.copy(h.base.q);
        h.group.visible = true;
      }

      if (useView) {
        // sin mando válido en esa mano (en VR o en pantalla): pistola anclada
        // a la vista, abierta hacia el centro, para no quedarse nunca sin armas
        if (h.group.parent !== this.scene) {
          this.scene.add(h.group); // si colgaba de un mando con pose absurda
          h.attached = null;
        }
        h.group.matrixAutoUpdate = true;
        h.group.visible = true;
        const side = hand === 'R' ? 1 : -1;
        const p = this.tmpV.set(side * 0.2, -0.215, -0.44).applyMatrix4(this.camera.matrixWorld);
        h.group.position.lerp(p, Math.min(1, dt * 18));
        const q = this.camera.getWorldQuaternion(this.tmpQ);
        h.group.quaternion.copy(q);
        h.group.rotateY(side * -0.055);
        h.group.rotateX(0.04);
      }

      // estado real de la mano para el HUD: pistola sujeta por el mando
      h.held = held && !useView;

      // Recarga AUTOMÁTICA: al vaciar el cargador se rellena solo. Se quitó el
      // gesto de apuntar al suelo porque partía el ritmo y en pleno combate no
      // se ve el cargador vacío.
      if (h.ammo <= 0 && !h.reloading) this.reload(hand, true);

      if (h.reloading) {
        h.reloadT += dt;
        const k = Math.min(1, h.reloadT / this.reloadTime);
        // amago mínimo: el arma baja un dedo, no se sale de la línea de tiro
        h.group.rotateX(Math.sin(k * Math.PI) * 0.12);
        h.group.position.y -= Math.sin(k * Math.PI) * 0.025;
        if (this.fx && h.reloadT < dt * 1.5) {
          this.fx.ring(h.group.position, h.accent, 0.5, 0.4);
        }
        if (k >= 1) {
          h.reloading = false;
          h.ammo = this.magSize;
          h.reloadT = 0;
          if (this.fx) this.fx.spark(h.group.position, h.accent, 5, 1.4, 0.3, 0.06);
        }
      }

      if (h.kick > 0) {
        h.group.translateZ(h.kick * 0.05);
        h.group.rotateX(h.kick * 0.16);
      }

      const lit = h.flashT > 0;
      const k = lit ? Math.min(1, h.flashT / h.flashDur) : 0;  // 1 al disparar, 0 al apagarse
      const grow = 1 - k;
      h.flash.visible = h.flashMid.visible = h.flashCore.visible = lit;
      h.petals.visible = h.sparks.visible = h.tongueGroup.visible = lit;
      if (lit) {
        // halo exterior rojo-naranja que se abre al disparar
        h.flash.material.opacity = 0.55 + 0.35 * k;
        h.flash.scale.setScalar(0.30 + grow * 0.22 + Math.random() * 0.05);
        // llama media naranja
        h.flashMid.material.opacity = 0.80;
        h.flashMid.scale.set(0.19 + Math.random() * 0.05, 0.30 + Math.random() * 0.08, 1);
        // núcleo amarillo-blanco alargado en la dirección del cañón
        h.flashCore.material.opacity = 1;
        h.flashCore.scale.set(0.095 + Math.random() * 0.03, 0.26 + grow * 0.20, 1);
        // pétalos: giran y respiran en cada disparo
        h.petals.rotation.z = Math.random() * Math.PI * 2;
        const ps = 0.85 + Math.random() * 0.45;
        h.petals.scale.set(ps, ps, 0.9 + grow * 1.2);
        h.sparks.rotation.z = Math.random() * Math.PI;
        // lengua larga: se estira en el eje del cañón y se recoge al apagarse
        h.tongueGroup.scale.set(1, 1, 0.55 + grow * 1.15);
        h.tongueGroup.rotation.z = Math.random() * 0.5 - 0.25;
        h.tongueGroup.rotation.x = Math.random() * 0.3 - 0.15;
        h.tongue.material.opacity = 0.62 * (0.35 + grow * 0.65);
        h.tongueCore.material.opacity = 0.95 * (0.3 + grow * 0.7);
        h.flashLight.intensity = 7.0 * k + 3.0;
      } else {
        h.flash.material.opacity = 0;
        h.flashMid.material.opacity = 0;
        h.flashCore.material.opacity = 0;
        h.tongue.material.opacity = 0;
        h.tongueCore.material.opacity = 0;
        h.flashLight.intensity = Math.max(0, h.flashLight.intensity - dt * 120);
      }

      const frac = h.ammo / this.magSize;
      const col = frac > 0.5 ? 0x5cff9d : frac > 0.22 ? 0xffe066 : 0xff2d55;
      h.ammoRing.material.color.setHex(col);
      h.ammoRing.rotation.z = -Math.PI * 0.3 + frac * Math.PI * 1.6;
      h.ammoRing.visible = !h.reloading;

      // mira láser (solo con el arma en la mano)
      const sight = this.sights[hand];
      if (presenting) {
        const a = h.muzzle.getWorldPosition(this.tmpV);
        const gq = new THREE.Quaternion();
        h.group.getWorldQuaternion(gq);
        const d = new THREE.Vector3(0, 0, -1).applyQuaternion(gq);
        const pos = sight.geometry.attributes.position;
        pos.setXYZ(0, a.x, a.y, a.z);
        pos.setXYZ(1, a.x + d.x * 28, a.y + d.y * 28, a.z + d.z * 28);
        pos.needsUpdate = true;
        sight.visible = true;
      } else {
        sight.visible = false;
      }
    }

    if (this.dbg) this._dbg(presenting, xrPose);

    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      // el haz viaja rápido pero se ve el proyectil grueso cruzando la calle
      t.prog = Math.min(1, t.prog + (dt * 150) / t.dist);
      const head = t.dist * t.prog;
      const tail = Math.max(0, head - 6.0);
      const len = Math.max(0.4, head - tail);
      t.g.position.copy(t.a).addScaledVector(t.dir, (head + tail) * 0.5);
      t.g.scale.set(0.13, 0.13, len);
      t.halo.scale.set(2.8, 2.8, 1.05);
      const fade = Math.min(1, t.life / 0.12);
      t.core.material.opacity = fade;
      t.halo.material.opacity = 0.7 * fade;
      if (t.life <= 0) t.g.visible = false;
    }
  }

  // panel de diagnóstico dentro del visor: se activa con ?dbg=1 en la URL
  _dbg(presenting, xrPose) {
    if (typeof document === 'undefined') return;
    let P = this._panel;
    if (!P) {
      const cv = document.createElement('canvas');
      cv.width = 640; cv.height = 320;
      const ctx = cv.getContext('2d');
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(0.32, 0.16),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false })
      );
      mesh.position.set(-0.17, -0.17, -0.42);
      mesh.renderOrder = 999;
      mesh.frustumCulled = false;
      this.camera.add(mesh);
      P = this._panel = { cv, ctx, tex, mesh, n: 0 };
    }
    P.mesh.visible = !!presenting;
    if ((P.n = (P.n + 1) % 12) !== 0) return;
    const c = P.ctx;
    c.clearRect(0, 0, 640, 320);
    c.fillStyle = 'rgba(0,0,0,0.65)';
    c.fillRect(0, 0, 640, 320);
    c.font = 'bold 36px monospace';
    const seen = !presenting || !xrPose ? 'none' : (xrPose.L ? 'L' : '-') + (xrPose.R ? 'R' : '-');
    const srcs = (this._srcInfo && this._srcInfo.length) ? this._srcInfo.join(' ') : 'sin fuentes';
    c.fillStyle = '#7cd4ff';
    c.fillText('XR ' + (presenting ? 'ON' : 'OFF') + '  pose ' + seen + '  v' + THREE.REVISION, 12, 52);
    c.font = 'bold 28px monospace';
    c.fillStyle = '#a9c6ff';
    c.fillText(srcs, 12, 100);
    c.font = 'bold 34px monospace';
    [['L', 170], ['R', 245]].forEach(([k, y]) => {
      const h = this.hands[k];
      c.fillStyle = h.held ? '#5cff9d' : '#ff5c7c';
      const z = h.dbgZ === undefined ? '?' : h.dbgZ.toFixed(2);
      c.fillText(k + ' ' + (h.held ? 'EN MANO' : 'VISTA') + '  z=' + z, 12, y);
    });
    if (!presenting) {
      c.fillStyle = '#ffd166';
      c.fillText('entra en VR para ver las manos', 12, 300);
    }
    P.tex.needsUpdate = true;
  }

  ammoOf(hand) {
    const h = this.hands[hand];
    return { ammo: h.ammo, mag: this.magSize, reloading: h.reloading, k: h.reloading ? h.reloadT / this.reloadTime : 0 };
  }

  bothReloading() {
    return this.hands.L.reloading && this.hands.R.reloading;
  }
}

export { buildPistol };
