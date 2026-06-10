import * as THREE from 'three';

// ============================================================
// CANCERDOOM — a Doom-like arena shooter set inside the body.
// Destroy the malignant cells before they overwhelm the host.
// ============================================================

// ---------- constants ----------
const ARENA_HALF = 45;
const WALL_HEIGHT = 7;
const PLAYER_RADIUS = 0.7;
const EYE_HEIGHT = 1.7;
const MOVE_SPEED = 11;
const SPRINT_SPEED = 17;
const MOUSE_SENS = 0.0022;
const MAX_HEALTH = 100;

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const hpVal = $('hpVal'), ammoVal = $('ammoVal'), scoreVal = $('scoreVal');
const waveVal = $('waveVal'), killsVal = $('killsVal'), weaponNameEl = $('weaponName');
const weaponSlotsEl = $('weaponSlots');
const damageFx = $('damageFx'), crosshair = $('crosshair'), hud = $('hud');
const startOverlay = $('startOverlay'), pauseOverlay = $('pauseOverlay'), gameOverOverlay = $('gameOverOverlay');
const waveBanner = $('waveBanner'), waveSub = $('waveSub'), pickupMsg = $('pickupMsg');

// ---------- audio (synthesized, no assets) ----------
let actx = null, masterGain = null;
function initAudio() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  actx = new AC();
  masterGain = actx.createGain();
  masterGain.gain.value = 0.45;
  masterGain.connect(actx.destination);
}
function blip(f0, f1, dur, type, vol) {
  if (!actx) return;
  const t = actx.currentTime;
  const osc = actx.createOscillator();
  const g = actx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(masterGain);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}
function noiseBurst(dur, vol, cutoff) {
  if (!actx) return;
  const t = actx.currentTime;
  const len = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const filt = actx.createBiquadFilter();
  filt.type = 'lowpass';
  filt.frequency.setValueAtTime(cutoff, t);
  filt.frequency.exponentialRampToValueAtTime(Math.max(cutoff * 0.2, 40), t + dur);
  const g = actx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt).connect(g).connect(masterGain);
  src.start(t);
}
const sfx = {
  pistol: () => blip(900, 200, 0.13, 'square', 0.5),
  chaingun: () => { blip(640, 170, 0.08, 'sawtooth', 0.35); noiseBurst(0.06, 0.15, 3000); },
  shotgun: () => { noiseBurst(0.3, 0.8, 1500); blip(180, 50, 0.25, 'square', 0.4); },
  squelch: () => { noiseBurst(0.28, 0.55, 500); blip(280, 50, 0.28, 'sine', 0.5); },
  split: () => { blip(200, 500, 0.18, 'sine', 0.35); noiseBurst(0.12, 0.3, 800); },
  hurt: () => blip(220, 70, 0.32, 'sawtooth', 0.7),
  pickup: () => { blip(520, 1040, 0.1, 'square', 0.3); setTimeout(() => blip(780, 1560, 0.12, 'square', 0.3), 90); },
  wave: () => { blip(160, 320, 0.4, 'sawtooth', 0.4); setTimeout(() => blip(240, 480, 0.4, 'sawtooth', 0.4), 180); },
  spit: () => blip(800, 320, 0.2, 'sine', 0.3),
  empty: () => blip(140, 100, 0.08, 'square', 0.25),
};

