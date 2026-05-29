import {
  engineInit,
  drawTextScreen,
  vec2,
  rgb,
  setShowSplashScreen,
  setCameraScale,
  setCanvasClearColor,
  setCanvasPixelated,
  mainCanvasSize,
  mainContext,
  time,
  keyWasPressed,
  mouseWasPressed,
  timeDelta,
} from "./node_modules/littlejsengine/dist/littlejs.esm.js";
import {
  initBackgroundMusic,
  tryStartBackgroundMusic,
  playTingSound,
  playGameOverSound,
} from "./music.js";

// ── grid & isometric layout ───────────────────────────────────────────────────
const GRID_W = 14;
const GRID_H = 22;
const OCEAN_ROWS = 4;
const BEACH_ROWS = GRID_H - OCEAN_ROWS;

const TILE_W = 52;
const TILE_H = 26;
const TILE_DEPTH = 10;

const WAVE_CYCLE_SEC = 7;
const WAVE_BEACH_COVER = 0.8;

let wavePhase = 0;
let waveAmplitude = 1;
let lastCycleIndex = -1;

const CRABS_PER_WAVE_MIN = 4;
const CRABS_PER_WAVE_MAX = 5;
const WIN_CRAB_COUNT = 30;
const crabs = new Map();
let crabsSpawnBudget = 0;
let prevTileKinds = null;
let caughtCrabs = 0;

const PLAYER_SPEED = 4.5;
const GREEN_ZONE_IX = 7;
const GREEN_ZONE_IY = GRID_H - 2;
const player = {
  ix: GREEN_ZONE_IX,
  iy: GREEN_ZONE_IY,
  x: GREEN_ZONE_IX,
  y: GREEN_ZONE_IY,
  facing: 1,
  moving: false,
};

// Pixel sprite: . = transparent, letters = palette keys
const PLAYER_SPRITE = [
  "....ssss....",
  "...ssssss...",
  "..ssssssss..",
  "..ssooosss..",
  "...sooos....",
  "..wwwwwwww..",
  "..wbwbwbww..",
  "..wwbwbwww..",
  "..wbwbwbww..",
  "..wwwwwwww..",
  "...nnnnnn...",
  "...nnnnnn...",
  "..ll..ll....",
  "..ll..ll....",
  ".ff....ff...",
  ".ff....ff...",
];

const PLAYER_PALETTE = {
  s: "#f4c9a0",
  o: "#2a1810",
  w: "#f5f5f5",
  b: "#2563b8",
  n: "#142a5c",
  l: "#f4c9a0",
  f: "#5c4033",
};

// ── isometric projection ──────────────────────────────────────────────────────
function getOrigin() {
  const w = mainCanvasSize.x;
  const h = mainCanvasSize.y;
  return { x: w * 0.5, y: h * 0.22 };
}

function isoToScreen(ix, iy, iz = 0) {
  const { x: ox, y: oy } = getOrigin();
  return {
    x: ox + (ix - iy) * (TILE_W * 0.5),
    y: oy + (ix + iy) * (TILE_H * 0.5) - iz * TILE_DEPTH,
  };
}

// ── wave simulation ───────────────────────────────────────────────────────────
function updateWave() {
  const cycle = (time * (Math.PI * 2)) / WAVE_CYCLE_SEC;
  wavePhase = cycle;

  const cycleIndex = Math.floor(cycle / (Math.PI * 2));
  if (cycleIndex !== lastCycleIndex) {
    lastCycleIndex = cycleIndex;
    // Each cycle: how much of the 80% beach strip the wave floods (40%–100% of max).
    waveAmplitude = 0.4 + Math.random() * 0.6;
    resetCrabSpawnBudget();
  }
}

/** 0 = shoreline, 1 = full 80% beach flooded at peak (× per-cycle amplitude). */
function waveCoverage01() {
  const t = (1 - Math.cos(wavePhase)) * 0.5;
  return Math.min(1, t * WAVE_BEACH_COVER * waveAmplitude);
}

/** Visual swell height for water tiles (randomized per cycle). */
function waveSwell() {
  return 0.35 + waveAmplitude * 0.45;
}

