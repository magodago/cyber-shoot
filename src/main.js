// CYBER SHOOT — shooter VR/escritorio estilo Pistol Whip en una plaza cyberpunk abierta.
// Enemigos estáticos que aparecen en suelo, balcones y azoteas; doble pistola; hordas
// aéreas y terrestres; jefes cada 3 niveles; tienda entre niveles que se dispara.

import * as THREE from 'three';
import { Arena, PALETTES } from './arena.js?v=19';
import { FX } from './fx.js?v=19';
import { GameAudio } from './audio.js?v=19';
import { WeaponSystem } from './weapon.js?v=21';
import { makeEnemy, BoltField } from './enemies.js?v=19';
import { Music } from './music.js?v=19';
import { createCover } from './cover.js?v=19';
import { createStory } from './story.js?v=19';
import { initAssets, skinWeapons } from './assets.js?v=3';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/* ------------------------------------------------------------------ estado */
const S = {
  mode: 'boot',          // boot | playing | shop | dead
  level: 1,
  score: 0,
  credits: 0,
  kills: 0,
  combo: 1,
  comboT: 0,
  health: 140,
  maxHealth: 200,
  waveIndex: 0,
  waveState: 'idle',
  waveT: 0,
  // Reloj propio del estado 'clear'. No depende de waveT, que puede venir
  // arrastrado del estado anterior: con esto la oleada no se puede colgar.
  clearT: 0,
  queue: [],
  spawnT: 0,
  boss: null,
  // El titán no se queda plantado: entra desde el fondo de la calle y la
  // distancia al jugador baja segundo a segundo. Si llega, se acabó.
  bossDist: 0,
  bossAddT: 0,
  shots: 0,
  hits: 0,
  up: { dmg: 0, mag: 0, rate: 0, reload: 0, hp: 0, pierce: 0, crit: 0, med: 0 }
};

const LEVELS = 6;   // 5 sectores de campaña + el del jefe titán

/* ------------------------------------------------------------------ escena */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
// La resolución nativa con bloom es el mayor coste fijo de fotograma (tirones en
// el visor y en portátiles sin GPU). Se arranca en 1.5 y el bucle baja o sube
// el escalón según el tiempo real de fotograma (ver autoQuality).
renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(0.55);   // mas nitidez en el centro del visor
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 400);
camera.position.set(0, 1.62, 0);
scene.add(camera);

// linterna del casco: lo que el jugador mira siempre recibe luz, así ningún
// enemigo puede quedar como una silueta negra contra el fondo
const helmetLight = new THREE.PointLight(0xd6e6ff, 34, 34, 2);
helmetLight.position.set(0, 0.1, 0);
camera.add(helmetLight);

/* entorno de reflejos: sin environment, el metal de los enemigos sale negro.
   Gradiente simple (cielo azul / suelo violeta) convertido a PMREM: los cuerpos
   oro y plata tienen algo que reflejar y se recortan contra el fondo. */
{
  const ecv = document.createElement('canvas');
  ecv.width = 64; ecv.height = 32;
  const ec = ecv.getContext('2d');
  const eg = ec.createLinearGradient(0, 0, 0, 32);
  eg.addColorStop(0.0, '#2c4f7c');
  eg.addColorStop(0.42, '#16263f');
  eg.addColorStop(0.52, '#3a1f46');
  eg.addColorStop(1.0, '#06070c');
  ec.fillStyle = eg;
  ec.fillRect(0, 0, 64, 32);
  const envTex = new THREE.CanvasTexture(ecv);
  envTex.mapping = THREE.EquirectangularReflectionMapping;
  envTex.colorSpace = THREE.SRGBColorSpace;
  const pm = new THREE.PMREMGenerator(renderer);
  pm.compileEquirectangularShader();
  scene.environment = pm.fromEquirectangular(envTex).texture;
  scene.environmentIntensity = 0.9;
  envTex.dispose();
  pm.dispose();
}

const rig = new THREE.Group();     // solo para giro de escritorio
rig.add(camera);
scene.add(rig);

const audio = new GameAudio();
const fx = new FX(scene);
const music = new Music(audio);
const arena = new Arena(scene);
// prototipo proto-assets: props escaneados + HDRI real (si falla, se juega igual).
// Guardamos la promesa: la primera oleada espera a que esté todo cargado, porque
// entrar a mitad de partida provocaba subidas de texturas y compilación de
// shaders (los "tirones de vez en cuando").
const assetsReady = initAssets({ renderer, scene, arena }).catch((e) => console.warn('[assets]', e));
const bolts = new BoltField(scene);

const enemies = [];
const PLAYER = new THREE.Vector3(0, 1.35, 0);

/* ------------------------------------------------------------------ armas */
const weapon = new WeaponSystem({
  scene, camera, audio, fx,
  hitTest, onShot, onHit, onDry
});
weapon.attachControllers(renderer);
// armas escaneadas CC0 sobre el viewmodel (kg-old: ?guns=gold devuelve el arma de oro)
skinWeapons(weapon).catch((e) => console.warn('[assets] armas', e));

/* ------------------------------------------------------------------ mundo (para enemigos) */
const world = {
  scene, fx, audio, bolts, level: 1,
  playerVel: new THREE.Vector3(),
  getPlayerPos: () => PLAYER.clone(),
  damagePlayer: (d) => damagePlayer(d),
  shake: (a) => shake(a),
  onHit(e, total, mult, point) {
    S.hits++;
    if (point) fx.spark(point, e.color || 0xff2d55, 4, 3.2, 0.3, 0.09);
    if (audio.impact) audio.impact();
  },
  onDeath(e) {
    addKill(e);
  },
  onBossPhase() {
    if (audio.explode) audio.explode();
    shake(0.5);
  }
};

/* ------------------------------------------------------------------ combate */
function addKill(e) {
  S.kills++;
  S.comboT = 2.6;
  S.combo = clamp(S.combo + 0.25, 1, 8);
  const pts = Math.round(e.scoreValue * S.combo * (e.isBoss ? 1.6 : 1));
  S.score += pts;
  S.credits += Math.round(e.scoreValue / 5);
  if (e.isBoss) {
    S.boss = null;
    S.bossDist = 0;
    music.setIntensity(1);
    if (audio.explode) audio.explode();
    shake(0.9);
    // La horda que lo escoltaba se viene abajo con él: el nivel puede cerrarse
    // y el jugador no se queda limpiando drones sueltos sin recompensa.
    for (const o of enemies) {
      if (o && !o.dead && o !== e) o.silentKill();
    }
    panel.flashMsg = 'TITÁN ABATIDO';
  } else if (audio.death) audio.death();
  fx.ring(e.group.position, e.color, 0.9, 0.45);
}

function damagePlayer(dmg) {
  if (S.mode !== 'playing') return;
  // i-frames: sin esto, un burst de 3-4 proyectiles se come la vida entera
  // en dos décimas de segundo y el jugador percibe el juego como injusto.
  const now = performance.now();
  if (now < (S.invulnUntil || 0)) return;
  S.invulnUntil = now + 700;
  // Antes el 0.62 dejaba cada impacto en 2-9 PV sobre 200 de vida: el jugador
  // aguantaba minutos sin sentir peligro. Ahora el golpe duele de verdad.
  S.health -= dmg * 2.4;
  S.combo = 1;
  if (audio.playerHit) audio.playerHit();
  shake(0.28);
  flashHit();
  if (S.health <= 0) {
    S.health = 0;
    gameOver();
  }
}

function silhouetteHits() {
  // Respaldo por silueta: el rayo contra las mallas visibles del enemigo. Una
  // caja elipsoide no cubre brazos, patas, alerones ni la cabeza del K-9, así
  // que apuntando al cuerpo el tiro no contaba. Aquí vale cualquier punto
  // dentro de lo que el jugador ve.
  const bodies = [];
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.dead || !e.bodyMeshes) continue;
    const list = e.bodyMeshes();
    for (let j = 0; j < list.length; j++) {
      if (list[j].visible !== false) bodies.push(list[j]);
    }
  }
  if (!bodies.length) return [];
  return ray.intersectObjects(bodies, false);
}

function hitTest(origin, dir, hand) {
  // tienda / fin: los disparos eligen tarjetas
  if (panel.active) {
    const hit = panel.raycast(origin, dir);
    return hit ? { point: hit.point, panel: hit } : null;
  }

  ray.set(origin, dir);
  ray.near = 0.25;
  ray.far = 120;

  const objs = [];
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.dead || !e.hitMeshes) continue;
    for (let j = 0; j < e.hitMeshes.length; j++) objs.push(e.hitMeshes[j]);
  }

  let hits = objs.length ? ray.intersectObjects(objs, false) : [];
  // 1) cajas de impacto: dan multiplicador por zona (cabeza x2.4)
  // 2) si ninguna caja se cruza, manda la silueta visible
  // 3) último recurso: manga ancha angular
  if (!hits.length) hits = silhouetteHits();
  hits = hits.filter((h) => h.object.userData.enemy && !h.object.userData.enemy.dead);
  if (!hits.length) return assistShot(origin, dir);

  const pierce = 1 + (weapon.upgrades.pierce || 0);
  const dmgBase = weapon.damage;
  let out = null;

  // Una misma silueta tiene varias cajas (cuerpo, cabeza) y la de la cabeza
  // queda dentro del volumen del torso: quedarse con el primer impacto hacía
  // que disparar a la cabeza nunca contara. Se elige la mejor caja de cada
  // enemigo (la de mayor multiplicador) y se ordena por distancia.
  const best = new Map();
  for (const h of hits) {
    const e = h.object.userData.enemy;
    if (!e || e.dead) continue;
    const cur = best.get(e);
    const mult = h.object.userData.mult || 1;
    if (!cur || mult > cur.mult || (mult === cur.mult && h.distance < cur.hit.distance)) {
      best.set(e, { hit: h, mult });
    }
  }
  const list = [...best.entries()].sort((a, b) => a[1].hit.distance - b[1].hit.distance).slice(0, pierce);

  for (const [e, { hit: h, mult: partMult }] of list) {
    const dist = h.distance;
    const falloff = dist < 14 ? 1.4 : dist < 26 ? 1.15 : 1;
    const crit = Math.random() < 0.08 + (weapon.upgrades.crit || 0) * 0.09;
    const dmg = dmgBase * falloff * (crit ? 2.1 : 1);
    e.hit(h.point, partMult, dmg);
    out = { point: h.point, enemy: e, crit, dmg };
  }
  return out;
}