// ---------- procedural textures ----------
function canvasTexture(size, painter, repeatX, repeatY) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  painter(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function paintFloor(ctx, s) {
  ctx.fillStyle = '#3a1018';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 4 + Math.random() * 26;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    const tone = Math.random();
    grad.addColorStop(0, tone > 0.5 ? 'rgba(110,30,45,0.5)' : 'rgba(35,8,14,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // capillary streaks
  ctx.strokeStyle = 'rgba(150,30,40,0.35)';
  for (let i = 0; i < 40; i++) {
    ctx.lineWidth = 1 + Math.random() * 2;
    ctx.beginPath();
    let x = Math.random() * s, y = Math.random() * s;
    ctx.moveTo(x, y);
    for (let j = 0; j < 5; j++) {
      x += (Math.random() - 0.5) * 60; y += (Math.random() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
function paintWall(ctx, s) {
  ctx.fillStyle = '#5c1f2a';
  ctx.fillRect(0, 0, s, s);
  for (let i = 0; i < 200; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = 6 + Math.random() * 30;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, Math.random() > 0.5 ? 'rgba(140,55,70,0.45)' : 'rgba(50,12,20,0.5)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  // sinew: vertical fibrous strands
  ctx.strokeStyle = 'rgba(170,60,80,0.3)';
  for (let i = 0; i < 60; i++) {
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    let x = Math.random() * s;
    ctx.moveTo(x, 0);
    for (let y = 0; y <= s; y += s / 8) ctx.lineTo(x + (Math.random() - 0.5) * 18, y);
    ctx.stroke();
  }
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x12030a);
scene.fog = new THREE.FogExp2(0x1c0510, 0.018);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 250);
const playerRig = new THREE.Object3D();
playerRig.position.set(0, EYE_HEIGHT, 0);
playerRig.add(camera);
scene.add(playerRig);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- lights ----------
scene.add(new THREE.HemisphereLight(0x8a5560, 0x301017, 1.7));
const playerLight = new THREE.PointLight(0xffd9b0, 160, 45, 1.6);
playerLight.position.set(0, 0.4, 0);
playerRig.add(playerLight);

[[-28, -28], [28, 28], [-28, 28], [28, -28], [0, 0]].forEach(([x, z], i) => {
  const l = new THREE.PointLight(i % 2 ? 0xff3050 : 0x16e0c0, 110, 45, 1.7);
  l.position.set(x, WALL_HEIGHT - 1.5, z);
  scene.add(l);
});

// ---------- level geometry / colliders ----------
const wallBoxes = []; // {minX,maxX,minZ,maxZ}
const wallMeshes = [];
const wallMat = new THREE.MeshStandardMaterial({
  map: canvasTexture(512, paintWall, 1, 1), roughness: 0.85, metalness: 0.05,
});

function addWall(cx, cz, w, d) {
  wallBoxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  const mat = wallMat.clone();
  mat.map = wallMat.map.clone();
  mat.map.repeat.set(Math.max(w, d) / 5, WALL_HEIGHT / 5);
  mat.map.needsUpdate = true;
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_HEIGHT, d), mat);
  mesh.position.set(cx, WALL_HEIGHT / 2, cz);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  wallMeshes.push(mesh);
}

// borders
addWall(0, -ARENA_HALF - 2, ARENA_HALF * 2 + 8, 4);
addWall(0, ARENA_HALF + 2, ARENA_HALF * 2 + 8, 4);
addWall(-ARENA_HALF - 2, 0, 4, ARENA_HALF * 2 + 8);
addWall(ARENA_HALF + 2, 0, 4, ARENA_HALF * 2 + 8);
// interior obstacles — pillars and tissue walls
addWall(-20, 0, 4, 4);
addWall(20, 0, 4, 4);
addWall(0, -20, 4, 4);
addWall(0, 20, 4, 4);
addWall(-13, -13, 3, 3);
addWall(13, 13, 3, 3);
addWall(-13, 13, 3, 3);
addWall(13, -13, 3, 3);
addWall(-32, 10, 3, 16);
addWall(32, -10, 3, 16);
addWall(10, 32, 16, 3);
addWall(-10, -32, 16, 3);

// floor + ceiling
const floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF * 2 + 8, ARENA_HALF * 2 + 8),
  new THREE.MeshStandardMaterial({ map: canvasTexture(1024, paintFloor, 10, 10), roughness: 0.9 })
);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const ceilMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF * 2 + 8, ARENA_HALF * 2 + 8),
  new THREE.MeshStandardMaterial({ map: canvasTexture(512, paintWall, 8, 8), roughness: 0.95, color: 0x885566 })
);
ceilMesh.rotation.x = Math.PI / 2;
ceilMesh.position.y = WALL_HEIGHT;
scene.add(ceilMesh);

// circle-vs-AABB collision resolution, shared by player and enemies
function resolveWalls(pos, radius) {
  for (const b of wallBoxes) {
    const cx = Math.max(b.minX, Math.min(pos.x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(pos.z, b.maxZ));
    const dx = pos.x - cx, dz = pos.z - cz;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      if (distSq > 1e-8) {
        const dist = Math.sqrt(distSq);
        pos.x = cx + (dx / dist) * radius;
        pos.z = cz + (dz / dist) * radius;
      } else {
        pos.x = cx + radius; // degenerate: push out along +x
      }
    }
  }
}
function isClear(x, z, r) {
  for (const b of wallBoxes) {
    const cx = Math.max(b.minX, Math.min(x, b.maxX));
    const cz = Math.max(b.minZ, Math.min(z, b.maxZ));
    const dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < r * r) return false;
  }
  return Math.abs(x) < ARENA_HALF - 2 && Math.abs(z) < ARENA_HALF - 2;
}

// ---------- game state ----------
const state = {
  running: false,
  over: false,
  health: MAX_HEALTH,
  score: 0,
  kills: 0,
  wave: 0,
  yaw: 0,
  pitch: 0,
  bobPhase: 0,
  shake: 0,
  fireCooldown: 0,
  firing: false,
  intermission: 0,
  ammo: { chemo: 80, rad: 12 },
};

