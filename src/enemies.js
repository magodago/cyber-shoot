import * as THREE from 'three';
import { TEX } from './fx.js';
import { roundBox, detailSet, hose, vent, rivets, decal } from './detail.js';
import { bakeStatic } from './batch.js';

// ---------------------------------------------------------------------------
// ENEMIGOS: aparecen en puntos fijos (suelo, balcones, azoteas, aire),
// se quedan clavados en el sitio y disparan. Nunca avanzan al jugador.
// Tipos: dron, perro con ruedas, centinela y jefe titán.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

function stdMat(color, metal = 0.8, rough = 0.35) {
  // Acero de verdad: metalness alto y rugosidad baja. El blindaje contra las
  // siluetas negras ya no es el metal (que se recortaba a 0.4 y dejaba todo
  // como plástico mate), sino el entorno PMREM fuerte + un emisivo mínimo.
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  // nada de colores de caramelo: saturación contenida, todo tira a aleación
  c.setHSL(hsl.h, Math.min(hsl.s, 0.34), hsl.l);
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  if (lum < 0.26) c.offsetHSL(0, 0, 0.26 - lum);
  const dset = detailSet(1);
  const m = new THREE.MeshStandardMaterial({
    color: c, metalness: Math.min(metal, 0.92), roughness: Math.max(rough, 0.22),
    envMapIntensity: 1.9,
    // micro-detalle real: juntas, arañazos y grano. Sin esto el blindaje es
    // plástico perfecto y por eso los enemigos parecían de juguete.
    map: dset.map, normalMap: dset.normalMap, roughnessMap: dset.roughnessMap,
    normalScale: new THREE.Vector2(0.85, 0.85)
  });
  m.emissive = c.clone().multiplyScalar(0.13);
  m.emissiveIntensity = 1;
  return m;
}

function neonMat(color) {
  return new THREE.MeshBasicMaterial({ color, toneMapped: false });
}

const HIT_GEO = new THREE.SphereGeometry(1, 8, 6);
const HIT_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

// `y` y `sy` permiten llevar la caja al cuerpo real: los humanoides tienen el
// origen en los pies, así que una esfera centrada en 0 les pasaba por las
// piernas y los disparos al torso no registraban.
function hitbox(r, mult, enemy, kind, y = 0, sy = 1, z = 0) {
  // Holtura global: los volúmenes de impacto se inflan un 25% para que el tiro
  // se sienta justo. Con el radio "real" el jugador ve pasar balas por encima
  // del hombro del enemigo sin que cuente.
  const PAD = 1.25;
  const m = new THREE.Mesh(HIT_GEO, HIT_MAT);
  m.scale.set(r * PAD, r * sy * PAD, r * PAD);
  m.position.set(0, y, z);
  m.userData.enemy = enemy;
  m.userData.mult = mult;
  m.userData.part = kind;
  m.userData.isHit = true;
  m.userData.sharedGeo = true;
  return m;
}

// ---------------------------------------------------------------------- base
export class Enemy {
  constructor(world, node, def) {
    this.world = world;
    this.node = node;
    this.def = def;
    this.aimTime = def.aimTime;   // por instancia: no contaminar ENEMY_DEFS compartido
    this.kind = def.kind;
    this.scaleBase = def.scale || 1;
    this.maxHp = Math.round(def.hp * (1 + (world.level - 1) * 0.07));
    this.hp = this.maxHp;
    this.state = 'spawn';
    this.st = 0;
    this.age = 0;
    this.dead = false;
    this.removed = false;
    this.flashT = 0;
    this.mats = [];
    this.hitMeshes = [];
    this.burstLeft = 0;
    this.burstT = 0;
    this.aliveTime = 0;
    this.scoreValue = def.score || 100;
    this.color = def.color || 0xff2d55;
    this._sepSeed = Math.random();

    this.group = new THREE.Group();
    this.group.position.copy(node.pos);
    this.group.rotation.y = Math.atan2(-node.dir.x, -node.dir.z);
    world.scene.add(this.group);

    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.1, -0.5);
    this.group.add(this.muzzle);

    this.charge = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.charge.position.copy(this.muzzle.position);
    this.group.add(this.charge);

    this._build();
    this.hp = this.maxHp;
    // emerge desde el punto de spawn
    this.group.position.y -= (this.def.rise || 1.6) * this.scaleBase;
    this.group.scale.setScalar(0.75 * this.scaleBase);
    this._addBeacon();

    // Fusión de piezas rígidas: un centinela son 134 mallas sueltas y cada una
    // cuesta una llamada de dibujo. Fundidas por material quedan ~10 y se
    // conservan intactos los subárboles que se animan (rotores, brazos, patas).
    const keeps = [];
    for (const k of Object.keys(this)) {
      if (k === 'world' || k === 'node' || k === 'def' || k === 'group') continue;
      const v = this[k];
      if (!v) continue;
      if (v.isObject3D) keeps.push(v);
      else if (Array.isArray(v)) { for (const it of v) if (it && it.isObject3D) keeps.push(it); }
    }
    this.batch = bakeStatic(this.group, keeps);
  }

  /* Baliza: los enemigos de balcón y azotea se pierden contra la fachada oscura.
     Un rombo aditivo con depthTest:false los hace localizables siempre, sin
     revelar su posición exacta (solo marca "aquí arriba hay uno"). */
  _addBeacon() {
    const k = this.node && this.node.kind;
    if (k !== 'balcony' && k !== 'ledge' && k !== 'roof') return;
    const col = this.color || 0xff2d55;
    const g = new THREE.Group();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: col, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false
    }));
    halo.scale.setScalar(1.6);
    halo.renderOrder = 999;
    g.add(halo);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.19, 0.29, 4),
      new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.95,
        blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false,
        side: THREE.DoubleSide, toneMapped: false
      })
    );
    ring.rotation.z = Math.PI / 4;
    ring.renderOrder = 1000;
    g.add(ring);
    g.position.y = 2.05;
    this.beacon = g;
    this.group.add(g);
  }

  _build() {}

  _mat(m) {
    if (m.userData.baseEI === undefined) {
      m.userData.baseEI = m.emissiveIntensity === undefined ? 0 : m.emissiveIntensity;
    }
    this.mats.push(m);
    return m;
  }

  addHit(mesh) {
    mesh.userData.enemy = this;
    mesh.userData.isHit = true;
    this.hitMeshes.push(mesh);
    // el hitbox debe colgar del grupo o su matrixWorld queda en el origen
    // y ningún disparo lejano impacta
    if (!mesh.parent) this.group.add(mesh);
    return mesh;
  }

  // Silueta real del enemigo, como respaldo de las cajas de impacto. Las cajas
  // son elipsoides invisibles: cubren el torso, pero no los brazos abiertos,
  // las patas, los alerones ni la cabeza de un cuadrúpedo (que va delante y
  // arriba del origen). Ahí el jugador ve cuerpo y el disparo se perdía. Si el
  // rayo entra en una malla visible, cuenta como impacto de cuerpo.
  bodyMeshes() {
    if (!this._bodyMeshes) {
      const out = [];
      this.group.traverse((o) => {
        if (!o.isMesh || !o.geometry || o.userData.isHit) return;
        const m = o.material;
        if (!m || m.blending === THREE.AdditiveBlending) return;
        if (m.transparent && (m.opacity === undefined ? 1 : m.opacity) < 0.12) return;
        o.userData.enemy = this;
        out.push(o);
      });
      this._bodyMeshes = out;
    }
    return this._bodyMeshes;
  }

  getPlayer() { return this.world.getPlayerPos(); }

  facePlayer(dt, speed = 5) {
    const p = this.getPlayer();
    const dx = p.x - this.group.position.x, dz = p.z - this.group.position.z;
    const target = Math.atan2(-dx, -dz);
    let d = target - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * Math.min(1, dt * speed);
  }

  spawnBolt(speed, spread, dmg, color) {
    const origin = this.muzzle.getWorldPosition(new THREE.Vector3());
    const p = this.getPlayer().clone();
    const dist = origin.distanceTo(p);
    // adelanto balístico: apunta a donde estará el jugador cuando llegue el disparo
    const v = this.world.playerVel;
    if (v) p.addScaledVector(v, Math.min(0.85, dist / Math.max(8, speed)) * 0.85);
    // error pequeño y en metros: se puede esquivar moviéndose de lado, pero impacta
    const err = spread * (0.5 + Math.random() * 0.6) * Math.min(1.7, dist / 11);
    p.x += (Math.random() - 0.5) * err;
    p.y += (Math.random() - 0.5) * err * 0.55;
    p.z += (Math.random() - 0.5) * err * 0.45;
    this.world.bolts.spawn(origin, p, speed, color || this.color, dmg);
    if (this.world.fx) this.world.fx.spark(origin, color || this.color, 4, 3.0, 0.2, 0.08);
  }

  // daño recibido; devuelve true si muere con este impacto
  hit(point, mult, dmg) {
    if (this.state === 'die' || this.dead) return false;
    const total = dmg * mult;
    this.hp -= total;
    this.flashT = 0.09;
    if (this.world.fx) {
      this.world.fx.spark(point, mult > 1.6 ? 0xffe066 : this.color, mult > 1.6 ? 10 : 5, 4.2, 0.3, 0.1);
      if (mult > 1.6) this.world.fx.ring(point, 0xffe066, 0.35, 0.3);
    }
    if (this.world.onHit) this.world.onHit(this, total, mult, point);
    if (this.hp <= 0) { this.die(); return true; }
    return false;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.state = 'die';
    this.st = 0;
    const p = this.group.position.clone();
    p.y += this.def.rise ? 0.8 : 0.9;
    if (this.world.fx) {
      this.world.fx.spark(p, this.color, 26, 7.5, 0.75, 0.16);
      this.world.fx.ring(p, this.color, 1.9, 0.55);
      this.world.fx.ring(p, 0xffffff, 0.8, 0.35);
    }
    if (this.world.audio) {
      if (this.world.audio.explode) this.world.audio.explode();
      if (this.world.audio.death) this.world.audio.death();
    }
    if (this.world.onDeath) this.world.onDeath(this);
  }

  // Retirada silenciosa: no da puntos ni suena, pero deja de bloquear la
  // oleada cuando un enemigo se queda fuera de alcance del jugador.
  silentKill() {
    if (this.dead) return;
    this.dead = true;
    this.removed = true;
    this.group.visible = false;
  }

  update(dt, t) {
    this.age += dt;
    this.st += dt;
    this.aliveTime += dt;
    if (this.flashT > 0) this.flashT -= dt;
    const flash = this.flashT > 0 ? 1.6 : 1;
    for (const m of this.mats) {
      if (m.emissiveIntensity !== undefined) {
        m.emissiveIntensity = (m.userData.baseEI || 0) * flash;
      }
    }

    if (this.beacon) {
      const p = 1 + Math.sin(t * 5 + this.node.pos.x) * 0.12;
      this.beacon.scale.setScalar(p);
      this.beacon.rotation.y += dt * 1.8;
    }
    if (this.state === 'spawn') {
      const k = Math.min(1, this.st / (this.def.riseTime || 0.5));
      const e = 1 - Math.pow(1 - k, 3);
      this.group.position.y = this.node.pos.y + this._liftY() - (this.def.rise || 1.6) * this.scaleBase * (1 - e);
      this.group.scale.setScalar((0.75 + 0.25 * e) * this.scaleBase);
      if (k >= 1) {
        this.group.position.y = this.node.pos.y + this._liftY();
        this.group.scale.setScalar(this.scaleBase);
        this._idle(dt, t);
        this.state = 'aim';
        this.st = 0;
      }
      return;
    }

    if (this.state === 'die') {
      this.group.position.y -= dt * 2.4;
      this.group.rotation.z += dt * 5;
      this.group.scale.multiplyScalar(1 - dt * 1.4);
      if (this.st > 0.55) this.remove();
      return;
    }

    this._idle(dt, t);
    if (!this.def.air) this._separate(dt);
    this.facePlayer(dt, this.def.turn || 4);
    this._ai(dt, t);
  }

  // Altura del cuerpo sobre el nodo del suelo. El titán la sobreescribe para
  // elevarse; el resto devuelve 0. Tiene que vivir aquí: si solo existe en una
  // subclase, cualquier otro enemigo lanza TypeError en la fase de aparición y
  // el error corta el fotograma antes del render (pantalla congelada).
  _liftY() {
    return (this.liftLocal || 0) * (this.group.scale.y || 1);
  }

  _idle() {}

  // los que van por el suelo no se atraviesan: se empujan y rodean
  /* Entrada aérea: si aparece alto (enjambre desde arriba), la altura de
     crucero se mezcla con la de entrada durante ~3,2 s. Baja en picado en vez
     de teletransportarse al nivel de vuelo en el primer fotograma. */
  _entryY(cruise) {
    if (this.entryY === undefined) return cruise;
    const k = Math.min(1, this.age / 3.2);
    return cruise * k + this.entryY * (1 - k);
  }

  _separate(dt) {
    const list = this.world.enemies;
    if (!list) return;
    const g = this.group.position;
    const r = this.def.radius || 0.62;
    for (const o of list) {
      if (o === this || o.dead || o.def.air) continue;
      const og = o.group.position;
      const dx = og.x - g.x, dz = og.z - g.z;
      const d2 = dx * dx + dz * dz;
      const min = r + (o.def.radius || 0.62);
      if (d2 >= min * min || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) * Math.min(1, dt * 9);
      const ux = dx / d, uz = dz / d;
      g.x -= ux * push * 0.5;
      g.z -= uz * push * 0.5;
      og.x += ux * push * 0.5;
      og.z += uz * push * 0.5;
      // además se abren en arco: cada uno busca su hueco alrededor del jugador
      const side = ((this._sepSeed || 0) - (o._sepSeed || 0)) > 0 ? 1 : -1;
      g.x += -uz * side * push * 0.35;
      g.z += ux * side * push * 0.35;
    }
  }

  _ai(dt, t) {
    const aimT = this.def.aimTime;
    if (this.state === 'aim') {
      this.charge.material.opacity = Math.min(1, this.st / aimT) * 0.85;
      this.charge.scale.setScalar(0.25 + Math.min(1, this.st / aimT) * 0.5);
      if (this.st >= aimT) {
        this.state = 'fire';
        this.st = 0;
        this.burstLeft = this.def.burst;
        this.burstT = 0;
      }
    } else if (this.state === 'fire') {
      this.charge.material.opacity = 0;
      this.burstT -= dt;
      if (this.burstT <= 0 && this.burstLeft > 0) {
        this.burstLeft--;
        this.burstT = this.def.burstGap;
        this.spawnBolt(this.def.boltSpeed, this.def.spread, this.def.damage);
        this._recoil();
      }
      if (this.burstLeft <= 0) {
        this.state = 'cool';
        this.st = 0;
      }
    } else if (this.state === 'cool') {
      if (this.st >= this.def.cool) {
        this.state = 'aim';
        this.st = 0;
        this.aimTime = Math.max(0.8, this.aimTime * (0.98 + Math.random() * 0.04));
      }
    }
  }

  _recoil() {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
    this.group.position.addScaledVector(dir, 0.05);
  }

  remove() {
    if (this.removed) return;
    this.removed = true;
    this.world.scene.remove(this.group);
    this.group.traverse(o => {
      // NUNCA tocar sprites: Three comparte UNA geometría para todos los
      // Sprite del mundo. Al liberarla, HUD, fogonazos y balizas dejan de
      // dibujarse y la imagen se queda clavada (fallo del nivel 4).
      if (o.isSprite) return;
      if (o.isMesh && o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
    });
    this.group.traverse(o => { o.userData.enemy = null; });
  }
}