function assistShot(origin, dir) {
  // Asistencia de puntería: engancha si el rayo pasa cerca del cuerpo.
  // El radio del volumen cuenta entero (un humanoide alto o un titán son mucho
  // más anchos que la esfera de su centro) y se suma holgura angular + fija.
  const ANG = 0.05;       // rad ≈ 2.9° de tolerancia angular
  const MAXOFF = 0.8;     // m de desvío máximo a cualquier distancia
  const SLACK = 0.22;     // m de holgura alrededor del volumen real
  const v = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let best = null;
  let bestScore = -Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.dead || !e.hitMeshes || !e.hitMeshes.length) continue;
    for (let j = 0; j < e.hitMeshes.length; j++) {
      const box = e.hitMeshes[j];
      box.getWorldPosition(v);
      box.getWorldScale(sc);
      const r = Math.max(sc.x, sc.y, sc.z);
      v.sub(origin);
      const t = v.dot(dir);
      if (t < 2.5 || t > 110) continue;
      const off = v.addScaledVector(dir, -t).length();
      const rad = r + Math.min(MAXOFF, t * ANG) + SLACK;
      if (off > rad) continue;
      // mejor centrado relativo al tamaño: un titán lejano no le roba el tiro
      // a un dron que está justo bajo la mira
      const score = (rad - off) / rad;
      if (score > bestScore) {
        bestScore = score;
        best = { e, t, mult: box.userData.mult || 1 };
      }
    }
  }
  if (!best) return null;
  const point = origin.clone().addScaledVector(dir, best.t);
  const falloff = best.t < 14 ? 1.4 : best.t < 26 ? 1.15 : 1;
  const dmg = weapon.damage * falloff;
  best.e.hit(point, best.mult, dmg);
  return { point, enemy: best.e, crit: best.mult > 1.6, dmg };
}

function onShot(hand, h, res) {
  S.shots++;
  if (res && res.panel) panel.fire(res.panel);
}

function onHit(res, hand, h) {
  if (!res) return;
  if (res.panel) return;
  if (res.crit) {
    fx.ring(res.point, 0xffe066, 0.5, 0.28);
    if (audio.parry) audio.parry();
  }
  if (res.enemy && res.enemy.dead) {
    fx.ring(res.point, res.enemy.color, 1.1, 0.4);
  }
}

function onDry(hand) {
  hudDry(hand);
}

/* ------------------------------------------------------------------ panel (tienda / fin) */
class Panel {
  constructor() {
    this.cv = document.createElement('canvas');
    this.cv.width = 1024; this.cv.height = 640;
    this.ctx = this.cv.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.cv);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.mat = new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, toneMapped: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.4375), this.mat);
    this.mesh.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.mesh);
    scene.add(this.group);
    this.active = false;
    this.mode = 'shop';
    this.rects = [];
    this.flash = 0;
    this.flashMsg = '';
    this.pulse = 0;
  }

  show(mode) {
    this.mode = mode;
    this.active = true;
    this.group.visible = true;
    this.mesh.visible = true;
    this.place();
    this.draw();
  }

  hide() {
    this.active = false;
    this.group.visible = false;
    this.mesh.visible = false;
  }

  place() {
    const p = camera.getWorldPosition(new THREE.Vector3());
    const q = camera.getWorldQuaternion(new THREE.Quaternion());
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y *= 0.35;
    fwd.normalize();
    this.group.position.copy(p).addScaledVector(fwd, 2.35);
    this.group.position.y -= 0.12;
    this.group.lookAt(p);
  }

  raycast(origin, dir) {
    ray.set(origin, dir);
    ray.near = 0.05; ray.far = 12;
    const h = ray.intersectObject(this.mesh, false)[0];
    if (!h || !h.uv) return null;
    const x = h.uv.x * 1024, y = (1 - h.uv.y) * 640;
    let target = null;
    for (const r of this.rects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) { target = r; break; }
    }
    return { point: h.point, target };
  }

  fire(hit) {
    const t = hit.target;
    if (!t) return;
    if (this.mode === 'shop') {
      if (t.kind === 'next') { closeShop(); return; }
      if (t.kind === 'med') buyMed();
      else if (t.kind === 'card') buy(t.index);
    } else if (this.mode === 'dead' || this.mode === 'win') {
      if (t.kind === 'next') restartRun();
      else if (t.kind === 'home') backToHome();
    }
    this.draw();
  }

  draw() {
    const c = this.ctx;
    this.rects = [];
    c.clearRect(0, 0, 1024, 640);

    // fondo
    roundRect(c, 8, 8, 1008, 624, 26);
    c.fillStyle = 'rgba(6,10,22,0.92)';
    c.fill();
    c.strokeStyle = 'rgba(73,230,255,0.85)';
    c.lineWidth = 4;
    c.stroke();

    if (this.mode === 'shop') this.drawShop(c);
    else if (this.mode === 'win') this.drawWin(c);
    else this.drawDead(c);

    if (this.flash > 0) {
      c.fillStyle = 'rgba(255,45,85,' + (0.1 * this.flash).toFixed(3) + ')';
      c.fillRect(8, 8, 1008, 624);
    }
    if (this.flashMsg) {
      c.font = '700 34px Inter, system-ui, sans-serif';
      c.fillStyle = '#ff4d6d';
      c.textAlign = 'center';
      c.fillText(this.flashMsg, 512, 620);
    }
    this.tex.needsUpdate = true;
  }

  drawShop(c) {
    c.textAlign = 'left';
    c.font = '800 46px Inter, system-ui, sans-serif';
    c.fillStyle = '#ffffff';
    c.fillText('NIVEL ' + S.level + ' SUPERADO', 46, 76);
    c.font = '600 26px Inter, system-ui, sans-serif';
    c.fillStyle = '#49e6ff';
    c.fillText('CRÉDITOS ' + S.credits, 46, 118);

    c.textAlign = 'right';
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '500 22px Inter, system-ui, sans-serif';
    c.fillText('dispara a una mejora', 978, 112);

    const cols = 3, cw = 296, ch = 128, x0 = 46, y0 = 150, gap = 16;
    SHOP.forEach((u, i) => {
      const cx = x0 + (i % cols) * (cw + gap);
      const cy = y0 + Math.floor(i / cols) * (ch + gap);
      const lvl = S.up[u.key] || 0;
      const max = u.max || 4;
      const cost = costOf(u, lvl);
      const afford = S.credits >= cost && lvl < max;

      roundRect(c, cx, cy, cw, ch, 14);
      c.fillStyle = lvl >= max ? 'rgba(255,255,255,0.05)' : afford ? 'rgba(73,230,255,0.12)' : 'rgba(255,45,85,0.08)';
      c.fill();
      c.strokeStyle = lvl >= max ? 'rgba(255,255,255,0.18)' : afford ? 'rgba(73,230,255,0.8)' : 'rgba(255,45,85,0.5)';
      c.lineWidth = 2.5;
      c.stroke();

      c.textAlign = 'left';
      c.fillStyle = '#ffffff';
      c.font = '800 25px Inter, system-ui, sans-serif';
      c.fillText(u.name, cx + 18, cy + 38);

      c.fillStyle = 'rgba(255,255,255,0.62)';
      c.font = '500 19px Inter, system-ui, sans-serif';
      c.fillText(u.desc, cx + 18, cy + 68);

      // nivel en pips
      for (let k = 0; k < max; k++) {
        c.beginPath();
        c.arc(cx + 24 + k * 22, cy + 96, 6, 0, Math.PI * 2);
        c.fillStyle = k < lvl ? '#49e6ff' : 'rgba(255,255,255,0.16)';
        c.fill();
      }

      c.textAlign = 'right';
      c.font = '800 26px Inter, system-ui, sans-serif';
      c.fillStyle = lvl >= max ? 'rgba(255,255,255,0.4)' : afford ? '#ffe066' : '#ff4d6d';
      c.fillText(lvl >= max ? 'MÁX' : cost + ' cr', cx + cw - 18, cy + 102);

      this.rects.push({ kind: 'card', index: i, x: cx, y: cy, w: cw, h: ch });
    });

    // siguiente
    // kit médico: barra propia encima de SIGUIENTE, no una séptima tarjeta
    const mcost = medCost();
    const mfull = S.health >= S.maxHealth;
    const mok = !mfull && S.credits >= mcost;
    roundRect(c, 46, 430, 932, 52, 14);
    c.fillStyle = mfull ? 'rgba(255,255,255,0.05)' : mok ? 'rgba(92,255,157,0.14)' : 'rgba(255,45,85,0.08)';
    c.fill();
    c.strokeStyle = mfull ? 'rgba(255,255,255,0.18)' : mok ? 'rgba(92,255,157,0.85)' : 'rgba(255,45,85,0.55)';
    c.lineWidth = 2.5;
    c.stroke();
    c.textAlign = 'left';
    c.fillStyle = '#ffffff';
    c.font = '800 25px Inter, system-ui, sans-serif';
    c.fillText('KIT MÉDICO  +' + MEDKIT.heal + ' PV', 66, 464);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '500 19px Inter, system-ui, sans-serif';
    c.fillText('VIDA ' + Math.max(0, Math.round(S.health)) + '/' + Math.round(S.maxHealth), 336, 463);
    c.textAlign = 'right';
    c.font = '800 25px Inter, system-ui, sans-serif';
    c.fillStyle = mfull ? 'rgba(255,255,255,0.4)' : mok ? '#5cff9d' : '#ff4d6d';
    c.fillText(mfull ? 'VIDA AL MÁXIMO' : mcost + ' cr', 958, 464);
    this.rects.push({ kind: 'med', x: 46, y: 430, w: 932, h: 52 });

    roundRect(c, 46, 492, 932, 108, 18);
    c.fillStyle = 'rgba(255,79,216,0.16)';
    c.fill();
    c.strokeStyle = 'rgba(255,79,216,0.9)';
    c.lineWidth = 3;
    c.stroke();
    c.textAlign = 'center';
    c.fillStyle = '#ffffff';
    c.font = '800 40px Inter, system-ui, sans-serif';
    c.fillText(S.level >= LEVELS ? 'ÚLTIMO NIVEL — VER RESULTADO' : 'SIGUIENTE NIVEL', 512, 552);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '500 19px Inter, system-ui, sans-serif';
    c.fillText('dispara aquí cuando estés listo', 512, 582);
    this.rects.push({ kind: 'next', x: 46, y: 492, w: 932, h: 108 });
  }

  drawWin(c) {
    c.textAlign = 'center';
    c.fillStyle = '#5cff9d';
    c.font = '900 70px Inter, system-ui, sans-serif';
    c.fillText('MISIÓN CUMPLIDA', 512, 148);
    c.fillStyle = '#49e6ff';
    c.font = '600 22px Inter, system-ui, sans-serif';
    c.fillText('CIUDAD LIBERADA · ' + LEVELS + ' NIVELES', 512, 190);
    c.fillStyle = '#ffffff';
    c.font = '900 62px Inter, system-ui, sans-serif';
    c.fillText(S.score.toLocaleString('es-ES'), 512, 268);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '600 18px Inter, system-ui, sans-serif';
    c.fillText('PUNTUACIÓN FINAL', 512, 296);
    c.fillStyle = 'rgba(255,255,255,0.72)';
    c.font = '500 26px Inter, system-ui, sans-serif';
    c.fillText(S.kills + ' bajas · ' + Math.round(100 * S.hits / Math.max(1, S.shots)) + '% precisión · ' + S.credits + ' créditos sin gastar', 512, 340);

    roundRect(c, 150, 380, 420, 110, 18);
    c.fillStyle = 'rgba(92,255,157,0.16)';
    c.fill();
    c.strokeStyle = 'rgba(92,255,157,0.9)';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '800 32px Inter, system-ui, sans-serif';
    c.fillText('VOLVER A JUGAR', 360, 448);
    this.rects.push({ kind: 'next', x: 150, y: 380, w: 420, h: 110 });

    roundRect(c, 600, 380, 274, 110, 18);
    c.fillStyle = 'rgba(73,230,255,0.10)';
    c.fill();
    c.strokeStyle = 'rgba(73,230,255,0.75)';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '800 30px Inter, system-ui, sans-serif';
    c.fillText('INICIO', 737, 448);
    this.rects.push({ kind: 'home', x: 600, y: 380, w: 274, h: 110 });

    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.font = '500 18px Inter, system-ui, sans-serif';
    c.fillText('dispara al botón', 512, 528);
  }

  drawDead(c) {
    c.textAlign = 'center';
    c.fillStyle = '#ff4d6d';
    c.font = '900 74px Inter, system-ui, sans-serif';
    c.fillText('SISTEMA CAÍDO', 512, 150);
    c.fillStyle = '#ffffff';
    c.font = '800 44px Inter, system-ui, sans-serif';
    c.fillText(S.score.toLocaleString('es-ES') + ' PTS', 512, 230);
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.font = '500 26px Inter, system-ui, sans-serif';
    c.fillText('nivel ' + S.level + ' · ' + S.kills + ' bajas · ' + Math.round(100 * S.hits / Math.max(1, S.shots)) + '% precisión', 512, 280);

    // Un solo botón, grande y centrado: vuelve a la portada, donde está el
    // botón de jugar. Antes había REINICIAR + INICIO y el inicio se quedaba
    // sin forma de empezar (sobre todo dentro del visor, sin DOM).
    roundRect(c, 216, 330, 592, 128, 20);
    c.fillStyle = 'rgba(73,230,255,0.16)';
    c.fill();
    c.strokeStyle = 'rgba(73,230,255,0.9)';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '800 44px Inter, system-ui, sans-serif';
    c.fillText('INICIO', 512, 408);
    this.rects.push({ kind: 'home', x: 216, y: 330, w: 592, h: 128 });

    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.font = '500 18px Inter, system-ui, sans-serif';
    c.fillText('dispara para volver a la portada', 512, 494);
  }
}