// ---------- input ----------
const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Digit1') switchWeapon(0);
  if (e.code === 'Digit2') switchWeapon(1);
  if (e.code === 'Digit3') switchWeapon(2);
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });
document.addEventListener('wheel', (e) => {
  if (!state.running) return;
  switchWeapon((currentWeapon + (e.deltaY > 0 ? 1 : weapons.length - 1)) % weapons.length);
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  state.yaw -= e.movementX * MOUSE_SENS;
  state.pitch -= e.movementY * MOUSE_SENS;
  state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch));
});
document.addEventListener('mousedown', () => { if (state.running) state.firing = true; });
document.addEventListener('mouseup', () => { state.firing = false; });

// ---------- weapons ----------
const weapons = [
  { name: 'ANTIBODY BLASTER', damage: 12, cooldown: 0.3, pellets: 1, spread: 0.004, ammoType: null, sound: 'pistol', tracer: 0x4dff4d },
  { name: 'CHEMO CHAINGUN', damage: 6, cooldown: 0.09, pellets: 1, spread: 0.035, ammoType: 'chemo', sound: 'chaingun', tracer: 0x35ffb0 },
  { name: 'RADIATION SCATTERGUN', damage: 8, cooldown: 0.95, pellets: 8, spread: 0.09, ammoType: 'rad', sound: 'shotgun', tracer: 0xffd23b },
];
let currentWeapon = 0;
function switchWeapon(i) {
  if (i === currentWeapon || !state.running) return;
  currentWeapon = i;
  viewRecoil = 0.12;
  updateHUD();
}

// weapon viewmodel: a stylized auto-syringe
const viewModel = new THREE.Group();
{
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.06, 0.34, 12),
    new THREE.MeshStandardMaterial({ color: 0x55676f, roughness: 0.45, metalness: 0.75 })
  );
  body.rotation.x = Math.PI / 2;
  const vial = new THREE.Mesh(
    new THREE.CylinderGeometry(0.052, 0.052, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: 0x35ffb0, emissive: 0x1a8055, roughness: 0.2, transparent: true, opacity: 0.85 })
  );
  vial.rotation.x = Math.PI / 2;
  vial.position.z = -0.02;
  const needle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.002, 0.22, 8),
    new THREE.MeshStandardMaterial({ color: 0x9aa8b0, roughness: 0.3, metalness: 0.9 })
  );
  needle.rotation.x = Math.PI / 2;
  needle.position.z = -0.27;
  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.16, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x332228, roughness: 0.8 })
  );
  grip.position.set(0, -0.12, 0.1);
  viewModel.add(body, vial, needle, grip);
  viewModel.scale.setScalar(0.72);
  viewModel.rotation.y = -0.06;
  viewModel.position.set(0.32, -0.28, -0.6);
  camera.add(viewModel);
}
const muzzleTip = new THREE.Object3D();
muzzleTip.position.set(0, 0, -0.4);
viewModel.add(muzzleTip);
const muzzleFlash = new THREE.PointLight(0x9dff70, 0, 7, 2);
muzzleTip.add(muzzleFlash);
let viewRecoil = 0;

// ---------- enemies ----------
const enemyTiers = [
  { radius: 0.85, hp: 14, speed: 7.0, color: 0xa6ff2e, emissive: 0x3a6b00, score: 25, damage: 6 },
  { radius: 1.45, hp: 32, speed: 4.8, color: 0x7ad12c, emissive: 0x2a4d08, score: 50, damage: 10 },
  { radius: 2.2, hp: 65, speed: 3.2, color: 0x4f8a1e, emissive: 0x1c3305, score: 100, damage: 16 },
];
const spitterDef = { radius: 1.5, hp: 40, speed: 3.6, color: 0xc62ed1, emissive: 0x4d0a55, score: 150, damage: 9 };

const enemies = [];
const enemyRoot = new THREE.Group();
scene.add(enemyRoot);