// ---------------------------------------------------------------------- dron
export class Drone extends Enemy {
  _build() {

    const hull = this._mat(stdMat(0xd3dbe6, 0.95, 0.28));
    const plate = this._mat(stdMat(0x7c8794, 0.92, 0.45));
    const dark = this._mat(stdMat(0x22272e, 0.8, 0.6));
    const carbon = this._mat(stdMat(0x0e1114, 0.35, 0.55));
    const accent = neonMat(this.color);
    const lit = this._mat(new THREE.MeshStandardMaterial({
      color: 0x140a0e, emissive: 0xff2d55, emissiveIntensity: 2.2,
      metalness: 0.4, roughness: 0.3
    }));

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      this.group.add(m);
      return m;
    };
    const RB = (w, h, d, r) => roundBox(w, h, d, r === undefined ? 0.03 : r);

    /* ---------------------------------------------------------------- fuselaje */
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), hull);
    shell.scale.set(1.12, 0.72, 1.45);
    this.group.add(shell);
    // cintura de chapa: rompe la forma de huevo
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.035, 8, 26), plate);
    belt.rotation.x = Math.PI / 2;
    belt.scale.set(1.05, 1.32, 1);
    belt.position.y = 0.005;
    this.group.add(belt);
    add(RB(0.26, 0.06, 0.62, 0.02), plate, 0, 0.2, 0.02);
    add(new THREE.CylinderGeometry(0.008, 0.012, 0.26, 5), plate, 0.07, 0.34, 0.12, 0.24);
    add(new THREE.SphereGeometry(0.014, 6, 5), accent, 0.1, 0.46, 0.15);

    // paneles de acceso y calca
    add(RB(0.2, 0.02, 0.24, 0.01), plate, 0, 0.215, -0.24, -0.08);
    const tag = decal('stencil', 0.16, 0.08, { text: 'N-04', color: '#c8d2dc' });
    tag.position.set(0, 0.226, 0.12);
    tag.rotation.x = -Math.PI / 2;
    this.group.add(tag);
    const hz = decal('hazard', 0.16, 0.045);
    hz.position.set(0.34, 0.02, -0.02);
    hz.rotation.set(0, Math.PI / 2, 0);
    this.group.add(hz);
    this.addHit(hitbox(0.42, 1, this, 'body'));

    /* ------------------------------------------------------------------ brazos */
    this.rotors = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const cx = Math.cos(a), cz = Math.sin(a);
      const arm = new THREE.Mesh(RB(0.44, 0.05, 0.075, 0.022), plate);
      arm.position.set(cx * 0.26, 0.03, cz * 0.26);
      arm.rotation.y = -a;
      this.group.add(arm);
      // refuerzo y cable por debajo del brazo
      const brace = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.4, 6), dark);
      brace.position.set(cx * 0.28, -0.045, cz * 0.28);
      brace.rotation.set(Math.PI / 2, 0, -a + Math.PI / 2);
      this.group.add(brace);

      const pod = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.09, 12), dark);
      pod.position.set(cx * 0.5, 0.06, cz * 0.5);
      this.group.add(pod);
      // aro protector del rotor (arco, no círculo cerrado)
      const guard = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.011, 5, 20, Math.PI * 1.25), plate);
      guard.rotation.x = -Math.PI / 2;
      guard.rotation.z = a + 0.4;
      guard.position.set(cx * 0.5, 0.1, cz * 0.5);
      this.group.add(guard);

      const rotor = new THREE.Group();
      rotor.position.set(cx * 0.5, 0.09, cz * 0.5);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.007, 0.03), carbon);
      rotor.add(blade);
      const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.007, 0.32), carbon);
      rotor.add(blade2);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.05, 10), plate);
      rotor.add(hub);
      const nav = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 5), i % 2 ? accent : lit);
      nav.position.set(cx * 0.09, 0.015, cz * 0.09);
      rotor.add(nav);
      this.group.add(rotor);
      this.rotors.push(rotor);
    }

    /* ------------------------------------------------------- torreta frontal */
    // soporte y cardán: la cámara cuelga, no va pegada al casco
    add(RB(0.16, 0.09, 0.12, 0.02), dark, 0, -0.15, -0.3);
    const gimbal = new THREE.Group();
    gimbal.position.set(0, -0.22, -0.36);
    const gBody = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), plate);
    gBody.scale.set(1.1, 0.95, 1.1);
    gimbal.add(gBody);
    const lensHouse = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.062, 0.07, 14), dark);
    lensHouse.rotation.x = Math.PI / 2;
    lensHouse.position.z = -0.065;
    gimbal.add(lensHouse);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), lit);
    lens.position.z = -0.098;
    gimbal.add(lens);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0.5,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    halo.scale.setScalar(0.3);
    halo.position.z = -0.11;
    gimbal.add(halo);
    for (const sd of [-1, 1]) {
      const fork = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.11, 0.05), dark);
      fork.position.set(sd * 0.095, 0.05, 0);
      gimbal.add(fork);
    }
    this.group.add(gimbal);
    this.gimbal = gimbal;
    this.addHit(hitbox(0.17, 2.6, this, 'head', -0.02));

    // pods de misiles bajo los brazos delanteros
    for (const sd of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), plate, sd * 0.28, -0.12, -0.16, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 10), dark, sd * 0.28, -0.12, -0.27, Math.PI / 2);
      add(RB(0.02, 0.06, 0.12, 0.008), dark, sd * 0.28, -0.05, -0.16);
    }
    // patines
    for (const sd of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.014, 0.014, 0.34, 6), plate, sd * 0.17, -0.24, 0.02, Math.PI / 2);
      add(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 6), dark, sd * 0.17, -0.18, -0.1, 0.4);
    }
    // luces de posición
    add(new THREE.SphereGeometry(0.016, 6, 5), accent, 0, -0.02, 0.42);
    add(new THREE.SphereGeometry(0.013, 6, 5), lit, 0, 0.16, -0.36);

    this.muzzle.position.set(0, -0.22, -0.47);
    this.charge.position.copy(this.muzzle.position);
    this.baseY = this.node.pos.y;
  }

  _idle(dt, t) {
    for (let i = 0; i < this.rotors.length; i++) {
      this.rotors[i].rotation.y += dt * (30 + i * 4);
    }
    // dron de combate: persigue al jugador y orbita a su alrededor
    const p = this.getPlayer();
    const g = this.group.position;
    const dx = p.x - g.x, dz = p.z - g.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    if (this.orbitDir === undefined) this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    const keep = 9.5;
    const far = dist > 22;
    const radial = Math.max(-2.4, Math.min(far ? 15 : 4.6, (dist - keep) * (far ? 2.6 : 1.15)));
    const tang = 1.35 * this.orbitDir;
    const vx = nx * radial - nz * tang;
    const vz = nz * radial + nx * tang;
    g.x += vx * dt;
    g.z += vz * dt;
    g.x = Math.max(-13, Math.min(13, g.x));
    g.z = Math.max(p.z - 75, Math.min(p.z + 10, g.z));
    const cruiseY = Math.max(2.3, p.y + 0.6) + Math.sin(t * 1.9 + this.node.pos.x) * 0.28;
    const targetY = this._entryY(cruiseY);
    g.y += (targetY - g.y) * Math.min(1, dt * 2.0);
    this.baseY = g.y;
    this.group.rotation.z = Math.sin(t * 1.7 + this.node.pos.z) * 0.07;
    this.group.rotation.x = Math.max(-0.18, Math.min(0.18, -vz * 0.05));
  }

  _recoil() {
    this.group.position.y += 0.03;
  }
}

