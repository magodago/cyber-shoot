import * as THREE from 'three';
import { TEX } from './fx.js';
import { roundBox, detailSet, hose, vent, rivets, decal } from './detail.js';

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
function hitbox(r, mult, enemy, kind, y = 0, sy = 1) {
  const m = new THREE.Mesh(HIT_GEO, HIT_MAT);
  m.scale.set(r, r * sy, r);
  m.position.y = y;
  m.userData.enemy = enemy;
  m.userData.mult = mult;
  m.userData.part = kind;
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
    this.hitMeshes.push(mesh);
    // el hitbox debe colgar del grupo o su matrixWorld queda en el origen
    // y ningún disparo lejano impacta
    if (!mesh.parent) this.group.add(mesh);
    return mesh;
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
    const radial = Math.max(-2.4, Math.min(4.6, (dist - keep) * 1.15));
    const tang = 1.35 * this.orbitDir;
    const vx = nx * radial - nz * tang;
    const vz = nz * radial + nx * tang;
    g.x += vx * dt;
    g.z += vz * dt;
    g.x = Math.max(-13, Math.min(13, g.x));
    g.z = Math.max(p.z - 75, Math.min(p.z + 10, g.z));
    const targetY = Math.max(2.3, p.y + 0.6) + Math.sin(t * 1.9 + this.node.pos.x) * 0.28;
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
    this.addHit(hitbox(0.42, 1, this, 'body'));
    this.addHit(hitbox(0.2, 2.4, this, 'head'));

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

      add(RB(0.135, 0.3, 0.155, 0.03), dark, sd * 0.4, 1.29, 0);
      add(RB(0.055, 0.19, 0.17, 0.018), plate, sd * 0.472, 1.3, 0);
      add(new THREE.SphereGeometry(0.062, 8, 6), dark, sd * 0.4, 1.12, 0);
      add(RB(0.125, 0.29, 0.145, 0.03), armor, sd * 0.4, 0.97, -0.03, -0.24);
      add(RB(0.05, 0.21, 0.12, 0.014), plate, sd * 0.462, 0.99, -0.035, -0.24);
      add(new THREE.CylinderGeometry(0.045, 0.045, 0.07, 8), dark, sd * 0.4, 0.82, -0.085, -0.24);
    }

    // mano izquierda abierta (dedos sueltos, no un muñón)
    add(RB(0.11, 0.13, 0.07, 0.02), dark, -0.4, 0.75, -0.1, -0.24);
    for (let k = 0; k < 3; k++) {
      add(new THREE.BoxGeometry(0.022, 0.075, 0.03), plate, -0.437 + k * 0.026, 0.69, -0.135, -0.5);
    }
    add(new THREE.BoxGeometry(0.026, 0.06, 0.03), plate, -0.345, 0.72, -0.11, -0.6, 0.5);

    /* ------------------------------------------------------------------ casco */
    add(new THREE.CylinderGeometry(0.062, 0.075, 0.13, 10), dark, 0, 1.62, 0);
    add(RB(0.3, 0.26, 0.3, 0.06), armor, 0, 1.76, 0);
    add(RB(0.235, 0.11, 0.05, 0.018), dark, 0, 1.755, -0.155);
    const visor = add(RB(0.2, 0.045, 0.022, 0.01), lit, 0, 1.762, -0.178);
    const vglow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.55,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    vglow.scale.setScalar(0.42);
    vglow.position.set(0, 1.762, -0.19);
    this.group.add(vglow);
    // ceja, carrilleras y mandíbula
    add(RB(0.31, 0.06, 0.13, 0.022), plate, 0, 1.865, -0.11, 0.28);
    for (const sd of [-1, 1]) {
      add(RB(0.06, 0.17, 0.13, 0.02), plate, sd * 0.152, 1.72, -0.09);
      add(new THREE.CylinderGeometry(0.022, 0.022, 0.02, 8), plate, sd * 0.15, 1.78, -0.17, Math.PI / 2);
    }
    add(RB(0.2, 0.08, 0.21, 0.022), dark, 0, 1.64, -0.02);
    add(new THREE.CylinderGeometry(0.007, 0.007, 0.24, 4), plate, 0.105, 1.94, 0.03, 0.16);
    add(new THREE.SphereGeometry(0.012, 6, 4), lit, 0.115, 2.055, 0.05);
    this.head = new THREE.Group();
    this.head.position.set(0, 1.76, 0);
    this.group.add(this.head);

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
    if (this.gun) {
      const p = this.getPlayer();
      this.gun.lookAt(p.x, p.y + 0.1, p.z);
    }
  }
}

// ---------------------------------------------------------------------- jefe
// ---------------------------------------------------------------------- jefe
export class Boss extends Enemy {
  constructor(world, node, def) {
    super(world, node, def);
    this.phase = 1;
    this.summoned = [false, false];
  }