// position-hashed displacement keeps duplicated vertices welded (no cracks)
function lumpify(geo, amount, s1, s2, s3) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 + s1) * Math.sin(v.y * 2.7 + s2) * Math.sin(v.z * 3.4 + s3);
    v.multiplyScalar(1 + n * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function buildCellMesh(def, isSpitter) {
  const group = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(def.radius, 2);
  lumpify(geo, 0.18, Math.random() * 10, Math.random() * 10, Math.random() * 10);
  const mat = new THREE.MeshStandardMaterial({
    color: def.color, emissive: def.emissive, roughness: 0.55, flatShading: true,
  });
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  group.add(body);

  // malignant spikes
  const spikeMat = new THREE.MeshStandardMaterial({
    color: isSpitter ? 0xff5ce0 : 0xd8ff70, emissive: isSpitter ? 0x801060 : 0x405510,
    roughness: 0.4, flatShading: true,
  });
  const spikeCount = 8 + Math.floor(Math.random() * 6);
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < spikeCount; i++) {
    const dir = new THREE.Vector3().randomDirection();
    const spike = new THREE.Mesh(
      new THREE.ConeGeometry(def.radius * 0.13, def.radius * (0.4 + Math.random() * 0.35), 6), spikeMat);
    spike.quaternion.setFromUnitVectors(up, dir);
    spike.position.copy(dir).multiplyScalar(def.radius * 0.92);
    group.add(spike);
  }
  // dark lesions on the membrane
  const lesionMat = new THREE.MeshStandardMaterial({ color: 0x2a1230, roughness: 0.9, flatShading: true });
  for (let i = 0; i < 5; i++) {
    const dir = new THREE.Vector3().randomDirection();
    const lesion = new THREE.Mesh(new THREE.IcosahedronGeometry(def.radius * 0.22, 1), lesionMat);
    lesion.position.copy(dir).multiplyScalar(def.radius * 0.95);
    group.add(lesion);
  }
  return { group, body, mat };
}

function spawnEnemy(tier, x, z, isSpitter = false, spawnScale = 0) {
  const def = isSpitter ? spitterDef : enemyTiers[tier];
  const { group, body, mat } = buildCellMesh(def, isSpitter);
  group.position.set(x, def.radius, z);
  enemyRoot.add(group);
  const enemy = {
    tier, def, group, body, mat, isSpitter,
    hp: def.hp,
    pos: group.position,
    pulsePhase: Math.random() * Math.PI * 2,
    attackCooldown: 0,
    spitCooldown: 1.5 + Math.random(),
    flash: 0,
    scale: spawnScale > 0 ? spawnScale : 0.01,
    strafeDir: Math.random() > 0.5 ? 1 : -1,
  };
  body.userData.enemy = enemy;
  group.traverse((o) => { o.userData.enemy = enemy; });
  enemies.push(enemy);
  return enemy;
}

function killEnemy(enemy, hitDir) {
  const idx = enemies.indexOf(enemy);
  if (idx === -1) return;
  enemies.splice(idx, 1);
  enemyRoot.remove(enemy.group);
  disposeGroup(enemy.group);
  state.kills++;
  state.score += enemy.def.score;

  if (!enemy.isSpitter && enemy.tier > 0) {
    // mitosis: the cell tears apart into two smaller malignancies
    sfx.split();
    const perp = new THREE.Vector3(-hitDir.z, 0, hitDir.x).normalize();
    for (const sign of [1, -1]) {
      const off = perp.clone().multiplyScalar(sign * enemy.def.radius * 0.7);
      let x = enemy.pos.x + off.x, z = enemy.pos.z + off.z;
      if (!isClear(x, z, enemyTiers[enemy.tier - 1].radius)) { x = enemy.pos.x; z = enemy.pos.z; }
      spawnEnemy(enemy.tier - 1, x, z, false, 0.3);
    }
    burstParticles(enemy.pos, 18, enemy.def.color, enemy.def.radius * 0.8);
  } else {
    sfx.squelch();
    burstParticles(enemy.pos, 30, enemy.def.color, enemy.def.radius);
    maybeDropPickup(enemy.pos);
  }
  updateHUD();
}

function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
}

// ---------- enemy projectiles (metastatic spit) ----------
const spitProjectiles = [];
const spitGeo = new THREE.SphereGeometry(0.28, 10, 10);
const spitMat = new THREE.MeshStandardMaterial({ color: 0xff5ce0, emissive: 0xc620a0, emissiveIntensity: 2 });
function fireSpit(from, target) {
  const mesh = new THREE.Mesh(spitGeo, spitMat);
  mesh.position.copy(from);
  mesh.position.y = 1.3;
  scene.add(mesh);
  const dir = new THREE.Vector3().subVectors(target, mesh.position).normalize();
  spitProjectiles.push({ mesh, vel: dir.multiplyScalar(16), life: 4 });
  sfx.spit();
}