// ------------------------------------------------------------------ perro ruedas
export class Hound extends Enemy {
  _build() {

    const body = this._mat(stdMat(0xc0cad7, 0.85, 0.36));
    const plate = this._mat(stdMat(0x77828f, 0.9, 0.5));
    const dark = this._mat(stdMat(0x23282f, 0.75, 0.62));
    const rubber = this._mat(stdMat(0x101315, 0.1, 0.95));
    const accent = neonMat(this.color);
    const lit = this._mat(new THREE.MeshStandardMaterial({
      color: 0x140a0e, emissive: this.color, emissiveIntensity: 2.2,
      metalness: 0.4, roughness: 0.35
    }));

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      this.group.add(m);
      return m;
    };
    const RB = (w, h, d, r) => roundBox(w, h, d, r === undefined ? 0.025 : r);

    /* --------------------------------------------------------------- chasis */
    add(RB(0.32, 0.24, 1.08, 0.07), body, 0, 0.37, 0.02);
    for (const sd of [-1, 1]) {
      // faldón lateral atornillado: dos capas de chapa
      const skirt = add(RB(0.1, 0.2, 0.8, 0.04), plate, sd * 0.22, 0.34, 0.02);
      skirt.rotation.z = sd * 0.1;
      add(RB(0.03, 0.05, 0.62, 0.012), accent, sd * 0.268, 0.38, 0.02);
      // rejilla de refrigeración en el costado
      for (let k = 0; k < 4; k++) {
        add(new THREE.BoxGeometry(0.012, 0.045, 0.11), dark, sd * 0.262, 0.44, -0.12 + k * 0.13);
      }
      // pistones de suspensión visibles
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), plate, sd * 0.2, 0.24, -0.3, 0.28);
      add(new THREE.CylinderGeometry(0.02, 0.02, 0.2, 8), plate, sd * 0.2, 0.24, 0.36, -0.28);
      add(new THREE.SphereGeometry(0.03, 6, 5), dark, sd * 0.2, 0.15, -0.26);
      add(new THREE.SphereGeometry(0.03, 6, 5), dark, sd * 0.2, 0.15, 0.32);
    }
    // lomo: placa con bisagra y calca de serie
    add(RB(0.34, 0.09, 0.72, 0.03), plate, 0, 0.51, 0.0);
    add(RB(0.2, 0.03, 0.16, 0.01), dark, 0, 0.56, -0.14);
    const dog = decal('stencil', 0.22, 0.11, { text: 'K-9', color: '#cbd5e0' });
    dog.position.set(0, 0.525, 0.26);
    dog.rotation.x = -Math.PI / 2;
    dog.rotation.z = Math.PI;
    this.group.add(dog);
    const hz = decal('hazard', 0.26, 0.07);
    hz.position.set(0.001, 0.47, 0.33);
    hz.rotation.set(0, Math.PI / 2, 0);
    this.group.add(hz);

    // franja de luz entre las chapas y charco en el suelo
    add(RB(0.02, 0.045, 0.66, 0.01), accent, 0.283, 0.44, 0.02);
    add(RB(0.02, 0.045, 0.66, 0.01), accent, -0.283, 0.44, 0.02);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4, 2.2),
      new THREE.MeshBasicMaterial({
        map: TEX.glow, color: this.color, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.03;
    this.group.add(pool);

    /* ---------------------------------------------------------------- cabeza */
    const head = new THREE.Group();
    head.position.set(0, 0.4, -0.5);
    const hAdd = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      head.add(m);
      return m;
    };
    hAdd(new THREE.CylinderGeometry(0.055, 0.07, 0.16, 10), dark, 0, -0.03, 0.14, Math.PI / 2);
    hAdd(RB(0.27, 0.2, 0.28, 0.05), body, 0, 0.0, -0.06);
    hAdd(RB(0.29, 0.07, 0.12, 0.02), plate, 0, 0.09, -0.1, 0.15);
    // hocico partido en dos mandíbulas con dientes
    hAdd(RB(0.2, 0.09, 0.22, 0.025), plate, 0, -0.03, -0.25);
    hAdd(RB(0.18, 0.055, 0.19, 0.02), dark, 0, -0.115, -0.23, 0.07);
    for (let k = 0; k < 5; k++) {
      hAdd(new THREE.BoxGeometry(0.018, 0.03, 0.02), plate, -0.06 + k * 0.03, -0.075, -0.33, 0.2);
    }
    // sensor principal + dos auxiliares
    const eyeHousing = hAdd(new THREE.CylinderGeometry(0.062, 0.07, 0.07, 12), dark, 0, 0.035, -0.185, Math.PI / 2);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), lit);
    eye.position.set(0, 0.035, -0.218);
    head.add(eye);
    for (const sd of [-1, 1]) {
      hAdd(new THREE.CylinderGeometry(0.02, 0.022, 0.05, 10), dark, sd * 0.085, 0.03, -0.19, Math.PI / 2);
      hAdd(new THREE.SphereGeometry(0.014, 8, 6), lit, sd * 0.085, 0.03, -0.213);
      // orejas / antenas de sensores
      const ear = hAdd(RB(0.035, 0.14, 0.07, 0.012), plate, sd * 0.11, 0.15, -0.02);
      ear.rotation.z = -sd * 0.22;
      hAdd(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 4), plate, sd * 0.11, 0.24, -0.03, 0.2);
    }
    // latiguillos cuello-cabeza
    const hh1 = hose(new THREE.Vector3(-0.08, -0.05, 0.16), new THREE.Vector3(-0.055, 0.02, 0.0), 0.014, rubber, 0.03);
    head.add(hh1);
    const hh2 = hose(new THREE.Vector3(0.08, -0.05, 0.16), new THREE.Vector3(0.055, 0.02, 0.0), 0.014, rubber, 0.03);
    head.add(hh2);
    this.group.add(head);
    this.head = head;

    /* ------------------------------------------------------------------ patas */
    this.wheels = [];
    const legPos = [[-0.245, -0.28], [0.245, -0.28], [-0.245, 0.32], [0.245, 0.32]];
    for (const [x, z] of legPos) {
      const arm = new THREE.Mesh(RB(0.06, 0.24, 0.09, 0.015), dark);
      arm.position.set(x, 0.24, z + (z < 0 ? 0.03 : -0.03));
      arm.rotation.x = z < 0 ? -0.16 : 0.16;
      this.group.add(arm);
      const shock = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.16, 8), plate);
      shock.position.set(x, 0.3, z + (z < 0 ? -0.06 : 0.06));
      shock.rotation.x = z < 0 ? -0.5 : 0.5;
      this.group.add(shock);

      const wheel = new THREE.Group();
      wheel.position.set(x, 0.135, z);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.08, 16), rubber);
      tyre.rotation.z = Math.PI / 2;
      wheel.add(tyre);
      // tacos de la rueda
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const lug = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.03, 0.05), dark);
        lug.position.set(0, Math.cos(a) * 0.13, Math.sin(a) * 0.13);
        lug.rotation.x = -a;
        wheel.add(lug);
      }
      const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.085, 12), plate);
      rim.rotation.z = Math.PI / 2;
      wheel.add(rim);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 8), dark);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      const disc = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 6, 16), accent);
      disc.rotation.y = Math.PI / 2;
      wheel.add(disc);
      this.group.add(wheel);
      this.wheels.push(wheel);
    }
    // chasis y testa reales: el K-9 tiene el origen en el suelo, así que las
    // cajas centradas en 0 le pasaban por las ruedas y la cabeza nunca recibía
    this.addHit(hitbox(0.4, 1, this, 'body', 0.37, 1.3, 0.02));
    this.addHit(hitbox(0.24, 2.4, this, 'head', 0.4, 1, -0.5));

    /* ------------------------------------------------------------- cola/antena */
    add(new THREE.CylinderGeometry(0.014, 0.022, 0.36, 8), plate, 0, 0.56, 0.42, -0.62);
    add(RB(0.02, 0.12, 0.1, 0.008), plate, 0, 0.72, 0.53, -0.3);
    const tip = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    tip.position.set(0, 0.78, 0.57);
    tip.scale.setScalar(0.22);
    this.group.add(tip);

    // bocacha luminosa bajo el hocico
    add(new THREE.CylinderGeometry(0.03, 0.035, 0.1, 10), dark, 0, 0.3, -0.62, Math.PI / 2);
    add(new THREE.TorusGeometry(0.028, 0.007, 5, 10), accent, 0, 0.3, -0.67);

    this.muzzle.position.set(0, 0.3, -0.68);
    this.charge.position.copy(this.muzzle.position);
    this.baseY = this.node.pos.y;
  }

  _idle(dt, t) {
    // perro con ruedas: cierra distancia y rodea al jugador
    for (const w of this.wheels) w.rotation.x += dt * 11;
    const p = this.getPlayer();
    const g = this.group.position;
    const dx = p.x - g.x, dz = p.z - g.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    if (this.strafeDir === undefined) this.strafeDir = Math.random() < 0.5 ? -1 : 1;
    const keep = 6.2;
    const push = Math.max(-1.2, Math.min(1.9, (dist - keep) * 1.2));
    const vx = nx * push * 3.1 - nz * this.strafeDir * 1.0;
    const vz = nz * push * 3.1 + nx * this.strafeDir * 1.0;
    g.x += vx * dt;
    g.z += vz * dt;
    g.x = Math.max(-12.6, Math.min(12.6, g.x));
    g.z = Math.max(p.z - 75, Math.min(p.z + 9, g.z));
    const k = t * 8 + this.node.pos.x;
    g.y = this.baseY + Math.abs(Math.sin(k)) * 0.015;
    this.group.rotation.z = Math.sin(k) * 0.012;
    if (this.head) {
      const want = Math.atan2(dx, dz) - this.group.rotation.y;
      this.head.rotation.y = Math.max(-0.4, Math.min(0.4, want));
    }
  }

  _recoil() {
    const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(this.group.quaternion);
    this.group.position.addScaledVector(dir, 0.04);
  }
}

