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

/** Pistola. Empuñadura en el origen, cañón hacia -Z. */
function buildPistol(accent) {
  const g = new THREE.Group();
  // materiales de "viewmodel": no hay luz cerca de la cámara, así que el arma
  // se ilumina a sí misma con emissive alto o se ve negra contra la noche
  const bodyMat = mat(GUN_COL.body, { metal: 0.55, rough: 0.45, emis: 0x1d3f5c, ei: 0.85 });
  const metalMat = mat(GUN_COL.metal, { metal: 0.7, rough: 0.35, emis: 0x17324a, ei: 0.7 });
  const neon = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
  const neonDim = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false,
    transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });

  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.19, 0.1), bodyMat);
  grip.position.set(0, -0.075, 0.055);
  grip.rotation.x = -0.22;
  g.add(grip);

  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.11, 0.34), metalMat);
  slide.position.set(0, 0.035, -0.09);
  g.add(slide);

  const shroud = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.055, 0.22), bodyMat);
  shroud.position.set(0, 0.012, -0.16);
  g.add(shroud);

  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.032, 0.2, 12), metalMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.02, -0.3);
  g.add(barrel);

  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.011, 8, 18), neon);
    ring.position.set(0, 0.02, -0.24 - i * 0.055);
    g.add(ring);
  }

  // cargador de energía visible en el costado (da volumen y color al arma)
  for (const s of [-1, 1]) {
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.052, 0.19), neonDim);
    plate.position.set(s * 0.043, 0.035, -0.1);
    g.add(plate);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.009, 0.022, 0.26), neon);
    strip.position.set(s * 0.053, 0.06, -0.1);
    g.add(strip);
  }

  // celda del cargador brillando a través de la empuñadura
  const cell = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.055), neon);
  cell.position.set(0, -0.095, 0.062);
  cell.rotation.x = -0.22;
  g.add(cell);

  const topRail = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.012, 0.3), neon);
  topRail.position.set(0, 0.093, -0.09);
  g.add(topRail);

  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.014, 0.012), neon);
  sight.position.set(0, 0.098, -0.19);
  g.add(sight);
  const sightBack = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.012, 0.012), neon);
  sightBack.position.set(0, 0.098, 0.01);
  g.add(sightBack);

  const ammoRing = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.0055, 6, 20, Math.PI * 1.6),
    new THREE.MeshBasicMaterial({ color: 0x5cff9d, toneMapped: false }));
  ammoRing.position.set(0, -0.088, 0.02);
  ammoRing.rotation.set(-0.5, 0, -Math.PI * 0.3);
  g.add(ammoRing);

  const hammer = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.05), bodyMat);
  hammer.position.set(0, 0.06, 0.055);
  g.add(hammer);

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.02, -0.4);
  g.add(muzzle);

  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX ? TEX.glow : null, color: accent, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flash.position.copy(muzzle.position);
  flash.scale.setScalar(0.6);
  g.add(flash);

  // segundo destello alargado: da la sensación de fogonazo, no de bombilla
  const flashCore = new THREE.Sprite(new THREE.SpriteMaterial({
    map: TEX ? TEX.glow : null, color: 0xffffff, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  flashCore.position.copy(muzzle.position);
  flashCore.position.z -= 0.1;
  flashCore.scale.set(0.18, 0.18, 1);
  g.add(flashCore);

  return { group: g, muzzle, flash, flashCore, ammoRing };
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
      const built = buildPistol(accent);
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
        flashT: 0,
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

  get magSize() { return 14 + this.upgrades.mag * 4; }
  get reloadTime() { return Math.max(0.42, 0.85 - this.upgrades.reload * 0.09); }
  get fireDelay() { return Math.max(0.075, 0.145 - this.upgrades.rate * 0.012); }
  get damage() { return 34 + this.upgrades.dmg * 9; }

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
      h.cool = 0.2;
      if (this.audio && this.audio.dry) this.audio.dry();
      this.onDry(hand);
      return false;
    }
    h.ammo--;
    h.cool = this.fireDelay;
    h.kick = 1;
    h.flashT = 0.055;
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
    if (this.audio && this.audio.shot) this.audio.shot();
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
      h.cool = Math.max(0, h.cool - dt);
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

      // apuntar al suelo → recarga
      const q = new THREE.Quaternion();
      h.group.getWorldQuaternion(q);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
      const down = fwd.y < -0.6;
      h.aimDownT = down ? h.aimDownT + dt : 0;
      if (down && h.ammo < this.magSize && !h.reloading) this.reload(hand);

      if (h.reloading) {
        h.reloadT += dt;
        const k = Math.min(1, h.reloadT / this.reloadTime);
        h.group.rotateX(Math.sin(k * Math.PI) * 0.55);
        h.group.position.y -= Math.sin(k * Math.PI) * 0.1;
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

      h.flash.material.opacity = h.flashT > 0 ? 0.8 : 0;
      h.flash.scale.setScalar(0.42 + Math.random() * 0.3);
      h.flashCore.material.opacity = h.flashT > 0 ? 0.95 : 0;
      h.flashCore.scale.set(0.24 + Math.random() * 0.16, 0.5 + Math.random() * 0.3, 1);

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