// ---------- particles ----------
const particleBursts = [];
function burstParticles(origin, count, color, spread) {
  const positions = new Float32Array(count * 3);
  const velocities = [];
  for (let i = 0; i < count; i++) {
    positions[i * 3] = origin.x + (Math.random() - 0.5) * spread;
    positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * spread;
    positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * spread;
    velocities.push(new THREE.Vector3(
      (Math.random() - 0.5) * 9, Math.random() * 7, (Math.random() - 0.5) * 9));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color, size: 0.22, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  particleBursts.push({ points, velocities, life: 0.9, maxLife: 0.9 });
}
function updateParticles(dt) {
  for (let i = particleBursts.length - 1; i >= 0; i--) {
    const p = particleBursts[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.points);
      p.points.geometry.dispose();
      p.points.material.dispose();
      particleBursts.splice(i, 1);
      continue;
    }
    const pos = p.points.geometry.attributes.position;
    for (let j = 0; j < p.velocities.length; j++) {
      const v = p.velocities[j];
      v.y -= 18 * dt;
      pos.setXYZ(j, pos.getX(j) + v.x * dt, Math.max(0.05, pos.getY(j) + v.y * dt), pos.getZ(j) + v.z * dt);
    }
    pos.needsUpdate = true;
    p.points.material.opacity = p.life / p.maxLife;
  }
}

// ---------- tracers ----------
const tracers = [];
function addTracer(from, to, color) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending });
  const line = new THREE.Line(geo, mat);
  scene.add(line);
  tracers.push({ line, life: 0.07 });
}
function updateTracers(dt) {
  for (let i = tracers.length - 1; i >= 0; i--) {
    tracers[i].life -= dt;
    if (tracers[i].life <= 0) {
      scene.remove(tracers[i].line);
      tracers[i].line.geometry.dispose();
      tracers[i].line.material.dispose();
      tracers.splice(i, 1);
    } else {
      tracers[i].line.material.opacity = tracers[i].life / 0.07;
    }
  }
}

// ---------- pickups ----------
const pickups = [];
const pickupDefs = {
  health: {
    label: '+25 LEUKOCYTE BOOST', color: 0xffffff,
    build: () => new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.55, 1),
      new THREE.MeshStandardMaterial({ color: 0xf5f5ff, emissive: 0x8899bb, emissiveIntensity: 0.6, roughness: 0.4, flatShading: true })),
    apply: () => { state.health = Math.min(MAX_HEALTH, state.health + 25); },
  },
  chemo: {
    label: '+40 CHEMO', color: 0x35ffb0,
    build: () => new THREE.Mesh(
      new THREE.CylinderGeometry(0.32, 0.32, 0.8, 10),
      new THREE.MeshStandardMaterial({ color: 0x35ffb0, emissive: 0x0d6b45, roughness: 0.3 })),
    apply: () => { state.ammo.chemo += 40; },
  },
  rad: {
    label: '+6 ISOTOPES', color: 0xffd23b,
    build: () => new THREE.Mesh(
      new THREE.OctahedronGeometry(0.5),
      new THREE.MeshStandardMaterial({ color: 0xffd23b, emissive: 0x8a6a00, roughness: 0.3, flatShading: true })),
    apply: () => { state.ammo.rad += 6; },
  },
};
function spawnPickup(type, x, z) {
  const def = pickupDefs[type];
  const mesh = def.build();
  mesh.position.set(x, 1, z);
  scene.add(mesh);
  const halo = new THREE.PointLight(def.color, 8, 6, 2);
  mesh.add(halo);
  pickups.push({ mesh, def, type, phase: Math.random() * Math.PI * 2 });
}
function maybeDropPickup(pos) {
  if (Math.random() > 0.3) return;
  const roll = Math.random();
  const type = roll < 0.4 ? 'health' : roll < 0.75 ? 'chemo' : 'rad';
  spawnPickup(type, pos.x, pos.z);
}
function updatePickups(dt, t) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.mesh.rotation.y += dt * 2;
    p.mesh.position.y = 1 + Math.sin(t * 2.5 + p.phase) * 0.18;
    const dx = p.mesh.position.x - playerRig.position.x;
    const dz = p.mesh.position.z - playerRig.position.z;
    if (dx * dx + dz * dz < 2.1) {
      p.def.apply();
      sfx.pickup();
      showPickupMsg(p.def.label);
      scene.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
      pickups.splice(i, 1);
      updateHUD();
    }
  }
}
let pickupMsgTimer = null;
function showPickupMsg(text) {
  pickupMsg.textContent = text;
  pickupMsg.style.opacity = 1;
  clearTimeout(pickupMsgTimer);
  pickupMsgTimer = setTimeout(() => { pickupMsg.style.opacity = 0; }, 1200);
}

// ---------- shooting ----------
const raycaster = new THREE.Raycaster();
const _shootDir = new THREE.Vector3();
const _muzzleWorld = new THREE.Vector3();