// ------------------------------------------------------------------ centinela
export class Sentry extends Enemy {
  _build() {

    // ---------------------------------------------------------------- mats
    const armor = this._mat(stdMat(0xb9c4d1, 1.0, 0.24));   // aleación pulida
    const plate = this._mat(stdMat(0x7e8996, 0.97, 0.42));  // chapa gastada
    const dark = this._mat(stdMat(0x2e343c, 0.9, 0.55));    // mecanismos
    const rubber = this._mat(stdMat(0x131619, 0.12, 0.94)); // botas y mangueras
    const accent = neonMat(this.color);
    const lit = this._mat(new THREE.MeshStandardMaterial({
      color: 0x140a0e, emissive: this.color, emissiveIntensity: 2.4,
      metalness: 0.45, roughness: 0.3, envMapIntensity: 1.4
    }));

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };
    const RB = (w, h, d, r) => roundBox(w, h, d, r === undefined ? 0.03 : r);

    /* ------------------------------------------------------------- piernas */
    for (const sd of [-1, 1]) {
      add(new THREE.SphereGeometry(0.095, 10, 8), dark, sd * 0.17, 0.9, 0);
      add(RB(0.1, 0.14, 0.14, 0.02), plate, sd * 0.235, 0.9, 0);

      add(RB(0.185, 0.4, 0.21, 0.045), armor, sd * 0.17, 0.69, 0.005, -0.09);
      // placa exterior del muslo: dos capas, no una caja
      const tp = add(RB(0.045, 0.28, 0.17, 0.014), plate, sd * 0.263, 0.7, 0.005, -0.09);
      tp.rotation.z = sd * 0.05;
      add(RB(0.17, 0.06, 0.19, 0.02), dark, sd * 0.17, 0.87, 0.0);

      add(new THREE.SphereGeometry(0.078, 10, 8), dark, sd * 0.17, 0.49, 0.02);
      add(RB(0.15, 0.14, 0.09, 0.03), plate, sd * 0.17, 0.49, -0.062, -0.18);

      add(RB(0.155, 0.39, 0.18, 0.032), armor, sd * 0.17, 0.3, 0.015, 0.055);
      add(RB(0.115, 0.3, 0.05, 0.02), plate, sd * 0.17, 0.32, -0.088, 0.05);
      // pistón hidráulico visto por detrás de la espinilla
      add(new THREE.CylinderGeometry(0.024, 0.024, 0.33, 8), dark, sd * 0.17, 0.32, 0.115, 0.07);
      add(new THREE.CylinderGeometry(0.031, 0.031, 0.12, 8), plate, sd * 0.17, 0.22, 0.11, 0.07);
      add(new THREE.SphereGeometry(0.058, 8, 6), dark, sd * 0.17, 0.12, 0.0);

      add(RB(0.2, 0.12, 0.37, 0.03), rubber, sd * 0.17, 0.062, -0.035);
      add(RB(0.19, 0.1, 0.24, 0.028), plate, sd * 0.17, 0.115, -0.09);
      add(RB(0.16, 0.07, 0.09, 0.02), armor, sd * 0.17, 0.085, -0.235, 0.18);
      // tacos de la suela
      for (let k = 0; k < 4; k++) {
        add(new THREE.BoxGeometry(0.2, 0.028, 0.04), dark, sd * 0.17, 0.014, -0.17 + k * 0.09);
      }
      // rodilleras con remaches
      const rv = rivets(3, 0.05, 0.011, plate);
      rv.position.set(sd * 0.17, 0.56, -0.085);
      rv.rotation.x = -0.2;
      this.group.add(rv);
    }

    /* ---------------------------------------------------------------- pelvis */
    add(RB(0.43, 0.23, 0.29, 0.055), plate, 0, 0.95, 0);
    add(RB(0.47, 0.08, 0.31, 0.02), dark, 0, 1.04, 0);
    add(RB(0.17, 0.21, 0.09, 0.025), armor, 0, 0.87, -0.125, 0.16);
    for (const sd of [-1, 1]) {
      const skirt = add(RB(0.1, 0.24, 0.24, 0.02), plate, sd * 0.235, 0.9, 0.01);
      skirt.rotation.z = sd * 0.16;
    }

    /* ----------------------------------------------------------------- torso */
    add(RB(0.35, 0.18, 0.25, 0.03), dark, 0, 1.1, 0);
    add(RB(0.61, 0.5, 0.35, 0.07), armor, 0, 1.34, 0);
    add(RB(0.51, 0.37, 0.09, 0.035), plate, 0, 1.36, -0.19, -0.05);
    // segmentos abdominales, para que el torso no sea un bloque
    for (let k = 0; k < 3; k++) {
      add(RB(0.34 - k * 0.03, 0.05, 0.07, 0.012), dark, 0, 1.13 + k * 0.055, -0.16);
    }
    add(RB(0.35, 0.1, 0.31, 0.02), dark, 0, 1.585, 0);

    // mochila: radiador, escapes y latiguillos al casco
    add(RB(0.45, 0.45, 0.19, 0.045), dark, 0, 1.35, 0.245);
    const rad = vent(0.32, 0.22, 5, dark, plate);
    rad.position.set(0, 1.34, 0.347);
    rad.rotation.y = Math.PI;
    this.group.add(rad);
    for (const sd of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.032, 0.035, 0.24, 8), plate, sd * 0.15, 1.6, 0.27);
      add(new THREE.CylinderGeometry(0.026, 0.026, 0.02, 8), lit, sd * 0.15, 1.72, 0.27);
      const h = hose(new THREE.Vector3(sd * 0.17, 1.56, 0.29), new THREE.Vector3(sd * 0.135, 1.66, 0.06), 0.017, rubber, 0.06);
      this.group.add(h);
    }
    add(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), plate, -0.2, 1.68, 0.24, 0.12);

    // calca de unidad en el pecho (plano girado a -Z)
    const tag = decal('stencil', 0.2, 0.1, { text: 'NEO-07', color: '#c9d2dc' });
    tag.position.set(0.14, 1.43, -0.242);
    tag.rotation.y = Math.PI;
    tag.rotation.z = -0.04;
    this.group.add(tag);
    const warn = decal('hazard', 0.16, 0.05);
    warn.position.set(-0.18, 1.19, -0.185);
    warn.rotation.y = Math.PI;
    this.group.add(warn);

    /* -------------------------------------------------------- hombros/brazos */
    for (const sd of [-1, 1]) {
      add(new THREE.SphereGeometry(0.088, 10, 8), dark, sd * 0.335, 1.47, 0);
      const pad = add(RB(0.25, 0.21, 0.38, 0.055), armor, sd * 0.375, 1.5, 0);
      pad.rotation.z = -sd * 0.17;
      const rim = add(RB(0.255, 0.045, 0.39, 0.016), plate, sd * 0.375, 1.4, 0);
      rim.rotation.z = -sd * 0.17;
      const rv = rivets(3, 0.07, 0.012, plate, 'z');
      rv.position.set(sd * 0.4, 1.585, 0);
      rv.rotation.z = -sd * 0.17;
      this.group.add(rv);

      // Brazo con pivote en el hombro: antes las piezas estaban soldadas al
      // torso y el centinela parecía una estatua. Ahora cuelgan de un grupo
      // que sí rota, así que respira y acompaña la puntería.
      const arm = new THREE.Group();
      arm.position.set(sd * 0.4, 1.47, 0);
      this.group.add(arm);
      const aAdd = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x - sd * 0.4, y - 1.47, z);
        m.rotation.set(rx, ry, rz);
        arm.add(m);
        return m;
      };
      aAdd(RB(0.135, 0.3, 0.155, 0.03), dark, sd * 0.4, 1.29, 0);
      aAdd(RB(0.055, 0.19, 0.17, 0.018), plate, sd * 0.472, 1.3, 0);
      aAdd(new THREE.SphereGeometry(0.062, 8, 6), dark, sd * 0.4, 1.12, 0);
      aAdd(RB(0.125, 0.29, 0.145, 0.03), armor, sd * 0.4, 0.97, -0.03, -0.24);
      aAdd(RB(0.05, 0.21, 0.12, 0.014), plate, sd * 0.462, 0.99, -0.035, -0.24);
      aAdd(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 8), dark, sd * 0.4, 0.82, -0.085, -0.24);
      if (sd < 0) this.armL = arm; else this.armR = arm;
    }

    // mano izquierda abierta (dedos sueltos, no un muñón)
    {
      const a = this.armL;
      const hand = (geo, mat, x, y, z, rx = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x + 0.4, y - 1.47, z);
        m.rotation.set(rx, 0, rz);
        a.add(m);
        return m;
      };
      hand(RB(0.11, 0.13, 0.07, 0.02), dark, -0.4, 0.75, -0.1, -0.24);
      for (let k = 0; k < 3; k++) {
        hand(new THREE.BoxGeometry(0.022, 0.075, 0.03), plate, -0.437 + k * 0.026, 0.69, -0.135, -0.5);
      }
      hand(new THREE.BoxGeometry(0.026, 0.06, 0.03), plate, -0.345, 0.72, -0.11, -0.6, 0.5);
    }

    /* ------------------------------------------------------------------ casco */
    // Pivote real de cabeza: antes el casco iba soldado al cuerpo (el grupo
    // `this.head` estaba vacío), así que el centinela no podía girar la cara.
    // Ahora todas las piezas del casco cuelgan de este grupo y sí se animan.
    const headG = new THREE.Group();
    headG.position.set(0, 1.76, 0);
    this.group.add(headG);
    this.head = headG;
    const hAdd = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y - 1.76, z);
      m.rotation.set(rx, ry, rz);
      headG.add(m);
      return m;
    };

    add(new THREE.CylinderGeometry(0.062, 0.075, 0.13, 10), dark, 0, 1.62, 0);
    hAdd(RB(0.3, 0.26, 0.3, 0.06), armor, 0, 1.76, 0);
    hAdd(RB(0.235, 0.11, 0.05, 0.018), dark, 0, 1.755, -0.155);
    hAdd(RB(0.2, 0.045, 0.022, 0.01), lit, 0, 1.762, -0.178);
    const vglow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    vglow.scale.setScalar(0.42);
    vglow.position.set(0, 0.002, -0.19);
    headG.add(vglow);
    // ceja, carrilleras y mandíbula
    hAdd(RB(0.31, 0.06, 0.13, 0.022), plate, 0, 1.865, -0.11, 0.28);
    for (const sd of [-1, 1]) {
      hAdd(RB(0.06, 0.17, 0.13, 0.02), plate, sd * 0.152, 1.72, -0.09);
      hAdd(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 8), plate, sd * 0.15, 1.78, -0.17, Math.PI / 2);
    }
    hAdd(RB(0.2, 0.08, 0.21, 0.022), dark, 0, 1.64, -0.02);
    hAdd(new THREE.CylinderGeometry(0.007, 0.007, 0.24, 4), plate, 0.105, 1.94, 0.03, 0.16);
    hAdd(new THREE.SphereGeometry(0.012, 6, 4), lit, 0.115, 2.055, 0.05);

    this.addHit(hitbox(0.46, 1, this, 'body', 1.05, 1.9));
    this.addHit(hitbox(0.22, 3, this, 'head', 1.76));

    /* ------------------------------------------------------------------ fusil */
    const gun = new THREE.Group();
    const gAdd = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      gun.add(m);
      return m;
    };
    gAdd(RB(0.1, 0.15, 0.42, 0.022), dark, 0, 0, -0.06);
    gAdd(RB(0.115, 0.12, 0.24, 0.02), plate, 0, -0.005, -0.31, 0.03);
    gAdd(RB(0.075, 0.1, 0.2, 0.02), dark, 0, -0.02, 0.22, 0.02);
    gAdd(RB(0.06, 0.07, 0.16, 0.015), plate, 0, 0.02, 0.33);
    gAdd(RB(0.07, 0.17, 0.1, 0.018), dark, 0, -0.15, 0.02, 0.22);
    gAdd(new THREE.CylinderGeometry(0.021, 0.021, 0.3, 10), plate, 0, 0.005, -0.55, Math.PI / 2);
    gAdd(new THREE.CylinderGeometry(0.034, 0.03, 0.16, 10), dark, 0, 0.005, -0.44, Math.PI / 2);
    for (let k = 0; k < 4; k++) {
      gAdd(new THREE.TorusGeometry(0.031, 0.006, 5, 10), lit, 0, 0.005, -0.46 - k * 0.038, Math.PI / 2);
    }
    gAdd(RB(0.06, 0.06, 0.16, 0.014), dark, 0, 0.105, -0.02);
    gAdd(new THREE.CylinderGeometry(0.024, 0.024, 0.03, 10), lit, 0, 0.105, -0.11, Math.PI / 2);
    gAdd(new THREE.CylinderGeometry(0.028, 0.03, 0.08, 10), dark, 0, 0.005, -0.71, Math.PI / 2);
    gAdd(RB(0.09, 0.09, 0.07, 0.02), plate, 0, 0.005, -0.665);
    // mano derecha cerrada sobre la empuñadura
    gAdd(RB(0.1, 0.12, 0.09, 0.02), dark, 0, -0.12, 0.13, 0.15);
    for (let k = 0; k < 3; k++) {
      gAdd(new THREE.BoxGeometry(0.024, 0.05, 0.075), plate, -0.03 + k * 0.03, -0.09, 0.11, 0.5);
    }
    gun.position.set(0.2, 1.08, -0.3);
    gun.rotation.x = 0.02;
    this.group.add(gun);
    this.gun = gun;

    this.muzzle.position.set(0.2, 1.08, -0.78);
    this.charge.position.copy(this.muzzle.position);
  }

  _idle(dt, t) {
    this.group.position.y = this.node.pos.y + Math.sin(t * 1.6 + this.node.pos.x) * 0.012;
    const p = this.getPlayer();
    if (this.head) {
      // Giro de casco con tope + micro-temblor de servo: sin esto parecía una
      // estatua con el arma flotando. El frente del modelo es -Z.
      const dx = p.x - this.group.position.x;
      const dz = p.z - this.group.position.z;
      const rel = Math.atan2(dx, dz) + Math.PI - this.group.rotation.y;
      const lim = Math.max(-0.6, Math.min(0.6, Math.atan2(Math.sin(rel), Math.cos(rel))));
      const tw = Math.sin(t * 11.3 + this.node.pos.x * 2.1) * 0.014;
      this.head.rotation.y += (lim + tw - this.head.rotation.y) * Math.min(1, dt * 4.5);
      const wantPitch = Math.max(-0.16, Math.min(0.24, (p.y + 1.4 - (this.node.pos.y + 1.76)) * 0.14));
      this.head.rotation.x += (wantPitch - this.head.rotation.x) * Math.min(1, dt * 3.2);
      this.head.position.y = 1.76 + Math.sin(t * 1.6) * 0.006;
    }
    if (this.gun) {
      // el arma respira con el cuerpo y sigue al jugador, como ya hacía
      this.gun.position.y = 1.08 + Math.sin(t * 1.6) * 0.008;
      this.gun.lookAt(p.x, p.y + 0.1, p.z);
    }
    // brazos: el izquierdo hace de contrapeso (sube un poco al apuntar) y el
    // derecho acompaña la respiración; sin esto las manos quedaban clavadas
    if (this.armL) {
      const raise = Math.max(-0.35, Math.min(0.55, (p.y + 1.2 - (this.node.pos.y + 1.47)) * 0.2));
      this.armL.rotation.x += ((-0.22 - raise * 0.6 + Math.sin(t * 1.6 + 0.7) * 0.03) - this.armL.rotation.x) * Math.min(1, dt * 3.4);
      this.armL.rotation.z += ((-0.06 + Math.sin(t * 1.15) * 0.02) - this.armL.rotation.z) * Math.min(1, dt * 3.0);
    }
    if (this.armR) {
      this.armR.rotation.x += ((-0.34 + Math.sin(t * 1.6 + 1.4) * 0.035) - this.armR.rotation.x) * Math.min(1, dt * 3.4);
      this.armR.rotation.z += ((0.05 + Math.sin(t * 1.05 + 0.4) * 0.02) - this.armR.rotation.z) * Math.min(1, dt * 3.0);
    }
  }
}

