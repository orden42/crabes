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
  timeReal,
  keyWasPressed,
  mouseWasPressed,
  mousePosScreen,
  timeDelta,
} from "./vendor/littlejs.esm.js";
import {
  initBackgroundMusic,
  tryStartBackgroundMusic,
  playTingSound,
  playGameOverSound,
  playWinMusic,
} from "./music.js";

function generateRockClusters({
  gridW,
  gridH,
  oceanRows,
  greenZoneIx,
  clusterCount = 4,
  minClusterSize = 3,
  maxClusterSize = 5,
  beachMarginTop = 2,
  beachMarginBottom = 3,
  clearRadius = 2,
  minClusterSpacing = 3,
}) {
  const beachMinY = oceanRows + beachMarginTop;
  const beachMaxY = gridH - beachMarginBottom - 1;
  const clearCenterY = gridH - beachMarginBottom - 1;
  const occupied = new Set();
  const result = [];

  function key(ix, iy) {
    return `${ix},${iy}`;
  }

  function isClearZone(ix, iy) {
    const dx = ix - greenZoneIx;
    const dy = iy - clearCenterY;
    return Math.hypot(dx, dy) <= clearRadius + 0.5;
  }

  function canPlace(ix, iy) {
    if (ix < 1 || ix >= gridW - 1 || iy < beachMinY || iy > beachMaxY) return false;
    if (isClearZone(ix, iy)) return false;
    return !occupied.has(key(ix, iy));
  }

  function farEnoughFromClusters(ix, iy) {
    for (const [rx, ry] of result) {
      if (Math.abs(ix - rx) + Math.abs(iy - ry) < minClusterSpacing) return false;
    }
    return true;
  }

  function pickClusterStart() {
    for (let attempt = 0; attempt < 80; attempt++) {
      const ix = 1 + Math.floor(Math.random() * (gridW - 2));
      const iy = beachMinY + Math.floor(Math.random() * (beachMaxY - beachMinY + 1));
      if (canPlace(ix, iy) && farEnoughFromClusters(ix, iy)) {
        return [ix, iy];
      }
    }
    return null;
  }

  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex++) {
    const start = pickClusterStart();
    if (!start) continue;

    const cluster = [start];
    occupied.add(key(start[0], start[1]));

    const targetSize =
      minClusterSize +
      Math.floor(Math.random() * (maxClusterSize - minClusterSize + 1));

    while (cluster.length < targetSize) {
      const [cx, cy] = cluster[Math.floor(Math.random() * cluster.length)];
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].sort(() => Math.random() - 0.5);

      let added = false;
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (!canPlace(nx, ny)) continue;
        cluster.push([nx, ny]);
        occupied.add(key(nx, ny));
        added = true;
        break;
      }
      if (!added) break;
    }

    for (const [ix, iy] of cluster) {
      result.push([ix, iy, clusterIndex]);
    }
  }

  return result;
}

