import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* ---------------------------------------------------------------------------
   BATCH: fusión de piezas estáticas.

   Los enemigos se modelan con muchas piezas sueltas (el centinela llega a 134
   mallas: remaches, costuras, cables, dedos...). En WebXR cada malla es una
   llamada de dibujo y el presupuesto de Quest es de ~150: con seis enemigos en
   pantalla el juego se atasca aunque las físicas estén tranquilas.

   Aquí se funden todas las piezas rígidas que comparten material en una sola
   geometría por material, conservando la jerarquía de los grupos que sí se
   animan (rotores, brazos, patas). El resultado es el mismo dibujo con una
   décima parte de llamadas.
   --------------------------------------------------------------------------- */

const _m4 = new THREE.Matrix4();

function cleanGeo(src) {
  let g = src.index ? src.toNonIndexed() : src.clone();
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  }
  g.clearGroups();
  g.morphAttributes = {};
  return g;
}

function countMeshes(root) {
  let n = 0;
  root.traverse((o) => { if (o.isMesh) n++; });
  return n;
}

// Funde en `root` todas las mallas cuyo ancestro animado más cercano es `root`.
function bakeInto(root, keep) {
  const buckets = new Map();
  const drop = [];

  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || o.isSprite || o.isSkinnedMesh) return;
    if (o.userData.isHit || o.userData.noBake) return;
    if (keep.has(o)) return;                       // raíz de un subárbol animado
    if (Array.isArray(o.material) || !o.material) return;
    if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;

    let parent = o.parent;
    while (parent && parent !== root && !keep.has(parent)) parent = parent.parent;
    if (!parent) parent = root;

    const key = `${parent.uuid}|${o.material.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) { b = { parent, mat: o.material, cast: o.castShadow, recv: o.receiveShadow, geos: [] }; buckets.set(key, b); }
    _m4.copy(parent.matrixWorld).invert().multiply(o.matrixWorld);
    b.geos.push(cleanGeo(o.geometry).applyMatrix4(_m4));
    drop.push(o);
  });

  for (const b of buckets.values()) {
    let merged = null;
    try {
      merged = b.geos.length === 1 ? b.geos[0] : mergeGeometries(b.geos, false);
    } catch (err) {
      merged = null;
    }
    if (!merged) { for (const g of b.geos) g.dispose(); continue; }
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.frustumCulled = true;
    mesh.userData.noBake = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    b.parent.add(mesh);
  }

  for (const o of drop) {
    if (o.parent) o.parent.remove(o);
    o.userData.dead = true;
  }
}

/**
 * Funde las mallas estáticas del grupo por material, también dentro de los
 * subárboles animados (cada brazo o pata queda en una malla por material).
 * @param {THREE.Object3D} root raíz del enemigo (su grupo)
 * @param {THREE.Object3D[]} keeps subárboles que deben seguir animándose
 * @returns {{before:number, after:number}}
 */
export function bakeStatic(root, keeps = []) {
  const keep = new Set();
  for (const k of keeps) { if (k && k !== root) keep.add(k); }
  keep.add(root);

  const before = countMeshes(root);
  for (const k of keeps) { if (k && k !== root) bakeInto(k, keep); }
  bakeInto(root, keep);

  return { before, after: countMeshes(root) };
}

// Marca un subárbol para que bakeStatic no lo toque puntualmente.
export function noBake(o) {
  o.traverse((x) => { x.userData.noBake = true; });
  return o;
}