// ---------------------------------------------------------------------- jefe
// ---------------------------------------------------------------------- jefe
export class Boss extends Enemy {
  /* Nave nodriza: ya no es un gigante que camina hacia ti. Es una cañonera
     que entra desde el fondo, orbita, hace pasadas de fuego y se retira para
     recargar el escudo. Cuando el escudo está caído, el núcleo del vientre
     queda expuesto y es el único punto donde el plomo entra de verdad. */
  constructor(world, node, def) {
    super(world, node, def);
    this.phase = 1;
    this.coreOpen = false;
    this.ventT = 0;
    this.invulnT = 0;
    this.fireT = 2.0;
    this.runT = 3.0;
    this.run = 'enter';
    this.orbA = Math.PI * 0.5 * (Math.random() < 0.5 ? 1 : -1);
    this.orbDir = Math.random() < 0.5 ? -1 : 1;
    this.rad = 20;
    this.radTarget = 18;
    this.bank = 0;
    this.pitch = 0;
    this.burstLeft = 0;
    this.burstT = 0;
    this.ramT = 0;
    this.turretYaw = 0;
    this.hitFlash = 0;
    this._vx = 0;
    this._vz = 0;
    this.muzzle = this.turretMuzzles ? this.turretMuzzles[0] : new THREE.Object3D();
  }

  _build() {
    const plate = this._mat(new THREE.MeshStandardMaterial({
      color: 0x2a3342, metalness: 0.92, roughness: 0.34, flatShading: true
    }));
    const dark = this._mat(new THREE.MeshStandardMaterial({
      color: 0x0d1119, metalness: 0.8, roughness: 0.55, flatShading: true
    }));
    const trim = this._mat(new THREE.MeshStandardMaterial({
      color: 0xff9f43, metalness: 0.7, roughness: 0.3,
      emissive: 0xff6a00, emissiveIntensity: 0.55
    }));
    const glow = this._mat(new THREE.MeshBasicMaterial({
      color: 0x9fe8ff, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    const coreMat = this._mat(new THREE.MeshBasicMaterial({
      color: 0xff7a1a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    const domeMat = this._mat(new THREE.MeshBasicMaterial({
      color: 0x49e6ff, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      this.group.add(m);
      return m;
    };

    /* --- casco: cuña alargada, morro afilado, paneles escalonados --- */
    add(new THREE.CylinderGeometry(0.9, 1.5, 4.6, 6, 1), plate, 0, 0, 0, Math.PI / 2, 0, Math.PI / 6);
    add(new THREE.CylinderGeometry(0.62, 0.9, 1.5, 6, 1), plate, 0, 0.02, -2.55, Math.PI / 2, 0, Math.PI / 6);
    add(new THREE.ConeGeometry(0.62, 1.1, 6), trim, 0, 0.02, -3.75, -Math.PI / 2, 0, 0);
    // dorso blindado y quilla
    add(new THREE.BoxGeometry(1.5, 0.34, 3.6), dark, 0, 0.62, 0.1);
    add(new THREE.BoxGeometry(0.9, 0.22, 2.2), plate, 0, 0.86, 0.35);
    add(new THREE.BoxGeometry(1.15, 0.3, 2.4), dark, 0, -0.62, 0.15);
    // costillas / líneas de panel
    for (let i = 0; i < 4; i++) {
      add(new THREE.BoxGeometry(1.7 - i * 0.12, 0.06, 0.09), trim, 0, 0.55, -1.2 + i * 0.85);
    }
    // entradas de aire laterales
    for (const sd of [-1, 1]) {
      add(new THREE.BoxGeometry(0.1, 0.36, 1.1), dark, sd * 1.24, 0.05, -0.9);
      add(new THREE.BoxGeometry(0.06, 0.2, 0.86), trim, sd * 1.29, 0.05, -0.9);
    }

    /* --- alas en flecha con pods de misiles --- */
    for (const sd of [-1, 1]) {
      const wing = new THREE.Group();
      wing.position.set(sd * 1.15, 0.05, 0.35);
      wing.rotation.y = sd * 0.42;
      wing.rotation.z = sd * -0.12;
      this.group.add(wing);
      const wAdd = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z); m.rotation.set(rx, ry, rz); wing.add(m); return m;
      };
      wAdd(new THREE.BoxGeometry(2.1, 0.13, 1.5), plate, sd * 0.95, 0, 0.1);
      wAdd(new THREE.BoxGeometry(1.1, 0.1, 0.7), dark, sd * 2.0, 0.02, 0.28);
      wAdd(new THREE.BoxGeometry(0.16, 0.05, 1.2), trim, sd * 0.55, 0.09, 0.05);
      // pod de misiles
      wAdd(new THREE.CylinderGeometry(0.2, 0.2, 1.0, 8), dark, sd * 1.8, -0.1, -0.35, Math.PI / 2, 0, 0);
      wAdd(new THREE.CircleGeometry(0.19, 8), trim, sd * 1.8, -0.1, -0.86, 0, Math.PI, 0);
      // aleta vertical de punta
      wAdd(new THREE.BoxGeometry(0.07, 0.62, 0.6), plate, sd * 2.45, 0.3, 0.35);
    }

    /* --- cabina / sensores --- */
    const canopy = add(new THREE.SphereGeometry(0.58, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      this._mat(new THREE.MeshStandardMaterial({
        color: 0x0a2634, metalness: 1, roughness: 0.08,
        emissive: 0x1d6f8c, emissiveIntensity: 0.6
      })), 0, 0.5, -1.35);
    canopy.scale.set(1, 0.8, 1.7);
    add(new THREE.TorusGeometry(0.42, 0.05, 6, 14), trim, 0, 0.42, -2.2, Math.PI / 2 - 0.25, 0, 0);
    // ojo sensor frontal
    const eye = add(new THREE.SphereGeometry(0.2, 10, 8), glow, 0, 0.24, -2.85);
    eye.scale.set(1, 0.55, 0.6);
    this.eye = eye;

    /* --- torretas gemelas bajo el morro --- */
    this.turrets = [];
    this.turretMuzzles = [];
    for (const sd of [-1, 1]) {
      const tg = new THREE.Group();
      tg.position.set(sd * 1.05, -0.52, -1.05);
      this.group.add(tg);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.22, 8), dark);
      tg.add(base);
      const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.26, 0.4), plate);
      yoke.position.y = -0.22; tg.add(yoke);
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 1.25, 8), dark);
      bar.rotation.x = Math.PI / 2; bar.position.set(0, -0.28, -0.42); tg.add(bar);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 8), trim);
      tip.rotation.x = Math.PI / 2; tip.position.set(0, -0.28, -1.0); tg.add(tip);
      const mz = new THREE.Object3D();
      mz.position.set(0, -0.28, -1.12);
      tg.add(mz);
      this.turrets.push(tg);
      this.turretMuzzles.push(mz);
    }