const SHOP = [
  { key: 'dmg', name: 'NÚCLEO PLASMA', desc: '+9 daño por bala', base: 220, max: 5 },
  { key: 'mag', name: 'CARGADOR', desc: '+4 balas por pistola', base: 190, max: 5 },
  { key: 'rate', name: 'SOBRECARGA', desc: 'más cadencia', base: 240, max: 5 },
  { key: 'reload', name: 'MANOS RÁPIDAS', desc: 'recarga más rápida', base: 170, max: 4 },
  { key: 'hp', name: 'BLINDAJE', desc: '+25 vida máxima', base: 210, max: 4 },
  { key: 'pierce', name: 'PERFORANTE', desc: 'atraviesa +1 enemigo', base: 320, max: 2 }
];

function costOf(u, lvl) { return Math.round(u.base * (1 + lvl * 0.75) / 10) * 10; }

// Kit médico: vida al instante en la tienda, con coste creciente. El blindaje
// sube la vida máxima pero no cura; sin esto, llegar tocado al sector 4 era
// una sentencia y no había nada que comprar para arreglarlo.
const MEDKIT = { heal: 70, base: 110, step: 45 };
function medCost() { return MEDKIT.base + (S.up.med || 0) * MEDKIT.step; }

function buyMed() {
  if (S.health >= S.maxHealth) { panel.flashMsg = 'VIDA AL MÁXIMO'; return; }
  const cost = medCost();
  if (S.credits < cost) {
    panel.flashMsg = 'FALTAN ' + (cost - S.credits) + ' CRÉDITOS';
    if (audio.dry) audio.dry();
    return;
  }
  S.credits -= cost;
  S.up.med = (S.up.med || 0) + 1;
  S.health = Math.min(S.maxHealth, S.health + MEDKIT.heal);
  panel.flashMsg = '';
  if (audio.parry) audio.parry();
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

const panel = new Panel();
const ray = new THREE.Raycaster();

function buy(i) {
  const u = SHOP[i];
  const lvl = S.up[u.key] || 0;
  const cost = costOf(u, lvl);
  if (lvl >= (u.max || 4)) { panel.flashMsg = 'MEJORA AL MÁXIMO'; return; }
  if (S.credits < cost) { panel.flashMsg = 'FALTAN ' + (cost - S.credits) + ' CRÉDITOS'; if (audio.dry) audio.dry(); return; }
  S.credits -= cost;
  S.up[u.key] = lvl + 1;
  applyUpgrades();
  panel.flashMsg = '';
  if (audio.parry) audio.parry();
}

function applyUpgrades() {
  const u = S.up;
  weapon.setUpgrades({ dmg: u.dmg, mag: u.mag, rate: u.rate, reload: u.reload, pierce: u.pierce, crit: u.crit });
  const prevMax = S.maxHealth;
  S.maxHealth = 200 + u.hp * 25;
  if (S.maxHealth > prevMax) S.health = Math.min(S.maxHealth, S.health + (S.maxHealth - prevMax));
  weapon.hands.L.ammo = weapon.magSize;
  weapon.hands.R.ammo = weapon.magSize;
}

/* ------------------------------------------------------------------ niveles */
let waves = [];

function pickKind(level) {
  const r = Math.random();
  if (level <= 1) return r < 0.45 ? 'drone' : r < 0.85 ? 'hound' : 'crawler';
  if (level <= 2) {
    return r < 0.30 ? 'drone' : r < 0.55 ? 'hound' : r < 0.70 ? 'crawler'
      : r < 0.88 ? 'wasp' : 'turret';
  }
  if (level <= 4) {
    return r < 0.22 ? 'drone' : r < 0.40 ? 'hound' : r < 0.52 ? 'wasp'
      : r < 0.64 ? 'crawler' : r < 0.78 ? 'sentry' : r < 0.90 ? 'turret' : 'sniper';
  }
  return r < 0.18 ? 'drone' : r < 0.33 ? 'hound' : r < 0.47 ? 'wasp'
    : r < 0.58 ? 'crawler' : r < 0.72 ? 'sentry' : r < 0.86 ? 'turret' : 'sniper';
}

function buildLevel(level) {
  // Campaña: 5 sectores normales y el sexto con el jefe titán.
  const bossLevel = level >= LEVELS;
  waves = [];

  // NIVEL DEL TITÁN: una sola oleada y el titán el primero de la cola.
  // Antes el jefe salía en la tercera oleada, después de ~25 enemigos: parecía
  // que el nivel no arrancaba y que el titán no existía.
  if (bossLevel) {
    waves.push({ list: ['turret', 'sniper', 'drone', 'wasp', 'hound'], boss: true });
    return;
  }

  const n = 3;
  for (let w = 0; w < n; w++) {
    // la curva se aplana desde el sector 3: más robots, pero sin avalancha
    const lv = level <= 2 ? level : 2 + (level - 2) * 0.55;
    const count = Math.round(5 + lv * 1.1 + w * 1.2);
    const list = [];
    for (let i = 0; i < count; i++) list.push(pickKind(level));
    // variedad forzada: siempre algo aéreo y algo de azotea, francotirador desde el 2
    if (!list.some(k => k === 'drone' || k === 'wasp')) list.push('wasp');
    if (!list.some(k => k === 'turret')) list.push('turret');
    // balcones: uno garantizado por oleada desde el sector 2 y dos desde el 4
    if (level >= 2) list.push('sniper');
    if (level >= 4) list.push('sniper');
    waves.push({ list, boss: false });
  }
}

function levelIntro(level) {
  if (level >= LEVELS) {
    return [{ tag: 'SECTOR 6 · TITÁN', title: 'ALGO ENORME RESPIRA',
      text: 'La puerta se abre sola. Tres pisos de metal, dos brazos como vigas y un cañón girando hacia ti. No hay cobertura: solo tú, el titán y lo que te quede en los cargadores.' }];
  }
  return null;
}

function startLevel(level) {
  S.level = level;
  world.level = level;
  arena.setPalette(PALETTES[(level - 1) % PALETTES.length]);

  clearEnemies();
  bolts.clear();
  buildLevel(level);

  S.waveIndex = 0;
  S.waveState = 'idle';
  S.waveT = 1.6;
  S.clearT = 0;
  S.queue = [];
  S.boss = null;
  S.bossDist = 0;
  S.bossAddT = 2.5;
  S.combo = 1;
  S.comboT = 0;
  S.mode = 'playing';
  S.health = Math.min(S.health || S.maxHealth, S.maxHealth);
  if (S.health <= 0) S.health = S.maxHealth;
  // entre niveles el operador respira: recupera un tercio de la vida máxima
  if (level > 1) S.health = Math.min(S.maxHealth, S.health + S.maxHealth * 0.34);

  applyUpgrades();
  weapon.enabled = true;
  panel.hide();
  music.setIntensity(1);
  updateHud(true);
  hideOverlay();

  // OJO: aquí había un renderer.compile(scene, camera) "para precalentar". Era
  // justo la causa del tirón: compile() compila TODOS los programas del sector de
  // golpe y de forma SÍNCRONA (37 programas, ~370 ms en el PC y varios segundos en
  // Quest), en el peor momento posible. Los programas que de verdad se usan se
  // compilan solos al primer dibujado, repartidos entre fotogramas.
}

function clearEnemies() {
  for (const e of enemies) {
    if (e.group) scene.remove(e.group);
    e.dead = true; e.removed = true;
  }
  enemies.length = 0;
}

const NODE_KIND = {
  drone: 'air', wasp: 'air',
  hound: 'ground', crawler: 'ground', sentry: 'ground',
  turret: 'roof', sniper: 'ledge', boss: 'ground'
};

// el jugador nunca se para: si un enemigo se queda atrás, vuelve a salir delante
function recycleBehind() {
  for (const e of enemies) {
    if (e.dead || e.isBoss || e.state === 'spawn') continue;
    if (e.group.position.z <= PLAYER.z + 3.0) continue;
    const kinds = NODE_KIND[e.kind] || 'ground';
    const taken = enemies.filter(x => !x.dead && x !== e).map(x => x.group.position);
    let node = arena.pickNodeAhead(Math.random, kinds, taken, 4.0, 13, 38, PLAYER);
    // si no hay balcón que se vea, el francotirador baja a la calle: mejor
    // visible que escondido bloqueando la oleada
    if (!node && kinds === 'ledge') {
      node = arena.pickNodeAhead(Math.random, 'ground', taken, 3.0, 12, 26, PLAYER);
    }
    if (!node) continue;
    e.node = node;
    e.group.position.copy(node.pos);
    e.state = 'spawn';
    e.st = 0;
    e.burstLeft = 0;
    e.burstT = 0;
    e.aimTime = e.def.aimTime;
    if (e.baseY !== undefined) e.baseY = node.pos.y;
  }
}

function spawnOne(kind) {
  const kinds = NODE_KIND[kind] || 'ground';
  const taken = enemies.filter(e => !e.dead).map(e => e.group.position);
  // delante del jugador (la calle se recicla por delante). Si el hueco está
  // lleno, reintenta con menos separación antes de descartar el enemigo:
  // así las oleadas grandes no se quedan a medias.
  let node = null;
  if (kind === 'boss') {
    // El titán entra desde el fondo de la calle: aparece pequeño, se le ve
    // crecer y viene hacia ti. Tú decides si llegas a matarlo antes.
    node = arena.pickNodeAhead(Math.random, 'ground', taken, 4.0, 20, 27, PLAYER);
    if (!node) node = { pos: new THREE.Vector3(0, 0, 0), kind: 'ground' };
    // la Arena guarda su propia z y va desfasada: se ancla a la del jugador
    node.pos.x = Math.max(-3.5, Math.min(3.5, node.pos.x * 0.25));
    node.pos.y = 0;
    S.bossDist = BOSS_START;
    node.pos.z = PLAYER.z - S.bossDist;
  }
  if (!node) {
    for (const gap of [3.2, 2.4, 1.6]) {
      node = arena.pickNodeAhead(Math.random, kinds, taken, gap, 10, 34, PLAYER);
      if (node) break;
    }
  }
  if (!node && kinds === 'ledge') {
    node = arena.pickNodeAhead(Math.random, 'ground', taken, 2.6, 10, 26, PLAYER);
  }
  if (!node) return false;
  // el titán aguanta una campaña entera de plomo: ~30 s de fuego perfecto
  const bossHp = kind === 'boss' ? Math.round(3800 + S.level * 320) : undefined;
  const e = makeEnemy(world, node, kind, bossHp);
  e.isBoss = kind === 'boss';
  enemies.push(e);
  if (e.isBoss) {
    S.boss = e; music.setIntensity(2); shake(0.5);
    // entrada del titán: ondas de choque y chispas para que se note a 20 m
    const p = node.pos.clone(); p.y = 0.15;
    if (world.fx) {
      world.fx.ring(p, 0xff9f43, 9, 1.2);
      world.fx.ring(p, 0xff2d55, 5.5, 0.9);
      world.fx.spark(p, 0xff9f43, 46, 11, 1.2, 0.32);
    }
    if (audio.explode) audio.explode();
  }
  return true;
}

function startWave(i) {
  const w = waves[i];
  if (!w) return;
  S.waveState = 'spawn';
  S.spawnT = 0.2;
  S.queue = w.list.slice();
  if (w.boss) S.queue.unshift('boss');
  if (audio.waveStart) audio.waveStart();
  updateHud(true);
}

// El titán no se queda plantado: entra desde el fondo y avanza solo. La
// distancia baja con el reloj y él se recoloca frente al jugador, así que la
// única salida es matarlo antes de que te ponga la mano encima.
const BOSS_START = 26, BOSS_NEAR = 3.4;

function updateBossApproach(dt) {
  const b = S.boss;
  if (!b || b.dead || S.mode !== 'playing') return;
  if (b.state === 'spawn') return;            // aún saliendo de la calzada
  // Cada fase que pierde lo hace enfadar: aprieta el paso. A 0,40 u/s cruza
  // la calle en algo menos de un minuto: hay que hacer daño de verdad, no
  // pasarse el cargador contra la coraza.
  const speed = 0.40 + Math.max(0, (b.phase || 1) - 1) * 0.12;
  S.bossDist = Math.max(BOSS_NEAR, S.bossDist - dt * speed);
  b.node.pos.z = PLAYER.z - S.bossDist;
  if (S.bossDist <= BOSS_NEAR) gameOver('EL TITÁN TE ALCANZÓ');
}

function updateWaves(dt) {
  if (S.mode !== 'playing') return;

  updateBossApproach(dt);

  // Mientras el titán viva, la calle escupe refuerzos: no puedes dedicarte solo
  // a él. Con tope de vivos para que la pelea siga siendo ganable.
  if (S.boss && !S.boss.dead) {
    S.bossAddT -= dt;
    if (S.bossAddT <= 0) {
      S.bossAddT = rand(3.6, 6.2);
      if (aliveCount() < 8) spawnOne(pickKind(S.level));
    }
  }

  if (S.waveState === 'idle') {
    S.waveT -= dt;
    if (S.waveT <= 0) {
      if (S.waveIndex < waves.length) startWave(S.waveIndex);
      else levelComplete();
    }
    return;
  }

  if (S.waveState === 'spawn') {
    S.spawnT -= dt;
    if (S.spawnT <= 0 && S.queue.length) {
      const kind = S.queue.shift();
      if (spawnOne(kind)) S.spawnFails = 0;
      else {
        // sin hueco libre: reintenta, pero no dejes la oleada colgada
        S.spawnFails = (S.spawnFails || 0) + 1;
        if (S.spawnFails > 12) {
          S.spawnFails = 0;
          // el titán nunca se cae de la cola: si no hay hueco, se fuerza
          S.queue = kind === 'boss' ? ['boss'] : [];
        }
        else S.queue.push(kind);
      }
      S.spawnT = rand(0.30, 0.55);
    }
    if (!S.queue.length) { S.waveState = 'clear'; S.clearT = 0; }
    return;
  }

  if (S.waveState === 'clear') {
    S.waveT -= dt;
    S.clearT += dt;
    // Si queda un enemigo fuera de la vista (balcón alto, detrás de una
    // fachada, fuera del cono), el jugador no puede rematarlo y la oleada se
    // queda colgada. Primero lo devolvemos a la calle, a la vista; después se
    // retira de la escena sin ruido.
    if (S.clearT > 2 && aliveCount() > 0) rescueStuckEnemies();
    if (S.clearT > 6 && aliveCount() > 0) {
      for (const e of enemies) {
        // el titán no se retira nunca: si vive, la oleada no está limpia
        if (e && !e.dead && !e.isBoss) e.silentKill();
      }
    }
    // Avance garantizado: la oleada cierra cuando no queda nadie a quien
    // matar, o a los 9 s pase lo que pase (salvo que el titán siga vivo).
    // El reloj es clearT, no waveT: waveT puede venir arrastrado y dejar la
    // oleada esperando para siempre, que era el fallo del nivel 1.
    const bossAlive = !!(S.boss && !S.boss.dead);
    if (!bossAlive && (aliveCount() === 0 || S.clearT > 9)) {
      if (aliveCount() > 0) {
        for (const e of enemies) if (e && !e.dead && !e.isBoss) e.silentKill();
      }
      S.waveIndex++;
      S.waveState = 'idle';
      S.waveT = 1.2;
      S.clearT = 0;
      music.setIntensity(S.level % 3 === 0 ? 1.6 : 1);
      updateHud(true);
    }
  }
}

function rescueStuckEnemies() {
  const taken = enemies.filter(e => e && !e.dead).map(e => e.group.position);
  for (const e of enemies) {
    if (!e || e.dead || e.isBoss) continue;
    const p = e.group.position;
    const dz = (arena.playerZ || 0) - p.z;
    const visible = dz > -2 && dz < 30 && Math.abs(Math.atan2(p.x, dz)) < 0.8;
    if (visible) continue;
    const node = arena.pickNodeAhead(Math.random, 'ground', taken, 3.0, 9, 17, PLAYER);
    if (!node) continue;
    e.node = node;
    p.set(node.pos.x, node.pos.y, node.pos.z);
    if (e.baseY !== undefined) e.baseY = node.pos.y;
    e.state = 'spawn';
    e.st = 0;
    e.invulnT = 0.2;
    if (world.fx) world.fx.ring(node.pos.clone().setY(node.pos.y + 0.3), 0x49e6ff, 1.4, 0.4);
  }
}

function aliveCount() {
  let n = 0;
  for (const e of enemies) if (e && !e.dead) n++;
  return n;
}

function levelComplete() {
  if (S.mode !== 'playing') return;
  S.mode = 'story';
  weapon.enabled = false;
  bolts.clear();
  music.setIntensity(0.7);
  S.score += 250 * S.level;
  S.credits += 120;
  panel.flashMsg = '';
  updateHud(true);
  playStory(STORY_OUT[S.level] || [], openShop);
}

function openShop() {
  if (S.mode !== 'story' && S.mode !== 'playing') return;
  S.mode = 'shop';
  weapon.enabled = true;
  panel.show('shop');
  updateHud(true);
}

function closeShop() {
  if (S.mode !== 'shop') return;
  panel.hide();
  if (S.level >= LEVELS) {
    playStory(STORY_FINALE, victory);
    return;
  }
  const next = S.level + 1;
  const intro = levelIntro(next);
  startLevel(next);
  // el sector del titán se presenta con su propia viñeta; al cerrarla hay que
  // devolver el control (con done=null el modo se quedaba en 'story' y el
  // titán no llegaba a salir nunca)
  if (intro) {
    playStory(intro, () => {
      S.mode = 'playing';
      weapon.enabled = true;
      updateHud(true);
    });
  }
}

function victory() {
  S.mode = 'dead';
  bolts.clear();
  music.setIntensity(0.45);
  panel.mode = 'win';
  panel.show('win');
  showOverlay(
    'MISIÓN CUMPLIDA',
    S.score.toLocaleString('es-ES') + ' puntos · ' + S.kills + ' bajas · ' + Math.round(100 * S.hits / Math.max(1, S.shots)) + '% precisión',
    'VOLVER A JUGAR',
    () => startCampaign(),
    '',
    'VOLVER AL INICIO',
    () => backToHome()
  );
}

function gameOver(why) {
  if (S.mode === 'dead') return;
  S.mode = 'dead';
  bolts.clear();
  music.setIntensity(0.4);
  if (audio.explode) audio.explode();
  shake(1);
  panel.flashMsg = '';
  panel.mode = 'dead';
  panel.show('dead');
  // Un único botón: a la portada, que ya tiene su JUGAR (también dentro del visor).
  showOverlay(
    'SISTEMA CAÍDO',
    (why ? why + ' · ' : '') + 'Puntuación ' + S.score.toLocaleString('es-ES'),
    'INICIO',
    () => backToHome(),
    '',
    '',
    null
  );
}

function resetRun() {
  S.score = 0; S.credits = 0; S.kills = 0; S.shots = 0; S.hits = 0;
  S.combo = 1; S.comboT = 0;
  S.up = { dmg: 0, mag: 0, rate: 0, reload: 0, hp: 0, pierce: 0, crit: 0, med: 0 };
  S.maxHealth = 200; S.health = 200;
  S.level = 1;
  panel.hide();
}

function restartRun() {
  resetRun();
  cover.show(false);
  startLevel(1);
}

// Volver a la portada: se vacía la calle, se apaga el arma y vuelve el título
// 3D con su único botón de jugar. Sirve desde el overlay (escritorio) y desde
// el botón INICIO del panel del visor.
function backToHome() {
  for (const e of enemies) { if (e) { e.dead = true; if (e.group) e.group.visible = false; } }
  enemies.length = 0;
  bolts.clear();
  panel.hide();
  hideOverlay();
  resetRun();
  // la calle vuelve al principio: sin esto la portada se veía desde el fondo
  travel = 0; strafe = 0; strafeV = 0;
  weapon.enabled = false;
  S.mode = 'cover';
  cover.show(true);
  showCover();
  if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
}

/* ------------------------------------------------------------------ bucle */
const clock = new THREE.Clock();
let t = 0;
let hudT = 0;
let travel = 0;              // metros recorridos por la calle
let strafe = 0, strafeV = 0; // desplazamiento lateral (esquivar)
const prevPlayer = new THREE.Vector3();

/* --- mandos Quest 3: stick izquierdo esquiva, stick derecho giro por pasos --- */
const vrIn = { strafe: null, snapCd: 0, snapAt: 0 };
function readVRInput(dt) {
  vrIn.strafe = null;
  if (!renderer.xr.isPresenting) return;
  const ses = renderer.xr.getSession();
  if (!ses) return;
  let lx = null, rx = null;
  for (const src of ses.inputSources) {
    const gp = src.gamepad;
    if (!gp || !gp.axes || gp.axes.length < 4) continue;
    const ax = gp.axes[2] || 0;
    if (src.handedness === 'left') lx = ax;
    else if (src.handedness === 'right') rx = ax;
    else if (lx === null) lx = ax;
  }
  const stick = lx !== null ? lx : rx;            // sin mando izq. uso el que haya
  if (stick !== null && Math.abs(stick) > 0.18) vrIn.strafe = -stick * 5.6;
  // giro por pasos de 30º con el stick derecho, con tope para no girar sin querer
  if (rx !== null && Math.abs(rx) > 0.7) {
    if (t - vrIn.snapAt > 0.4) {
      yaw -= Math.sign(rx) * Math.PI / 6;
      vrIn.snapAt = t;
    }
  }
}


let frameErrShown = false;
function frame(time, xrFrame) {
  // Red de seguridad: un fallo en un fotograma (un enemigo raro, una malla sin
  // datos) mataba el bucle y dejaba el visor congelado con el escenario montado
  // y las armas inertes. Ahora se registra y el juego sigue vivo.
  try {
    frameBody(time, xrFrame);
  } catch (err) {
    if (!frameErrShown) {
      frameErrShown = true;
      console.error('[cyber-shoot] error en el bucle:', err);
    }
    S.mode = 'playing';
    weapon.enabled = true;
  }
}

function frameBody(time, xrFrame) {
  const dt = Math.min(0.05, clock.getDelta());
  autoQuality(dt);
  stepPrewarm();
  t += dt;
  S.frames = (S.frames | 0) + 1;   // latido: sirve para saber si el bucle vive

  // Autocuración del modo: si quedó en 'story' sin historia en pantalla, estaba
  // congelado (armas sin disparar). Vuelve a jugar.
  if (S.mode === 'story' && !story.playing) { S.mode = 'playing'; weapon.enabled = true; }

  // avance continuo: el jugador va calle adelante y los enemigos salen delante
  if (S.mode === 'playing') {
    const spd = 3.2 * (S.boss ? 0.45 : 1) * (S.waveState === 'clear' ? 0.7 : 1);
    travel += spd * dt;
  }
  // esquiva lateral real: A/D o flechas (o stick izquierdo del mando en VR)
  readVRInput(dt);
  const kbWant = ((input.left ? -1 : 0) + (input.right ? 1 : 0)) * 5.6;
  const want = vrIn.strafe !== null ? vrIn.strafe : kbWant;
  if (renderer.xr.isPresenting) rig.rotation.y = yaw;
  strafeV += (want - strafeV) * Math.min(1, dt * 10);
  strafe = clamp(strafe + strafeV * dt, -7.6, 7.6);
  if (S.mode !== 'playing') strafeV *= Math.max(0, 1 - dt * 6);
  rig.position.x = strafe * Math.cos(yaw);
  rig.position.z = -travel - strafe * Math.sin(yaw);
  camera.getWorldPosition(PLAYER);
  PLAYER.y = 1.35;
  world.playerVel.copy(PLAYER).sub(prevPlayer).divideScalar(Math.max(0.001, dt));
  prevPlayer.copy(PLAYER);
  // la plaza viaja con el jugador; pilares y arcos se reciclan en z
  arena.setPlayerZ(-travel, travel);

  arena.update(dt, t);
  fx.update(dt);
  // Disparo en ráfaga: mientras se mantiene pulsado se dispara solo; la
  // cadencia real la marca weapon.fireDelay (ametralladora ligera).
  if (S.mode === 'playing') {
    if (held.L) weapon.fire('L');
    if (held.R) weapon.fire('R');
  }
  weapon.update(dt, xrFrame);
  music.update();

  if (S.mode === 'playing') {
    updateWaves(dt);
    recycleBehind();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e) continue;
      try {
        e.update(dt, t);
      } catch (err) {
        // un enemigo con un fallo no puede tirar el fotograma entero: sin
        // render, la imagen se queda clavada y parece que el juego se colgó.
        if (!e.__err) { e.__err = true; console.error('[cyber-shoot] enemigo retirado por error:', err); }
        e.removed = true;
      }
      if (e.removed) enemies.splice(i, 1);
    }
    bolts.update(dt, PLAYER, (b) => damagePlayer(b.dmg || 12));

    if (S.comboT > 0) {
      S.comboT -= dt;
      if (S.comboT <= 0) S.combo = 1;
    }
    // regeneración: lenta entre oleadas y, sobre todo, si llevas 3 s sin
    // recibir un disparo. Sin esto, un nivel se vuelve imposible de remontar.
    if (S.health < S.maxHealth) {
      const calm = performance.now() - (S.invulnUntil || 0) > 4500;
      if (calm) S.health = Math.min(S.maxHealth, S.health + dt * (S.waveState === 'clear' ? 6 : 2.2));
    }
  } else if (S.mode === 'shop') {
    // en la tienda los enemigos no existen y el arma está al máximo
    weapon.hands.L.ammo = weapon.magSize;
    weapon.hands.R.ammo = weapon.magSize;
    bolts.update(dt, PLAYER, null);
    if (S.mode === 'shop' && panel.active) panel.place();
  }

  if (panel.active && panel.flash > 0) {
    panel.flash = Math.max(0, panel.flash - dt * 2);
    if (panel.flash === 0) panel.draw();
  }

  cover.update(dt);
  story.update(dt);

  hudT -= dt;
  if (hudT <= 0) { hudT = 0.1; updateHud(); }

  // la viñeta roja de daño se apaga sola (en el visor no hay DOM que lo haga)
  if (hitFlash.mat.opacity > 0) {
    hitFlash.mat.opacity = Math.max(0, hitFlash.mat.opacity - dt * 1.9);
    if (hitFlash.mat.opacity === 0) hitFlash.sp.visible = false;
  }

  if (!renderer.xr.isPresenting) {
    applyShake(dt);
    composer.render();
  } else {
    shakeAmp = 0;
    renderer.render(scene, camera);
  }
}