  _build() {
    // Paleta militar: acero gastado, latón sucio y brasas de reactor.
    // El blanco nuclear y el dorado brillante eran la razón de que pareciese
    // un juguete; ahora la silueta es la de una máquina de asedio.
    const hull = this._mat(stdMat(0x7b8899, 0.85, 0.44));
    const plate = this._mat(stdMat(0xb07a2c, 0.8, 0.4));
    const dark = this._mat(stdMat(0x59636f, 0.9, 0.5));
    const steel = this._mat(stdMat(0xaeb9c7, 0.8, 0.42));
    const accent = this._mat(new THREE.MeshBasicMaterial({ color: 0xff2d55, toneMapped: false }));
    const trim = this._mat(new THREE.MeshBasicMaterial({ color: 0xffa63d, toneMapped: false }));
    const cool = this._mat(new THREE.MeshBasicMaterial({ color: 0x49e6ff, toneMapped: false }));

    // cajas con canto biselado: el titán tenía aristas vivas de bloque de CAD
    const rbox = (w, h, d, r = 0.04) => roundBox(w, h, d, r);
    const mk = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = null) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      (parent || this.group).add(m);
      return m;
    };

    // ---------------------------------------------------------- piernas
    for (const s of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(s * 1.02, 0, 0);
      this.group.add(leg);

      mk(rbox(0.78, 1.05, 0.86), dark, 0, 1.55, 0.05, 0, 0, 0, leg);
      mk(rbox(0.92, 0.34, 1.0), hull, 0, 2.02, 0.02, 0.12, 0, 0, leg);
      mk(rbox(0.68, 0.52, 0.76), hull, 0, 1.86, 0.16, -0.2, 0, 0, leg);
      mk(new THREE.CylinderGeometry(0.13, 0.13, 1.0, 8), steel, s * 0.42, 1.5, 0.42, 0.18, 0, 0, leg);
      mk(new THREE.SphereGeometry(0.3, 12, 10), plate, 0, 0.92, 0.02);
      mk(new THREE.ConeGeometry(0.16, 0.52, 5), steel, 0, 0.92, -0.36, -Math.PI / 2.2, 0, 0, leg);
      mk(rbox(0.56, 1.0, 0.62), hull, 0, 0.45, 0.04, 0, 0, 0, leg);
      mk(rbox(0.7, 0.3, 0.7), plate, 0, 0.2, -0.02, 0, 0, 0, leg);
      mk(rbox(1.02, 0.3, 1.42), dark, 0, -0.28, -0.12, 0, 0, 0, leg);
      mk(rbox(0.86, 0.16, 0.4), steel, 0, -0.4, -0.74, 0.12, 0, 0, leg);
      for (let i = -1; i <= 1; i++) {
        mk(new THREE.ConeGeometry(0.1, 0.44, 5), steel, i * 0.3, -0.44, -0.98, -Math.PI / 2, 0, 0, leg);
      }
      mk(new THREE.TorusGeometry(0.2, 0.05, 6, 14), trim, 0, 0.9, 0.3, 0, 0, 0, leg);
      mk(rbox(0.07, 0.9, 0.07), accent, s * 0.37, 1.5, -0.36, 0, 0, 0, leg);
    }

    // ---------------------------------------------------------- cadera
    mk(rbox(2.0, 0.62, 1.18), dark, 0, 2.4, 0);
    for (const s of [-1, 1]) {
      mk(rbox(1.0, 0.78, 0.18), plate, s * 0.62, 2.02, -0.62, 0.3, 0, s * 0.06);
      mk(rbox(0.86, 0.56, 0.16), hull, s * 1.04, 2.12, 0.56, -0.2, s * 0.42, 0);
    }
    mk(rbox(0.42, 0.86, 0.16), trim, 0, 2.0, -0.66, 0.3, 0, 0);

    // ---------------------------------------------------------- torso
    this.bust = new THREE.Group();
    this.bust.position.set(0, 2.72, 0);
    this.group.add(this.bust);
    const bust = this.bust;

    mk(rbox(2.5, 1.5, 1.4), hull, 0, 0.3, 0, 0.06, 0, 0, bust);
    mk(rbox(2.16, 0.6, 1.18), dark, 0, 1.0, 0.18, -0.16, 0, 0, bust);
    mk(rbox(1.36, 1.0, 0.3), plate, 0, 0.34, -0.72, 0.02, 0, 0, bust);
    for (const s of [-1, 1]) {
      mk(rbox(0.56, 0.96, 0.26), dark, s * 0.96, 0.4, -0.6, 0, s * 0.28, 0, bust);
      for (let r = 0; r < 2; r++) {
        mk(new THREE.TorusGeometry(0.58 - r * 0.1, 0.05, 6, 16, Math.PI * 1.05), steel,
          s * 0.4, 0.52 - r * 0.36, -0.68, Math.PI / 2, 0, s * 0.55, bust);
      }
      mk(rbox(0.1, 1.2, 0.1), cool, s * 1.17, 0.34, -0.5, 0, 0, 0, bust);
      // omóplatos dentados
      mk(new THREE.ConeGeometry(0.16, 0.5, 5), plate, s * 0.8, 1.1, 0.55, Math.PI / 2.6, 0, s * 0.3, bust);
    }
    for (let i = 0; i < 5; i++) {
      mk(new THREE.ConeGeometry(0.16, 0.64 - i * 0.07, 5), i < 2 ? plate : steel,
        0, 0.66 + i * 0.32, 0.84 - i * 0.06, Math.PI / 2.5, 0, 0, bust);
    }

    // núcleo con jaula
    const cy = 0.42;
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 18), new THREE.MeshBasicMaterial({
      color: 0xff2d55, toneMapped: false
    }));
    this.core.position.set(0, cy, -0.8);
    bust.add(this.core);
    this._mat(this.core.material);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      mk(rbox(0.09, 1.16, 0.09), steel, Math.cos(a) * 0.72, cy, -0.84 + Math.sin(a) * 0.28, 0, 0, 0, bust);
    }
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xff2d55, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    this.halo.position.set(0, cy, -1.0);
    this.halo.scale.setScalar(3.4);
    bust.add(this.halo);
    this.coreLight = new THREE.PointLight(0xff2d55, 110, 26, 2);
    this.coreLight.position.set(0, cy, -1.6);
    bust.add(this.coreLight);

    // ---------------------------------------------------------- cabeza
    const head = new THREE.Group();
    head.position.set(0, 1.44, -0.1);
    bust.add(head);
    mk(rbox(0.88, 0.64, 0.88), hull, 0, 0, 0, 0, 0, 0, head);
    mk(rbox(0.68, 0.44, 0.52), dark, 0, -0.08, -0.54, 0.12, 0, 0, head);
    mk(rbox(0.62, 0.2, 0.18), steel, 0, 0.17, -0.52, 0, 0, 0, head);
    mk(rbox(0.62, 0.22, 0.48), plate, 0, -0.3, -0.44, 0.1, 0, 0, head);
    for (let i = -3; i <= 3; i++) {
      mk(new THREE.ConeGeometry(0.045, 0.2, 4), steel, i * 0.085, -0.16, -0.64, Math.PI, 0, 0, head);
      mk(new THREE.ConeGeometry(0.04, 0.16, 4), steel, i * 0.085, -0.36, -0.62, 0, 0, 0, head);
    }
    for (const s of [-1, 1]) {
      mk(rbox(0.24, 0.055, 0.07), accent, s * 0.2, 0.02, -0.46, 0, 0, s * 0.24, head);
      mk(new THREE.SphereGeometry(0.05, 8, 8), trim, s * 0.31, 0.2, -0.44, 0, 0, 0, head);
      let hx = s * 0.38, hy = 0.3, hz = 0.1, rx = -0.5;
      for (let i = 0; i < 3; i++) {
        mk(new THREE.ConeGeometry(0.14 - i * 0.032, 0.44, 6), i === 2 ? plate : steel,
          hx, hy, hz, rx, 0, s * 0.18, head);
        hy += 0.3; hz += 0.25; hx += s * 0.05; rx -= 0.24;
      }
      mk(new THREE.ConeGeometry(0.07, 0.34, 5), steel, s * 0.44, -0.1, 0.02, 0, 0, s * 1.05, head);
    }
    for (let i = 0; i < 3; i++) {
      mk(new THREE.ConeGeometry(0.1, 0.38, 4), dark, 0, 0.34, 0.24 + i * 0.16, -0.32, 0, 0, head);
    }
    this.addHit(hitbox(0.58, 1.8, this, 'head', 4.16, 1.0));
    this.bodyHit = this.addHit(hitbox(1.42, 1.0, this, 'body', 3.0, 1.25));
    this.coreHit = this.addHit(hitbox(0.52, 2.6, this, 'core', 3.14));

    // ---------------------------------------------------------- hombros y cañones
    this.cannons = [];
    for (const s of [-1, 1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 1.55, 0.94, 0.02);
      bust.add(sh);
      mk(new THREE.SphereGeometry(0.42, 14, 12), dark, 0, 0, 0, 0, 0, 0, sh);
      mk(rbox(1.12, 0.42, 1.06), plate, s * 0.12, 0.26, 0, 0, 0, s * 0.16, sh);
      mk(rbox(0.94, 0.34, 0.96), hull, s * 0.2, 0.56, 0.02, 0, 0, s * 0.26, sh);
      mk(rbox(0.72, 0.28, 0.8), dark, s * 0.26, 0.84, 0.04, 0, 0, s * 0.34, sh);
      for (let i = -1; i <= 1; i++) {
        mk(new THREE.ConeGeometry(0.11, 0.56 + Math.abs(i) * 0.1, 5), steel,
          s * (0.34 + i * 0.24), 1.02 - Math.abs(i) * 0.1, 0.2, -0.32, 0, s * 0.5, sh);
      }
      const gun = new THREE.Group();
      gun.position.set(s * 0.08, 0.1, -0.6);
      sh.add(gun);
      mk(rbox(0.64, 0.52, 0.52), dark, 0, 0, 0.14, 0, 0, 0, gun);
      for (let b = -1; b <= 1; b++) {
        mk(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 8), steel, b * 0.21, 0, -0.66, Math.PI / 2, 0, 0, gun);
        const ring = mk(new THREE.TorusGeometry(0.13, 0.03, 6, 12), accent, b * 0.21, 0, -1.32, 0, 0, 0, gun);
        this.cannons.push(ring);
      }
      for (let f = 0; f < 4; f++) {
        mk(rbox(0.04, 0.32, 0.52), steel, s * (0.32 + f * 0.06), 0.08, -0.26, 0, 0, 0, gun);
      }
    }

    // ---------------------------------------------------------- brazos con garras
    this.arms = [];
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 1.88, 0.7, 0.02);
      bust.add(arm);
      mk(new THREE.CylinderGeometry(0.26, 0.32, 1.05, 10), hull, 0, -0.55, 0, 0, 0, s * 0.08, arm);
      mk(new THREE.SphereGeometry(0.3, 12, 10), plate, 0, -1.12, 0.02, 0, 0, 0, arm);
      mk(rbox(0.6, 0.88, 0.64), dark, s * 0.06, -1.62, -0.04, 0.1, 0, 0, arm);
      mk(rbox(0.52, 0.42, 0.68), hull, s * 0.1, -1.98, -0.08, 0.1, 0, 0, arm);
      for (let c = -1; c <= 1; c++) {
        mk(new THREE.ConeGeometry(0.09, 0.58, 5), steel, s * 0.1 + c * 0.17, -2.36, -0.2, -0.38, c * 0.2, 0, arm);
      }
      mk(rbox(0.1, 0.72, 0.14), accent, s * 0.35, -1.58, 0.02, 0.1, 0, 0, arm);
      this.arms.push(arm);
    }

    // ---------------------------------------------------------- reactores
    this.flames = [];
    for (const s of [-1, 1]) {
      const st = new THREE.Group();
      st.position.set(s * 0.78, 0.86, 0.72);
      bust.add(st);
      for (let i = 0; i < 3; i++) {
        mk(new THREE.CylinderGeometry(0.16 - i * 0.02, 0.2, 0.62, 8), i === 1 ? plate : dark,
          0, 0.34 + i * 0.44, 0, 0.12, 0, 0, st);
        mk(new THREE.TorusGeometry(0.19, 0.03, 5, 12), cool, 0, 0.64 + i * 0.44, 0, Math.PI / 2, 0, 0, st);
      }
      const flame = new THREE.Sprite(new THREE.SpriteMaterial({
        map: TEX.glow, color: 0x49e6ff, transparent: true, opacity: 0.7,
        blending: THREE.AdditiveBlending, depthWrite: false
      }));
      flame.position.set(0, 1.75, 0.08);
      flame.scale.set(1.1, 2.3, 1);
      st.add(flame);
      this.flames.push(flame);
    }

    // ---------------------------------------------------------- esquirlas orbitales
    this.shards = [];
    for (let i = 0; i < 8; i++) {
      const sh = new THREE.Mesh(new THREE.TetrahedronGeometry(0.16), i % 2 ? trim : accent);
      bust.add(sh);
      this.shards.push(sh);
    }
    this.orbs = [];
    for (const r of [1.02, 1.28]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.022, 4, 40), r > 1.1 ? cool : accent);
      ring.position.set(0, 0.42, -0.82);
      bust.add(ring);
      this.orbs.push(ring);
    }

    // ---------------------------------------------------------- suelo
    this.hazard = new THREE.Mesh(
      new THREE.RingGeometry(1.75, 3.4, 48),
      new THREE.MeshBasicMaterial({
        color: 0xff2d55, transparent: true, opacity: 0.3,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false
      })
    );
    this.hazard.rotation.x = -Math.PI / 2;
    this.hazard.position.y = -0.52;
    this.group.add(this.hazard);

    this.muzzle.position.set(0, 3.2, -1.7);
    this.charge.position.copy(this.muzzle.position);
    this.charge.scale.setScalar(2);

    // luces de estudio: sin ellas el chasis se lee como una masa negra
    const key = new THREE.PointLight(0xffd2a8, 480, 50, 2);
    key.position.set(-3.6, 7.4, -7.0);
    this.group.add(key);
    const rim = new THREE.PointLight(0x49e6ff, 560, 56, 2);
    rim.position.set(4.0, 8.8, 5.8);
    this.group.add(rim);
    const under = new THREE.PointLight(0xff2d55, 220, 22, 2);
    under.position.set(0, 0.8, -2.5);
    this.group.add(under);
    this.keyLight = key;
    this.rimLight = rim;

    // franjas encendidas en las costillas: leen la silueta a 30 m
    for (const y of [0.06, 0.86]) {
      mk(rbox(2.3, 0.07, 0.09), trim, 0, 3.72 + y, -1.14, 0, 0, 0);
    }

    // apoyo en el suelo: la caja real del titán baja varios metros del origen, así
    // que sin este desplazamiento media máquina quedaba enterrada. Se mide en
    // espacio LOCAL de la pieza (la escala del grupo se aplica al usarlo) para
    // que siga siendo correcto si la escala se fija después de construir.
    this.group.updateMatrixWorld(true);
    {
      const inv = new THREE.Matrix4().copy(this.group.matrixWorld).invert();
      const m4 = new THREE.Matrix4();
      let minLocalY = Infinity;
      this.group.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const box = o.geometry.boundingBox.clone().applyMatrix4(m4.multiplyMatrices(inv, o.matrixWorld));
        if (box.min.y < minLocalY) minLocalY = box.min.y;
      });
      this.liftLocal = Number.isFinite(minLocalY) ? Math.max(0, -minLocalY + 0.02) : 0;
    }
  }

  _idle(dt, t) {
    this.group.position.y = this.node.pos.y + this._liftY() + Math.sin(t * 1.1) * 0.05;
    this.group.rotation.z = Math.sin(t * 0.7) * 0.008;
    const col = this.phase === 1 ? 0xff2d55 : this.phase === 2 ? 0xff9f43 : 0xffe066;
    // respiración del torso y vaivén de brazos: rompe la pose de estatua
    if (this.bust) {
      this.bust.position.y = 2.72 + Math.sin(t * 1.25) * 0.045;
      this.bust.rotation.x = Math.sin(t * 1.25 + 0.6) * 0.014;
    }
    if (this.arms) {
      for (let i = 0; i < this.arms.length; i++) {
        const s = i === 0 ? -1 : 1;
        this.arms[i].rotation.x = Math.sin(t * 0.9 + i * 1.7) * 0.09;
        this.arms[i].rotation.z = s * (0.06 + Math.sin(t * 0.7 + i) * 0.05);
      }
    }
    // esquirlas orbitando el reactor
    if (this.shards) {
      for (let i = 0; i < this.shards.length; i++) {
        const a = t * 1.15 + (i / this.shards.length) * Math.PI * 2;
        const r = 1.35 + Math.sin(t * 2 + i) * 0.12;
        this.shards[i].position.set(Math.cos(a) * r, 0.42 + Math.sin(a * 2 + i) * 0.5, -0.8 + Math.sin(a) * r * 0.45);
        this.shards[i].rotation.set(t * 1.7 + i, t * 1.2, 0);
        this.shards[i].material.color.setHex(col);
      }
    }
    if (this.orbs) {
      this.orbs[0].rotation.z += dt * (this.phase > 1 ? 2.4 : 1.2);
      this.orbs[1].rotation.z -= dt * (this.phase > 2 ? 3.1 : 1.7);
      this.orbs[0].material.color.setHex(col);
    }
    if (this.flames) {
      for (let i = 0; i < this.flames.length; i++) {
        const f = this.flames[i];
        const k = 0.85 + Math.sin(t * 9 + i * 2) * 0.15;
        f.scale.set(1.1 * k, 2.3 * k * (this.phase > 1 ? 1.25 : 1), 1);
        f.material.opacity = 0.55 + Math.sin(t * 11 + i) * 0.2;
      }
    }
    if (this.core) {
      const pulse = 0.86 + Math.sin(t * 4) * 0.14;
      this.core.scale.setScalar(pulse);
      this.core.material.color.setHex(col);
    }
    if (this.halo) {
      this.halo.scale.setScalar(2.9 + Math.sin(t * 3.2) * 0.5);
      this.halo.material.color.setHex(col);
    }
    if (this.coreLight) {
      this.coreLight.color.setHex(col);
      this.coreLight.intensity = (this.phase > 1 ? 85 : 62) + Math.sin(t * 3.2) * 24;
    }
    if (this.hazard) {
      this.hazard.material.opacity = 0.2 + Math.sin(t * 2.4) * 0.11;
      this.hazard.rotation.z += dt * 0.6;
    }
    for (let i = 0; i < this.cannons.length; i++) {
      this.cannons[i].rotation.z += dt * (this.phase > 1 ? 6 : 3);
    }
    // fases
    const frac = this.hp / this.maxHp;
    if (this.phase === 1 && frac <= 0.66) this._phase(2);
    if (this.phase === 2 && frac <= 0.33) this._phase(3);
  }

  _phase(p) {
    this.phase = p;
    this.aimTime = Math.max(0.7, this.aimTime * 0.85);
    this.burstCount = p === 2 ? 5 : 6;
    this.spreadNow = 1.5;
    if (this.world.fx) {
      const p3 = this.group.position.clone().add(new THREE.Vector3(0, 2.4, 0));
      this.world.fx.ring(p3, 0xff9f43, 4.5, 0.9);
      this.world.fx.spark(p3, 0xffe066, 30, 8, 0.9, 0.2);
    }
    if (this.world.audio && this.world.audio.explode) this.world.audio.explode();
    if (this.def.onPhase) this.def.onPhase(this, p);
  }

  // El titán no es una torreta: se desplaza, esquiva en línea y, desde la
  // fase 2, encadena anillos de proyectiles que obligan a moverse.
  _liftY() {
    return (this.liftLocal || 0) * (this.group.scale.y || 1);
  }

  _move(dt, t) {
    const nx = this.node.pos.x, nz = this.node.pos.z;
    if (this.dashT > 0) {
      this.dashT -= dt;
      const k = Math.min(1, 1 - Math.max(0, this.dashT) / this.dashDur);
      const e = k * k * (3 - 2 * k);
      this.group.position.x = this.dashFrom.x + (this.dashTo.x - this.dashFrom.x) * e;
      this.group.position.z = this.dashFrom.z + (this.dashTo.z - this.dashFrom.z) * e;
      return;
    }
    this.group.position.x = nx + Math.sin(t * 0.5 + this._sepSeed * 6) * 2.5;
    this.group.position.z = nz + Math.sin(t * 0.27 + 1.4) * 1.3;
    if (this.phase >= 2) {
      this.dashCd = (this.dashCd === undefined ? 5.5 : this.dashCd) - dt;
      if (this.dashCd <= 0) {
        this.dashCd = 4.2 + Math.random() * 2.6;
        this.dashDur = 0.42;
        this.dashT = 0.42;
        this.dashFrom = this.group.position.clone();
        this.dashTo = new THREE.Vector3(nx + (Math.random() < 0.5 ? -4.2 : 4.2), this.node.pos.y + this._liftY(), nz + (Math.random() - 0.5) * 2.4);
        if (this.world.fx) {
          const q = this.group.position.clone();
          q.y += 0.4;
          this.world.fx.ring(q, 0x49e6ff, 4.6, 0.6);
        }
      }
    }
  }

  _radial(dt) {
    if (this.phase < 2) return;
    this.radT = (this.radT === undefined ? 4.0 : this.radT) - dt;
    if (this.radT > 0) return;
    this.radT = this.phase >= 3 ? 3.4 : 5.2;
    const origin = this.muzzle.getWorldPosition(new THREE.Vector3());
    const p = this.getPlayer();
    const n = this.phase >= 3 ? 12 : 9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.age * 0.4;
      const target = new THREE.Vector3(
        p.x + Math.cos(a) * 2.2,
        p.y + 0.15 + Math.sin(a * 2) * 0.5,
        p.z + Math.sin(a) * 2.2
      );
      this.world.bolts.spawn(origin, target, this.def.boltSpeed * 1.2, 0xff2d55, this.def.damage);
    }
    if (this.world.fx) this.world.fx.ring(origin, 0xff2d55, 5.2, 0.55);
    if (this.world.audio && this.world.audio.shot) this.world.audio.shot();
  }

  // ráfaga en abanico desde los dos cañones
  _ai(dt, t) {
    this._move(dt, t);
    this._radial(dt);
    const aimT = this.aimTime;
    if (this.state === 'aim') {
      this.charge.material.opacity = Math.min(1, this.st / aimT) * 0.9;
      this.charge.scale.setScalar(1.2 + Math.min(1, this.st / aimT) * 1.4);
      if (this.st >= aimT) {
        this.state = 'fire';
        this.st = 0;
        this.burstLeft = this.burstCount || this.def.burst;
        this.burstT = 0;
      }
    } else if (this.state === 'fire') {
      this.charge.material.opacity = 0;
      this.burstT -= dt;
      if (this.burstT <= 0 && this.burstLeft > 0) {
        this.burstLeft--;
        this.burstT = this.def.burstGap;
        const base = this.getPlayer().clone();
        const spread = this.spreadNow || this.def.spread;
        for (let k = -1; k <= 1; k += 2) {
          const target = base.clone();
          target.x += k * spread * 0.9 + (Math.random() - 0.5) * spread;
          target.y += (Math.random() - 0.3) * spread * 0.5;
          target.z += (Math.random() - 0.5) * spread;
          const origin = this.muzzle.getWorldPosition(new THREE.Vector3());
          origin.x += k * 1.45;
          this.world.bolts.spawn(origin, target, this.def.boltSpeed, 0xff9f43, this.def.damage);
        }
        if (this.world.audio && this.world.audio.shot) this.world.audio.shot();
      }
      if (this.burstLeft <= 0) { this.state = 'cool'; this.st = 0; }
    } else if (this.state === 'cool') {
      if (this.st >= this.def.cool) { this.state = 'aim'; this.st = 0; }
    }
  }

  die() {
    if (this.dead) return;
    const p = this.group.position.clone().add(new THREE.Vector3(0, 2, 0));
    if (this.world.fx) {
      for (let i = 0; i < 6; i++) {
        const q = p.clone().add(new THREE.Vector3(
          (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 1.6));
        this.world.fx.spark(q, 0xffe066, 30, 9, 1.0, 0.22);
        this.world.fx.ring(q, 0xff9f43, 3.2, 0.8);
      }
    }
    super.die();
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
    const radial = Math.max(-1.6, Math.min(5.4, (dist - keep) * 1.8));
    const tang = 3.4 * this.orbitDir;
    g.x += (nx * radial - nz * tang) * dt;
    g.z += (nz * radial + nx * tang) * dt;
    g.x = Math.max(-13, Math.min(13, g.x));
    g.z = Math.max(p.z - 70, Math.min(p.z + 8, g.z));
    const targetY = 1.9 + Math.sin(t * 5.2 + this._sepSeed * 9) * 0.5;
    g.y += (targetY - g.y) * Math.min(1, dt * 3.4);
    this.baseY = g.y;
    this.group.rotation.z = Math.sin(t * 6 + this._sepSeed * 5) * 0.3;
    this.group.rotation.x = -0.12;
  }

  _recoil() {}
}