    /* --- motores: tres toberas con llama viva --- */
    this.flames = [];
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * 0.72;
      add(new THREE.CylinderGeometry(0.34, 0.42, 0.7, 10), dark, x, 0.02, 2.35, Math.PI / 2, 0, 0);
      add(new THREE.TorusGeometry(0.36, 0.05, 6, 12), trim, x, 0.02, 2.7);
      const fl = new THREE.Mesh(
        new THREE.ConeGeometry(0.28, 1.9, 8, 1, true),
        this._mat(new THREE.MeshBasicMaterial({
          color: 0x54d8ff, transparent: true, opacity: 0.75, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
        }))
      );
      fl.rotation.x = -Math.PI / 2;
      fl.position.set(x, 0.02, 3.6);
      this.group.add(fl);
      this.flames.push(fl);
      const fg = new THREE.PointLight(0x49c8ff, 1.4, 9, 2);
      fg.position.set(x, 0.02, 3.1);
      this.group.add(fg);
    }

    /* --- núcleo del vientre: el punto débil, oculto tras el escudo --- */
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), coreMat);
    this.core.position.set(0, -0.82, -0.2);
    this.core.scale.set(1, 0.85, 1);
    this.group.add(this.core);
    this.coreRing = new THREE.Mesh(new THREE.TorusGeometry(0.86, 0.07, 8, 20), trim);
    this.coreRing.position.set(0, -0.85, -0.2);
    this.coreRing.rotation.x = Math.PI / 2;
    this.group.add(this.coreRing);
    this.coreLight = new THREE.PointLight(0xff7a1a, 0.6, 7, 2);
    this.coreLight.position.set(0, -0.9, -0.2);
    this.group.add(this.coreLight);

    /* --- escudo: cúpula de energía + retícula --- */
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(4.1, 20, 14), domeMat);
    this.dome.position.set(0, 0, 0.2);
    this.dome.scale.set(1.35, 0.72, 1.5);
    this.group.add(this.dome);
    this.domeGrid = new THREE.Mesh(
      new THREE.IcosahedronGeometry(4.16, 1),
      this._mat(new THREE.MeshBasicMaterial({
        color: 0x49e6ff, wireframe: true, transparent: true, opacity: 0.16,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      }))
    );
    this.domeGrid.position.copy(this.dome.position);
    this.domeGrid.scale.copy(this.dome.scale);
    this.group.add(this.domeGrid);

    /* --- cajas de impacto --- */
    this.addHit(hitbox(1.5, 1, this, 'hull', 0.15, 1.0, -0.1));
    this.addHit(hitbox(0.9, 2.6, this, 'core', -0.78, 0.85, -0.2));
    this.muzzle = this.turretMuzzles[0];
    this.liftLocal = 0;
  }

  _liftY() { return 0; }

  /* --- fase por vida: la nave se pone más agresiva --- */
  _phase(p) {
    if (this.dead) return;
    p = Math.max(1, Math.min(3, p));
    if (p === this.phase && this.phaseT !== undefined) return;
    this.phase = p;
    this.phaseT = 0;
    this.invulnT = 1.1;
    this.coreOpen = false;
    this.ventT = 0;
    this.run = 'retreat';
    this.runT = 2.2;
    this.radTarget = 22;
    this.burstLeft = 0;
    if (this.world.fx) {
      const pos = this.group.position.clone();
      this.world.fx.ring(pos, 0x49e6ff, 7, 0.9);
      this.world.fx.ring(pos, 0xff9f43, 4.5, 0.7);
      this.world.fx.spark(pos, 0x9fe8ff, 26, 7, 0.9, 0.24);
    }
    if (this.def.onPhase) this.def.onPhase(this, p);
  }

  _idle(dt, t) {
    // llama de motores y pulso del núcleo
    const kick = 0.82 + Math.sin(t * 22 + this.phase) * 0.08 + (this.run === 'dive' ? 0.35 : 0);
    if (this.flames) {
      for (let i = 0; i < this.flames.length; i++) {
        const f = this.flames[i];
        f.scale.set(0.9 + kick * 0.12, 0.75 + kick * 0.5, 0.9 + kick * 0.12);
        f.material.opacity = 0.5 + kick * 0.3;
      }
    }
    if (this.core) {
      const open = this.coreOpen && this.ventT > 0;
      const s = open ? 1.28 + Math.sin(t * 12) * 0.14 : 0.9;
      this.core.scale.set(s, s * 0.85, s);
      this.core.material.opacity = open ? 0.95 : 0.55;
      if (this.coreLight) this.coreLight.intensity = open ? 2.4 + Math.sin(t * 14) * 0.6 : 0.45;
      if (this.coreRing) this.coreRing.rotation.z += dt * (open ? 4.5 : 1.2);
    }
    if (this.dome && this.domeGrid) {
      const up = !(this.coreOpen && this.ventT > 0);
      this.dome.visible = up;
      this.domeGrid.visible = up;
      if (up) {
        const o = 0.1 + Math.abs(Math.sin(t * 1.6)) * 0.06 + (this.invulnT > 0 ? 0.1 : 0);
        this.dome.material.opacity = o;
        this.domeGrid.material.opacity = 0.12 + (this.invulnT > 0 ? 0.12 : 0);
        this.domeGrid.rotation.y += dt * 0.35;
        this.domeGrid.rotation.x += dt * 0.12;
      }
    }
    if (this.eye) this.eye.material.opacity = 0.55 + Math.abs(Math.sin(t * 3.4)) * 0.4;
    if (this.hitFlash > 0) this.hitFlash -= dt;
  }

  _ai(dt, t) {
    this._move(dt, t);

    // umbrales de fase (una sola vez cada uno)
    const frac = this.hp / this.maxHp;
    const want = frac > 0.68 ? 1 : frac > 0.34 ? 2 : 3;
    if (want > this.phase) this._phase(want);

    if (this.invulnT > 0) this.invulnT -= dt;
    if (this.ventT > 0) {
      this.ventT -= dt;
      if (this.ventT <= 0) { this.coreOpen = false; this.burstLeft = 0; }
    }

    // reloj de maniobra: pasada de ataque -> retirada con núcleo al aire
    this.runT -= dt;
    if (this.runT <= 0) {
      if (this.run === 'dive') {
        this.run = 'retreat';
        this.runT = this.phase === 3 ? 3.4 : 4.2;
        this.radTarget = 21;
        this.coreOpen = true;
        this.ventT = this.runT - 0.6;
        this.burstLeft = 0;
      } else {
        this.run = 'dive';
        this.runT = this.phase === 3 ? 5.2 : 4.2;
        this.radTarget = 10.5;
        this.coreOpen = false;
        this.ventT = 0;
        this.burstLeft = this.phase === 3 ? 8 : 6;
        this.burstT = 0.2;
        this.orbDir = Math.random() < 0.5 ? -1 : 1;
      }
    }

    // fuego: ráfagas dobles desde las torretas
    if (this.run === 'dive' && this.burstLeft > 0) {
      this.burstT -= dt;
      if (this.burstT <= 0) {
        this.burstT = this.phase === 3 ? 0.14 : 0.19;
        this.burstLeft--;
        this._fireVolley();
      }
    }

    // torretas siguen al jugador
    const p = this.getPlayer();
    const local = this.group.worldToLocal(p.clone());
    const yaw = Math.atan2(-local.x, -local.z);
    this.turretYaw += (Math.max(-0.55, Math.min(0.55, yaw)) - this.turretYaw) * Math.min(1, dt * 8);
    if (this.turrets) for (const tg of this.turrets) tg.rotation.y = this.turretYaw;
  }

  _fireVolley() {
    const p = this.getPlayer();
    for (let i = 0; i < 2; i++) {
      const mz = this.turretMuzzles[i];
      const origin = mz.getWorldPosition(new THREE.Vector3());
      const target = p.clone();
      target.x += (Math.random() - 0.5) * 2.2;
      target.y += (Math.random() - 0.5) * 0.9;
      target.z += (Math.random() - 0.5) * 1.4;
      this.world.bolts.spawn(origin, target, this.def.boltSpeed, 0xff2d55, this.def.damage);
      if (this.world.fx) this.world.fx.spark(origin, 0xff9f43, 5, 3.4, 0.22, 0.08);
    }
    if (this.world.fx) {
      const p2 = this.group.position.clone();
      this.world.fx.ring(p2, 0x49e6ff, 1.4, 0.28);
    }
  }

  _move(dt, t) {
    const p = this.getPlayer();
    const nx = this.node.pos.x, nz = this.node.pos.z;
    // órbita alrededor del jugador: entra, barre de lado y se retira
    this.rad += (this.radTarget - this.rad) * Math.min(1, dt * 1.4);
    this.orbA += dt * this.orbDir * (this.run === 'dive' ? 0.5 : 0.3) * (this.phase === 3 ? 1.35 : 1);
    const ox = Math.cos(this.orbA);
    const oz = Math.sin(this.orbA);
    const wantX = p.x + ox * this.rad;
    const wantZ = p.z + oz * this.rad - 2.0;
    const high = this.run === 'dive' ? 4.6 : 7.4;
    const wantY = high + Math.sin(t * 0.8) * 0.55 + (this.run === 'enter' ? 3.4 : 0);

    // suavizado con inercia: la nave pesa, no es un dron
    const k = Math.min(1, dt * (this.run === 'dive' ? 2.1 : 1.4));
    const prevX = this.group.position.x, prevZ = this.group.position.z;
    this.group.position.x += (wantX - this.group.position.x) * k;
    this.group.position.y += (wantY - this.group.position.y) * Math.min(1, dt * 1.6);
    this.group.position.z += (wantZ - this.group.position.z) * k;
    // el nodo sigue al grupo: la calle recicla por delante y el resto de
    // sistemas (HUD, arena) consultan node.pos
    this.node.pos.x = this.group.position.x;
    this.node.pos.z = this.group.position.z;

    const vx = (this.group.position.x - prevX) / Math.max(dt, 0.0001);
    const vz = (this.group.position.z - prevZ) / Math.max(dt, 0.0001);
    // alabeo por desplazamiento lateral y cabeceo por avance
    const bankT = Math.max(-0.65, Math.min(0.65, -(vx * 0.12 + vz * 0.05)));
    this.bank += (bankT - this.bank) * Math.min(1, dt * 3.2);
    this.group.rotation.z = this.bank;
    this.pitch += ((-vz * 0.02) - this.pitch) * Math.min(1, dt * 3);
    this.group.rotation.x = this.pitch;
    this.age += dt;
  }

  hit(point, mult, dmg) {
    if (this.state === 'die' || this.dead) return false;
    if (this.state === 'spawn') return false;
    const open = this.coreOpen && this.ventT > 0;
    let m = mult;
    if (open) {
      // el núcleo desnudo recibe mucho más; el casco sigue aguantando
      m = mult >= 2.6 ? mult * 1.45 : mult * 0.65;
    } else {
      // escudo arriba: entra poco plomo, y el núcleo está sellado
      m = mult >= 2.6 ? 0.06 : mult * 0.32;
    }
    if (this.invulnT > 0) m *= 0.12;
    this.hitFlash = 0.12;
    if (this.world.fx) {
      const col = open ? 0xffe066 : 0x49e6ff;
      this.world.fx.spark(point, col, 5, 4.0, 0.28, 0.1);
      if (m > 0.5) this.world.fx.ring(point, col, 0.9, 0.3);
    }
    return super.hit(point, m, dmg);
  }

  die() {
    if (this.dead) return;
    this.coreOpen = true;
    this.core.material.color.setHex(0xffe066);
    const p = this.group.position.clone();
    if (this.world.fx) {
      // la nave se parte en cadena: motores, alas y núcleo
      for (let i = 0; i < 9; i++) {
        const q = p.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 2.6, (Math.random() - 0.5) * 6));
        this.world.fx.spark(q, i % 2 ? 0xff9f43 : 0xffe066, 34, 11, 1.2, 0.3);
        this.world.fx.ring(q, i % 2 ? 0xff2d55 : 0x49e6ff, 3.2 + Math.random() * 2, 0.9);
      }
      this.world.fx.ring(p, 0xffffff, 14, 1.6);
      this.world.fx.spark(p, 0xffe066, 130, 18, 1.8, 0.5);
    }
    if (this.world.lights) { /* nada: las luces cuelgan del grupo */ }
    super.die();
  }

  remove() {
    super.remove();
  }
}