/* ------------------------------------------------------------------ sacudida */
let shakeAmp = 0;
function shake(a) { shakeAmp = Math.max(shakeAmp, a); }
function applyShake(dt) {
  if (shakeAmp <= 0) return;
  shakeAmp = Math.max(0, shakeAmp - dt * 2.2);
  camera.position.x = rand(-1, 1) * shakeAmp * 0.035;
  camera.position.y = 1.62 + rand(-1, 1) * shakeAmp * 0.03;
}

/* ------------------------------------------------------------------ HUD DOM */
function updateHud(force) {
  const hp = clamp(S.health / S.maxHealth, 0, 1);
  const hf = $('#hp-fill');
  if (hf) {
    hf.style.width = (hp * 100).toFixed(1) + '%';
    hf.style.background = hp > 0.5 ? 'linear-gradient(90deg,#49e6ff,#5cff9d)' : hp > 0.25 ? 'linear-gradient(90deg,#ff9f43,#ffe066)' : 'linear-gradient(90deg,#ff2d55,#ff4d6d)';
  }
  const hn = $('#hp-num');
  if (hn) hn.textContent = Math.ceil(S.health);

  setAmmo('#ammoL', '#magL', weapon.hands.L);
  setAmmo('#ammoR', '#magR', weapon.hands.R);

  const sc = $('#score'); if (sc) sc.textContent = S.score.toLocaleString('es-ES');
  const cr = $('#credits'); if (cr) cr.textContent = S.credits + ' cr';
  const lv = $('#lvl'); if (lv) lv.textContent = 'NIVEL ' + S.level;
  const wv = $('#wave');
  if (wv) wv.textContent = S.mode === 'playing' ? ('OLEADA ' + Math.min(S.waveIndex + 1, waves.length) + '/' + waves.length) : (S.mode === 'shop' ? 'TIENDA' : '');
  const cb = $('#combo');
  if (cb) {
    cb.textContent = S.combo > 1.05 ? 'x' + S.combo.toFixed(2) : '';
    cb.style.opacity = S.combo > 1.05 ? '1' : '0';
  }

  const bb = $('#bossbar');
  if (bb) {
    if (S.boss && !S.boss.dead) {
      bb.style.opacity = '1';
      const f = $('#boss-fill');
      if (f) f.style.width = clamp(S.boss.hp / S.boss.maxHp, 0, 1) * 100 + '%';
      const bt = $('#boss-t');
      if (bt) {
        const b = S.boss;
        if (b.invulnT > 0) {
          bt.textContent = 'CORAZA REARMÁNDOSE — NO ENTRA DAÑO';
          bt.style.color = '#49e6ff';
        } else if (b.coreOpen) {
          bt.textContent = 'NÚCLEO EXPUESTO — DISPARA AHÍ';
          bt.style.color = '#ffe066';
        } else {
          bt.textContent = 'CORAZA ACTIVA — BUSCA EL NÚCLEO CUANDO RECARGUE';
          bt.style.color = '';
        }
      }
    } else bb.style.opacity = '0';
  }

  updateWorldHud();
}

