// CYBER SHOOT — shooter VR/escritorio estilo Pistol Whip en una plaza cyberpunk abierta.
// Enemigos estáticos que aparecen en suelo, balcones y azoteas; doble pistola; hordas
// aéreas y terrestres; jefes cada 3 niveles; tienda entre niveles que se dispara.

import * as THREE from 'three';
import { Arena, PALETTES } from './arena.js';
import { FX } from './fx.js';
import { GameAudio } from './audio.js';
import { WeaponSystem } from './weapon.js';
import { makeEnemy, BoltField } from './enemies.js';
import { Music } from './music.js';
import { createCover } from './cover.js';
import { createStory } from './story.js';
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
  queue: [],
  spawnT: 0,
  boss: null,
  shots: 0,
  hits: 0,
  up: { dmg: 0, mag: 0, rate: 0, reload: 0, hp: 0, pierce: 0, crit: 0 }
};

const LEVELS = 6;   // 5 sectores de campaña + el del jefe titán

/* ------------------------------------------------------------------ escena */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.05, 400);
camera.position.set(0, 1.62, 0);
scene.add(camera);

const rig = new THREE.Group();     // solo para giro de escritorio
rig.add(camera);
scene.add(rig);

const audio = new GameAudio();
const fx = new FX(scene);
const music = new Music(audio);
const arena = new Arena(scene);
const bolts = new BoltField(scene);

const enemies = [];
const PLAYER = new THREE.Vector3(0, 1.35, 0);

/* ------------------------------------------------------------------ armas */
const weapon = new WeaponSystem({
  scene, camera, audio, fx,
  hitTest, onShot, onHit, onDry
});
weapon.attachControllers(renderer);

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
    music.setIntensity(1);
    if (audio.explode) audio.explode();
    shake(0.9);
  } else if (audio.death) audio.death();
  fx.ring(e.group.position, e.color, 0.9, 0.45);
}

function damagePlayer(dmg) {
  if (S.mode !== 'playing') return;
  // i-frames: sin esto, un burst de 3-4 proyectiles se come la vida entera
  // en dos décimas de segundo y el jugador percibe el juego como injusto.
  const now = performance.now();
  if (now < (S.invulnUntil || 0)) return;
  S.invulnUntil = now + 900;
  // 0.62: el juego pedía ser exigente, no castigar. La vida base sube a 200
  // y cada impacto pega un 38 % menos.
  S.health -= dmg * 0.62;
  S.combo = 1;
  if (audio.playerHit) audio.playerHit();
  shake(0.28);
  flashHit();
  if (S.health <= 0) {
    S.health = 0;
    gameOver();
  }
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
  if (!objs.length) return null;

  const hits = ray.intersectObjects(objs, false);
  if (!hits.length) {
    // En VR apuntar con la mano a un dron es muy difícil: si el rayo pasa
    // cerca del enemigo, cuenta como impacto (manga ancha solo en el visor)
    return renderer.xr.isPresenting ? assistShot(origin, dir) : null;
  }

  const pierce = 1 + (weapon.upgrades.pierce || 0);
  const seen = new Set();
  const dmgBase = weapon.damage;
  let out = null;

  for (const h of hits) {
    const e = h.object.userData.enemy;
    if (!e || e.dead || seen.has(e)) continue;
    seen.add(e);
    const dist = h.distance;
    const falloff = dist < 14 ? 1.4 : dist < 26 ? 1.15 : 1;
    const crit = Math.random() < 0.08 + (weapon.upgrades.crit || 0) * 0.09;
    const dmg = dmgBase * falloff * (crit ? 2.1 : 1);
    e.hit(h.point, 1, dmg);
    out = { point: h.point, enemy: e, crit, dmg };
    if (seen.size >= pierce) break;
  }
  return out;
}