// ----------------------------------------------------------------- proyectiles
export class BoltField {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.pool = [];
  }

  _make() {
    const g = new THREE.Group();
    // fragmento de láser: rombo alargado, no bola
    const shard = new THREE.OctahedronGeometry(0.5, 0);
    const core = new THREE.Mesh(shard, new THREE.MeshBasicMaterial({
      color: 0xffffff, toneMapped: false
    }));
    core.scale.set(0.07, 0.07, 0.42);
    g.add(core);

    const shell = new THREE.Mesh(shard, new THREE.MeshBasicMaterial({
      color: 0xff2d55, transparent: true, opacity: 0.42, toneMapped: false,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    shell.scale.set(0.105, 0.105, 0.5);
    g.add(shell);

    const rings = [];

    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    glow.scale.setScalar(0.34);
    g.add(glow);

    const trail = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    trail.position.z = 0.3;
    trail.scale.setScalar(0.3);
    g.add(trail);

    g.visible = false;
    this.scene.add(g);
    return { g, rings, core, shell, glow, trail };
  }

  spawn(origin, target, speed = 16, color = 0xff2d55, dmg = 12) {
    const o = this.pool.pop() || this._make();
    o.g.visible = true;
    o.g.position.copy(origin);
    o.g.lookAt(target);
    o.dir = target.clone().sub(origin).normalize();
    o.speed = speed;
    o.life = 5;
    o.dmg = dmg;
    o.color = color;
    o.shell.material.color.setHex(color);
    o.glow.material.color.setHex(color);
    o.trail.material.color.setHex(color);
    o.rings.forEach(r => r.material.color.setHex(color));
    this.list.push(o);
  }

  _retire(b) {
    b.g.visible = false;
    const i = this.list.indexOf(b);
    if (i >= 0) this.list.splice(i, 1);
    if (this.pool.indexOf(b) === -1) this.pool.push(b);
  }

  clear() {
    for (const o of this.list) {
      o.g.visible = false;
      if (this.pool.indexOf(o) === -1) this.pool.push(o);
    }
    this.list.length = 0;
  }

  update(dt, playerPos, onPlayerHit) {
    const hitR2 = 0.55 * 0.55;
    // El callback puede vaciar la lista (muerte del jugador → bolts.clear()).
    // Sin este blindaje el bucle seguía con índices viejos, b quedaba
    // undefined y la excepción congelaba el juego en cada frame: era el
    // cuelgue que aparecía "en algunas partes".
    const snapshot = this.list.slice();
    for (let i = snapshot.length - 1; i >= 0; i--) {
      const b = snapshot[i];
      if (!b || this.list.indexOf(b) === -1) continue;
      b.life -= dt;
      const step = b.speed * dt;
      // barrido: comprueba varios puntos para no atravesar al jugador
      let hit = false;
      const steps = Math.max(1, Math.ceil(step / 0.25));
      for (let s = 0; s < steps; s++) {
        b.g.position.addScaledVector(b.dir, step / steps);
        if (b.g.position.distanceToSquared(playerPos) < hitR2) { hit = true; break; }
      }
      const pulse = 0.9 + Math.sin(b.life * 26) * 0.1;
      b.core.rotation.z += dt * 9;
      b.shell.rotation.z -= dt * 6;
      b.glow.scale.setScalar(0.34 * pulse);
      b.trail.scale.setScalar(0.3 * pulse);

      if (hit) {
        if (onPlayerHit) onPlayerHit(b);
        this._retire(b);
        continue;
      }
      // solo muere por vida: el jugador avanza y el origen deja de ser referencia
      if (b.life <= 0) this._retire(b);
    }
  }
}

// ------------------------------------------------------------------ avispa
export class Wasp extends Enemy {
  _build() {
    // Avispa de reconocimiento: chasis de aleación oscura, no plástico amarillo.
    const hull = this._mat(stdMat(0x8d97a5, 0.9, 0.34));
    const plate = this._mat(stdMat(0x5c6572, 0.94, 0.46));
    const dark = this._mat(stdMat(0x22272e, 0.86, 0.55));
    const carbon = this._mat(stdMat(0x0d1013, 0.35, 0.6));
    const accent = neonMat(this.color);
    const lit = this._mat(new THREE.MeshStandardMaterial({
      color: 0x120a0d, emissive: this.color, emissiveIntensity: 2.4,
      metalness: 0.4, roughness: 0.3
    }));

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      this.group.add(m);
      return m;
    };

    /* --- fuselaje segmentado (lee como insecto mecánico, no como cápsula) */
    const segs = [
      [0.115, 0.1, 0.0], [0.12, 0.12, 0.12], [0.105, 0.1, 0.24], [0.082, 0.08, 0.34]
    ];
    segs.forEach(([r, l, z], i) => {
      add(new THREE.CapsuleGeometry(r, l, 4, 12), i === 0 ? hull : plate, 0, 0, z, Math.PI / 2);
      // aros de unión entre segmentos
      add(new THREE.TorusGeometry(r * 0.95, 0.011, 5, 14), dark, 0, 0, z + l * 0.5 + 0.01, Math.PI / 2);
    });
    add(roundBox(0.18, 0.055, 0.3, 0.02), dark, 0, 0.095, 0.12);   // lomo
    add(roundBox(0.05, 0.03, 0.26, 0.01), plate, 0, 0.125, 0.12);

    /* --- cabeza: sensor óptico en carcasa + halo */
    const headG = new THREE.Group();
    headG.position.set(0, -0.005, -0.24);
    this.group.add(headG);
    const hAdd = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      headG.add(m);
      return m;
    };
    hAdd(roundBox(0.23, 0.17, 0.2, 0.05), hull, 0, 0, 0);
    hAdd(roundBox(0.19, 0.055, 0.06, 0.015), dark, 0, 0.055, -0.095);
    hAdd(new THREE.CylinderGeometry(0.062, 0.075, 0.07, 14), dark, 0, -0.005, -0.115, Math.PI / 2);
    hAdd(new THREE.SphereGeometry(0.052, 14, 10), lit, 0, -0.005, -0.145);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    halo.position.set(0, -0.005, -0.15);
    halo.scale.setScalar(0.2);
    headG.add(halo);
    for (const sd of [-1, 1]) {  // mandíbulas
      hAdd(roundBox(0.035, 0.05, 0.12, 0.012), plate, sd * 0.085, -0.06, -0.115, 0, sd * 0.22, 0);
      hAdd(new THREE.ConeGeometry(0.018, 0.07, 6), dark, sd * 0.09, -0.085, -0.17, Math.PI * 0.62, 0, sd * 0.2);
    }
    hAdd(new THREE.CylinderGeometry(0.006, 0.004, 0.16, 5), plate, 0.055, 0.12, 0.02, -0.35);  // antena

    /* --- patas de aterrizaje plegadas */
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        add(new THREE.SphereGeometry(0.028, 8, 6), dark, sd * 0.1, -0.075, -0.06 + i * 0.16);
        add(new THREE.CylinderGeometry(0.014, 0.011, 0.13, 6), plate, sd * 0.135, -0.13, -0.06 + i * 0.16, 0, 0, sd * 0.7);
        add(new THREE.CylinderGeometry(0.009, 0.007, 0.12, 6), dark, sd * 0.175, -0.2, -0.06 + i * 0.16, 0, 0, sd * -0.55);
        add(roundBox(0.045, 0.014, 0.055, 0.006), carbon, sd * 0.2, -0.255, -0.06 + i * 0.16);
      }
    }

    /* --- cuatro rotores en góndolas (alas de energía + palas reales) */
    this.wings = [];
    this.rotors = [];
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        const z = -0.1 + i * 0.26;
        const arm = add(roundBox(0.24, 0.035, 0.05, 0.014), plate, sd * 0.16, 0.045, z, 0, 0, sd * 0.08);
        arm.position.z = z;
        const nac = add(new THREE.CylinderGeometry(0.048, 0.055, 0.1, 12), dark, sd * 0.265, 0.055, z);
        add(new THREE.TorusGeometry(0.05, 0.008, 5, 14), accent, sd * 0.265, 0.105, z, Math.PI / 2);
        const rotor = new THREE.Group();
        rotor.position.set(sd * 0.265, 0.112, z);
        for (let b = 0; b < 2; b++) {
          const blade = new THREE.Mesh(roundBox(0.17, 0.006, 0.035, 0.003), carbon);
          blade.rotation.y = b * Math.PI;
          blade.rotation.z = 0.09;
          rotor.add(blade);
        }
        this.group.add(rotor);
        this.rotors.push(rotor);

        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.13), new THREE.MeshBasicMaterial({
          color: this.color, transparent: true, opacity: 0.13, side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
        }));
        wing.position.set(sd * 0.265, 0.118, z);
        this.group.add(wing);
        this.wings.push(wing);
      }
    }

    /* --- aguijón posterior con emisor */
    add(new THREE.CylinderGeometry(0.012, 0.03, 0.16, 8), dark, 0, -0.01, 0.42, Math.PI / 2);
    add(new THREE.CylinderGeometry(0.006, 0.012, 0.09, 6), lit, 0, -0.01, 0.52, Math.PI / 2);
    const tail = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    tail.position.set(0, -0.01, 0.56);
    tail.scale.setScalar(0.26);
    this.group.add(tail);

    const tag = decal('stencil', 0.1, 0.05, { text: 'W-04', color: '#c9d2dc' });
    tag.position.set(0.0, 0.06, 0.02);
    tag.rotation.x = -Math.PI / 2;
    this.group.add(tag);

    this.addHit(hitbox(0.32, 1.6, this, 'body'));

    this.muzzle.position.set(0, 0, -0.3);
    this.charge.position.copy(this.muzzle.position);
    this.baseY = this.node.pos.y;
  }

  _idle(dt, t) {
    for (let i = 0; i < this.wings.length; i++) {
      this.wings[i].rotation.y = Math.sin(t * 42 + i * 1.7) * 0.5;
    }
    if (this.rotors) for (let i = 0; i < this.rotors.length; i++) this.rotors[i].rotation.y += dt * 46;
    // enjambre: orbita rápido y bajo, con zigzag, para obligar a mover el punto de mira
    const p = this.getPlayer();
    const g = this.group.position;
    const dx = p.x - g.x, dz = p.z - g.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    if (this.orbitDir === undefined) this.orbitDir = Math.random() < 0.5 ? -1 : 1;
    const keep = 6.4 + this._sepSeed * 3.2;
    const far = dist > 22;
    const radial = Math.max(-1.6, Math.min(far ? 16 : 5.4, (dist - keep) * (far ? 2.4 : 1.8)));
    const tang = 3.4 * this.orbitDir;
    g.x += (nx * radial - nz * tang) * dt;
    g.z += (nz * radial + nx * tang) * dt;
    g.x = Math.max(-13, Math.min(13, g.x));
    g.z = Math.max(p.z - 70, Math.min(p.z + 8, g.z));
    const cruiseY = 1.9 + Math.sin(t * 5.2 + this._sepSeed * 9) * 0.5 + Math.sin(t * 1.4 + this._sepSeed * 3) * 0.18;
    const targetY = this._entryY(cruiseY);
    g.y += (targetY - g.y) * Math.min(1, dt * 3.4);
    this.baseY = g.y;
    this.group.rotation.z = Math.sin(t * 6 + this._sepSeed * 5) * 0.3;
    this.group.rotation.x = -0.12;
  }

  _recoil() {}
}