/** Beach row index (0 = ocean) where the wet line sits. */
function waveEdgeRow() {
  return OCEAN_ROWS + waveCoverage01() * BEACH_ROWS;
}

function tileAt(ix, iy) {
  if (ix < 0 || iy < 0 || ix >= GRID_W || iy >= GRID_H) return "void";
  if (iy < OCEAN_ROWS) return "ocean";
  const edge = waveEdgeRow();
  if (iy < edge - 0.35) return "water";
  if (iy < edge + 0.25) return "foam";
  if (iy < edge + 1.1) return "wet";
  return "sand";
}

function tileKey(ix, iy) {
  return `${ix},${iy}`;
}

function isSubmerged(kind) {
  return kind === "water" || kind === "foam" || kind === "ocean";
}

function isExposedBeach(kind) {
  return kind === "wet" || kind === "sand";
}

function canPlayerWalk(ix, iy) {
  if (ix < 0 || iy < 0 || ix >= GRID_W || iy >= GRID_H) return false;
  const kind = tileAt(ix, iy);
  return kind === "sand" || kind === "wet";
}

function updatePlayer() {
  let dx = 0;
  let dy = 0;
  if (keyWasPressed("ArrowUp")) {
    dx = -1;
    dy = -1;
  } else if (keyWasPressed("ArrowDown")) {
    dx = 1;
    dy = 1;
  } else if (keyWasPressed("ArrowLeft")) {
    dx = -1;
    dy = 1;
  } else if (keyWasPressed("ArrowRight")) {
    dx = 1;
    dy = -1;
  }

  if (dx !== 0 || dy !== 0) {
    const tx = Math.round(player.x) + dx;
    const ty = Math.round(player.y) + dy;
    if (canPlayerWalk(tx, ty)) {
      player.ix = tx;
      player.iy = ty;
      player.facing = dx < 0 || (dx === 0 && dy > 0) ? -1 : 1;
    }
  }

  const dist = Math.hypot(player.ix - player.x, player.iy - player.y);
  if (dist > 0.02) {
    const step = Math.min(PLAYER_SPEED * timeDelta, dist);
    const t = step / dist;
    player.x += (player.ix - player.x) * t;
    player.y += (player.iy - player.y) * t;
    player.moving = true;
  } else {
    player.x = player.ix;
    player.y = player.iy;
    player.moving = false;
  }
}

function drawPlayer() {
  const ix = player.x;
  const iy = player.y;
  const kind = tileAt(Math.round(ix), Math.round(iy));
  if (!canPlayerWalk(Math.round(ix), Math.round(iy)) && kind !== "sand" && kind !== "wet") {
    return;
  }

  const elev = kind === "sand" ? 0.15 * Math.sin(ix * 1.3 + iy * 0.9) : 0.08;
  const bob = player.moving ? Math.sin(time * 14) * 1.5 : Math.sin(time * 3) * 0.6;
  const base = isoToScreen(ix, iy, elev);
  const cx = base.x;
  const cy = base.y - 22 + bob;
  const ctx = mainContext;
  const px = 2.2;
  const rows = PLAYER_SPRITE.length;
  const cols = PLAYER_SPRITE[0].length;
  const w = cols * px;
  const h = rows * px;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(player.facing, 1);

  for (let row = 0; row < rows; row++) {
    const line = PLAYER_SPRITE[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === ".") continue;
      const color = PLAYER_PALETTE[ch];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(col * px - w * 0.5, row * px - h, px, px);
    }
  }

  ctx.restore();
}

function resetCrabSpawnBudget() {
  crabsSpawnBudget =
    CRABS_PER_WAVE_MIN +
    Math.floor(Math.random() * (CRABS_PER_WAVE_MAX - CRABS_PER_WAVE_MIN + 1));
}

function initPrevTiles() {
  prevTileKinds = Array.from({ length: GRID_W }, () =>
    Array.from({ length: GRID_H }, () => "void"),
  );
  for (let iy = 0; iy < GRID_H; iy++) {
    for (let ix = 0; ix < GRID_W; ix++) {
      prevTileKinds[ix][iy] = tileAt(ix, iy);
    }
  }
}