// ------------------------------------------------------------------ torreta de azotea
export class Turret extends Enemy {
  _build() {
    const body = this._mat(stdMat(0x94a0af, 0.95, 0.34));
    const dark = this._mat(stdMat(0x2b3138, 0.9, 0.52));
    const accent = neonMat(this.color);

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.22, 8), dark);
    base.position.y = 0.11;
    this.group.add(base);
    this.addHit(hitbox(0.5, 1, this, 'body', 0.35, 1.5));

    for (let i = 0; i < 3; i++) {
      const a = i / 3 * Math.PI * 2;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.62), body);
      arm.position.set(Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3);
      arm.rotation.y = -a;
      this.group.add(arm);
    }

    const column = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 0.5, 8), body);
    column.position.y = 0.47;
    this.group.add(column);

    this.head = new THREE.Group();
    this.head.position.y = 0.82;
    const casing = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.34, 0.44), body);
    this.head.add(casing);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.02), neonMat(0xff2d55));
    visor.position.set(0, 0.05, -0.23);
    this.head.add(visor);
    for (const s of [-1, 1]) {
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.62, 8), dark);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(s * 0.14, -0.04, -0.42);
      this.head.add(barrel);
      const ringBarrel = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), accent);
      ringBarrel.position.set(s * 0.14, -0.04, -0.64);
      this.head.add(ringBarrel);
    }
    this.group.add(this.head);
    this.addHit(hitbox(0.38, 2, this, 'head', 0.82));

    const ammo = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.3), dark);
    ammo.position.set(0.34, 0.42, 0.12);
    this.group.add(ammo);
    const ammoStripe = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.03), accent);
    ammoStripe.position.set(0.34, 0.42, -0.03);
    this.group.add(ammoStripe);

    this.muzzle.position.set(0, 0.78, -0.72);
    this.charge.position.copy(this.muzzle.position);
    this.baseY = this.node.pos.y;
  }

  _idle(dt, t) {
    // clavada en la azotea: solo barre el cañón
    this.head.rotation.y = Math.sin(t * 0.8 + this._sepSeed * 6) * 0.14;
    this.head.rotation.x = Math.sin(t * 0.5) * 0.03;
  }

  _recoil() {
    this.head.position.z = 0.06;
  }

  update(dt, t) {
    super.update(dt, t);
    if (this.head) this.head.position.z *= Math.max(0, 1 - dt * 7);
  }
}