function assistShot(origin, dir) {
  const v = new THREE.Vector3();
  let best = null;
  let bestT = Infinity;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.dead || !e.hitMeshes || !e.hitMeshes.length) continue;
    e.hitMeshes[0].getWorldPosition(v);
    v.sub(origin);
    const t = v.dot(dir);
    if (t < 3 || t > 48) continue;
    const rad = (e.def && e.def.radius ? e.def.radius : 0.62) + 0.75 + t * 0.012;
    const off = v.clone().addScaledVector(dir, -t).length();
    if (off > rad) continue;
    if (t < bestT) { bestT = t; best = { e, point: origin.clone().addScaledVector(dir, t) }; }
  }
  if (!best) return null;
  const falloff = bestT < 14 ? 1.4 : bestT < 26 ? 1.15 : 1;
  const dmg = weapon.damage * falloff;
  best.e.hit(best.point, 1, dmg);
  return { point: best.point, enemy: best.e, crit: false, dmg };
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
      if (t.kind === 'card') buy(t.index);
    } else if (this.mode === 'dead' || this.mode === 'win') {
      if (t.kind === 'next') restartRun();
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
      c.fillText(this.flashMsg, 512, 600);
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
    roundRect(c, 46, 466, 932, 128, 18);
    c.fillStyle = 'rgba(255,79,216,0.16)';
    c.fill();
    c.strokeStyle = 'rgba(255,79,216,0.9)';
    c.lineWidth = 3;
    c.stroke();
    c.textAlign = 'center';
    c.fillStyle = '#ffffff';
    c.font = '800 42px Inter, system-ui, sans-serif';
    c.fillText(S.level >= LEVELS ? 'ÚLTIMO NIVEL — VER RESULTADO' : 'SIGUIENTE NIVEL', 512, 536);
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = '500 20px Inter, system-ui, sans-serif';
    c.fillText('dispara aquí cuando estés listo', 512, 568);
    this.rects.push({ kind: 'next', x: 46, y: 466, w: 932, h: 128 });
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

    roundRect(c, 246, 380, 532, 110, 18);
    c.fillStyle = 'rgba(92,255,157,0.16)';
    c.fill();
    c.strokeStyle = 'rgba(92,255,157,0.9)';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '800 38px Inter, system-ui, sans-serif';
    c.fillText('VOLVER A JUGAR', 512, 450);
    this.rects.push({ kind: 'next', x: 246, y: 380, w: 532, h: 110 });
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

    roundRect(c, 246, 330, 532, 120, 18);
    c.fillStyle = 'rgba(73,230,255,0.16)';
    c.fill();
    c.strokeStyle = 'rgba(73,230,255,0.9)';
    c.lineWidth = 3;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = '800 40px Inter, system-ui, sans-serif';
    c.fillText('REINICIAR', 512, 406);
    this.rects.push({ kind: 'next', x: 246, y: 330, w: 532, h: 120 });
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.font = '500 18px Inter, system-ui, sans-serif';
    c.fillText('dispara al botón', 512, 486);
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
  const n = bossLevel ? 3 : 3;
  waves = [];
  for (let w = 0; w < n; w++) {
    const isBoss = bossLevel && w === n - 1;
    const count = isBoss ? 4 : Math.round(5 + level * 1.1 + w * 1.2);
    const list = [];
    for (let i = 0; i < count; i++) list.push(pickKind(isBoss ? 3 : level));
    // variedad forzada: siempre algo aéreo y algo de azotea, francotirador desde el 2
    if (!list.some(k => k === 'drone' || k === 'wasp')) list.push('wasp');
    if (!list.some(k => k === 'turret')) list.push('turret');
    if (level >= 2 && !isBoss && list.length < 6) list.push('sniper');
    if (isBoss) { list.push('turret', 'sniper'); }
    waves.push({ list, boss: isBoss });
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
  S.queue = [];
  S.boss = null;
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
    // El titán se planta en mitad de la calle, de frente y a media distancia:
    // lo bastante lejos para que se vea entero (14 m de alto) y lo bastante
    // cerca para que imponga. Nunca se descarta por falta de hueco.
    node = arena.pickNodeAhead(Math.random, 'ground', taken, 4.0, 20, 27, PLAYER);
    if (!node) node = { pos: new THREE.Vector3(0, 0, 0), kind: 'ground' };
    // la Arena guarda su propia z y va desfasada: se ancla a la del jugador
    node.pos.x = Math.max(-3.5, Math.min(3.5, node.pos.x * 0.25));
    node.pos.y = 0;
    node.pos.z = PLAYER.z - 17.5;
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
  const bossHp = kind === 'boss' ? Math.round(1100 + S.level * 90) : undefined;
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

function updateWaves(dt) {
  if (S.mode !== 'playing') return;

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
    if (!S.queue.length) S.waveState = 'clear';
    return;
  }

  if (S.waveState === 'clear') {
    S.waveT -= dt;
    // Si queda un enemigo fuera de la vista (balcón alto, detrás de una
    // fachada, fuera del cono), el jugador no puede rematarlo y la oleada se
    // queda colgada. Primero lo devolvemos a la calle, a la vista. Solo si
    // sigue sin poder matarse se retira de la escena.
    if (S.waveT < -2.5 && aliveCount() > 0) rescueStuckEnemies();
    if (S.waveT < -14 && aliveCount() > 0) {
      for (const e of enemies) {
        if (e && !e.dead) e.silentKill();
      }
      S.waveT = -30;
    }
    if (S.waveT <= 0 && aliveCount() === 0) {
      S.waveIndex++;
      S.waveState = 'idle';
      S.waveT = 1.5;
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
  // el sector del titán se presenta con su propia viñeta
  if (intro) playStory(intro, null);
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
    () => startCampaign()
  );
}

function gameOver() {
  if (S.mode === 'dead') return;
  S.mode = 'dead';
  bolts.clear();
  music.setIntensity(0.4);
  if (audio.explode) audio.explode();
  shake(1);
  panel.flashMsg = '';
  panel.mode = 'dead';
  panel.show('dead');
  showOverlay('SISTEMA CAÍDO', 'Puntuación ' + S.score.toLocaleString('es-ES'), 'REINICIAR', () => restartRun());
}

function resetRun() {
  S.score = 0; S.credits = 0; S.kills = 0; S.shots = 0; S.hits = 0;
  S.combo = 1; S.comboT = 0;
  S.up = { dmg: 0, mag: 0, rate: 0, reload: 0, hp: 0, pierce: 0, crit: 0 };
  S.maxHealth = 200; S.health = 200;
  S.level = 1;
  panel.hide();
}

function restartRun() {
  resetRun();
  cover.show(false);
  startLevel(1);
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


function frame(time, xrFrame) {
  const dt = Math.min(0.05, clock.getDelta());
  t += dt;

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
  weapon.update(dt, xrFrame);
  music.update();

  if (S.mode === 'playing') {
    updateWaves(dt);
    recycleBehind();
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (!e) continue;
      e.update(dt, t);
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
      const calm = performance.now() - (S.invulnUntil || 0) > 3000;
      if (calm) S.health = Math.min(S.maxHealth, S.health + dt * (S.waveState === 'clear' ? 9 : 4.5));
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
  if (!f) return;
  f.style.opacity = '0.85';
  setTimeout(() => { f.style.opacity = '0'; }, 90);
}

/* ------------------------------------------------------------------ HUD mundo (VR) */
const worldHud = (() => {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 160;
  const ctx = cv.getContext('2d');
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false, opacity: 0.92 });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.46, 0.144, 1);
  sp.position.set(0, -0.34, -0.95);
  sp.visible = false;
  camera.add(sp);
  return { cv, ctx, tex, sp, mat };
})();

function updateWorldHud() {
  if (!renderer.xr.isPresenting) return;
  const { ctx: c, cv, tex } = worldHud;
  c.clearRect(0, 0, cv.width, cv.height);
  c.fillStyle = 'rgba(4,8,18,0.55)';
  roundRect(c, 4, 4, 504, 152, 18); c.fill();
  c.strokeStyle = 'rgba(73,230,255,0.6)'; c.lineWidth = 3; c.stroke();

  // vida
  const hp = clamp(S.health / S.maxHealth, 0, 1);
  c.fillStyle = 'rgba(255,255,255,0.14)';
  c.fillRect(24, 30, 300, 20);
  c.fillStyle = hp > 0.5 ? '#49e6ff' : hp > 0.25 ? '#ff9f43' : '#ff2d55';
  c.fillRect(24, 30, 300 * hp, 20);

  c.font = '800 30px Inter, system-ui, sans-serif';
  c.textAlign = 'left';
  c.fillStyle = '#ffffff';
  c.fillText(S.credits + ' cr', 24, 96);
  c.textAlign = 'right';
  c.fillText(S.score.toLocaleString('es-ES'), 488, 96);

  // balas
  c.textAlign = 'left';
  c.font = '700 24px Inter, system-ui, sans-serif';
  c.fillStyle = '#49e6ff';
  c.fillText('L ' + (weapon.hands.L.reloading ? '···' : weapon.hands.L.ammo), 24, 136);
  c.textAlign = 'right';
  c.fillStyle = '#ff4fd8';
  c.fillText((weapon.hands.R.reloading ? '···' : weapon.hands.R.ammo) + ' R', 488, 136);

  c.textAlign = 'center';
  c.fillStyle = 'rgba(255,255,255,0.7)';
  c.font = '600 22px Inter, system-ui, sans-serif';
  c.fillText('NIVEL ' + S.level + ' · OLEADA ' + Math.min(S.waveIndex + 1, Math.max(1, waves.length)) + '/' + waves.length, 256, 136);

  if (renderer.xr.isPresenting) {
    // diagnóstico en el visor: mandos detectados y armas enganchadas
    const mL = weapon.hands.L.held, mR = weapon.hands.R.held;
    c.textAlign = 'center';
    c.font = '700 20px Inter, system-ui, sans-serif';
    c.fillStyle = (mL && mR) ? '#5cff9d' : '#ff9f43';
    c.fillText('VR MANDOS ' + (weapon.hands.L.controller ? 'L' : '·') + (weapon.hands.R.controller ? 'R' : '·') +
      ' ARMAS ' + (mL ? 'L' : '·') + (mR ? 'R' : '·'), 256, 64);
  }

  tex.needsUpdate = true;
}

/* ------------------------------------------------------------------ overlay 2D */
function showCover() {
  const ov = $('#overlay');
  if (!ov) return;
  ov.style.display = 'flex';
  ov.classList.add('cover');
  $('#ov-title').textContent = '';
  $('#ov-sub').textContent = '';
  $('#ov-extra').innerHTML = '';
  const b = $('#ov-btn');
  b.textContent = 'JUGAR';
  b.onclick = onPlay;
  b.style.display = 'block';
}

function showOverlay(title, sub, btn, fn, extra) {
  const ov = $('#overlay');
  if (!ov) return;
  ov.style.display = 'flex';
  ov.classList.remove('cover');
  $('#ov-title').textContent = title;
  $('#ov-sub').textContent = sub || '';
  $('#ov-extra').innerHTML = extra || '';
  const b = $('#ov-btn');
  b.textContent = btn;
  b.onclick = fn;
  b.style.display = btn ? 'block' : 'none';
}

function hideOverlay() {
  const ov = $('#overlay');
  if (ov) ov.style.display = 'none';
}

/* ------------------------------------------------------------------ entrada */
let yaw = 0, pitch = 0;
const input = { left: false, right: false, up: false, down: false };

function initDesktop() {
  const el = renderer.domElement;
  el.addEventListener('click', () => {
    if (S.mode === 'boot') return;
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
  document.addEventListener('keydown', (e) => {
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
      const hand = c.userData.hand === 'L' ? 'L' : (c.userData.handedness === 'left' ? 'L' : 'R');
      if (audio.ready) audio.resume();
      weapon.fire(hand);
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
  playStory(STORY_INTRO, () => startLevel(1));
}

/* ------------------------------------------------------------------ arranque */
const cover = createCover(scene);
const story = createStory(scene, camera);

function boot() {
  initDesktop();
  initXR();
  renderer.setAnimationLoop(frame);
  showCover();

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
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
      renderer.xr.setSession(session);
      return;                       // sessionstart arranca la campaña
    } catch (err) { /* sin visor disponible: seguimos en pantalla */ }
  }
  startCampaign();
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
window.__CS = () => ({ S, enemies, waves, arena, weapon, scene, camera, world, bolts, startLevel, hitTest, ray, panel, restartRun, closeShop, buy, travel: () => travel, player: () => PLAYER.clone(), story, playStory });