function setAmmo(sel, magSel, h) {
  const el = $(sel);
  if (el) el.textContent = h.reloading ? '···' : h.ammo;
  const m = $(magSel);
  if (m) m.style.width = (100 * (h.ammo / weapon.magSize)).toFixed(0) + '%';
}

function hudDry(hand) {
  const el = hand === 'L' ? $('#ammoL') : $('#ammoR');
  if (el) { el.classList.add('dry'); setTimeout(() => el.classList.remove('dry'), 160); }
}

function flashHit() {
  const f = $('#hitflash');
  if (f) {
    f.style.opacity = '0.85';
    setTimeout(() => { f.style.opacity = '0'; }, 90);
  }
  // en el visor el DOM no se ve: el "te han dado" va en 3D
  if (hitFlash) {
    hitFlash.sp.visible = true;
    hitFlash.mat.opacity = 0.95;
  }
  updateWorldHud();
}

/* ------------------------------------------------------------------ HUD mundo (VR) */
const worldHud = (() => {
  const cv = document.createElement('canvas');
  cv.width = 640; cv.height = 200;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0.94 });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.64, 0.20, 1);
  sp.position.set(0, -0.30, -0.95);
  sp.renderOrder = 990;
  sp.visible = false;
  camera.add(sp);
  return { cv, ctx, tex, sp, mat };
})();