function shoot() {
  const w = weapons[currentWeapon];
  if (w.ammoType && state.ammo[w.ammoType] <= 0) {
    sfx.empty();
    state.fireCooldown = 0.3;
    return;
  }
  if (w.ammoType) state.ammo[w.ammoType]--;
  state.fireCooldown = w.cooldown;
  sfx[w.sound]();
  viewRecoil = Math.min(viewRecoil + 0.08, 0.2);
  muzzleFlash.intensity = 50;
  muzzleTip.getWorldPosition(_muzzleWorld);

  for (let p = 0; p < w.pellets; p++) {
    camera.getWorldDirection(_shootDir);
    _shootDir.x += (Math.random() - 0.5) * w.spread * 2;
    _shootDir.y += (Math.random() - 0.5) * w.spread * 2;
    _shootDir.z += (Math.random() - 0.5) * w.spread * 2;
    _shootDir.normalize();
    const origin = new THREE.Vector3();
    camera.getWorldPosition(origin);
    raycaster.set(origin, _shootDir);
    raycaster.far = 120;

    const enemyHits = raycaster.intersectObjects(enemyRoot.children, true);
    const wallHits = raycaster.intersectObjects(wallMeshes, false);
    const enemyHit = enemyHits.find((h) => h.object.userData.enemy);
    const wallDist = wallHits.length ? wallHits[0].distance : Infinity;

    if (enemyHit && enemyHit.distance < wallDist) {
      const enemy = enemyHit.object.userData.enemy;
      addTracer(_muzzleWorld.clone(), enemyHit.point, w.tracer);
      enemy.hp -= w.damage;
      enemy.flash = 0.12;
      // knockback
      enemy.pos.x += _shootDir.x * w.damage * 0.03;
      enemy.pos.z += _shootDir.z * w.damage * 0.03;
      burstParticles(enemyHit.point, 5, 0xff4060, 0.3);
      if (enemy.hp <= 0) killEnemy(enemy, _shootDir);
    } else if (wallDist < Infinity) {
      addTracer(_muzzleWorld.clone(), wallHits[0].point, w.tracer);
      burstParticles(wallHits[0].point, 4, 0x995566, 0.2);
    } else {
      const end = origin.clone().addScaledVector(_shootDir, 60);
      addTracer(_muzzleWorld.clone(), end, w.tracer);
    }
  }
  updateHUD();
}

// ---------- player damage ----------
function damagePlayer(amount) {
  if (state.over) return;
  state.health -= amount;
  state.shake = Math.min(state.shake + 0.35, 0.7);
  sfx.hurt();
  damageFx.style.transition = 'none';
  damageFx.style.opacity = 1;
  requestAnimationFrame(() => {
    damageFx.style.transition = 'opacity 0.5s ease-out';
    damageFx.style.opacity = 0;
  });
  if (state.health <= 0) {
    state.health = 0;
    gameOver();
  }
  updateHUD();
}

function gameOver() {
  state.over = true;
  state.running = false;
  state.firing = false;
  document.exitPointerLock();
  $('gameOverStats').innerHTML =
    `MALIGNANT CELLS DESTROYED: ${state.kills}<br>` +
    `WAVES SURVIVED: ${Math.max(0, state.wave - 1)}<br>` +
    `FINAL SCORE: ${state.score}`;
  gameOverOverlay.style.display = 'flex';
  hud.style.display = 'none';
  crosshair.style.display = 'none';
}

// ---------- waves ----------
const SPAWN_POINTS = [
  [-38, -38], [38, -38], [-38, 38], [38, 38], [0, -38], [0, 38], [-38, 0], [38, 0],
];
function startWave() {
  state.wave++;
  const count = 3 + state.wave * 2;
  for (let i = 0; i < count; i++) {
    const candidates = SPAWN_POINTS.filter(([x, z]) => {
      const dx = x - playerRig.position.x, dz = z - playerRig.position.z;
      return dx * dx + dz * dz > 500;
    });
    const [sx, sz] = candidates[Math.floor(Math.random() * candidates.length)] || SPAWN_POINTS[0];
    const jx = sx + (Math.random() - 0.5) * 6, jz = sz + (Math.random() - 0.5) * 6;
    const isSpitter = state.wave >= 3 && Math.random() < 0.2;
    if (isSpitter) {
      spawnEnemy(0, jx, jz, true);
    } else {
      const roll = Math.random();
      const tier = state.wave >= 4 && roll < 0.3 ? 2 : roll < 0.6 ? 1 : 0;
      spawnEnemy(tier, jx, jz);
    }
  }
  sfx.wave();
  waveBanner.textContent = `WAVE ${state.wave}`;
  waveSub.textContent = waveSubtitle(state.wave);
  waveBanner.style.opacity = 1;
  waveSub.style.opacity = 1;
  setTimeout(() => { waveBanner.style.opacity = 0; waveSub.style.opacity = 0; }, 2200);
  updateHUD();
}
function waveSubtitle(w) {
  const lines = [
    'BIOPSY CONFIRMS MALIGNANCY', 'THE TUMOR GROWS', 'METASTASIS DETECTED',
    'AGGRESSIVE PROLIFERATION', 'STAGE FOUR', 'TOTAL CELLULAR WAR', 'REMISSION DENIED',
  ];
  return lines[Math.min(w - 1, lines.length - 1)];
}

