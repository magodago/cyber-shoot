// Capa opcional de assets REALES (Poly Haven, CC0) para el prototipo
// "proto-assets". Sustituye el mobiliario procedural de la calle por muebles
// escaneados con texturas PBR y cambia el entorno AI por un HDRI nocturno real
// (reflejos de farolas y escaparates en el asfalto mojado).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const PROP_DIR = 'assets/props/';
const HDRI_URL = 'assets/hdri/cobblestone_street_night_1k.hdr';

// Configuración por prop: altura objetivo en metros y dónde se apoya.
// where: walk = acera junto a la fachada · curb = borde de la acera
//        wall = pegado a la fachada · road = sobre el asfalto
const DEFS = {
  crate:       { id: 'old_military_crate',        h: 0.95, where: 'walk', weight: 3 },
  crateSmall:  { id: 'plastic_crate_02',          h: 0.52, where: 'walk', weight: 2 },
  barrier:     { id: 'concrete_road_barrier',     h: 1.02, where: 'curb', weight: 2 },
  barrierB:    { id: 'concrete_road_barrier_02',  h: 1.00, where: 'curb', weight: 1 },
  trash:       { id: 'metal_trash_can',           h: 0.98, where: 'walk', weight: 3 },
  pipes:       { id: 'modular_industrial_pipes_01', h: 3.10, where: 'wall', y: 0.30, weight: 2 },
  cables:      { id: 'modular_electric_cables',   h: 1.10, where: 'wall', y: 4.10, weight: 2 },
  manhole:     { id: 'water_manhole_cover',       h: 0.06, where: 'road', y: 0.02, weight: 2 },
  fence:       { id: 'modular_chainlink_fence',   h: 2.20, where: 'curb', weight: 1 },
  lamp:        { id: 'street_lamp_01',            h: 6.40, where: 'curb', weight: 1 },
  wallLamp:    { id: 'industrial_wall_lamp',      h: 0.85, where: 'wall', y: 4.60, weight: 2 },
  container:   { id: 'industrial_pastic_container', h: 1.55, where: 'walk', weight: 2 },
  // munición y arma escaneada como atrezo de calle
  ammo:        { id: 'ammo_box',                 h: 0.30, where: 'walk', weight: 2 },
  rifle:       { id: 'bolt_action_rifle_7_62',    h: 1.02, where: 'wall', rot: [0, 0, Math.PI / 2], lean: 0.09, weight: 2 },
};

// Los escaneos de Poly Haven son kits: traen variantes y piezas sueltas.
// Se quedan solo las del arma montada (variante _a, cargador lleno).
const LIMPIAR = {
  service_pistol: /_b$|magazine_|_bullet/,
  bolt_action_rifle_7_62: /_b$|_bullet_54mm/,
};

const GROUND = 0.14;        // altura de la acera sobre el asfalto
const templates = {};       // id -> plantilla normalizada
let loader = null;
let decorated = false;

/* ------------------------------------------------------------------ carga */

function normalizar(scene, h, rot) {
  // pivote en el centro de la base: escala a la altura pedida y baja al suelo
  if (rot) scene.rotation.set(rot[0] || 0, rot[1] || 0, rot[2] || 0);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3());
  const s = size.y > 0.0001 ? h / size.y : 1;
  const pivot = new THREE.Group();
  pivot.add(scene);
  scene.scale.setScalar(s);
  scene.position.set(
    -(box.min.x + box.max.x) * 0.5 * s,
    -box.min.y * s,
    -(box.min.z + box.max.z) * 0.5 * s
  );
  pivot.userData.size = size.clone().multiplyScalar(s);
  return pivot;
}

function cargar(id, intento = 0) {
  const nombres = [id + '_1k.gltf', id + '.gltf', 'scene.gltf'];
  return new Promise((resolve) => {
    loader.load(
      PROP_DIR + id + '/' + nombres[intento],
      (gltf) => {
        gltf.scene.traverse((o) => {
          if (!o.isMesh) return;
          o.castShadow = false;
          o.receiveShadow = false;
          o.frustumCulled = true;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (!m) continue;
            if (m.envMapIntensity !== undefined) m.envMapIntensity = 1.0;
            m.needsUpdate = true;
          }
        });
        const re = LIMPIAR[id];
        if (re) {
          const fuera = [];
          gltf.scene.traverse((o) => { if (re.test(o.name)) fuera.push(o); });
          for (const o of fuera) o.parent && o.parent.remove(o);
        }
        resolve(gltf.scene);
      },
      undefined,
      (e) => {
        if (intento < 2) return resolve(cargar(id, intento + 1));
        console.warn('[assets] no se pudo cargar', id, e);
        resolve(null);
      }
    );
  });
}

/* --------------------------------------------------------------- colocación */

function xDe(def, b) {
  const inset = b.inset;
  if (def.where === 'curb') return b.side * 9.95;
  if (def.where === 'wall') return b.side * (inset - 0.38);
  if (def.where === 'walk') {
    // sobre la acera, arrimado a la fachada pero sin salirse al bordillo
    const d = Math.min(inset - 0.72, 11.55);
    return b.side * Math.max(d, 10.15);
  }
  return b.side * (3 + Math.random() * 4);
}

function clonar(def, b, z, rotY, extraY = 0) {
  const tpl = templates[def.id];
  if (!tpl) return;
  const o = tpl.clone(true);
  o.position.set(xDe(def, b), (def.y !== undefined ? def.y : GROUND) + extraY, z);
  o.rotation.y = rotY;
  if (def.lean) o.rotation.x = def.lean;
  b.g.add(o);
}

const PESOS = Object.keys(DEFS);