function respawnPlayerOnGreenZone() {
  player.ix = GREEN_ZONE_IX;
  player.iy = GREEN_ZONE_IY;
  player.x = GREEN_ZONE_IX;
  player.y = GREEN_ZONE_IY;
  player.moving = false;
}

function checkPlayerInWater() {
  const ix = Math.round(player.x);
  const iy = Math.round(player.y);
  const kind = tileAt(ix, iy);
  if (kind !== "water" && kind !== "foam") return;

  caughtCrabs = 0;
  playGameOverSound();
  respawnPlayerOnGreenZone();
}

function tryCatchCrab() {
  if (player.moving) return;

  const key = tileKey(player.ix, player.iy);
  if (!crabs.has(key)) return;

  crabs.delete(key);
  caughtCrabs++;
  playTingSound();
}

function updateCrabs() {
  if (!prevTileKinds) return;

  for (let iy = OCEAN_ROWS; iy < GRID_H; iy++) {
    for (let ix = 0; ix < GRID_W; ix++) {
      const prev = prevTileKinds[ix][iy];
      const curr = tileAt(ix, iy);
      const key = tileKey(ix, iy);

      if (crabs.has(key) && isSubmerged(curr)) {
        crabs.delete(key);
      }

      if (
        !crabs.has(key) &&
        crabsSpawnBudget > 0 &&
        isSubmerged(prev) &&
        isExposedBeach(curr) &&
        Math.random() < 0.14
      ) {
        crabs.set(key, {
          ix,
          iy,
          facing: Math.random() < 0.5 ? -1 : 1,
          phase: Math.random() * Math.PI * 2,
        });
        crabsSpawnBudget--;
      }

      prevTileKinds[ix][iy] = curr;
    }
  }
}

// ── canvas helpers ────────────────────────────────────────────────────────────
function drawDiamond(cx, cy, w, h, fill, stroke) {
  const ctx = mainContext;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx, cy - h * 0.5);
  ctx.lineTo(cx + w * 0.5, cy);
  ctx.lineTo(cx, cy + h * 0.5);
  ctx.lineTo(cx - w * 0.5, cy);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawBlockTop(ix, iy, iz, color, stroke) {
  const { x, y } = isoToScreen(ix, iy, iz);
  drawDiamond(x, y, TILE_W, TILE_H, color, stroke);
}

function drawBlockSides(ix, iy, iz, topColor, leftColor, rightColor) {
  const top = isoToScreen(ix, iy, iz);
  const bot = isoToScreen(ix, iy, iz - 1);
  const ctx = mainContext;
  const hw = TILE_W * 0.5;
  const hh = TILE_H * 0.5;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(top.x - hw, top.y);
  ctx.lineTo(top.x, top.y + hh);
  ctx.lineTo(bot.x, bot.y + hh);
  ctx.lineTo(bot.x - hw, bot.y);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(top.x + hw, top.y);
  ctx.lineTo(top.x, top.y + hh);
  ctx.lineTo(bot.x, bot.y + hh);
  ctx.lineTo(bot.x + hw, bot.y);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();
  ctx.restore();

  drawDiamond(top.x, top.y, TILE_W, TILE_H, topColor, null);
}

// ── tile colors ───────────────────────────────────────────────────────────────
const COLORS = {
  ocean: ["#1a6fa8", "#145a8c", "#0f4a75"],
  water: ["#2d9fd4", "#2489be", "#1a72a5"],
  foam: ["#7ed4f0", "#5ec4e8", "#4ab0d8"],
  wet: ["#c4a574", "#b89564", "#a88454"],
  sand: ["#e8d4a8", "#dcc898", "#d0bc88"],
  grass: ["#5cb85c", "#4da84d", "#3d983d"],
};