// ---------- enemy update ----------
const _toPlayer = new THREE.Vector3();
const _sep = new THREE.Vector3();
function updateEnemies(dt, t) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];

    // spawn grow-in
    if (e.scale < 1) {
      e.scale = Math.min(1, e.scale + dt * 2.2);
    }
    const pulse = 1 + Math.sin(t * 3 + e.pulsePhase) * 0.06;
    e.group.scale.setScalar(e.scale * pulse);

    // hit flash
    if (e.flash > 0) {
      e.flash -= dt;
      e.mat.emissive.setHex(0xffffff);
      e.mat.emissiveIntensity = 0.9;
    } else {
      e.mat.emissive.setHex(e.def.emissive);
      e.mat.emissiveIntensity = 1;
    }

    _toPlayer.set(playerRig.position.x - e.pos.x, 0, playerRig.position.z - e.pos.z);
    const dist = _toPlayer.length();
    _toPlayer.normalize();

    // separation from neighbors
    _sep.set(0, 0, 0);
    for (const other of enemies) {
      if (other === e) continue;
      const dx = e.pos.x - other.pos.x, dz = e.pos.z - other.pos.z;
      const dsq = dx * dx + dz * dz;
      const minD = e.def.radius + other.def.radius;
      if (dsq < minD * minD && dsq > 1e-6) {
        const d = Math.sqrt(dsq);
        _sep.x += (dx / d) * (minD - d);
        _sep.z += (dz / d) * (minD - d);
      }
    }

    let moveX = _toPlayer.x, moveZ = _toPlayer.z;
    if (e.isSpitter) {
      if (dist < 11) {
        // hold range and strafe while spitting
        moveX = _toPlayer.z * e.strafeDir - _toPlayer.x * 0.3;
        moveZ = -_toPlayer.x * e.strafeDir - _toPlayer.z * 0.3;
      }
      e.spitCooldown -= dt;
      if (e.spitCooldown <= 0 && dist < 30 && e.scale >= 1) {
        e.spitCooldown = 1.8 + Math.random() * 0.8;
        fireSpit(e.pos, playerRig.position);
      }
    }

    e.pos.x += (moveX * e.def.speed + _sep.x * 4) * dt;
    e.pos.z += (moveZ * e.def.speed + _sep.z * 4) * dt;
    resolveWalls(e.pos, e.def.radius * 0.85);
    e.pos.y = e.def.radius * e.scale * pulse * 0.95;

    // tumble toward the player as it rolls forward
    e.group.rotation.y = Math.atan2(_toPlayer.x, _toPlayer.z);

    // melee
    e.attackCooldown -= dt;
    if (dist < e.def.radius + PLAYER_RADIUS + 0.4 && e.attackCooldown <= 0 && e.scale >= 1) {
      e.attackCooldown = 0.9;
      damagePlayer(e.def.damage);
    }
  }
}

function updateSpit(dt) {
  for (let i = spitProjectiles.length - 1; i >= 0; i--) {
    const s = spitProjectiles[i];
    s.life -= dt;
    s.mesh.position.addScaledVector(s.vel, dt);
    const dx = s.mesh.position.x - playerRig.position.x;
    const dy = s.mesh.position.y - playerRig.position.y;
    const dz = s.mesh.position.z - playerRig.position.z;
    let dead = false;
    if (dx * dx + dy * dy + dz * dz < 1.1) {
      damagePlayer(spitterDef.damage);
      dead = true;
    } else if (s.life <= 0 || !isClear(s.mesh.position.x, s.mesh.position.z, 0.2)) {
      burstParticles(s.mesh.position, 6, 0xff5ce0, 0.3);
      dead = true;
    }
    if (dead) {
      scene.remove(s.mesh);
      spitProjectiles.splice(i, 1);
    }
  }
}

// ---------- HUD ----------
function updateHUD() {
  hpVal.textContent = Math.ceil(state.health);
  hpVal.style.color = state.health > 50 ? '#ff3b3b' : state.health > 25 ? '#ff8c3b' : '#ff1010';
  scoreVal.textContent = state.score;
  killsVal.textContent = state.kills;
  waveVal.textContent = state.wave;
  const w = weapons[currentWeapon];
  ammoVal.innerHTML = w.ammoType ? state.ammo[w.ammoType] : '&#8734;';
  weaponNameEl.textContent = w.name;
  weaponSlotsEl.innerHTML = ['BLASTER', 'CHEMO', 'RAD']
    .map((n, i) => (i === currentWeapon ? `<b>${i + 1} ${n}</b>` : `${i + 1} ${n}`))
    .join(' &nbsp; ');
}