// aviso de "te están dando": viñeta roja pegada a la vista, solo en el visor
const hitFlash = (() => {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 256;
  const c = cv.getContext('2d');
  const g = c.createRadialGradient(128, 128, 52, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,0,60,0)');
  g.addColorStop(0.55, 'rgba(255,0,60,0.14)');
  g.addColorStop(0.82, 'rgba(255,0,60,0.55)');
  g.addColorStop(1, 'rgba(255,0,60,0.95)');
  c.fillStyle = g;
  c.fillRect(0, 0, 256, 256);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, opacity: 0 });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(1.85, 1.85, 1);
  sp.position.set(0, 0, -1.25);
  sp.renderOrder = 995;
  sp.visible = false;
  camera.add(sp);
  return { cv, tex, sp, mat };
})();

function updateWorldHud() {
  if (!renderer.xr.isPresenting) return;
  const { ctx: c, cv, tex, sp } = worldHud;
  if (!sp.visible) sp.visible = true;
  c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = 'rgba(4,8,18,0.62)';
  roundRect(c, 4, 4, cv.width - 8, cv.height - 8, 22); c.fill();
  c.strokeStyle = 'rgba(73,230,255,0.55)'; c.lineWidth = 3; c.stroke();

  /* --- vidas: barra + número grande, con etiqueta --- */
  const hp = clamp(S.health / S.maxHealth, 0, 1);
  const hpCol = hp > 0.5 ? '#49e6ff' : hp > 0.25 ? '#ff9f43' : '#ff2d55';
  c.textAlign = 'left';
  c.font = '700 24px Inter, system-ui, sans-serif';
  c.fillStyle = hpCol;
  c.fillText('VIDAS', 26, 56);
  c.fillStyle = 'rgba(255,255,255,0.14)';
  c.fillRect(116, 30, 300, 32);
  c.fillStyle = hpCol;
  c.fillRect(116, 30, 300 * hp, 32);
  c.font = '800 40px Inter, system-ui, sans-serif';
  c.fillStyle = '#ffffff';
  c.fillText(String(Math.ceil(S.health)), 432, 62);
  const hw = c.measureText(String(Math.ceil(S.health))).width;
  c.font = '700 22px Inter, system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fillText('/ ' + S.maxHealth, 432 + hw + 6, 60);

  /* --- créditos · nivel/oleada · puntos --- */
  c.textAlign = 'left';
  c.font = '700 24px Inter, system-ui, sans-serif';
  c.fillStyle = '#ffd166';
  c.fillText(S.credits + ' cr', 26, 112);
  c.textAlign = 'center';
  c.font = '700 22px Inter, system-ui, sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.82)';
  c.fillText('NIVEL ' + S.level + ' · OLEADA ' + Math.min(S.waveIndex + 1, Math.max(1, waves.length)) + '/' + waves.length, 320, 112);
  c.textAlign = 'right';
  c.fillStyle = '#ffffff';
  c.fillText(S.score.toLocaleString('es-ES'), 614, 112);

  /* --- cargadores --- */
  c.textAlign = 'left';
  c.font = '800 28px Inter, system-ui, sans-serif';
  c.fillStyle = '#49e6ff';
  c.fillText((weapon.hands.L.reloading ? '···' : weapon.hands.L.ammo) + '  L', 26, 158);
  c.textAlign = 'right';
  c.fillStyle = '#ff4fd8';
  c.fillText('R  ' + (weapon.hands.R.reloading ? '···' : weapon.hands.R.ammo), 614, 158);

  /* --- diagnóstico mandos --- */
  const mL = weapon.hands.L.held, mR = weapon.hands.R.held;
  c.textAlign = 'center';
  c.font = '700 20px Inter, system-ui, sans-serif';
  c.fillStyle = (mL && mR) ? '#5cff9d' : '#ff9f43';
  c.fillText('MANDOS ' + (weapon.hands.L.controller ? 'L' : '·') + (weapon.hands.R.controller ? 'R' : '·') +
    ' · ARMAS ' + (mL ? 'L' : '·') + (mR ? 'R' : '·'), 320, 188);

  tex.needsUpdate = true;
}