function shade(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * factor);
  const g = Math.min(255, ((n >> 8) & 255) * factor);
  const b = Math.min(255, (n & 255) * factor);
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function drawTile(ix, iy) {
  const kind = tileAt(ix, iy);
  if (kind === "void") return;

  const swell = waveSwell();
  const waveAnim =
    kind === "water" || kind === "foam"
      ? 0.9 + swell * 0.12 * Math.sin(time * 4 + ix * 0.7 + iy * 0.5)
      : 1;

  const palette = COLORS[kind] || COLORS.sand;
  const top = shade(palette[0], waveAnim);
  const left = shade(palette[1], waveAnim * 0.88);
  const right = shade(palette[2], waveAnim * 0.82);

  const height =
    kind === "sand"
      ? 0.15 * Math.sin(ix * 1.3 + iy * 0.9)
      : kind === "wet"
        ? 0.08
        : 0;

  drawBlockSides(ix, iy, height, top, left, right);
}

// ── decorations ───────────────────────────────────────────────────────────────
function drawPalm(ix, iy) {
  if (iy < GRID_H - 2) return;

  const trunkH = 2.2;
  const groundZ = 0.35;
  const base = isoToScreen(ix, iy, groundZ);
  const top = isoToScreen(ix, iy, groundZ + trunkH);
  const ctx = mainContext;

  ctx.save();
  ctx.strokeStyle = "#6b4423";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y - 8);
  ctx.stroke();

  const fronds = [
    [-28, -18],
    [28, -18],
    [-22, -32],
    [22, -32],
    [0, -38],
  ];
  ctx.fillStyle = "#2d8a3e";
  for (const [dx, dy] of fronds) {
    ctx.beginPath();
    ctx.ellipse(top.x + dx, top.y + dy, 16, 7, Math.atan2(dy, dx), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawGrassStrip(ix, iy) {
  if (iy < GRID_H - 2) return;
  drawBlockSides(ix, iy, 0.35, COLORS.grass[0], COLORS.grass[1], COLORS.grass[2]);
}

function drawCrab(ix, iy, facing, phase) {
  const kind = tileAt(ix, iy);
  if (!isExposedBeach(kind)) return;

  const wiggle = Math.sin(time * 5 + phase) * 2;
  const base = isoToScreen(ix, iy, kind === "sand" ? 0.15 : 0.08);
  const cx = base.x + wiggle;
  const cy = base.y - 6;
  const ctx = mainContext;
  const sc = facing;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(sc, 1);

  ctx.fillStyle = "#c44a2a";
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 7, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#a83820";
  ctx.beginPath();
  ctx.ellipse(-7, -1, 5, 4, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(7, -1, 5, 4, 0.4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "#8b3018";
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  for (const side of [-1, 1]) {
    for (let leg = 0; leg < 3; leg++) {
      const lx = -4 + leg * 4;
      const ly = 4 + leg * 0.5;
      const sway = Math.sin(time * 8 + phase + leg + (side > 0 ? 1 : 0)) * 3;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx + side * (8 + sway), ly + 6);
      ctx.stroke();
    }
  }

  ctx.fillStyle = "#1a1a1a";
  ctx.beginPath();
  ctx.arc(9, -3, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(11, -5, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ── sky & horizon ─────────────────────────────────────────────────────────────
function drawSky() {
  const w = mainCanvasSize.x;
  const h = mainCanvasSize.y;
  const ctx = mainContext;
  const grad = ctx.createLinearGradient(0, 0, 0, h * 0.55);
  grad.addColorStop(0, "#4eb0ff");
  grad.addColorStop(0.45, "#87ceeb");
  grad.addColorStop(1, "#f5e6c8");
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  const sun = { x: w * 0.78, y: h * 0.14 };
  ctx.save();
  const glow = ctx.createRadialGradient(sun.x, sun.y, 4, sun.x, sun.y, 55);
  glow.addColorStop(0, "rgba(255,250,200,0.95)");
  glow.addColorStop(0.4, "rgba(255,220,120,0.35)");
  glow.addColorStop(1, "rgba(255,200,80,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, 55, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff4c0";
  ctx.beginPath();
  ctx.arc(sun.x, sun.y, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ── scene composition ─────────────────────────────────────────────────────────
const PALMS = [
  [2, 20],
  [11, 20],
  [4, 21],
  [9, 21],
];
function drawScene() {
  drawSky();

  const order = [];
  for (let iy = 0; iy < GRID_H; iy++) {
    for (let ix = 0; ix < GRID_W; ix++) {
      order.push({ ix, iy, key: ix + iy });
    }
  }
  order.sort((a, b) => a.key - b.key);

  const entities = order.map(({ ix, iy }) => ({
    ix,
    iy,
    depth: ix + iy,
    draw() {
      if (iy >= GRID_H - 2) drawGrassStrip(ix, iy);
      else drawTile(ix, iy);

      const crab = crabs.get(tileKey(ix, iy));
      if (crab) drawCrab(crab.ix, crab.iy, crab.facing, crab.phase);
    },
  }));

  entities.push({
    ix: player.x,
    iy: player.y,
    depth: player.x + player.y + 0.5,
    draw: drawPlayer,
  });

  entities.sort((a, b) => a.depth - b.depth);
  for (const ent of entities) ent.draw();

  for (const [ix, iy] of PALMS) drawPalm(ix, iy);
}

function drawHUD() {
  const w = mainCanvasSize.x;
  const reach = Math.round((waveCoverage01() / WAVE_BEACH_COVER) * 100);
  const amp = waveAmplitude.toFixed(2);

  drawTextScreen(
    `Crabes : ${caughtCrabs}`,
    vec2(16, 28),
    24,
    rgb(1, 0.95, 0.85),
    0,
    rgb(0, 0, 0),
    "left",
  );
  drawTextScreen("La chasse aux crabes", vec2(w * 0.5, 28), 28, rgb(1, 1, 1));
  drawTextScreen(
    `Wave: ${reach}% of max (80% beach)  ·  amplitude: ${amp}`,
    vec2(w * 0.5, 54),
    18,
    rgb(0.92, 0.96, 1),
  );
  drawTextScreen(
    "Flèches : déplacer le garçon sur la plage",
    vec2(w * 0.5, 78),
    16,
    rgb(0.92, 0.96, 1),
  );
}

function drawWinBanner() {
  if (caughtCrabs < WIN_CRAB_COUNT) return;

  const w = mainCanvasSize.x;
  const h = mainCanvasSize.y;
  const bannerH = 80;
  const y = h * 0.5 - bannerH * 0.5;
  const ctx = mainContext;

  ctx.save();
  ctx.fillStyle = "rgba(25, 95, 55, 0.94)";
  ctx.fillRect(0, y, w, bannerH);
  ctx.strokeStyle = "rgba(255, 215, 80, 0.95)";
  ctx.lineWidth = 4;
  ctx.strokeRect(4, y + 4, w - 8, bannerH - 8);
  ctx.restore();

  drawTextScreen(
    "Vous avez gagné!",
    vec2(w * 0.5, y + bannerH * 0.5),
    40,
    rgb(1, 0.95, 0.45),
    0,
    rgb(0, 0, 0),
    "center",
  );
}

// ── LittleJS callbacks ──────────────────────────────────────────────────────────
function gameInit() {
  setShowSplashScreen(false);
  setCameraScale(1);
  setCanvasPixelated(false);
  setCanvasClearColor(rgb(0.53, 0.81, 1));
  waveAmplitude = 0.4 + Math.random() * 0.6;
  resetCrabSpawnBudget();
  initPrevTiles();
  caughtCrabs = 0;
  respawnPlayerOnGreenZone();
  player.facing = 1;
  player.moving = false;
  initBackgroundMusic();
}

function gameUpdate() {
  if (
    keyWasPressed("ArrowUp") ||
    keyWasPressed("ArrowDown") ||
    keyWasPressed("ArrowLeft") ||
    keyWasPressed("ArrowRight") ||
    mouseWasPressed(0)
  ) {
    tryStartBackgroundMusic();
  }
  updateWave();
  updateCrabs();
  updatePlayer();
  checkPlayerInWater();
  tryCatchCrab();
}

function gameRenderPost() {
  drawScene();
  drawHUD();
  drawWinBanner();
}

engineInit(gameInit, gameUpdate, () => {}, () => {}, gameRenderPost);