// ---------- player movement ----------
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
function updatePlayer(dt, t) {
  playerRig.rotation.set(0, state.yaw, 0);
  camera.rotation.set(state.pitch, 0, 0);

  _fwd.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  _right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));
  let mx = 0, mz = 0;
  if (keys['KeyW'] || keys['ArrowUp']) { mx += _fwd.x; mz += _fwd.z; }
  if (keys['KeyS'] || keys['ArrowDown']) { mx -= _fwd.x; mz -= _fwd.z; }
  if (keys['KeyD'] || keys['ArrowRight']) { mx += _right.x; mz += _right.z; }
  if (keys['KeyA'] || keys['ArrowLeft']) { mx -= _right.x; mz -= _right.z; }
  const moving = mx !== 0 || mz !== 0;
  if (moving) {
    const len = Math.hypot(mx, mz);
    const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? SPRINT_SPEED : MOVE_SPEED;
    playerRig.position.x += (mx / len) * speed * dt;
    playerRig.position.z += (mz / len) * speed * dt;
    state.bobPhase += dt * speed * 1.1;
  }
  resolveWalls(playerRig.position, PLAYER_RADIUS);

  // head bob + screen shake
  state.shake = Math.max(0, state.shake - dt * 2);
  const bobY = moving ? Math.abs(Math.sin(state.bobPhase)) * 0.07 : 0;
  playerRig.position.y = EYE_HEIGHT + bobY + (Math.random() - 0.5) * state.shake * 0.3;
  camera.rotation.z = (Math.random() - 0.5) * state.shake * 0.05;

  // viewmodel bob + recoil
  viewRecoil = Math.max(0, viewRecoil - dt * 1.4);
  viewModel.position.set(
    0.32 + (moving ? Math.sin(state.bobPhase) * 0.012 : 0),
    -0.28 + (moving ? Math.abs(Math.cos(state.bobPhase)) * 0.012 : 0),
    -0.6 + viewRecoil
  );
  viewModel.rotation.x = viewRecoil * 1.6;
  muzzleFlash.intensity = Math.max(0, muzzleFlash.intensity - dt * 600);

  // firing
  state.fireCooldown -= dt;
  if (state.firing && state.fireCooldown <= 0) shoot();
}

// ---------- intermission / wave flow ----------
function updateWaveFlow(dt) {
  if (enemies.length === 0) {
    if (state.intermission <= 0) {
      state.intermission = 4;
      // reward breather: guaranteed supply drop near the player
      const angle = Math.random() * Math.PI * 2;
      for (let attempt = 0; attempt < 10; attempt++) {
        const x = playerRig.position.x + Math.cos(angle + attempt) * 6;
        const z = playerRig.position.z + Math.sin(angle + attempt) * 6;
        if (isClear(x, z, 1)) {
          spawnPickup(state.health < 60 ? 'health' : Math.random() < 0.5 ? 'chemo' : 'rad', x, z);
          break;
        }
      }
    }
    state.intermission -= dt;
    if (state.intermission <= 0) startWave();
  }
}

// ---------- pointer lock / overlay flow ----------
let started = false;
startOverlay.addEventListener('click', () => {
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  renderer.domElement.requestPointerLock();
});
pauseOverlay.addEventListener('click', () => {
  if (actx && actx.state === 'suspended') actx.resume();
  renderer.domElement.requestPointerLock();
});
gameOverOverlay.addEventListener('click', () => location.reload());

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) {
    startOverlay.style.display = 'none';
    pauseOverlay.style.display = 'none';
    hud.style.display = 'flex';
    crosshair.style.display = 'block';
    state.running = true;
    if (!started) {
      started = true;
      startWave();
    }
  } else {
    state.running = false;
    state.firing = false;
    if (!state.over && started) {
      pauseOverlay.style.display = 'flex';
      hud.style.display = 'none';
      crosshair.style.display = 'none';
    }
  }
});

// ---------- main loop ----------
const clock = new THREE.Clock();
let elapsed = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.running) {
    elapsed += dt;
    updatePlayer(dt, elapsed);
    updateEnemies(dt, elapsed);
    updateSpit(dt);
    updateWaveFlow(dt);
    updatePickups(dt, elapsed);
  }
  updateParticles(dt);
  updateTracers(dt);
  renderer.render(scene, camera);
}
updateHUD();
animate();

// debug/testing handle
window.CANCERDOOM = { state, playerRig, enemies, spawnEnemy };
