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
const TOUCH_SENS = 0.0055;
const MAX_HEALTH = 100;

// touch-first devices (phones/tablets) get on-screen controls and lighter rendering
const IS_TOUCH = (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  && window.matchMedia('(pointer: coarse)').matches;

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
function makeCanvas(size, painter) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  painter(c.getContext('2d'), size);
  return c;
}
function toTexture(canvas, repeatX = 1, repeatY = 1, srgb = true) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function mottle(ctx, s, count, colors, rMin, rMax) {
  for (let i = 0; i < count; i++) {
    const x = Math.random() * s, y = Math.random() * s, r = rMin + Math.random() * (rMax - rMin);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, colors[Math.floor(Math.random() * colors.length)]);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
}
// random-walk vein polylines, reusable across color/bump/emissive maps so they align
function veinPaths(s, count) {
  const paths = [];
  for (let i = 0; i < count; i++) {
    const pts = [[Math.random() * s, Math.random() * s]];
    let ang = Math.random() * Math.PI * 2;
    const segs = 5 + Math.floor(Math.random() * 9);
    for (let j = 0; j < segs; j++) {
      ang += (Math.random() - 0.5) * 1.3;
      const [px, py] = pts[pts.length - 1];
      const step = s * (0.04 + Math.random() * 0.06);
      pts.push([px + Math.cos(ang) * step, py + Math.sin(ang) * step]);
    }
    paths.push({ pts, w: 1 + Math.random() * 3.5 });
  }
  return paths;
}
function strokeVeins(ctx, paths, color, widthScale, blur = 0) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (blur) { ctx.shadowColor = color; ctx.shadowBlur = blur; }
  for (const p of paths) {
    ctx.lineWidth = Math.max(0.5, p.w * widthScale);
    ctx.beginPath();
    ctx.moveTo(p.pts[0][0], p.pts[0][1]);
    for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i][0], p.pts[i][1]);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
}