/* ------------------------------------------------------------------ overlay 2D */
function showCover() {
  const ov = $('#overlay');
  if (!ov) return;
  ov.style.display = 'flex';
  ov.classList.add('cover');
  document.body.classList.add('on-cover');
  $('#ov-title').textContent = '';
  $('#ov-sub').textContent = '';
  $('#ov-extra').innerHTML = '';
  // No DOM button on cover: the 3D plaque is the only JUGAR button
  const b = $('#ov-btn');
  b.style.display = 'none';
  document.getElementById('hud').style.opacity = '0';
  const b2 = $('#ov-btn2');
  if (b2) b2.style.display = 'none';
}

function showOverlay(title, sub, btn, fn, extra, altLabel, altFn) {
  const ov = $('#overlay');
  if (!ov) return;
  ov.style.display = 'flex';
  // En escritorio el ratón está capturado por la calle: el cursor no existe y
  // el botón no se puede pulsar (y disparar apuntando al panel no sirve porque
  // el overlay lo tapa). Se suelta el puntero para que el botón sea un botón.
  if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  ov.classList.remove('cover');
  $('#ov-title').textContent = title;
  $('#ov-sub').textContent = sub || '';
  $('#ov-extra').innerHTML = extra || '';
  const b = $('#ov-btn');
  b.textContent = btn;
  b.onclick = fn;
  b.style.display = btn ? 'block' : 'none';
  // segundo botón (volver al inicio), oculto si la pantalla no lo pide
  const b2 = $('#ov-btn2');
  if (b2) {
    b2.textContent = altLabel || '';
    b2.onclick = altFn || null;
    b2.style.display = altLabel ? 'block' : 'none';
  }
}

function hideOverlay() {
  const ov = $('#overlay');
  if (ov) ov.style.display = 'none';
  document.body.classList.remove('on-cover');
  document.getElementById('hud').style.opacity = '1';
}

/* ------------------------------------------------------------------ entrada */
let yaw = 0, pitch = 0;
const input = { left: false, right: false, up: false, down: false };
// Gatillo pulsado (VR o ratón): alimenta el disparo continuo del bucle.
const held = { L: false, R: false };

function initDesktop() {
  const el = renderer.domElement;
  el.addEventListener('click', () => {
    if (S.mode === 'boot') return;
    // pantalla final: manda el botón del overlay, no el gatillo
    if (S.mode === 'dead') return;
    if (S.mode === 'story') { story.skip(); return; }
    if (document.pointerLockElement !== el) { el.requestPointerLock(); return; }
    weapon.fire('R');
  });
  document.addEventListener('mousemove', (e) => {
    if (document.pointerLockElement !== renderer.domElement) return;
    yaw -= e.movementX * 0.0022;
    pitch = clamp(pitch - e.movementY * 0.0022, -1.0, 0.75);
    rig.rotation.y = yaw;
    camera.rotation.x = pitch;
  });
  // mantener el botón izquierdo = ráfaga continua
  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (document.pointerLockElement !== renderer.domElement) return;
    held.R = true;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0) held.R = false;
  });
  document.addEventListener('keydown', (e) => {
    // carteles: cualquier tecla de acción los pasa sin esperar
    if (S.mode === 'story' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyF' || e.code === 'KeyE')) {
      e.preventDefault(); story.skip(); return;
    }
    if (S.mode === 'dead' && (e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter')) {
      const b = $('#ov-btn');
      if (b && typeof b.onclick === 'function') { e.preventDefault(); b.onclick(); return; }
    }
    if (e.code === 'KeyR') { weapon.reload('L', true); weapon.reload('R', true); }
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = true;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = true;
    if (e.code === 'KeyE') { /* reservado */ }
    if (e.code === 'KeyQ') weapon.fire('L');
    if (e.code === 'Escape' && S.mode === 'playing') {
      document.exitPointerLock();
    }
  });
  document.addEventListener('keyup', (e) => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') input.left = false;
    if (e.code === 'KeyD' || e.code === 'ArrowRight') input.right = false;
  });
  window.addEventListener('blur', () => { input.left = input.right = false; });
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (S.mode !== 'boot') weapon.fire('L');
  });
}

function initXR() {
  renderer.xr.addEventListener('sessionstart', () => {
    hideOverlay();
    worldHud.sp.visible = true;
    yaw = 0; pitch = 0;
    rig.rotation.set(0, 0, 0);
    camera.position.set(0, 0, 0);
    if (S.mode === 'boot' || S.mode === 'dead' || S.mode === 'shop') startCampaign();
    if (audio.ready) music.start();
  });
  renderer.xr.addEventListener('sessionend', () => {
    worldHud.sp.visible = false;
    if (S.mode !== 'dead') {
      S.mode = 'shop';
      panel.hide();
    }
    showOverlay('CYBER SHOOT', 'Sesión VR finalizada. Pulsa JUGAR para continuar en pantalla.', 'JUGAR EN PANTALLA', () => { startLevel(S.level); });
  });

  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.addEventListener('connected', (ev) => { c.userData.handedness = ev.data.handedness; });
    c.addEventListener('selectstart', () => {
      if (audio.ready) audio.resume();
      // en VR el gatillo es el botón universal: pasa los carteles
      if (S.mode === 'story') { story.skip(); return; }
      // portada dentro del visor: el gatillo es el botón de jugar
      if (S.mode === 'cover') {
        audio.init(); audio.resume(); music.start();
        startCampaign(); return;
      }
      const hand = c.userData.hand === 'L' ? 'L' : (c.userData.handedness === 'left' ? 'L' : 'R');
      held[hand] = true;
      weapon.fire(hand);
    });
    c.addEventListener('selectend', () => {
      held[c.userData.hand === 'L' ? 'L' : (c.userData.handedness === 'left' ? 'L' : 'R')] = false;
    });
    c.addEventListener('squeezestart', () => {
      if (S.mode === 'story') story.skip();
    });
  }
}

/* --------------------------------------------------- campaña: viñetas y flujo */
const STORY_INTRO = [
  {
    tag: 'NEO LABS · 2087',
    title: 'LA ÚLTIMA PLAZA',
    text: 'La ciudad se apagó hace once horas. Los drones de la compañía patrullan lo que queda de la plaza y no dejan pasar a nadie.'
  },
  {
    tag: 'TU ENCARGO',
    title: 'ENTRA Y DESPEJA',
    text: 'Eres el último operador libre. Cinco sectores, una salida. Dispara a todo lo que brille en rojo y no dejes que te rodeen.'
  },
  {
    tag: 'CONTROLES',
    title: 'DOS PISTOLAS',
    text: 'Apunta con la mirada y dispara con los gatillos. A y D o el stick izquierdo para esquivar. El cargador se vacía rápido: recarga con R.'
  }
];