export function startLevel(config = {}) {
  const {
    winCrabCount = 10,
    nextLevelUrl = null,
    winText = "Niveau terminé !",
    continueText = "Continuer",
    waveCycleSec = 7,
    crabsPerWaveMin = 4,
    crabsPerWaveMax = 5,
    levelLabel = "",
    creatureType = "crab",
    rocks: explicitRocks = [],
    rockObstacles = null,
    rockCreaturePenalty = 0,
    theme = "beach",
    freezeCycle = null,
  } = config;

  const isIceTheme = theme === "ice";

  const GRID_W = 14;
  const GRID_H = 22;
  const OCEAN_ROWS = 4;
  const BEACH_ROWS = GRID_H - OCEAN_ROWS;
  const GREEN_ZONE_IX = 7;

  const rocks = rockObstacles
    ? generateRockClusters({
        gridW: GRID_W,
        gridH: GRID_H,
        oceanRows: OCEAN_ROWS,
        greenZoneIx: GREEN_ZONE_IX,
        ...rockObstacles,
      })
    : explicitRocks;
  const rockSet = new Set(rocks.map(([ix, iy]) => `${ix},${iy}`));

  const TILE_W = 40;
  const TILE_H = 40;
  const TILE_DEPTH = 3;
  const CELL_W = 38;
  const CELL_H = 38;
  const HUD_HEIGHT = 0;
  const VIEW_PAD_X = 16;
  const VIEW_PAD_BOTTOM = 32;
  const PALM_TOP_EXTRA = 28;
  const PHONE_MAX_WIDTH = 520;

  function isPhoneLayout() {
    const w = mainCanvasSize.x;
    const h = mainCanvasSize.y;
    return Math.min(w, h) < PHONE_MAX_WIDTH;
  }

  function viewPadX() {
    return isPhoneLayout() ? 2 : VIEW_PAD_X;
  }

  function viewPadBottom() {
    return isPhoneLayout() ? 8 : VIEW_PAD_BOTTOM;
  }

  function layoutPalmTopExtra() {
    return isPhoneLayout() ? 10 : PALM_TOP_EXTRA;
  }

  let isoScale = 1;

  const WAVE_BEACH_COVER = 0.8;

  let wavePhase = 0;
  let waveAmplitude = 1;
  let lastCycleIndex = -1;

  const crabs = new Map();
  let crabsSpawnBudget = 0;
  let prevTileKinds = null;
  let caughtCrabs = 0;
  let levelWon = false;
  let levelWonAt = 0;
  let playerLastTileKey = null;
  let freezePhaseStart = 0;
  let isFrozen = false;
  let frozenAnimTime = 0;
  let wasFrozen = false;

  const PLAYER_SPEED = 4.5;
  const GREEN_ZONE_IY = GRID_H - 2;
  const player = {
    ix: GREEN_ZONE_IX,
    iy: GREEN_ZONE_IY,
    x: GREEN_ZONE_IX,
    y: GREEN_ZONE_IY,
    facing: 1,
    moving: false,
  };

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

  function scaledTileW() {
    return TILE_W * isoScale;
  }

  function scaledTileH() {
    return TILE_H * isoScale;
  }

  function scaledTileDepth() {
    return TILE_DEPTH * isoScale;
  }

  function gridToScreenOffset(ix, iy) {
    const cx = (GRID_W - 1) * 0.5;
    const cy = (GRID_H - 1) * 0.5;
    return {
      x: (ix - cx) * CELL_W,
      y: (iy - cy) * CELL_H,
    };
  }

  function tileDrawDepth(ix, iy) {
    const p = gridToScreenOffset(ix, iy);
    return p.y * GRID_W + p.x;
  }

  function getGridBounds() {
    const corners = isPhoneLayout()
      ? [
          [0, OCEAN_ROWS],
          [GRID_W - 1, OCEAN_ROWS],
          [0, GRID_H - 1],
          [GRID_W - 1, GRID_H - 1],
        ]
      : [
          [0, 0],
          [GRID_W - 1, 0],
          [0, GRID_H - 1],
          [GRID_W - 1, GRID_H - 1],
        ];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [ix, iy] of corners) {
      const p = gridToScreenOffset(ix, iy);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const half = TILE_W * 0.5;
    const edge = isPhoneLayout() ? half * 0.25 : half;
    const palmExtra = layoutPalmTopExtra();
    return {
      minX: minX - edge,
      maxX: maxX + edge,
      minY: minY - half - palmExtra,
      maxY: maxY + half,
      width: maxX - minX + edge * 2,
      height: maxY - minY + TILE_H + palmExtra,
      centerX: (minX + maxX) * 0.5,
      centerY: (minY + maxY) * 0.5,
    };
  }

  function updateViewLayout() {
    const w = mainCanvasSize.x;
    const h = mainCanvasSize.y;
    const bounds = getGridBounds();
    const padX = viewPadX();
    const padBottom = viewPadBottom();
    const availW = w - padX * 2;
    const availH = h - HUD_HEIGHT - padBottom;
    isoScale = Math.min(1, availW / bounds.width, availH / bounds.height);
  }

  function getOrigin() {
    const w = mainCanvasSize.x;
    const h = mainCanvasSize.y;
    const bounds = getGridBounds();
    const padBottom = viewPadBottom();
    const availH = h - HUD_HEIGHT - padBottom;
    const half = scaledTileH() * 0.5;
    const y = isPhoneLayout()
      ? HUD_HEIGHT + availH - bounds.maxY * isoScale - half
      : HUD_HEIGHT + availH * 0.5 - bounds.centerY * isoScale;
    return {
      x: w * 0.5 - bounds.centerX * isoScale,
      y,
    };
  }

  function isoToScreen(ix, iy, iz = 0) {
    const { x: ox, y: oy } = getOrigin();
    const p = gridToScreenOffset(ix, iy);
    return {
      x: ox + p.x * isoScale,
      y: oy + p.y * isoScale - iz * scaledTileDepth(),
    };
  }

  function animTime() {
    return isFrozen ? frozenAnimTime : time;
  }

  function updateFreezeCycle() {
    if (!freezeCycle) {
      isFrozen = false;
      wasFrozen = false;
      return;
    }

    const cycleLen = freezeCycle.activeSec + freezeCycle.frozenSec;
    const inCycle = (timeReal - freezePhaseStart) % cycleLen;
    isFrozen = inCycle >= freezeCycle.activeSec;

    if (isFrozen && !wasFrozen) {
      frozenAnimTime = time;
    }
    wasFrozen = isFrozen;
  }

  function updateWave() {
    const cycle = (time * (Math.PI * 2)) / waveCycleSec;
    wavePhase = cycle;

    const cycleIndex = Math.floor(cycle / (Math.PI * 2));
    if (cycleIndex !== lastCycleIndex) {
      lastCycleIndex = cycleIndex;
      waveAmplitude = 0.4 + Math.random() * 0.6;
      resetCrabSpawnBudget();
    }
  }

  function waveCoverage01() {
    const t = (1 - Math.cos(wavePhase)) * 0.5;
    return Math.min(1, t * WAVE_BEACH_COVER * waveAmplitude);
  }

  function waveSwell() {
    return 0.35 + waveAmplitude * 0.45;
  }

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

  function isRock(ix, iy) {
    return rockSet.has(tileKey(ix, iy));
  }

  function isSubmerged(kind) {
    return kind === "water" || kind === "foam" || kind === "ocean";
  }

  function isExposedBeach(kind) {
    return kind === "wet" || kind === "sand";
  }

  /** Higher near the shoreline, lower toward the top of the beach. */
  function creatureSpawnChance(iy) {
    const beachTop = GRID_H - 3;
    const beachBottom = OCEAN_ROWS;
    const span = beachTop - beachBottom;
    if (span <= 0) return 0.14;

    const nearWater = Math.max(0, Math.min(1, (beachTop - iy) / span));
    const minChance = 0.05;
    const maxChance = 0.32;
    return minChance + nearWater * (maxChance - minChance);
  }

  function canPlayerWalk(ix, iy) {
    if (ix < 0 || iy < 0 || ix >= GRID_W || iy >= GRID_H) return false;
    if (isRock(ix, iy)) return rockCreaturePenalty > 0;
    const kind = tileAt(ix, iy);
    return kind === "sand" || kind === "wet";
  }

  function playerGroundScreenPos() {
    const ix = player.x;
    const iy = player.y;
    const kind = tileAt(Math.round(ix), Math.round(iy));
    const elev = kind === "sand" ? 0.15 * Math.sin(ix * 1.3 + iy * 0.9) : 0.08;
    const base = isoToScreen(ix, iy, elev);
    return { x: base.x, y: base.y - 2 * isoScale };
  }

  function gridStepScreenUnit(dx, dy) {
    const p0 = gridToScreenOffset(0, 0);
    const p1 = gridToScreenOffset(dx, dy);
    const sx = p1.x - p0.x;
    const sy = p1.y - p0.y;
    const len = Math.hypot(sx, sy) || 1;
    return { sx: sx / len, sy: sy / len };
  }

  const GRID_MOVE_DIRS = [
    { dx: 0, dy: -1, ...gridStepScreenUnit(0, -1) },
    { dx: 0, dy: 1, ...gridStepScreenUnit(0, 1) },
    { dx: -1, dy: 0, ...gridStepScreenUnit(-1, 0) },
    { dx: 1, dy: 0, ...gridStepScreenUnit(1, 0) },
  ];

  function gridDirectionFromScreenDelta(vx, vy) {
    let best = GRID_MOVE_DIRS[0];
    let bestDot = -Infinity;
    for (const d of GRID_MOVE_DIRS) {
      const dot = vx * d.sx + vy * d.sy;
      if (dot > bestDot) {
        bestDot = dot;
        best = d;
      }
    }
    return best;
  }

  function getTapGridDirection() {
    if (!mouseWasPressed(0)) return null;

    const feet = playerGroundScreenPos();
    const vx = mousePosScreen.x - feet.x;
    const vy = mousePosScreen.y - feet.y;
    if (Math.hypot(vx, vy) < 28 * isoScale) return null;

    return gridDirectionFromScreenDelta(vx, vy);
  }

  function tryMovePlayer(dx, dy) {
    if (dx === 0 && dy === 0) return;
    const tx = Math.round(player.x) + dx;
    const ty = Math.round(player.y) + dy;
    if (canPlayerWalk(tx, ty)) {
      player.ix = tx;
      player.iy = ty;
      if (dx !== 0) player.facing = dx < 0 ? -1 : 1;
    }
  }

  function updatePlayer() {
    let dx = 0;
    let dy = 0;
    if (keyWasPressed("ArrowUp")) {
      dy = -1;
    } else if (keyWasPressed("ArrowDown")) {
      dy = 1;
    } else if (keyWasPressed("ArrowLeft")) {
      dx = -1;
    } else if (keyWasPressed("ArrowRight")) {
      dx = 1;
    } else {
      const tapDir = getTapGridDirection();
      if (tapDir) {
        dx = tapDir.dx;
        dy = tapDir.dy;
      }
    }

    tryMovePlayer(dx, dy);

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
    const bob = player.moving ? Math.sin(animTime() * 14) * 1.5 * isoScale : Math.sin(animTime() * 3) * 0.6 * isoScale;
    const base = isoToScreen(ix, iy, elev);
    const cx = base.x;
    const cy = base.y - 8 * isoScale + bob;
    const ctx = mainContext;
    const px = 2.2 * isoScale;
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
      crabsPerWaveMin +
      Math.floor(Math.random() * (crabsPerWaveMax - crabsPerWaveMin + 1));
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
    playerLastTileKey = tileKey(player.ix, player.iy);
  }

  function checkRockPenalty() {
    if (rockCreaturePenalty <= 0 || player.moving) return;

    const ix = player.ix;
    const iy = player.iy;
    const key = tileKey(ix, iy);

    if (!isRock(ix, iy)) {
      playerLastTileKey = key;
      return;
    }

    if (key === playerLastTileKey || caughtCrabs <= 0) return;

    playerLastTileKey = key;
    caughtCrabs = Math.floor(caughtCrabs * (1 - rockCreaturePenalty));

    if (caughtCrabs < winCrabCount) {
      levelWon = false;
      levelWonAt = 0;
    }

    playGameOverSound();
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

    if (caughtCrabs >= winCrabCount && !levelWon) {
      levelWon = true;
      levelWonAt = timeReal;
      playWinMusic();
    }
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
          !isRock(ix, iy) &&
          crabsSpawnBudget > 0 &&
          isSubmerged(prev) &&
          isExposedBeach(curr) &&
          Math.random() < creatureSpawnChance(iy)
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

  function drawBlockTopDown(ix, iy, iz, topColor, leftColor, rightColor) {
    const { x, y } = isoToScreen(ix, iy, iz);
    const s = scaledTileW();
    const half = s * 0.5;
    const lip = Math.max(1, scaledTileDepth());
    const ctx = mainContext;

    ctx.save();
    ctx.fillStyle = topColor;
    ctx.fillRect(x - half, y - half, s, s);
    ctx.fillStyle = rightColor;
    ctx.fillRect(x - half, y + half - lip, s, lip);
    ctx.fillStyle = leftColor;
    ctx.fillRect(x + half - lip, y - half, lip, s);
    ctx.restore();
  }

  const COLORS = {
    ocean: ["#1a6fa8", "#145a8c", "#0f4a75"],
    water: ["#2d9fd4", "#2489be", "#1a72a5"],
    foam: ["#7ed4f0", "#5ec4e8", "#4ab0d8"],
    wet: ["#c4a574", "#b89564", "#a88454"],
    sand: ["#e8d4a8", "#dcc898", "#d0bc88"],
    grass: ["#5cb85c", "#4da84d", "#3d983d"],
  };

  const ICE_COLORS = {
    ocean: ["#1a4a6a", "#123a55", "#0c2a40"],
    water: ["#2a6898", "#1f5580", "#164368"],
    foam: ["#a8d8f0", "#8ec8e8", "#78b8dc"],
    wet: ["#b8d4e8", "#a0c4dc", "#88b4d0"],
    sand: ["#e8f4ff", "#d0e8f8", "#b8dcf0"],
    grass: ["#dceaf4", "#c8dce8", "#b4cedc"],
  };

  function getTileColors() {
    return isIceTheme ? ICE_COLORS : COLORS;
  }

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

    const palette = getTileColors()[kind] || getTileColors().sand;
    const top = shade(palette[0], waveAnim);
    const left = shade(palette[1], waveAnim * 0.88);
    const right = shade(palette[2], waveAnim * 0.82);

    const height =
      kind === "sand"
        ? 0.15 * Math.sin(ix * 1.3 + iy * 0.9)
        : kind === "wet"
          ? 0.08
          : 0;

    drawBlockTopDown(ix, iy, height, top, left, right);
  }

  function drawPalm(ix, iy) {
    if (iy < GRID_H - 2) return;

    const base = isoToScreen(ix, iy, 0);
    const s = isoScale;
    const ctx = mainContext;

    ctx.save();
    ctx.fillStyle = "#6b4423";
    ctx.beginPath();
    ctx.arc(base.x, base.y, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#248035";
    for (let a = 0; a < 5; a++) {
      const ang = (a / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(
        base.x + Math.cos(ang) * 10 * s,
        base.y + Math.sin(ang) * 10 * s,
        9 * s,
        5 * s,
        ang,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.fillStyle = "#2d8a3e";
    ctx.beginPath();
    ctx.arc(base.x, base.y, 12 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawGrassStrip(ix, iy) {
    if (iy < GRID_H - 2) return;
    const grass = getTileColors().grass;
    drawBlockTopDown(ix, iy, 0, grass[0], grass[1], grass[2]);
  }

  function drawSnowPile(ix, iy) {
    if (iy < GRID_H - 2) return;

    const base = isoToScreen(ix, iy, 0);
    const s = isoScale;
    const ctx = mainContext;

    ctx.save();
    ctx.fillStyle = "rgba(160, 190, 210, 0.35)";
    ctx.beginPath();
    ctx.ellipse(base.x, base.y + 2 * s, 14 * s, 8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#eef6fc";
    ctx.beginPath();
    ctx.ellipse(base.x - 3 * s, base.y - 2 * s, 9 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d8eaf4";
    ctx.beginPath();
    ctx.ellipse(base.x + 4 * s, base.y, 8 * s, 6 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRock(ix, iy, variant = 0) {
    const kind = tileAt(ix, iy);
    if (kind !== "sand" && kind !== "wet") return;

    const elev = kind === "sand" ? 0.15 * Math.sin(ix * 1.3 + iy * 0.9) : 0.08;
    const { x, y } = isoToScreen(ix, iy, elev);
    const s = isoScale;
    const ctx = mainContext;
    const seed = variant * 17 + ix * 13 + iy * 7;

    const stones = [
      { ox: 0, oy: -5, rx: 11, ry: 9, light: "#a8a8a8", mid: "#7a7a7a", dark: "#525252" },
      { ox: -7, oy: 2, rx: 8, ry: 7, light: "#989898", mid: "#6d6d6d", dark: "#454545" },
      { ox: 6, oy: 1, rx: 7, ry: 6, light: "#b0b0b0", mid: "#828282", dark: "#585858" },
    ];
    const count = 2 + (seed % 2);

    ctx.save();
    ctx.fillStyle = "rgba(0, 0, 0, 0.18)";
    ctx.beginPath();
    ctx.ellipse(x, y + 3 * s, 15 * s, 9 * s, 0, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < count; i++) {
      const st = stones[(seed + i) % stones.length];
      const jx = ((seed + i * 11) % 5) - 2;
      const jy = ((seed + i * 7) % 5) - 2;
      const sx = x + (st.ox + jx) * s;
      const sy = y + (st.oy + jy * 0.6) * s;

      ctx.fillStyle = st.mid;
      ctx.beginPath();
      ctx.ellipse(sx, sy, st.rx * s, st.ry * s, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = st.light;
      ctx.beginPath();
      ctx.ellipse(sx - 2 * s, sy - 3 * s, st.rx * 0.55 * s, st.ry * 0.45 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = st.dark;
      ctx.beginPath();
      ctx.ellipse(sx + 3 * s, sy + 2 * s, st.rx * 0.45 * s, st.ry * 0.35 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function drawCrabIcon(cx, cy, scale, facing = 1, legPhase = 0) {
    const ctx = mainContext;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(facing * scale, scale);

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
        const sway = Math.sin(animTime() * 8 + legPhase + leg + (side > 0 ? 1 : 0)) * 3;
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

  function drawShrimpIcon(cx, cy, scale, facing = 1, legPhase = 0) {
    const ctx = mainContext;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(facing * scale, scale);

    ctx.fillStyle = "#f5a089";
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.lineTo(-18, -4);
    ctx.lineTo(-16, 0);
    ctx.lineTo(-18, 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#e86b52";
    for (let i = 0; i < 4; i++) {
      const bx = -8 + i * 4;
      ctx.beginPath();
      ctx.ellipse(bx, 0, 3.5, 5 - i * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#d4523a";
    ctx.beginPath();
    ctx.ellipse(8, -1, 5, 4.5, 0.2, 0, Math.PI * 2);
    ctx.fill();

    const antSway = Math.sin(animTime() * 6 + legPhase) * 2;
    ctx.strokeStyle = "#c44a35";
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(10, -3);
    ctx.quadraticCurveTo(16 + antSway, -10, 20 + antSway, -8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, -2);
    ctx.quadraticCurveTo(15 - antSway, -6, 18 - antSway, -4);
    ctx.stroke();

    ctx.strokeStyle = "#b84028";
    for (let leg = 0; leg < 4; leg++) {
      const lx = -4 + leg * 3;
      const sway = Math.sin(animTime() * 10 + legPhase + leg) * 2;
      ctx.beginPath();
      ctx.moveTo(lx, 3);
      ctx.lineTo(lx - 2 + sway * 0.3, 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(lx, 3);
      ctx.lineTo(lx + 2 - sway * 0.3, 8);
      ctx.stroke();
    }

    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(10, -2, 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawFishIcon(cx, cy, scale, facing = 1, legPhase = 0) {
    const ctx = mainContext;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(facing * scale, scale);

    ctx.fillStyle = "#3a78b0";
    ctx.beginPath();
    ctx.moveTo(-12, 0);
    ctx.lineTo(-18, -6);
    ctx.lineTo(-18, 6);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#4a90c8";
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#f0c040";
    ctx.fillRect(-2, -3, 3, 6);

    const fin = Math.sin(animTime() * 8 + legPhase) * 3;
    ctx.fillStyle = "#5aa0d0";
    ctx.beginPath();
    ctx.moveTo(0, 3);
    ctx.lineTo(-4, 8 + fin);
    ctx.lineTo(4, 8 - fin);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "#1a1a1a";
    ctx.beginPath();
    ctx.arc(8, -2, 2, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawCreatureIcon(cx, cy, scale, facing = 1, legPhase = 0) {
    if (creatureType === "fish") {
      drawFishIcon(cx, cy, scale, facing, legPhase);
    } else if (creatureType === "shrimp") {
      drawShrimpIcon(cx, cy, scale, facing, legPhase);
    } else {
      drawCrabIcon(cx, cy, scale, facing, legPhase);
    }
  }

  function drawCreature(ix, iy, facing, phase) {
    const kind = tileAt(ix, iy);
    if (!isExposedBeach(kind)) return;

    const s = isoScale;
    const wiggle = Math.sin(animTime() * 5 + phase) * 2 * s;
    const base = isoToScreen(ix, iy, kind === "sand" ? 0.15 : 0.08);
    drawCreatureIcon(base.x + wiggle, base.y - 2 * s, s, facing, phase);
  }

  function drawSky() {
    const w = mainCanvasSize.x;
    const h = mainCanvasSize.y;
    const ctx = mainContext;
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (isIceTheme) {
      grad.addColorStop(0, "#6a8aa8");
      grad.addColorStop(0.35, "#a8c0d8");
      grad.addColorStop(1, "#d0e4f0");
    } else {
      grad.addColorStop(0, "#5a9fd4");
      grad.addColorStop(0.35, "#7eb8e0");
      grad.addColorStop(1, "#9ecae8");
    }
    ctx.save();
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

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
        order.push({ ix, iy, key: tileDrawDepth(ix, iy) });
      }
    }
    order.sort((a, b) => a.key - b.key);

    const entities = order.map(({ ix, iy }) => ({
      ix,
      iy,
      depth: tileDrawDepth(ix, iy),
      draw() {
        if (iy >= GRID_H - 2) drawGrassStrip(ix, iy);
        else drawTile(ix, iy);

        const creature = crabs.get(tileKey(ix, iy));
        if (creature) drawCreature(creature.ix, creature.iy, creature.facing, creature.phase);
      },
    }));

    entities.push({
      ix: player.x,
      iy: player.y,
      depth: tileDrawDepth(player.x, player.y) + 0.02,
      draw: drawPlayer,
    });

    for (const [ix, iy, variant = 0] of rocks) {
      entities.push({
        ix,
        iy,
        depth: tileDrawDepth(ix, iy) + 0.015,
        draw() {
          drawRock(ix, iy, variant);
        },
      });
    }

    entities.sort((a, b) => a.depth - b.depth);
    for (const ent of entities) ent.draw();

    if (isIceTheme) {
      for (const [ix, iy] of PALMS) drawSnowPile(ix, iy);
    } else {
      for (const [ix, iy] of PALMS) drawPalm(ix, iy);
    }
  }

  function hudSize(base) {
    return Math.max(11, Math.round(base * Math.min(1, mainCanvasSize.x / 720)));
  }

  function drawCrabCounterOnGrass() {
    const grassIy = GRID_H - 1.5;
    const pos = isoToScreen(GREEN_ZONE_IX, grassIy, 0.15);
    const fontSize = hudSize(26);
    const countText = `${caughtCrabs}/${winCrabCount}`;
    const ctx = mainContext;
    const iconScale = isoScale * 1.05;
    const iconW = 22 * iconScale;
    const gap = 8 * isoScale;

    ctx.save();
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = ctx.measureText(countText).width;
    ctx.restore();

    const totalW = textW + gap + iconW;
    const leftX = pos.x - totalW * 0.5;
    const y = pos.y;

    drawTextScreen(
      countText,
      vec2(leftX, y),
      fontSize,
      rgb(1, 1, 1),
      0,
      rgb(0.1, 0.25, 0.1),
      "left",
    );
    drawCreatureIcon(leftX + textW + gap + iconW * 0.5, y, iconScale, 1, animTime() * 5);
  }

  function drawFreezeTimer() {
    if (!freezeCycle) return;

    const w = mainCanvasSize.x;
    const cycleLen = freezeCycle.activeSec + freezeCycle.frozenSec;
    const inCycle = (timeReal - freezePhaseStart) % cycleLen;
    const remaining = isFrozen
      ? cycleLen - inCycle
      : freezeCycle.activeSec - inCycle;
    const label = isFrozen ? "Gel" : "Banquise";
    const text = `${label} : ${Math.ceil(remaining)} s`;
    const color = isFrozen ? rgb(0.75, 0.92, 1) : rgb(1, 1, 1);
    const outline = isFrozen ? rgb(0.1, 0.25, 0.45) : rgb(0.1, 0.15, 0.2);

    drawTextScreen(
      text,
      vec2(w * 0.5, hudSize(42)),
      hudSize(18),
      color,
      0,
      outline,
      "center",
    );
  }

  function drawFreezeOverlay() {
    if (!isFrozen) return;

    const w = mainCanvasSize.x;
    const h = mainCanvasSize.y;
    const ctx = mainContext;

    ctx.save();
    ctx.fillStyle = "rgba(180, 220, 255, 0.28)";
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    drawTextScreen(
      "Gel !",
      vec2(w * 0.5, h * 0.12),
      hudSize(28),
      rgb(0.85, 0.95, 1),
      0,
      rgb(0.1, 0.25, 0.45),
      "center",
    );
  }

  function drawHUD() {
    const w = mainCanvasSize.x;
    const h = mainCanvasSize.y;
    const padBottom = viewPadBottom();
    const phone = isPhoneLayout();

    if (levelLabel) {
      drawTextScreen(
        levelLabel,
        vec2(w * 0.5, hudSize(18)),
        hudSize(16),
        rgb(1, 1, 1),
        0,
        rgb(0.1, 0.15, 0.2),
        "center",
      );
    }

    drawCrabCounterOnGrass();
    drawFreezeTimer();
    drawTextScreen(
      phone ? "Toucher : direction" : "Flèches / toucher : haut bas gauche droite",
      vec2(w * 0.5, h - padBottom * 0.55),
      hudSize(phone ? 13 : 15),
      rgb(0.92, 0.96, 1),
      0,
      rgb(0.1, 0.15, 0.2),
      "center",
    );
  }

  function drawWinBanner() {
    if (!levelWon) return;

    const w = mainCanvasSize.x;
    const h = mainCanvasSize.y;
    const bannerH = nextLevelUrl ? 110 : 80;
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
      winText,
      vec2(w * 0.5, y + bannerH * (nextLevelUrl ? 0.38 : 0.5)),
      hudSize(34),
      rgb(1, 0.95, 0.45),
      0,
      rgb(0, 0, 0),
      "center",
    );

    if (nextLevelUrl) {
      drawTextScreen(
        continueText,
        vec2(w * 0.5, y + bannerH * 0.72),
        hudSize(18),
        rgb(0.95, 1, 0.95),
        0,
        rgb(0, 0, 0),
        "center",
      );
    }
  }

  function tryAdvanceLevel() {
    if (!levelWon || !nextLevelUrl) return;
    if (timeReal - levelWonAt < 0.8) return;

    const pressed =
      keyWasPressed("Enter") ||
      keyWasPressed("Space") ||
      mouseWasPressed(0);
    if (pressed) {
      window.location.href = nextLevelUrl;
    }
  }

  function gameInit() {
    setShowSplashScreen(false);
    setCameraScale(1);
    setCanvasPixelated(false);
    setCanvasClearColor(isIceTheme ? rgb(0.75, 0.88, 0.96) : rgb(0.53, 0.81, 1));
    waveAmplitude = 0.4 + Math.random() * 0.6;
    resetCrabSpawnBudget();
    initPrevTiles();
    caughtCrabs = 0;
    levelWon = false;
    levelWonAt = 0;
    freezePhaseStart = timeReal;
    wasFrozen = false;
    isFrozen = false;
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

    if (levelWon) {
      tryAdvanceLevel();
      return;
    }

    updateFreezeCycle();
    updateWave();
    checkPlayerInWater();

    if (!isFrozen) {
      updateCrabs();
      updatePlayer();
      checkRockPenalty();
      tryCatchCrab();
    }
  }

  function gameRenderPost() {
    updateViewLayout();
    drawScene();
    drawHUD();
    drawWinBanner();
    drawFreezeOverlay();
  }

  engineInit(gameInit, gameUpdate, () => {}, () => {}, gameRenderPost);
}