function elegir() {
  let total = 0;
  for (const k of PESOS) total += DEFS[k].weight;
  let r = Math.random() * total;
  for (const k of PESOS) {
    r -= DEFS[k].weight;
    if (r <= 0) return DEFS[k];
  }
  return DEFS.crate;
}

function amueblar(arena) {
  for (const b of arena.blocks) {
    const n = 2 + ((Math.random() * 2) | 0);
    const usados = new Set();
    for (let i = 0; i < n; i++) {
      const def = elegir();
      if (usados.has(def.id)) continue;
      usados.add(def.id);
      const z = (Math.random() - 0.5) * Math.max(2, b.d - 3.5);
      const alineado = def.where === 'curb' || def.where === 'wall';
      clonar(def, b, z, alineado
        ? (b.side > 0 ? Math.PI : 0)
        : Math.random() * Math.PI * 2);
    }
    // pareja de cajas apiladas: da lectura de calle vivida
    if (templates[DEFS.crate.id] && Math.random() < 0.45) {
      clonar(DEFS.crate, b, (Math.random() - 0.5) * Math.max(2, b.d - 3.5), Math.random() * Math.PI * 2);
    }
  }
}

/* --------------------------------------------------------------- entorno */

async function entorno(renderer, scene) {
  const tex = await new RGBELoader().loadAsync(HDRI_URL);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pm = new THREE.PMREMGenerator(renderer);
  pm.compileEquirectangularShader();
  const env = pm.fromEquirectangular(tex).texture;
  scene.environment = env;
  if (scene.environmentIntensity !== undefined) scene.environmentIntensity = 1.0;
  tex.dispose();
  pm.dispose();
}

/* --------------------------------------------------------------- API */

export async function initAssets({ renderer, scene, arena }) {
  if (decorated) return;
  decorated = true;
  loader = new GLTFLoader();

  entorno(renderer, scene).catch((e) => console.warn('[assets] HDRI', e));

  const ids = [...new Set(Object.values(DEFS).map((d) => d.id))];
  const cargados = await Promise.all(ids.map((id) => cargar(id).then((s) => [id, s])));
  let ok = 0;
  for (const [id, scene3d] of cargados) {
    if (!scene3d) continue;
    const def = Object.values(DEFS).find((d) => d.id === id);
    templates[id] = normalizar(scene3d, def.h, def.rot);
    ok++;
  }
  amueblar(arena);
  console.info('[assets] props cargados:', ok, '/', ids.length);
}

/* ------------------------------------------------------------------ armas */

// Ajuste fino del arma escaneada en la mano. El escaneo mide 22 cm de largo y
// 13 de alto; la empuñadura se ancla al puño (origen de `body`) y la boca del
// cañón arrastra consigo el fogonazo y el láser. Todo retoque se hace aquí.
const ARMA_AJUSTE = {
  escala: 0.95,   // 1 = tamaño real del escaneo
  empZ: 0.87,     // empuñadura: fracción de la eslora desde la boca (0 boca, 1 culata)
  empY: 0.34,     // empuñadura: fracción de la altura desde abajo
  ejeY: 0.86,     // eje del cañón: fracción de la altura desde abajo
  atras: 0.0,     // + aleja el arma de la cámara (hacia la mano)
  arriba: 0.0,    // + sube el arma
  lado: 0.0,      // + la desplaza a la derecha
};

// bbox sólo de mallas visibles: los escaneos traen piezas apagadas y variantes
function bboxVisible(root) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.visible === false) return;
    const pos = o.geometry && o.geometry.attributes && o.geometry.attributes.position;
    if (!pos) return;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
      box.expandByPoint(v);
    }
  });
  return box;
}

// Sustituye la pistola procedural por el escaneo de Poly Haven conservando los
// efectos (fogonazo, chispas, luz) y el retroceso, que siguen en weapon.js.
export async function skinWeapons(system) {
  if (!system || !system.hands) return;
  if (new URLSearchParams(location.search).get('guns') === 'gold') return;
  if (!loader) loader = new GLTFLoader();

  const src = await cargar('service_pistol');
  if (!src) return;

  for (const k of ['R', 'L']) {
    const h = system.hands[k];
    if (!h || !h.body || !h.gunParts) continue;

    const skin = src.clone(true);
    // el escaneo apunta a +X; el visor mira a -Z
    skin.rotation.y = Math.PI / 2;

    const box = bboxVisible(skin);
    const size = box.getSize(new THREE.Vector3());
    if (size.z < 0.05) { console.warn('[assets] arma no válida', k, size.toArray()); continue; }

    const A = ARMA_AJUSTE;
    const s = A.escala;
    // empuñadura al puño
    skin.scale.setScalar(s);
    skin.position.set(
      -(box.min.x + box.max.x) * 0.5 * s + A.lado,
      -(box.min.y + size.y * A.empY) * s + A.arriba,
      -(box.min.z + size.z * A.empZ) * s + A.atras
    );

    for (const p of h.gunParts) p.visible = false;
    if (h.ammoRing) h.ammoRing.visible = false;
    h.body.add(skin);
    h.skin = skin;

    // La boca del cañón real no cae donde la del arma procedural: se mueve el
    // muzzle y con él todos los efectos, que son hijos de `body` y nacieron
    // copiando su posición.
    const boca = new THREE.Vector3(
      0,
      (box.min.y + size.y * A.ejeY) * s + skin.position.y,
      box.min.z * s + skin.position.z
    );
    const d = boca.sub(h.muzzle.position);
    if (d.lengthSq() > 1e-8) {
      h.muzzle.position.add(d);
      for (const e of [h.flash, h.flashMid, h.flashCore, h.petals, h.sparks, h.tongueGroup, h.flashLight]) {
        if (e) e.position.add(d);
      }
    }
  }
  console.info('[assets] pistola escaneada montada');
}