const STORY_OUT = {
  1: [{
    tag: 'SECTOR 1 · LIMPIO',
    title: 'LA CALLE CALLA',
    text: 'El primer bloque queda en silencio. Al fondo, las luces del sector dos ya están encendidas y algo grande se mueve entre las torres.'
  }],
  2: [{
    tag: 'SECTOR 2 · LIMPIO',
    title: 'SIN FRANCOTIRADORES',
    text: 'Los tiradores de los balcones han dejado de disparar. La compañía sabe que avanzas: los refuerzos ya vienen de camino.'
  }],
  3: [{
    tag: 'SECTOR 3 · LIMPIO',
    title: 'ALGO BAJO EL SUELO',
    text: 'Encuentras un registro abierto. Los drones no patrullaban la plaza: la estaban protegiendo. Lo que hay debajo es más antiguo que la ciudad.'
  }],
  4: [{
    tag: 'SECTOR 4 · LIMPIO',
    title: 'ÚLTIMA PUERTA',
    text: 'Solo queda un acceso. Lo que espera al otro lado pesa más que todo lo anterior. Recarga, respira y entra.'
  }],
  5: [{
    tag: 'SECTOR 5 · LIMPIO',
    title: 'LA PUERTA DEL TITÁN',
    text: 'Los últimos balcones se apagan y la calle termina en una puerta blindada. Detrás no hay drones: hay algo que la compañía construyó para que nunca saliera.'
  }],
  6: [{
    tag: 'OBJETIVO ABATIDO',
    title: 'EL GIGANTE CAE',
    text: 'El titán cae de rodillas y el hormigón se queda quieto por primera vez en cinco años. La plaza es tuya, y la ciudad sigue ahí, apagada, esperando.'
  }]
};

const STORY_FINALE = [{
  tag: 'CAMPAÑA COMPLETADA',
  title: 'PLAZA DESPEJADA',
  text: 'Cinco sectores, un titán y ninguna baja propia. Alguien tendrá que volver a encender las luces: por hoy, la plaza respira.'
}];

function playStory(list, done) {
  S.mode = 'story';
  weapon.enabled = false;
  bolts.clear();
  panel.hide();
  story.play(list, () => { if (done) done(); });
}

function startCampaign() {
  hideOverlay();
  resetRun();
  cover.show(false);
  // Atajo de pruebas: ?level=6 arranca directo en el nivel del titán (y en VR
  // también sirve, porque la URL es la misma). Sin atajo, campaña normal.
  const q = new URLSearchParams(location.search);
  const start = Math.max(1, Math.min(LEVELS, parseInt(q.get('level') || '1', 10) || 1));
  const begin = () => {
    if (start > 1) { weapon.enabled = true; startLevel(start); }
    else playStory(STORY_INTRO, () => startLevel(1));
  };
  // Los props y el HDRI cargan en segundo plano: si entran en escena con la
  // partida ya en marcha, hay subida de texturas y tirón. Se esperan (máximo
  // 7 s) y se precompilan los shaders de enemigos antes de la primera oleada.
  let done = false;
  const go = () => { if (done) return; done = true; prewarmShaders(); begin(); };
  assetsReady.then(go, go);
  setTimeout(go, 7000);
}

/* ------------------------------------------------------------------ arranque */
const cover = createCover(scene);
const story = createStory(scene, camera);

function boot() {
  initDesktop();
  initXR();
  renderer.setAnimationLoop(frame);
  showCover();
  // 3D plaque click on desktop (VR uses trigger)
  const coverRay = new THREE.Raycaster();
  const coverPtr = new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    if (renderer.xr.isPresenting) return;
    if (!cover || !cover.button) return;
    if (S.mode !== 'playing' && document.body.classList.contains('on-cover')) {
      coverPtr.set(
        (ev.clientX / window.innerWidth) * 2 - 1,
        -(ev.clientY / window.innerHeight) * 2 + 1
      );
      coverRay.setFromCamera(coverPtr, camera);
      const hits = coverRay.intersectObject(cover.button, true);
      if (hits.length) onPlay();
    }
  });
  // Sonda de pruebas: con ?debug expone el estado del juego para poder
  // comprobarlo desde fuera (nivel, enemigos, jefe, modo, armas).
  if (new URLSearchParams(location.search).has('debug')) {
    window.__cs = { S, enemies, startLevel, spawnOne, weapon, story, camera, hitTest, renderer };
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
    applyQuality(quality.i);   // no volver a resolución nativa al redimensionar
  });

  // Vigilante del visor: en el navegador del visor/móvil el contexto WebGL a
  // veces se queda sin memoria y el fotograma deja de llegar. Sin esto la
  // imagen se quedaba clavada y solo se salía recargando (fallo del nivel 4).
  let lastBeat = -1, stuck = 0;
  setInterval(() => {
    if (S.frames === lastBeat) {
      if (document.hidden) { lastBeat = S.frames; stuck = 0; return; }
      stuck++;
      if (stuck === 2) {                       // 2 s sin dibujar: limpia la basura
        for (const e of enemies) if (e && !e.isBoss && !e.removed) e.remove();
        enemies.length = 0;
        if (S.mode === 'playing') S.waveT = 0;
      } else if (stuck >= 6) {                 // 6 s: reinicia el bucle
        S.mode = 'playing';
        weapon.enabled = true;
        clock.getDelta();
        renderer.setAnimationLoop(frame);
        stuck = 0;
      }
    } else {
      lastBeat = S.frames; stuck = 0;
    }
  }, 1000);

  const cv = renderer.domElement;
  cv.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[cyber-shoot] contexto WebGL perdido, recuperando…');
  });
  cv.addEventListener('webglcontextrestored', () => {
    clock.getDelta();
    renderer.setAnimationLoop(frame);
  });
}

// Un único botón: entra en VR si el navegador lo permite y, si no, juega en pantalla.
async function onPlay() {
  audio.init(); audio.resume(); music.start();
  if (navigator.xr && navigator.xr.requestSession) {
    try {
      const session = await navigator.xr.requestSession('immersive-vr', {
        optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers']
      });
      // En el visor el bloom está apagado, pero el framebuffer a resolución
      // nativa sigue pesando: 0.9 mantiene nitidez y libera margen de fotograma.
      try { renderer.xr.setFramebufferScaleFactor(0.9); } catch (e) { /* nada */ }
      renderer.xr.setSession(session);
      return;                       // sessionstart arranca la campaña
    } catch (err) { /* sin visor disponible: seguimos en pantalla */ }
  }
  startCampaign();
}

/* ------------------------------------------- calidad adaptativa y precalentado
   Los tirones tenían dos causas medibles: props/HDRI entrando en escena con la
   partida en marcha, y el primer enemigo de cada tipo compilando su shader en
   mitad de la oleada (congelación de 100-300 ms). Aquí se resuelven las dos. */
const QUALITY_STEPS = [1.5, 1.25, 1.0, 0.8];
const quality = { i: 0, acc: 0, n: 0, hold: 0 };

function applyQuality(i) {
  quality.i = Math.max(0, Math.min(QUALITY_STEPS.length - 1, i));
  const pr = Math.min(QUALITY_STEPS[quality.i], window.devicePixelRatio || 1);
  renderer.setPixelRatio(pr);
  if (typeof composer !== 'undefined' && composer) composer.setPixelRatio(pr);
  quality.acc = 0; quality.n = 0;
}

function autoQuality(dt) {
  if (renderer.xr.isPresenting) return;      // en el visor manda el navegador
  quality.acc += dt; quality.n++;
  if (quality.hold > 0) quality.hold -= dt;
  if (quality.n < 90) return;                // ~1,5 s de muestra
  const avg = quality.acc / quality.n;
  quality.acc = 0; quality.n = 0;
  if (avg > 0.024 && quality.i < QUALITY_STEPS.length - 1) {
    applyQuality(quality.i + 1);             // por debajo de ~40 fps: baja
    quality.hold = 4;
  } else if (avg < 0.0125 && quality.i > 0 && quality.hold <= 0) {
    applyQuality(quality.i - 1);             // va sobrado: recupera nitidez
    quality.hold = 4;
  }
}

// Un ejemplar de cada enemigo, fuera de la vista y bajo el suelo, para que sus
// materiales y programas queden compilados antes de la primera oleada. Se hace
// UN TIPO POR FOTOGRAMA: compilar los ocho de golpe congelaba la imagen más de
// un segundo en el visor (medido en el navegador de pruebas). Va durante la
// pantalla de historia, así que el coste no se ve.
const WARM_KINDS = ['drone', 'wasp', 'hound', 'crawler', 'sentry', 'turret', 'sniper', 'boss'];
const warmQueue = [];
let prewarmQueued = false;
const warmLog = [];

function prewarmShaders() {
  if (prewarmQueued) return;
  prewarmQueued = true;
  for (const k of WARM_KINDS) warmQueue.push(k);
}

function stepPrewarm() {
  if (!warmQueue.length) return;
  const kind = warmQueue.shift();
  const spot = new THREE.Vector3(0, -260, -12);
  const t0 = performance.now();
  let e = null, ok = false;
  try {
    e = makeEnemy(world, { pos: spot.clone(), dir: new THREE.Vector3(0, 0, -1), kind: 'ground' }, kind, 500);
    e.group.position.copy(spot);
    e.group.updateMatrixWorld(true);
    renderer.compile(scene, camera);
    ok = true;
  } catch (err) { /* un tipo que falle no puede impedir jugar */ }
  if (e) { try { scene.remove(e.group); } catch (err) { /* nada */ } }
  warmLog.push({ kind, ok, ms: Math.round(performance.now() - t0) });
}

/* bloom solo en pantalla: en VR cuesta frames */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.75, 0.72);
composer.addPass(bloom);
composer.addPass(new OutputPass());
composer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));

boot();

/* depuración: consola del navegador */
window.__CS = () => ({ S, enemies, waves, arena, weapon, scene, camera, world, bolts, startLevel, hitTest, ray, panel, restartRun, closeShop, buy, travel: () => travel, player: () => PLAYER.clone(), story, playStory, prewarmShaders, stepPrewarm, applyQuality, autoQuality, quality, warmQueue, warmLog, startCampaign, onPlay, assetsReady: () => assetsReady });
