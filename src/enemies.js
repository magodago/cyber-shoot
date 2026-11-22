import * as THREE from 'three';
import { TEX } from './fx.js';

// ---------------------------------------------------------------------------
// ENEMIGOS: aparecen en puntos fijos (suelo, balcones, azoteas, aire),
// se quedan clavados en el sitio y disparan. Nunca avanzan al jugador.
// Tipos: dron, perro con ruedas, centinela y jefe titán.
// ---------------------------------------------------------------------------

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();

function stdMat(color, metal = 0.8, rough = 0.35) {
  // El metal puro sobre un entorno nocturno se lee como una silueta NEGRA:
  // sin luz directa no hay especular y el difuso de un metal es casi cero.
  // Dos blindajes: metalizado limitado + suelo de luminancia (ningún tono
  // puede quedar por debajo del 45 % de brillo) y emisivo del propio color
  // para que la silueta siga leyéndose a contraluz o en sombra.
  const c = new THREE.Color(color);
  const lum = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  if (lum < 0.42) c.offsetHSL(0, 0, 0.42 - lum);
  const m = new THREE.MeshStandardMaterial({
    color: c, metalness: Math.min(metal, 0.4), roughness: Math.max(rough, 0.45),
    envMapIntensity: 1.0
  });
  m.emissive = c.clone().multiplyScalar(0.34);
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
    const body = this._mat(stdMat(0xdfe7f0, 1.0, 0.2));
    const accent = neonMat(this.color);

    const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.34, 0), body);
    core.scale.set(1.1, 0.7, 1.35);
    this.group.add(core);
    this.addHit(hitbox(0.42, 1, this, 'body'));

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.022, 6, 24), accent);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.02;
    this.group.add(ring);

    this.rotors = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.028, 0.05), body);
      arm.position.set(Math.cos(a) * 0.28, 0.05, Math.sin(a) * 0.28);
      arm.rotation.y = -a;
      this.group.add(arm);

      const rotor = new THREE.Group();
      rotor.position.set(Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.008, 0.035), accent);
      rotor.add(blade);
      const blade2 = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.008, 0.34), accent);
      rotor.add(blade2);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 8), body);
      rotor.add(hub);
      this.group.add(rotor);
      this.rotors.push(rotor);
    }

    // ojo / cañón frontal
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 10), neonMat(0xff2d55));
    eye.position.set(0, -0.02, -0.42);
    this.group.add(eye);
    this.addHit(hitbox(0.2, 2.6, this, 'head'));

    const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.26, 8), body);
    gun.rotation.x = Math.PI / 2;
    gun.position.set(0, -0.16, -0.3);
    this.group.add(gun);

    const under = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.03, 0.1), accent);
    under.position.set(0, -0.28, -0.1);
    this.group.add(under);

    this.muzzle.position.set(0, -0.16, -0.45);
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
    // el perro tiene que leerse sobre el asfalto: chasis claro con brillo
    // metálico bajo (metalness alto sin envMap = negro) y emisivo propio
    const body = this._mat(stdMat(0xc3cddb, 0.28, 0.42));
    const dark = this._mat(stdMat(0x8d9aac, 0.32, 0.5));
    const accent = neonMat(this.color);

    // chasis bajo y alargado
    const chassis = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.52, 6, 12), body);
    chassis.rotation.z = Math.PI / 2;
    chassis.position.set(0, 0.34, 0.02);
    this.group.add(chassis);
    this.addHit(hitbox(0.42, 1, this, 'body'));

    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.26), dark);
    plate.position.set(0, 0.47, 0.02);
    this.group.add(plate);

    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.014, 0.02), accent);
    stripe.position.set(0, 0.52, 0.02);
    this.group.add(stripe);

    // franjas laterales y charco de luz: silueta visible a contraluz
    for (const s of [-1, 1]) {
      const flank = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.5), accent);
      flank.position.set(s * 0.175, 0.38, 0.02);
      this.group.add(flank);
    }
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 2.6),
      new THREE.MeshBasicMaterial({
        map: TEX.glow, color: this.color, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.03;
    this.group.add(pool);

    // cabeza baja, tipo depredador
    const head = new THREE.Group();
    head.position.set(0, 0.36, -0.46);
    const skull = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.19, 0.26), body);
    skull.position.z = -0.06;
    head.add(skull);
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.2), dark);
    snout.position.set(0, -0.04, -0.22);
    head.add(snout);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.035, 0.02), neonMat(0xff2d55));
    visor.position.set(0, 0.03, -0.2);
    head.add(visor);
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.16), dark);
    jaw.position.set(0, -0.09, -0.2);
    head.add(jaw);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.06), body);
      ear.position.set(s * 0.1, 0.13, -0.02);
      ear.rotation.z = s * -0.25;
      head.add(ear);
    }
    this.group.add(head);
    this.head = head;
    this.addHit(hitbox(0.19, 2.4, this, 'head'));

    // patas con ruedas
    this.wheels = [];
    const legPos = [[-0.24, -0.26], [0.24, -0.26], [-0.24, 0.3], [0.24, 0.3]];
    for (const [x, z] of legPos) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.05), dark);
      strut.position.set(x, 0.22, z);
      this.group.add(strut);
      const wheel = new THREE.Group();
      wheel.position.set(x, 0.13, z);
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.075, 14), dark);
      tyre.rotation.z = Math.PI / 2;
      wheel.add(tyre);
      const disc = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.014, 6, 14), accent);
      disc.rotation.y = Math.PI / 2;
      wheel.add(disc);
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 8), body);
      hub.rotation.z = Math.PI / 2;
      wheel.add(hub);
      this.group.add(wheel);
      this.wheels.push(wheel);
    }

    // cola antena
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.36, 6), dark);
    tail.position.set(0, 0.52, 0.4);
    tail.rotation.x = -0.7;
    this.group.add(tail);
    const tip = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    tip.position.set(0, 0.68, 0.55);
    tip.scale.setScalar(0.3);
    this.group.add(tip);

    this.muzzle.position.set(0, 0.34, -0.72);
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
    const body = this._mat(stdMat(0xffc24a, 1.0, 0.24));
    const dark = this._mat(stdMat(0xaab6c6, 0.95, 0.32));
    const accent = neonMat(this.color);

    for (const s of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.78, 0.15), dark);
      leg.position.set(s * 0.16, 0.39, 0);
      this.group.add(leg);
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.08, 0.3), body);
      boot.position.set(s * 0.16, 0.04, -0.04);
      this.group.add(boot);
    }

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.3), body);
    torso.position.set(0, 1.06, 0);
    this.group.add(torso);
    this.addHit(hitbox(0.46, 1, this, 'body', 1.05, 1.9));

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.06), accent);
    chest.position.set(0, 1.12, -0.17);
    this.group.add(chest);

    // hombreras
    for (const s of [-1, 1]) {
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.18, 0.34), dark);
      pad.position.set(s * 0.38, 1.3, 0);
      pad.rotation.z = s * 0.18;
      this.group.add(pad);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.13), body);
      arm.position.set(s * 0.4, 0.98, -0.06);
      arm.rotation.x = -0.35;
      this.group.add(arm);
    }

    // casco con visor
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.24, 0.26), body);
    head.position.set(0, 1.52, 0);
    this.group.add(head);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.03), neonMat(0xff2d55));
    visor.position.set(0, 1.54, -0.135);
    this.group.add(visor);
    this.addHit(hitbox(0.21, 3, this, 'head', 1.52));

    // fusil
    const gun = new THREE.Group();
    const gunBody = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.62), dark);
    gun.add(gunBody);
    const gunCore = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.035, 0.4), accent);
    gunCore.position.set(0, 0.06, -0.05);
    gun.add(gunCore);
    gun.position.set(0.18, 1.12, -0.3);
    this.group.add(gun);
    this.gun = gun;

    this.muzzle.position.set(0.18, 1.12, -0.68);
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

      mk(new THREE.BoxGeometry(0.78, 1.05, 0.86), dark, 0, 1.55, 0.05, 0, 0, 0, leg);
      mk(new THREE.BoxGeometry(0.92, 0.34, 1.0), hull, 0, 2.02, 0.02, 0.12, 0, 0, leg);
      mk(new THREE.BoxGeometry(0.68, 0.52, 0.76), hull, 0, 1.86, 0.16, -0.2, 0, 0, leg);
      mk(new THREE.CylinderGeometry(0.13, 0.13, 1.0, 8), steel, s * 0.42, 1.5, 0.42, 0.18, 0, 0, leg);
      mk(new THREE.SphereGeometry(0.3, 12, 10), plate, 0, 0.92, 0.02);
      mk(new THREE.ConeGeometry(0.16, 0.52, 5), steel, 0, 0.92, -0.36, -Math.PI / 2.2, 0, 0, leg);
      mk(new THREE.BoxGeometry(0.56, 1.0, 0.62), hull, 0, 0.45, 0.04, 0, 0, 0, leg);
      mk(new THREE.BoxGeometry(0.7, 0.3, 0.7), plate, 0, 0.2, -0.02, 0, 0, 0, leg);
      mk(new THREE.BoxGeometry(1.02, 0.3, 1.42), dark, 0, -0.28, -0.12, 0, 0, 0, leg);
      mk(new THREE.BoxGeometry(0.86, 0.16, 0.4), steel, 0, -0.4, -0.74, 0.12, 0, 0, leg);
      for (let i = -1; i <= 1; i++) {
        mk(new THREE.ConeGeometry(0.1, 0.44, 5), steel, i * 0.3, -0.44, -0.98, -Math.PI / 2, 0, 0, leg);
      }
      mk(new THREE.TorusGeometry(0.2, 0.05, 6, 14), trim, 0, 0.9, 0.3, 0, 0, 0, leg);
      mk(new THREE.BoxGeometry(0.07, 0.9, 0.07), accent, s * 0.37, 1.5, -0.36, 0, 0, 0, leg);
    }

    // ---------------------------------------------------------- cadera
    mk(new THREE.BoxGeometry(2.0, 0.62, 1.18), dark, 0, 2.4, 0);
    for (const s of [-1, 1]) {
      mk(new THREE.BoxGeometry(1.0, 0.78, 0.18), plate, s * 0.62, 2.02, -0.62, 0.3, 0, s * 0.06);
      mk(new THREE.BoxGeometry(0.86, 0.56, 0.16), hull, s * 1.04, 2.12, 0.56, -0.2, s * 0.42, 0);
    }
    mk(new THREE.BoxGeometry(0.42, 0.86, 0.16), trim, 0, 2.0, -0.66, 0.3, 0, 0);

    // ---------------------------------------------------------- torso
    this.bust = new THREE.Group();
    this.bust.position.set(0, 2.72, 0);
    this.group.add(this.bust);
    const bust = this.bust;

    mk(new THREE.BoxGeometry(2.5, 1.5, 1.4), hull, 0, 0.3, 0, 0.06, 0, 0, bust);
    mk(new THREE.BoxGeometry(2.16, 0.6, 1.18), dark, 0, 1.0, 0.18, -0.16, 0, 0, bust);
    mk(new THREE.BoxGeometry(1.36, 1.0, 0.3), plate, 0, 0.34, -0.72, 0.02, 0, 0, bust);
    for (const s of [-1, 1]) {
      mk(new THREE.BoxGeometry(0.56, 0.96, 0.26), dark, s * 0.96, 0.4, -0.6, 0, s * 0.28, 0, bust);
      for (let r = 0; r < 2; r++) {
        mk(new THREE.TorusGeometry(0.58 - r * 0.1, 0.05, 6, 16, Math.PI * 1.05), steel,
          s * 0.4, 0.52 - r * 0.36, -0.68, Math.PI / 2, 0, s * 0.55, bust);
      }
      mk(new THREE.BoxGeometry(0.1, 1.2, 0.1), cool, s * 1.17, 0.34, -0.5, 0, 0, 0, bust);
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
      mk(new THREE.BoxGeometry(0.09, 1.16, 0.09), steel, Math.cos(a) * 0.72, cy, -0.84 + Math.sin(a) * 0.28, 0, 0, 0, bust);
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
    mk(new THREE.BoxGeometry(0.88, 0.64, 0.88), hull, 0, 0, 0, 0, 0, 0, head);
    mk(new THREE.BoxGeometry(0.68, 0.44, 0.52), dark, 0, -0.08, -0.54, 0.12, 0, 0, head);
    mk(new THREE.BoxGeometry(0.62, 0.2, 0.18), steel, 0, 0.17, -0.52, 0, 0, 0, head);
    mk(new THREE.BoxGeometry(0.62, 0.22, 0.48), plate, 0, -0.3, -0.44, 0.1, 0, 0, head);
    for (let i = -3; i <= 3; i++) {
      mk(new THREE.ConeGeometry(0.045, 0.2, 4), steel, i * 0.085, -0.16, -0.64, Math.PI, 0, 0, head);
      mk(new THREE.ConeGeometry(0.04, 0.16, 4), steel, i * 0.085, -0.36, -0.62, 0, 0, 0, head);
    }
    for (const s of [-1, 1]) {
      mk(new THREE.BoxGeometry(0.24, 0.055, 0.07), accent, s * 0.2, 0.02, -0.46, 0, 0, s * 0.24, head);
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
      mk(new THREE.BoxGeometry(1.12, 0.42, 1.06), plate, s * 0.12, 0.26, 0, 0, 0, s * 0.16, sh);
      mk(new THREE.BoxGeometry(0.94, 0.34, 0.96), hull, s * 0.2, 0.56, 0.02, 0, 0, s * 0.26, sh);
      mk(new THREE.BoxGeometry(0.72, 0.28, 0.8), dark, s * 0.26, 0.84, 0.04, 0, 0, s * 0.34, sh);
      for (let i = -1; i <= 1; i++) {
        mk(new THREE.ConeGeometry(0.11, 0.56 + Math.abs(i) * 0.1, 5), steel,
          s * (0.34 + i * 0.24), 1.02 - Math.abs(i) * 0.1, 0.2, -0.32, 0, s * 0.5, sh);
      }
      const gun = new THREE.Group();
      gun.position.set(s * 0.08, 0.1, -0.6);
      sh.add(gun);
      mk(new THREE.BoxGeometry(0.64, 0.52, 0.52), dark, 0, 0, 0.14, 0, 0, 0, gun);
      for (let b = -1; b <= 1; b++) {
        mk(new THREE.CylinderGeometry(0.1, 0.12, 1.4, 8), steel, b * 0.21, 0, -0.66, Math.PI / 2, 0, 0, gun);
        const ring = mk(new THREE.TorusGeometry(0.13, 0.03, 6, 12), accent, b * 0.21, 0, -1.32, 0, 0, 0, gun);
        this.cannons.push(ring);
      }
      for (let f = 0; f < 4; f++) {
        mk(new THREE.BoxGeometry(0.04, 0.32, 0.52), steel, s * (0.32 + f * 0.06), 0.08, -0.26, 0, 0, 0, gun);
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
      mk(new THREE.BoxGeometry(0.6, 0.88, 0.64), dark, s * 0.06, -1.62, -0.04, 0.1, 0, 0, arm);
      mk(new THREE.BoxGeometry(0.52, 0.42, 0.68), hull, s * 0.1, -1.98, -0.08, 0.1, 0, 0, arm);
      for (let c = -1; c <= 1; c++) {
        mk(new THREE.ConeGeometry(0.09, 0.58, 5), steel, s * 0.1 + c * 0.17, -2.36, -0.2, -0.38, c * 0.2, 0, arm);
      }
      mk(new THREE.BoxGeometry(0.1, 0.72, 0.14), accent, s * 0.35, -1.58, 0.02, 0.1, 0, 0, arm);
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
      mk(new THREE.BoxGeometry(2.3, 0.07, 0.09), trim, 0, 3.72 + y, -1.14, 0, 0, 0);
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
    const body = this._mat(stdMat(0xffc24a, 1.0, 0.26));
    const dark = this._mat(stdMat(0xaab6c6, 0.9, 0.36));

    const thorax = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.26, 4, 8), body);
    thorax.rotation.x = Math.PI / 2;
    this.group.add(thorax);
    this.addHit(hitbox(0.32, 1.6, this, 'body'));

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), body);
    head.position.z = -0.2;
    this.group.add(head);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), neonMat(0xff2d55));
    eye.position.set(0, 0.02, -0.29);
    this.group.add(eye);

    // alas de energía translúcidas: se leen como enjambre, no como dron
    this.wings = [];
    for (const s of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.16), new THREE.MeshBasicMaterial({
        color: this.color, transparent: true, opacity: 0.16, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
      }));
      wing.position.set(s * 0.26, 0.08, 0.02);
      wing.rotation.z = s * -0.25;
      this.group.add(wing);
      this.wings.push(wing);
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 10), dark);
      rotor.position.set(s * 0.26, 0.1, 0.02);
      this.group.add(rotor);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.18, 0.02), dark);
      leg.position.set(s * 0.1, -0.14, 0.04);
      leg.rotation.z = s * 0.35;
      this.group.add(leg);
    }

    const sting = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.035, 0.2, 6), neonMat(this.color));
    sting.position.set(0, -0.03, 0.24);
    sting.rotation.x = Math.PI / 2;
    this.group.add(sting);
    const tail = new THREE.Sprite(new THREE.SpriteMaterial({
      map: TEX.glow, color: this.color, transparent: true, opacity: 0.8,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    tail.position.set(0, -0.02, 0.34);
    tail.scale.setScalar(0.26);
    this.group.add(tail);

    this.muzzle.position.set(0, 0, -0.3);
    this.charge.position.copy(this.muzzle.position);
    this.baseY = this.node.pos.y;
  }

  _idle(dt, t) {
    for (let i = 0; i < this.wings.length; i++) {
      this.wings[i].rotation.y = Math.sin(t * 42 + i * 1.7) * 0.5;
    }
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
    const body = this._mat(stdMat(0xdfe7f0, 1.0, 0.24));
    const dark = this._mat(stdMat(0xe0a233, 0.95, 0.34));
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
    this.addHit(hitbox(0.34, 1, this, 'body', 1.12, 1.9));

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
    this.addHit(hitbox(0.25, 2.6, this, 'head', 1.55));

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
    const body = this._mat(stdMat(0xe0a233, 1.0, 0.28));
    const dark = this._mat(stdMat(0xaab6c6, 0.9, 0.4));
    const accent = neonMat(this.color);

    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.26, 10, 8), body);
    shell.scale.set(1, 0.62, 1.15);
    shell.position.y = 0.26;
    this.group.add(shell);
    this.addHit(hitbox(0.34, 1.2, this, 'body'));

    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), neonMat(0xff9f43));
    this.core.position.set(0, 0.3, -0.06);
    this.group.add(this.core);
    const ringCore = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 14), accent);
    ringCore.rotation.x = Math.PI / 2;
    ringCore.position.set(0, 0.3, -0.06);
    this.group.add(ringCore);

    this.legs = [];
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const leg = new THREE.Group();
        const upper = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.3, 0.035), dark);
        upper.position.set(s * 0.2, 0.22, -0.18 + i * 0.18);
        upper.rotation.z = s * 0.8;
        leg.add(upper);
        const lower = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.24, 0.03), body);
        lower.position.set(s * 0.38, 0.1, -0.18 + i * 0.18);
        lower.rotation.z = s * -0.5;
        leg.add(lower);
        this.group.add(leg);
        this.legs.push(leg);
      }
    }

    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.28, 6), dark);
    spike.position.set(0, 0.44, 0.16);
    spike.rotation.x = 0.5;
    this.group.add(spike);

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
    kind: 'boss', hp: 900, score: 1500, color: 0xff9f43, scale: 3.1,
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