// ------------------------------------------------------------------ araña suicida
export class Crawler extends Enemy {
  _build() {
    // Escarabajo explosivo: caparazón de placas de aleación sobre bastidor.
    const plate = this._mat(stdMat(0x77808c, 0.92, 0.42));
    const hull = this._mat(stdMat(0x9aa4b1, 0.95, 0.32));
    const dark = this._mat(stdMat(0x23282f, 0.88, 0.55));
    const carbon = this._mat(stdMat(0x0e1114, 0.3, 0.62));
    const accent = neonMat(this.color);
    const lit = this._mat(new THREE.MeshStandardMaterial({
      color: 0x140a06, emissive: 0xff9f43, emissiveIntensity: 2.6,
      metalness: 0.35, roughness: 0.28
    }));

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.group) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };

    /* --- chasis bajo + placas del lomo solapadas */
    add(roundBox(0.46, 0.12, 0.62, 0.05), dark, 0, 0.15, 0);
    for (let i = 0; i < 3; i++) {
      const w = 0.5 - i * 0.055;
      const p = add(roundBox(w, 0.1, 0.22, 0.04), i === 1 ? hull : plate, 0, 0.235 + i * 0.03, -0.2 + i * 0.19, -0.1 + i * 0.05);
      p.scale.z = 1.02;
      add(roundBox(w - 0.06, 0.03, 0.19, 0.012), dark, 0, 0.29 + i * 0.03, -0.2 + i * 0.19, -0.1 + i * 0.05);
    }
    add(roundBox(0.34, 0.06, 0.2, 0.02), plate, 0, 0.135, 0.3, 0.12);   // faldón trasero

    /* --- núcleo de detonación a la vista, tras rejilla */
    this.core = add(new THREE.SphereGeometry(0.1, 14, 12), lit, 0, 0.27, -0.02);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }));
    glow.position.set(0, 0.27, -0.02);
    glow.scale.setScalar(0.34);
    this.group.add(glow);
    const cage = new THREE.Group();
    cage.position.set(0, 0.27, -0.02);
    for (let i = 0; i < 4; i++) {
      const bar = new THREE.Mesh(roundBox(0.19, 0.016, 0.016, 0.006), dark);
      bar.rotation.y = i * Math.PI / 4;
      cage.add(bar);
    }
    const ringCore = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.016, 6, 18), accent);
    ringCore.rotation.x = Math.PI / 2;
    cage.add(ringCore);
    this.group.add(cage);

    /* --- seis patas hidráulicas con rodilla y almohadilla */
    this.legs = [];
    for (const sd of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const z = -0.22 + i * 0.22;
        const leg = new THREE.Group();
        leg.position.set(sd * 0.22, 0.2, z);
        add(new THREE.SphereGeometry(0.042, 10, 8), dark, 0, 0, 0, 0, 0, 0, leg);
        add(roundBox(0.2, 0.045, 0.05, 0.018), plate, sd * 0.1, 0.025, 0, 0, 0, sd * -0.3, leg);
        add(new THREE.SphereGeometry(0.03, 8, 6), dark, sd * 0.2, -0.01, 0, 0, 0, 0, leg);
        add(new THREE.CylinderGeometry(0.014, 0.012, 0.22, 6), hull, sd * 0.235, -0.11, 0, 0, 0, sd * 0.22, leg);
        add(new THREE.CylinderGeometry(0.008, 0.007, 0.18, 5), dark, sd * 0.2, -0.1, 0.03, 0.2, 0, sd * 0.12, leg);
        add(roundBox(0.07, 0.022, 0.09, 0.01), carbon, sd * 0.26, -0.215, 0, 0, 0, 0, leg);
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 4), accent, sd * 0.26, -0.198, 0.04, 0, 0, 0, leg);
        this.group.add(leg);
        this.legs.push(leg);
      }
    }

    /* --- morro con sensor y pinchos de carga */
    add(roundBox(0.3, 0.14, 0.12, 0.04), hull, 0, 0.19, -0.32);
    add(new THREE.CylinderGeometry(0.028, 0.036, 0.04, 12), dark, 0, 0.2, -0.38, Math.PI / 2);
    add(new THREE.SphereGeometry(0.024, 10, 8), lit, 0, 0.2, -0.395);
    add(new THREE.ConeGeometry(0.045, 0.16, 8), plate, 0, 0.33, 0.12, -0.35);
    const tag = decal('hazard', 0.12, 0.04);
    tag.position.set(0, 0.28, 0.28);
    tag.rotation.x = -1.15;
    this.group.add(tag);

    this.addHit(hitbox(0.34, 1.2, this, 'body'));

    this.muzzle.position.set(0, 0.28, -0.3);
    this.charge.position.copy(this.muzzle.position);
    this.charge.material.opacity = 0;
    this.baseY = this.node.pos.y;
  }

  _idle(dt, t) {
    // corre en zigzag hacia el jugador: no dispara, se pega y explota
    const p = this.getPlayer();
    const g = this.group.position;
    const dx = p.x - g.x, dz = p.z - g.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    const nx = dx / dist, nz = dz / dist;
    const wob = Math.sin(t * 6 + this._sepSeed * 8) * 0.55;
    g.x += (nx - nz * wob) * 3.5 * dt;
    g.z += (nz + nx * wob) * 3.5 * dt;
    g.x = Math.max(-12.6, Math.min(12.6, g.x));
    g.z = Math.max(p.z - 40, Math.min(p.z + 6, g.z));
    g.y = this.baseY + Math.abs(Math.sin(t * 12 + this._sepSeed * 6)) * 0.05;
    for (let i = 0; i < this.legs.length; i++) {
      this.legs[i].rotation.x = Math.sin(t * 13 + i * 1.4) * 0.45;
    }
    const urg = Math.max(0, 1 - dist / 8);
    this.core.scale.setScalar(0.9 + urg * 0.55 + Math.sin(t * 22) * 0.08);
    this.core.material.color.setHex(urg > 0.45 ? 0xff2d55 : 0xff9f43);
  }

  _ai() {
    if (this.group.position.distanceTo(this.getPlayer()) < 2.4) this._explode();
  }

  _explode() {
    if (this.dead) return;
    this.dead = true;
    const pos = this.group.position.clone();
    if (this.world.fx) {
      this.world.fx.spark(pos, 0xff9f43, 30, 8, 0.7, 0.18);
      this.world.fx.ring(pos, 0xff2d55, 3.4, 0.55);
    }
    if (this.world.damagePlayer) this.world.damagePlayer(15);
    if (this.world.shake) this.world.shake(0.9);
    this.state = 'die';
    this.st = 0;
  }
}

// ----------------------------------------------------------------- defs tipos
export const ENEMY_DEFS = {
  drone: {
    kind: 'drone', hp: 62, score: 100, color: 0xff2d55,
    aimTime: 2.0, burst: 1, burstGap: 0.14, cool: 2.0,
    boltSpeed: 14, spread: 0.3, damage: 5, rise: 2.2, riseTime: 0.55,
    Class: Drone, turn: 5
  },
  hound: {
    kind: 'hound', hp: 105, score: 140, color: 0xff9f43,
    aimTime: 1.6, burst: 2, burstGap: 0.12, cool: 1.8,
    boltSpeed: 15, spread: 0.26, damage: 5, rise: 1.2, riseTime: 0.45,
    Class: Hound, turn: 7
  },
  sentry: {
    kind: 'sentry', hp: 155, score: 180, color: 0x49e6ff,
    aimTime: 1.6, burst: 3, burstGap: 0.15, cool: 1.7,
    boltSpeed: 16, spread: 0.24, damage: 6, rise: 1.6, riseTime: 0.6,
    Class: Sentry, turn: 3
  },
  wasp: {
    kind: 'wasp', hp: 34, score: 70, color: 0xff4fd8,
    aimTime: 0.75, burst: 2, burstGap: 0.1, cool: 1.5,
    boltSpeed: 20, spread: 0.34, damage: 3, air: true, rise: 3.2, riseTime: 0.5,
    Class: Wasp, turn: 9
  },
  crawler: {
    kind: 'crawler', hp: 30, score: 80, color: 0xff9f43,
    aimTime: 0, burst: 0, burstGap: 0, cool: 99,
    boltSpeed: 0, spread: 0, damage: 0, rise: 0.8, riseTime: 0.4,
    Class: Crawler, turn: 8
  },
  boss: {
    kind: 'boss', hp: 900, score: 1500, color: 0xff9f43, scale: 1.6,
    aimTime: 1.25, burst: 4, burstGap: 0.17, cool: 0.95,
    boltSpeed: 23, spread: 0.95, damage: 12, rise: 1.0, riseTime: 0.9,
    Class: Boss, turn: 3.2
  }
};

export function makeEnemy(world, node, kind, bossHp) {
  const base = ENEMY_DEFS[kind] || ENEMY_DEFS.drone;
  const def = Object.assign({}, base);
  if (kind === 'boss') {
    def.hp = bossHp || 900;
    def.score = 1500;
    def.onPhase = (boss, p) => {
      if (world.onBossPhase) world.onBossPhase(boss, p);
    };
  }
  return new def.Class(world, node, def);
}