// ------------------------------------------------------------------ francotirador de balcón
export class Sniper extends Enemy {
  _build() {
    // Contraste alto a propósito: es el enemigo más lejano del juego y se lee
    // contra fachada oscura. Cuerpo azul-gris claro + tiras de neón verticales.
    const body = this._mat(stdMat(0xffc24a, 1.0, 0.22));
    const dark = this._mat(stdMat(0xaab6c6, 0.95, 0.36));
    const accent = neonMat(this.color);

    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.86, 0.12), dark);
      leg.position.set(s * 0.12, 0.43, 0);
      this.group.add(leg);
      const knee = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.16, 0.16), body);
      knee.position.set(s * 0.12, 0.5, -0.03);
      this.group.add(knee);
    }
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.56, 0.26), body);
    torso.position.y = 1.14;
    torso.rotation.x = -0.06;
    this.group.add(torso);
    // dos tiras verticales de neón en el pecho: silueta legible a 30 m
    for (const s of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.4, 0.02), accent);
      strip.position.set(s * 0.1, 1.14, -0.14);
      this.group.add(strip);
    }
    this.addHit(hitbox(0.48, 1, this, 'body', 1.12, 1.9));

    const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.1, 0.2), dark);
    shoulders.position.y = 1.4;
    this.group.add(shoulders);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.22), body);
    head.position.set(0, 1.55, -0.04);
    this.group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.03, 0.02), neonMat(0xff2d55));
    visor.position.set(0, 1.56, -0.16);
    this.group.add(visor);

    // rifle largo, desproporcionado a propósito: se reconoce desde lejos
    const rifle = new THREE.Group();
    rifle.position.set(0.16, 1.32, -0.1);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.34), dark);
    stock.position.z = 0.1;
    rifle.add(stock);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.034, 1.15, 8), dark);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.z = -0.6;
    rifle.add(barrel);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8), accent);
    brake.rotation.x = Math.PI / 2;
    brake.position.z = -1.18;
    rifle.add(brake);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.26, 8), body);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.09, -0.2);
    rifle.add(scope);
    const lens = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), neonMat(0x49e6ff));
    lens.position.set(0, 0.09, -0.34);
    rifle.add(lens);
    this.group.add(rifle);
    this.addHit(hitbox(0.34, 2.6, this, 'head', 1.55));

    // Baliza: un punto rojo pulsante sobre la cabeza. De noche el francotirador
    // se perdía contra la fachada y el jugador no sabía de dónde le disparaban.
    this.beacon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: 0xff2d55, transparent: true,
      opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
    }));
    this.beacon.scale.set(1.1, 1.1, 1);
    this.beacon.position.set(0, 2.1, 0);
    this.group.add(this.beacon);

    this.muzzle.position.set(0.16, 1.32, -1.3);
    this.charge.position.copy(this.muzzle.position);
    this.baseY = this.node.pos.y;

    // láser de puntería: avisa antes del disparo (se puede ver y esquivar)
    this.beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 1, 5, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xff2d55, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    this.beam.visible = false;
    this.beam.frustumCulled = false;
    this.world.scene.add(this.beam);
  }

  _ai(dt, t) {
    if (this.beacon) {
      const k = 0.45 + 0.35 * (0.5 + 0.5 * Math.sin(t * 4.2));
      this.beacon.material.opacity = k;
      this.beacon.scale.setScalar(0.85 + 0.5 * k);
    }
    const on = (this.state === 'aim' || this.state === 'fire') && !this.dead && !this.removed;
    if (on) {
      const a = this.muzzle.getWorldPosition(new THREE.Vector3());
      const b = this.getPlayer();
      const d = a.distanceTo(b);
      this.beam.visible = true;
      this.beam.position.copy(a).add(b).multiplyScalar(0.5);
      this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.beam.scale.set(1, d, 1);
      const k = this.state === 'aim' ? Math.min(1, this.st / this.def.aimTime) : 1;
      this.beam.material.opacity = 0.1 + k * 0.55;
    } else {
      this.beam.visible = false;
    }
    super._ai(dt, t);
  }

  remove() {
    if (this.beam) {
      this.world.scene.remove(this.beam);
      this.beam.geometry.dispose();
      this.beam.material.dispose();
      this.beam = null;
    }
    super.remove();
  }
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
  turret: {
    kind: 'turret', hp: 190, score: 220, color: 0xff2d55,
    aimTime: 1.7, burst: 4, burstGap: 0.18, cool: 2.4,
    boltSpeed: 22, spread: 0.12, damage: 6, rise: 0.9, riseTime: 0.7,
    Class: Turret, turn: 1.4
  },
  sniper: {
    kind: 'sniper', hp: 90, score: 160, color: 0xff2d55,
    aimTime: 2.4, burst: 1, burstGap: 0.1, cool: 3.8,
    boltSpeed: 34, spread: 0.06, damage: 9, rise: 0.6, riseTime: 0.8,
    Class: Sniper, turn: 6
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