// soft round sprite so point particles don't render as hard squares
const particleTex = (() => {
  const c = makeCanvas(64, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
  return new THREE.CanvasTexture(c);
})();

// floor: raw tissue with arteries and glossy blood pools (roughness map makes pools shine)
function makeFloorMaps(repeat) {
  const s = 1024;
  const pools = [];
  for (let i = 0; i < 9; i++) pools.push({ x: Math.random() * s, y: Math.random() * s, r: s * (0.04 + Math.random() * 0.08) });
  const veins = veinPaths(s, 70);
  const color = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#41141b';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, 380, ['rgba(118,40,52,0.45)', 'rgba(48,12,18,0.55)', 'rgba(150,72,70,0.25)', 'rgba(88,24,36,0.4)'], 6, 50);
    strokeVeins(ctx, veins, 'rgba(22,3,7,0.55)', 1.7);
    strokeVeins(ctx, veins, 'rgba(135,22,32,0.5)', 0.8);
    for (const p of pools) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, 'rgba(66,2,8,0.95)');
      g.addColorStop(0.75, 'rgba(56,2,8,0.85)');
      g.addColorStop(1, 'rgba(40,2,6,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 2400; i++) {
      ctx.fillStyle = `rgba(${120 + Math.random() * 80 | 0},${20 + Math.random() * 40 | 0},${30 + Math.random() * 40 | 0},${0.05 + Math.random() * 0.12})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
    }
  });
  const bump = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, 320, ['rgba(255,255,255,0.25)', 'rgba(0,0,0,0.3)'], 5, 45);
    strokeVeins(ctx, veins, 'rgba(255,255,255,0.45)', 1.2, 3);
    for (const p of pools) {
      ctx.fillStyle = 'rgba(70,70,70,0.85)';
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.9, 0, Math.PI * 2); ctx.fill();
    }
  });
  const rough = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#c9c9c9';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, 160, ['rgba(120,120,120,0.5)', 'rgba(235,235,235,0.4)'], 8, 60);
    for (const p of pools) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, 'rgba(25,25,25,1)');
      g.addColorStop(0.8, 'rgba(40,40,40,0.9)');
      g.addColorStop(1, 'rgba(40,40,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
  });
  return {
    map: toTexture(color, repeat, repeat),
    bumpMap: toTexture(bump, repeat, repeat, false),
    roughnessMap: toTexture(rough, repeat, repeat, false),
  };
}

// wall canvases (textures are instantiated per wall so UV repeats match wall size)
function makeWallCanvases() {
  const s = 512;
  const veins = veinPaths(s, 30);
  const color = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#541d27';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, 260, ['rgba(135,52,66,0.45)', 'rgba(44,10,18,0.55)', 'rgba(160,80,84,0.22)', 'rgba(70,18,28,0.45)'], 6, 38);
    // vertical sinew strands
    for (let i = 0; i < 70; i++) {
      ctx.strokeStyle = `rgba(${130 + Math.random() * 60 | 0},${40 + Math.random() * 30 | 0},${55 + Math.random() * 30 | 0},${0.12 + Math.random() * 0.2})`;
      ctx.lineWidth = 1 + Math.random() * 3;
      ctx.beginPath();
      let x = Math.random() * s;
      ctx.moveTo(x, 0);
      for (let y = 0; y <= s; y += s / 8) ctx.lineTo(x + (Math.random() - 0.5) * 20, y);
      ctx.stroke();
    }
    strokeVeins(ctx, veins, 'rgba(20,3,8,0.5)', 1.6);
    strokeVeins(ctx, veins, 'rgba(150,28,40,0.45)', 0.8);
  });
  const bump = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#888888';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, 240, ['rgba(255,255,255,0.3)', 'rgba(0,0,0,0.35)'], 5, 36);
    strokeVeins(ctx, veins, 'rgba(255,255,255,0.5)', 1.2, 3);
  });
  // glowing arteries — emissive map, pulsed in the render loop
  const emissive = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    strokeVeins(ctx, veins, 'rgba(255,46,60,0.85)', 0.7, 6);
  });
  return { color, bump, emissive };
}

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: !IS_TOUCH, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, IS_TOUCH ? 1.5 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0207);
scene.fog = new THREE.FogExp2(0x150409, 0.017);

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
scene.add(new THREE.HemisphereLight(0x8a4a52, 0x241016, 1.05));
const playerLight = new THREE.PointLight(0xffc9a0, 110, 45, 1.8);
playerLight.position.set(0, 0.4, 0);
playerRig.add(playerLight);

// dim overhead light: its only real job is casting grounding shadows
const overhead = new THREE.DirectionalLight(0xffd0c0, 0.55);
overhead.position.set(12, 30, 8);
overhead.castShadow = true;
overhead.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
overhead.shadow.camera.left = -55;
overhead.shadow.camera.right = 55;
overhead.shadow.camera.top = 55;
overhead.shadow.camera.bottom = -55;
overhead.shadow.camera.near = 5;
overhead.shadow.camera.far = 60;
overhead.shadow.bias = -0.0005;
scene.add(overhead);

// bio-luminescent accent lights with flicker (animated in the render loop)
const flickerLights = [];
[[-28, -28], [28, 28], [-28, 28], [28, -28], [0, 0]].forEach(([x, z], i) => {
  const l = new THREE.PointLight(i % 2 ? 0xff2838 : 0x18c8a8, i % 2 ? 85 : 60, 42, 1.7);
  l.position.set(x, WALL_HEIGHT - 1.5, z);
  scene.add(l);
  flickerLights.push({ light: l, base: l.intensity, speed: 5 + Math.random() * 7, phase: Math.random() * 10 });
});
// dim warm fill along the mid-walls so the far field isn't a black void
[[0, -40], [0, 40], [-40, 0], [40, 0]].forEach(([x, z]) => {
  const l = new THREE.PointLight(0xff5a40, 50, 38, 1.8);
  l.position.set(x, WALL_HEIGHT - 2, z);
  scene.add(l);
  flickerLights.push({ light: l, base: l.intensity, speed: 4 + Math.random() * 5, phase: Math.random() * 10 });
});

// ---------- level geometry / colliders ----------
const wallBoxes = []; // {minX,maxX,minZ,maxZ}
const wallMeshes = [];
const wallMats = []; // shared list so artery glow can pulse in the render loop
const wallCanvases = makeWallCanvases();

// tessellated box with position-hashed jitter — organic, but still welded
function organicBox(w, h, d) {
  const geo = new THREE.BoxGeometry(
    w, h, d,
    Math.max(1, Math.round(w / 1.2)), Math.max(2, Math.round(h / 1.2)), Math.max(1, Math.round(d / 1.2))
  );
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 1.9 + v.y * 1.3) * Math.sin(v.y * 2.3 + v.z * 1.7) * Math.sin(v.z * 2.1 + v.x * 1.1);
    v.multiplyScalar(1 + n * 0.035);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function addWall(cx, cz, w, d) {
  wallBoxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
  const rx = Math.max(w, d) / 6, ry = WALL_HEIGHT / 6;
  const mat = new THREE.MeshStandardMaterial({
    map: toTexture(wallCanvases.color, rx, ry),
    bumpMap: toTexture(wallCanvases.bump, rx, ry, false),
    bumpScale: 0.8,
    emissiveMap: toTexture(wallCanvases.emissive, rx, ry),
    emissive: 0xff2233,
    emissiveIntensity: 0.25,
    roughness: 0.72,
    metalness: 0.0,
  });
  wallMats.push(mat);
  const mesh = new THREE.Mesh(organicBox(w, WALL_HEIGHT, d), mat);
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
const floorMaps = makeFloorMaps(7);
const floorMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF * 2 + 8, ARENA_HALF * 2 + 8),
  new THREE.MeshStandardMaterial({
    map: floorMaps.map, bumpMap: floorMaps.bumpMap, bumpScale: 0.7,
    roughnessMap: floorMaps.roughnessMap, roughness: 1,
  })
);
floorMesh.rotation.x = -Math.PI / 2;
floorMesh.receiveShadow = true;
scene.add(floorMesh);

const ceilMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(ARENA_HALF * 2 + 8, ARENA_HALF * 2 + 8),
  new THREE.MeshStandardMaterial({
    map: toTexture(wallCanvases.color, 9, 9),
    bumpMap: toTexture(wallCanvases.bump, 9, 9, false),
    bumpScale: 0.6,
    emissiveMap: toTexture(wallCanvases.emissive, 9, 9),
    emissive: 0xff2233, emissiveIntensity: 0.18,
    roughness: 0.9, color: 0x6a4550,
  })
);
ceilMesh.rotation.x = Math.PI / 2;
ceilMesh.position.y = WALL_HEIGHT;
scene.add(ceilMesh);

// merge helper for static decor / enemy parts (keeps draw calls down)
function mergeGeoms(geos) {
  const nis = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let total = 0;
  for (const g of nis) total += g.attributes.position.count;
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const itemSize = name === 'uv' ? 2 : 3;
    const arr = new Float32Array(total * itemSize);
    let off = 0;
    for (const g of nis) {
      const a = g.attributes[name];
      if (a) arr.set(a.array, off);
      off += g.attributes.position.count * itemSize;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, itemSize));
  }
  return merged;
}

// ---------- organic set dressing ----------
{
  // polyp clusters hugging the wall bases
  const polypGeos = [], pusGeos = [];
  const spots = [];
  for (let i = 0; i < 30; i++) {
    const side = i % 4;
    const t = (Math.random() * 2 - 1) * (ARENA_HALF - 4);
    const m = ARENA_HALF - 0.9;
    spots.push(side === 0 ? [t, -m] : side === 1 ? [t, m] : side === 2 ? [-m, t] : [m, t]);
  }
  [[-20, 0], [20, 0], [0, -20], [0, 20], [-13, -13], [13, 13], [-13, 13], [13, -13], [-32, 10], [32, -10], [10, 32], [-10, -32]]
    .forEach(([x, z]) => spots.push([x + 2.6, z + 2.6], [x - 2.6, z - 2.6]));
  for (const [x, z] of spots) {
    const n = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const r = 0.18 + Math.random() * 0.5;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      lumpify(geo, 0.25, Math.random() * 9, Math.random() * 9, Math.random() * 9);
      geo.translate(x + (Math.random() - 0.5) * 1.8, r * 0.55, z + (Math.random() - 0.5) * 1.8);
      (Math.random() < 0.25 ? pusGeos : polypGeos).push(geo);
    }
  }
  const polyps = new THREE.Mesh(mergeGeoms(polypGeos), new THREE.MeshStandardMaterial({
    map: toTexture(wallCanvases.color, 2, 2), bumpMap: toTexture(wallCanvases.bump, 2, 2, false),
    bumpScale: 0.4, color: 0xa06068, roughness: 0.5,
  }));
  polyps.castShadow = polyps.receiveShadow = true;
  scene.add(polyps);
  const pus = new THREE.Mesh(mergeGeoms(pusGeos), new THREE.MeshStandardMaterial({
    color: 0xa8854a, emissive: 0x3a2c0c, emissiveIntensity: 0.4, roughness: 0.3,
  }));
  scene.add(pus);

  // sinew tendrils hanging from the ceiling
  const tendrilGeos = [];
  for (let i = 0; i < 42; i++) {
    const x = (Math.random() * 2 - 1) * (ARENA_HALF - 3), z = (Math.random() * 2 - 1) * (ARENA_HALF - 3);
    const len = 0.8 + Math.random() * 1.9;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, WALL_HEIGHT + 0.2, z),
      new THREE.Vector3(x + (Math.random() - 0.5) * 0.5, WALL_HEIGHT - len * 0.5, z + (Math.random() - 0.5) * 0.5),
      new THREE.Vector3(x + (Math.random() - 0.5) * 1.0, WALL_HEIGHT - len, z + (Math.random() - 0.5) * 1.0),
    ]);
    tendrilGeos.push(new THREE.TubeGeometry(curve, 6, 0.04 + Math.random() * 0.09, 5));
  }
  const hangers = new THREE.Mesh(mergeGeoms(tendrilGeos), new THREE.MeshStandardMaterial({
    color: 0x5a1c26, roughness: 0.55,
  }));
  scene.add(hangers);
}

// drifting spores for atmosphere
const SPORE_COUNT = IS_TOUCH ? 160 : 280;
const sporeBase = new Float32Array(SPORE_COUNT * 3);
const sporePhase = new Float32Array(SPORE_COUNT);
for (let i = 0; i < SPORE_COUNT; i++) {
  sporeBase[i * 3] = (Math.random() * 2 - 1) * (ARENA_HALF - 1);
  sporeBase[i * 3 + 1] = 0.4 + Math.random() * (WALL_HEIGHT - 1);
  sporeBase[i * 3 + 2] = (Math.random() * 2 - 1) * (ARENA_HALF - 1);
  sporePhase[i] = Math.random() * Math.PI * 2;
}
const sporeGeo = new THREE.BufferGeometry();
sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporeBase.slice(), 3));
const sporePoints = new THREE.Points(sporeGeo, new THREE.PointsMaterial({
  color: 0xff9090, size: 0.11, map: particleTex, transparent: true, opacity: 0.5,
  blending: THREE.AdditiveBlending, depthWrite: false,
}));
scene.add(sporePoints);
function updateSpores(t) {
  const pos = sporeGeo.attributes.position;
  for (let i = 0; i < SPORE_COUNT; i++) {
    const p = sporePhase[i];
    pos.array[i * 3] = sporeBase[i * 3] + Math.sin(t * 0.25 + p) * 0.9;
    pos.array[i * 3 + 1] = sporeBase[i * 3 + 1] + Math.sin(t * 0.4 + p * 1.7) * 0.5;
    pos.array[i * 3 + 2] = sporeBase[i * 3 + 2] + Math.cos(t * 0.22 + p) * 0.9;
  }
  pos.needsUpdate = true;
}

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
document.addEventListener('mousedown', () => { if (state.running && !IS_TOUCH) state.firing = true; });
document.addEventListener('mouseup', () => { state.firing = false; });

// ---------- touch controls ----------
// left side: floating joystick for movement; right side: drag to aim.
// dedicated FIRE / WPN / pause buttons live outside the canvas.
const touchState = { moveId: null, moveOriginX: 0, moveOriginY: 0, moveX: 0, moveY: 0, lookId: null, lookX: 0, lookY: 0 };
const STICK_RADIUS = 50;
let pauseTapTime = -1e9; // swallow the ghost click that follows a pause-button tap
const eatDefault = (e) => { if (e.cancelable) e.preventDefault(); };
if (IS_TOUCH) {
  document.body.classList.add('mobile');
  const stickBase = $('stickBase'), stickKnob = $('stickKnob');
  const gameEl = $('game');

  const resetStick = () => {
    touchState.moveId = null;
    touchState.moveX = touchState.moveY = 0;
    stickKnob.style.transform = 'translate(-50%, -50%)';
    stickBase.style.left = '36px';
    stickBase.style.top = 'auto';
    stickBase.style.bottom = '110px';
  };

  gameEl.addEventListener('touchstart', (e) => {
    eatDefault(e);
    if (!state.running) return;
    for (const t of e.changedTouches) {
      if (t.clientX < window.innerWidth * 0.45 && touchState.moveId === null) {
        touchState.moveId = t.identifier;
        touchState.moveOriginX = t.clientX;
        touchState.moveOriginY = t.clientY;
        stickBase.style.left = (t.clientX - 60) + 'px';
        stickBase.style.top = (t.clientY - 60) + 'px';
        stickBase.style.bottom = 'auto';
      } else if (touchState.lookId === null) {
        touchState.lookId = t.identifier;
        touchState.lookX = t.clientX;
        touchState.lookY = t.clientY;
      }
    }
  }, { passive: false });

  gameEl.addEventListener('touchmove', (e) => {
    eatDefault(e);
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.moveId) {
        let dx = t.clientX - touchState.moveOriginX, dy = t.clientY - touchState.moveOriginY;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
        touchState.moveX = dx / STICK_RADIUS;
        touchState.moveY = dy / STICK_RADIUS;
        stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      } else if (t.identifier === touchState.lookId) {
        state.yaw -= (t.clientX - touchState.lookX) * TOUCH_SENS;
        state.pitch -= (t.clientY - touchState.lookY) * TOUCH_SENS;
        state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch));
        touchState.lookX = t.clientX;
        touchState.lookY = t.clientY;
      }
    }
  }, { passive: false });

  const onTouchEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === touchState.moveId) resetStick();
      else if (t.identifier === touchState.lookId) touchState.lookId = null;
    }
  };
  gameEl.addEventListener('touchend', onTouchEnd);
  gameEl.addEventListener('touchcancel', onTouchEnd);

  const fireBtn = $('fireBtn');
  fireBtn.addEventListener('touchstart', (e) => { eatDefault(e); if (state.running) state.firing = true; }, { passive: false });
  fireBtn.addEventListener('touchend', (e) => { eatDefault(e); state.firing = false; }, { passive: false });
  fireBtn.addEventListener('touchcancel', () => { state.firing = false; });
  $('weaponBtn').addEventListener('touchstart', (e) => {
    eatDefault(e);
    switchWeapon((currentWeapon + 1) % weapons.length);
  }, { passive: false });
  $('pauseBtn').addEventListener('touchstart', (e) => {
    eatDefault(e);
    pauseTapTime = performance.now();
    pauseGame();
  }, { passive: false });

  document.addEventListener('contextmenu', (e) => e.preventDefault());
}

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
  { radius: 0.85, hp: 14, speed: 7.0, color: 0xb9c22e, score: 25, damage: 6 },
  { radius: 1.45, hp: 32, speed: 4.8, color: 0xd14848, score: 50, damage: 10 },
  { radius: 2.2, hp: 65, speed: 3.2, color: 0x9a40c0, score: 100, damage: 16 },
];
const spitterDef = { radius: 1.5, hp: 40, speed: 3.6, color: 0xe040d0, score: 150, damage: 9 };

const enemies = [];
const enemyRoot = new THREE.Group();
scene.add(enemyRoot);

// position-hashed displacement keeps duplicated vertices welded (no cracks)
function lumpify(geo, amount, s1, s2, s3, freq = 1) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 3.1 * freq + s1) * Math.sin(v.y * 2.7 * freq + s2) * Math.sin(v.z * 3.4 * freq + s3);
    v.multiplyScalar(1 + n * amount);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

// tumor skin palettes: sickly pus, inflamed flesh, necrotic violet, toxic magenta
const cellPalettes = [
  {
    base: '#6e681e', blotches: ['rgba(50,48,10,0.5)', 'rgba(150,146,70,0.35)', 'rgba(95,76,24,0.4)', 'rgba(40,32,6,0.45)'],
    veinDark: 'rgba(40,46,6,0.6)', veinMid: 'rgba(130,150,40,0.5)',
    glow: 'rgba(170,255,70,0.9)', glowSoft: 'rgba(130,210,50,0.3)', tendril: 0x6a7026,
  },
  {
    base: '#8e3038', blotches: ['rgba(90,16,24,0.5)', 'rgba(192,80,88,0.35)', 'rgba(130,40,50,0.4)', 'rgba(45,8,12,0.45)'],
    veinDark: 'rgba(48,6,12,0.6)', veinMid: 'rgba(190,60,50,0.5)',
    glow: 'rgba(255,90,58,0.9)', glowSoft: 'rgba(220,60,40,0.3)', tendril: 0x7a2830,
  },
  {
    base: '#4f2350', blotches: ['rgba(42,14,46,0.55)', 'rgba(122,64,120,0.35)', 'rgba(70,30,72,0.4)', 'rgba(20,6,24,0.5)'],
    veinDark: 'rgba(28,5,32,0.6)', veinMid: 'rgba(150,70,160,0.5)',
    glow: 'rgba(192,80,255,0.9)', glowSoft: 'rgba(150,60,210,0.3)', tendril: 0x4a2050,
  },
  {
    base: '#6e2068', blotches: ['rgba(56,10,54,0.55)', 'rgba(160,64,160,0.35)', 'rgba(100,30,96,0.4)', 'rgba(25,4,26,0.5)'],
    veinDark: 'rgba(36,4,36,0.6)', veinMid: 'rgba(220,70,200,0.5)',
    glow: 'rgba(255,70,225,0.95)', glowSoft: 'rgba(220,50,190,0.35)', tendril: 0x7a2470,
  },
];

function makeCellSkin(p) {
  const s = 256;
  const veins = veinPaths(s, 24);
  const color = makeCanvas(s, (ctx) => {
    ctx.fillStyle = p.base;
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, 150, p.blotches, 5, 40);
    strokeVeins(ctx, veins, p.veinDark, 1.4);
    strokeVeins(ctx, veins, p.veinMid, 0.6);
  });
  const bump = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#909090';
    ctx.fillRect(0, 0, s, s);
    mottle(ctx, s, 130, ['rgba(255,255,255,0.35)', 'rgba(0,0,0,0.35)'], 4, 30);
    strokeVeins(ctx, veins, 'rgba(255,255,255,0.6)', 1.2, 2);
  });
  const emissive = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, s, s);
    strokeVeins(ctx, veins, p.glow, 0.9, 5);
    mottle(ctx, s, 12, [p.glowSoft], 10, 36);
  });
  return {
    map: toTexture(color), bumpMap: toTexture(bump, 1, 1, false), emissiveMap: toTexture(emissive),
  };
}

// shared material sets per palette; only the membrane is cloned per enemy (for hit flash)
function makePaletteMats(p) {
  const skin = makeCellSkin(p);
  return {
    membrane: new THREE.MeshPhysicalMaterial({
      map: skin.map, bumpMap: skin.bumpMap, bumpScale: 1.0,
      emissiveMap: skin.emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.5,
      roughness: 0.38, clearcoat: 0.55, clearcoatRoughness: 0.3,
    }),
    spur: new THREE.MeshStandardMaterial({ color: 0xd9cba6, roughness: 0.55 }),
    tendril: new THREE.MeshStandardMaterial({ color: p.tendril, roughness: 0.5 }),
    lesion: new THREE.MeshStandardMaterial({ color: 0x1c0a14, roughness: 0.95 }),
    gullet: new THREE.MeshStandardMaterial({ color: 0x0d0306, emissive: 0x550a12, emissiveIntensity: 0.6, roughness: 0.8 }),
    fang: new THREE.MeshStandardMaterial({ color: 0xe8ddc0, roughness: 0.35 }),
  };
}
enemyTiers.forEach((def, i) => { def.mats = makePaletteMats(cellPalettes[i]); });
spitterDef.mats = makePaletteMats(cellPalettes[3]);

// jaundiced bloodshot eyeball; iris sits at +X on the sphere's UV layout
function makeEyeTexture() {
  const s = 128;
  const c = makeCanvas(s, (ctx) => {
    ctx.fillStyle = '#ddd2bc';
    ctx.fillRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2;
    ctx.strokeStyle = 'rgba(170,30,30,0.55)';
    for (let i = 0; i < 30; i++) {
      const a = Math.random() * Math.PI * 2;
      let x = cx + Math.cos(a) * s * 0.16, y = cy + Math.sin(a) * s * 0.16;
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += Math.cos(a + (Math.random() - 0.5)) * s * 0.1;
        y += Math.sin(a + (Math.random() - 0.5)) * s * 0.1;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const ir = s * 0.15;
    const g = ctx.createRadialGradient(cx, cy, ir * 0.2, cx, cy, ir);
    g.addColorStop(0, '#c8b418');
    g.addColorStop(0.8, '#6e2406');
    g.addColorStop(1, '#160803');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, ir, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath(); ctx.ellipse(cx, cy, ir * 0.2, ir * 0.78, 0, 0, Math.PI * 2); ctx.fill();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const eyeTex = makeEyeTexture();
// faint emissive on the same map so the eyes shine out of the dark
const eyeMat = new THREE.MeshStandardMaterial({
  map: eyeTex, roughness: 0.18,
  emissiveMap: eyeTex, emissive: 0xffb030, emissiveIntensity: 0.22,
});

const _up = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _mtx = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);

function buildCellMesh(def, isSpitter) {
  const group = new THREE.Group();
  const M = def.mats;
  const r = def.radius;

  // membrane: two octaves of lumps, wet veined skin
  const geo = new THREE.IcosahedronGeometry(r, r >= 1.4 ? 4 : 3);
  const s1 = Math.random() * 10, s2 = Math.random() * 10, s3 = Math.random() * 10;
  lumpify(geo, 0.14, s1, s2, s3);
  lumpify(geo, 0.06, s3, s1, s2, 2.6);
  const mat = M.membrane.clone();
  const body = new THREE.Mesh(geo, mat);
  body.castShadow = true;
  group.add(body);

  // bone spurs (kept clear of the face at +Z, which always turns to the player)
  const spurGeos = [];
  const spurCount = 7 + Math.floor(Math.random() * 5);
  for (let i = 0; i < spurCount; i++) {
    let dir;
    do { dir = new THREE.Vector3().randomDirection(); } while (dir.z > 0.72);
    const g = new THREE.ConeGeometry(r * 0.08, r * (0.45 + Math.random() * 0.5), 5);
    _quat.setFromUnitVectors(_up, dir);
    _mtx.compose(dir.clone().multiplyScalar(r * 0.92), _quat, _one);
    g.applyMatrix4(_mtx);
    spurGeos.push(g);
  }
  group.add(new THREE.Mesh(mergeGeoms(spurGeos), M.spur));

  // tendrils drooping under their own weight
  const tenGeos = [];
  const tenCount = 8 + Math.floor(Math.random() * 5);
  for (let i = 0; i < tenCount; i++) {
    let dir;
    do { dir = new THREE.Vector3().randomDirection(); } while (dir.z > 0.8);
    const j = () => (Math.random() - 0.5) * r * 0.35;
    const curve = new THREE.CatmullRomCurve3([
      dir.clone().multiplyScalar(r * 0.9),
      dir.clone().multiplyScalar(r * 1.25).add(new THREE.Vector3(j(), j() - r * 0.08, j())),
      dir.clone().multiplyScalar(r * 1.5).add(new THREE.Vector3(j(), j() - r * 0.3, j())),
      dir.clone().multiplyScalar(r * 1.62).add(new THREE.Vector3(j(), j() - r * 0.55, j())),
    ]);
    tenGeos.push(new THREE.TubeGeometry(curve, 7, r * 0.045, 5));
  }
  group.add(new THREE.Mesh(mergeGeoms(tenGeos), M.tendril));

  // necrotic lesions
  const lesionGeos = [];
  for (let i = 0; i < 6; i++) {
    const dir = new THREE.Vector3().randomDirection();
    const g = new THREE.IcosahedronGeometry(r * (0.14 + Math.random() * 0.14), 1);
    lumpify(g, 0.3, Math.random() * 9, Math.random() * 9, Math.random() * 9);
    g.translate(dir.x * r * 0.96, dir.y * r * 0.96, dir.z * r * 0.96);
    lesionGeos.push(g);
  }
  group.add(new THREE.Mesh(mergeGeoms(lesionGeos), M.lesion));

  // lamprey maw on the leading face
  {
    const dir = new THREE.Vector3(0, -0.18, 1).normalize();
    const m = r * 0.4;
    const maw = new THREE.Group();
    maw.position.copy(dir).multiplyScalar(r * 0.8);
    maw.quaternion.setFromUnitVectors(_zAxis, dir);
    const gullet = new THREE.Mesh(new THREE.SphereGeometry(m, 12, 8), M.gullet);
    gullet.scale.z = 0.55;
    maw.add(gullet);
    const fangGeos = [];
    const teeth = 9;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2 + Math.random() * 0.3;
      const g = new THREE.ConeGeometry(m * 0.16, m * (0.5 + Math.random() * 0.25), 5);
      _quat.setFromUnitVectors(_up, new THREE.Vector3(-Math.cos(a) * 0.8, -Math.sin(a) * 0.8, 0.55).normalize());
      _mtx.compose(new THREE.Vector3(Math.cos(a) * m * 0.82, Math.sin(a) * m * 0.82, m * 0.34), _quat, _one);
      g.applyMatrix4(_mtx);
      fangGeos.push(g);
    }
    maw.add(new THREE.Mesh(mergeGeoms(fangGeos), M.fang));
    group.add(maw);
  }

  // bloodshot eyes; irises converge on the player since the group faces them
  const eyeCount = isSpitter ? 1 : 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < eyeCount; i++) {
    const er = r * (isSpitter ? 0.3 : 0.15 + Math.random() * 0.09);
    const dir = isSpitter
      ? new THREE.Vector3(0, 0.35, 1).normalize()
      : new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.25 + Math.random() * 0.5, 1).normalize();
    const eye = new THREE.Mesh(new THREE.SphereGeometry(er, 12, 10), eyeMat);
    eye.position.copy(dir).multiplyScalar(r * 0.93);
    const gaze = dir.clone().multiplyScalar(0.35).add(_zAxis).normalize();
    eye.quaternion.setFromUnitVectors(_xAxis, gaze);
    group.add(eye);
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
  enemy.mat.dispose();
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

// geometries are unique per enemy; materials/textures are shared, except the
// cloned membrane material which killEnemy disposes explicitly
function disposeGroup(group) {
  group.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
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
    color, size: 0.26, map: particleTex, transparent: true, opacity: 1,
    blending: THREE.AdditiveBlending, depthWrite: false,
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
  document.body.classList.remove('playing');
  if (document.exitPointerLock) document.exitPointerLock();
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
    // asymmetric breathing squash-and-stretch
    const pulse = 1 + Math.sin(t * 3 + e.pulsePhase) * 0.05;
    const pulseY = 1 + Math.sin(t * 3.4 + e.pulsePhase * 1.3) * 0.08;
    e.group.scale.set(e.scale * pulse, e.scale * pulseY, e.scale * pulse);

    // hit flash: overbright body + hot veins, else slow vein throb
    if (e.flash > 0) {
      e.flash -= dt;
      e.mat.color.setRGB(3, 3, 3);
      e.mat.emissiveIntensity = 2.5;
    } else {
      e.mat.color.setRGB(1, 1, 1);
      e.mat.emissiveIntensity = 0.55 + Math.sin(t * 3.5 + e.pulsePhase) * 0.3;
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
    e.pos.y = e.def.radius * e.scale * pulseY * 0.95;

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
  const stickMag = Math.hypot(touchState.moveX, touchState.moveY);
  if (stickMag > 0.12) { // deadzone
    mx += _fwd.x * -touchState.moveY + _right.x * touchState.moveX;
    mz += _fwd.z * -touchState.moveY + _right.z * touchState.moveX;
  }
  const moving = mx !== 0 || mz !== 0;
  if (moving) {
    const len = Math.hypot(mx, mz);
    const sprinting = keys['ShiftLeft'] || keys['ShiftRight'] || stickMag > 0.95;
    const speed = sprinting ? SPRINT_SPEED : MOVE_SPEED;
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

// ---------- start / pause flow (pointer lock on desktop, direct on touch) ----------
let started = false;
function enterGame() {
  startOverlay.style.display = 'none';
  pauseOverlay.style.display = 'none';
  hud.style.display = 'flex';
  crosshair.style.display = 'block';
  document.body.classList.add('playing');
  state.running = true;
  if (!started) {
    started = true;
    startWave();
  }
}
function pauseGame() {
  state.running = false;
  state.firing = false;
  document.body.classList.remove('playing');
  if (!state.over && started) {
    pauseOverlay.style.display = 'flex';
    hud.style.display = 'none';
    crosshair.style.display = 'none';
  }
}
function tryMobileFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {});
  } catch (e) { /* iOS Safari: no fullscreen API on iPhone — play inline */ }
}
function onOverlayTap() {
  if (performance.now() - pauseTapTime < 600) return; // ghost click after pause tap
  initAudio();
  if (actx && actx.state === 'suspended') actx.resume();
  if (IS_TOUCH) {
    tryMobileFullscreen();
    enterGame();
  } else {
    renderer.domElement.requestPointerLock();
  }
}
startOverlay.addEventListener('click', onOverlayTap);
pauseOverlay.addEventListener('click', onOverlayTap);
gameOverOverlay.addEventListener('click', () => location.reload());

document.addEventListener('pointerlockchange', () => {
  if (IS_TOUCH) return;
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) enterGame();
  else pauseGame();
});

// pause when the app is backgrounded (tab switch, phone lock, notification shade)
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.running) pauseGame();
});

// ---------- main loop ----------
const clock = new THREE.Clock();
let elapsed = 0;
let worldTime = 0;
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  worldTime += dt;
  if (state.running) {
    elapsed += dt;
    updatePlayer(dt, elapsed);
    updateEnemies(dt, elapsed);
    updateSpit(dt);
    updateWaveFlow(dt);
    updatePickups(dt, elapsed);
  }
  // living-organ ambience: flickering lights, throbbing arteries, drifting spores
  for (const f of flickerLights) {
    f.light.intensity = f.base * (0.78 + 0.22 * Math.sin(worldTime * f.speed + f.phase) + (Math.random() - 0.5) * 0.1);
  }
  const arteryGlow = 0.05 + Math.max(0, Math.sin(worldTime * 1.7)) * 0.13;
  for (const m of wallMats) m.emissiveIntensity = arteryGlow;
  ceilMesh.material.emissiveIntensity = arteryGlow * 0.35;
  updateSpores(worldTime);
  updateParticles(dt);
  updateTracers(dt);
  renderer.render(scene, camera);
}
updateHUD();
animate();

// debug/testing handle
window.CANCERDOOM = { state, playerRig, enemies, spawnEnemy };
