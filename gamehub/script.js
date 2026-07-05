const canvas = document.querySelector("#gameCanvas");
const ctx = canvas.getContext("2d");

const startButton = document.querySelector("#startButton");
const pauseButton = document.querySelector("#pauseButton");
const phaseButton = document.querySelector("#phaseButton");
const resetButton = document.querySelector("#resetButton");
const scoreValue = document.querySelector("#scoreValue");
const bestValue = document.querySelector("#bestValue");
const comboValue = document.querySelector("#comboValue");
const phaseValue = document.querySelector("#phaseValue");
const rankValue = document.querySelector("#rankValue");
const statusText = document.querySelector("#statusText");

const GRID = 28;
const START_LENGTH = 6;
const PHASE_MS = 1350;
const PHASE_COOLDOWN_MS = 5600;
const COMBO_MS = 5200;

let canvasSize = 0;
let board = { x: 0, y: 0, size: 0, cell: 0 };
let lastTime = performance.now();
let state = null;
let particles = [];
let audioCtx = null;

function playSound(kind) {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const now = audioCtx.currentTime;
    const gain = audioCtx.createGain();
    const osc = audioCtx.createOscillator();
    const noiseGain = audioCtx.createGain();
    gain.gain.value = 0.0001;
    gain.connect(audioCtx.destination);
    osc.connect(gain);

    const table = {
      start: [180, 0.12, "square", 0.08, 360],
      eat: [520, 0.08, "triangle", 0.07, 760],
      wild: [720, 0.11, "sine", 0.09, 1180],
      phase: [260, 0.18, "sawtooth", 0.06, 90],
      gate: [330, 0.16, "triangle", 0.08, 660],
      hazard: [95, 0.13, "square", 0.08, 240],
      death: [120, 0.38, "sawtooth", 0.12, 42],
    };
    const [freq, dur, type, vol, sweep] = table[kind] || table.eat;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(24, sweep), now + dur);
    gain.gain.exponentialRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.start(now);
    osc.stop(now + dur + 0.04);

    if (kind === "death" || kind === "hazard") {
      const buffer = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.08, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
      const src = audioCtx.createBufferSource();
      noiseGain.gain.value = kind === "death" ? 0.08 : 0.035;
      src.buffer = buffer;
      src.connect(noiseGain);
      noiseGain.connect(audioCtx.destination);
      src.start(now);
    }
  } catch {
    // Sound should never break controls in locked-down browsers.
  }
}

const directions = {
  up: { x: 0, y: -1, name: "up" },
  down: { x: 0, y: 1, name: "down" },
  left: { x: -1, y: 0, name: "left" },
  right: { x: 1, y: 0, name: "right" },
};

function loadBest() {
  try {
    return Number(localStorage.getItem("sawline-best") || "0");
  } catch {
    return 0;
  }
}

function saveBest(score) {
  const best = Math.max(loadBest(), score);
  try {
    localStorage.setItem("sawline-best", String(best));
  } catch {
    // Storage can be unavailable in strict/privacy contexts. The run should still end cleanly.
  }
  return best;
}

function sameCell(a, b) {
  return a && b && a.x === b.x && a.y === b.y;
}

function keyOf(cell) {
  return `${cell.x},${cell.y}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function makeState(mode = "menu") {
  const startX = Math.floor(GRID / 2);
  const startY = Math.floor(GRID / 2);
  const snake = [];

  for (let i = 0; i < START_LENGTH; i += 1) {
    snake.push({ x: startX - i, y: startY });
  }

  const next = {
    mode,
    snake,
    dir: directions.right,
    nextDir: directions.right,
    growth: 0,
    food: null,
    hazards: new Set(),
    gates: [],
    gateLock: 0,
    score: 0,
    best: loadBest(),
    combo: 1,
    comboTimer: 0,
    eaten: 0,
    phaseMs: 0,
    phaseCooldown: 0,
    accumulator: 0,
    tick: 0,
    status: mode === "menu" ? "Press Start." : "Run active.",
  };

  state = next;
  spawnFood();
  spawnGates();
  updateHud();
}

function randomCell() {
  return {
    x: Math.floor(Math.random() * GRID),
    y: Math.floor(Math.random() * GRID),
  };
}

function isOccupied(cell, includeHazards = true) {
  if (state.snake.some(part => sameCell(part, cell))) return true;
  if (includeHazards && state.hazards.has(keyOf(cell))) return true;
  if (state.gates.some(gate => sameCell(gate, cell))) return true;
  return false;
}

function farFromHead(cell, distance = 5) {
  const head = state.snake[0];
  return Math.abs(cell.x - head.x) + Math.abs(cell.y - head.y) >= distance;
}

function findFreeCell(options = {}) {
  const attempts = options.attempts || 900;
  const includeHazards = options.includeHazards !== false;
  const minDistance = options.minDistance || 0;

  for (let i = 0; i < attempts; i += 1) {
    const cell = randomCell();
    if (!isOccupied(cell, includeHazards) && (!minDistance || farFromHead(cell, minDistance))) {
      return cell;
    }
  }

  for (let y = 0; y < GRID; y += 1) {
    for (let x = 0; x < GRID; x += 1) {
      const cell = { x, y };
      if (!isOccupied(cell, includeHazards)) return cell;
    }
  }

  return { x: 2, y: 2 };
}

function spawnFood() {
  const types = ["charge", "charge", "charge", "wild"];
  state.food = {
    ...findFreeCell({ minDistance: 4 }),
    type: types[Math.floor(Math.random() * types.length)],
    pulse: Math.random() * Math.PI * 2,
  };
}

function spawnGates() {
  const first = findFreeCell({ minDistance: 7 });
  let second = null;

  for (let i = 0; i < 300; i += 1) {
    const candidate = findFreeCell({ minDistance: 7 });
    const distance = Math.abs(first.x - candidate.x) + Math.abs(first.y - candidate.y);
    if (!sameCell(first, candidate) && distance >= 12) {
      second = candidate;
      break;
    }
  }

  if (!second) {
    for (let y = 0; y < GRID && !second; y += 1) {
      for (let x = 0; x < GRID; x += 1) {
        const candidate = { x, y };
        const distance = Math.abs(first.x - x) + Math.abs(first.y - y);
        if (!sameCell(first, candidate) && !isOccupied(candidate) && distance >= 8) {
          second = candidate;
          break;
        }
      }
    }
  }

  state.gates = [first, second || findFreeCell({ minDistance: 7 })];
}

function addHazards(count) {
  for (let i = 0; i < count; i += 1) {
    const cell = findFreeCell({ minDistance: 6 });
    state.hazards.add(keyOf(cell));
  }
}

function setDirection(dir) {
  if (!state) return;
  const current = state.dir;
  if (current.x + dir.x === 0 && current.y + dir.y === 0) return;
  state.nextDir = dir;
}

function startGame() {
  makeState("playing");
  particles = [];
  canvas.focus();
  state.status = "Chain charges. Phase through trouble.";
  playSound("start");
  updateHud();
}

function togglePause() {
  if (!state || state.mode === "menu" || state.mode === "gameover") return;
  state.mode = state.mode === "paused" ? "playing" : "paused";
  state.status = state.mode === "paused" ? "Paused." : "Run active.";
  updateHud();
}

function activatePhase() {
  if (!state || state.mode !== "playing") return;
  if (state.phaseCooldown > 0 || state.phaseMs > 0) return;

  state.phaseMs = PHASE_MS;
  state.phaseCooldown = PHASE_COOLDOWN_MS;
  state.status = "Phase blink active.";
  burstParticles(state.snake[0], "#74e7ff", 18);
  playSound("phase");
  updateHud();
}

function endRun(reason) {
  state.mode = "gameover";
  state.best = saveBest(state.score);
  state.status = reason;
  burstParticles(state.snake[0], "#ff3030", 30);
  playSound("death");
  updateHud();
}

function getTickMs() {
  const speedFromScore = Math.min(42, Math.floor(state.score / 35) * 4);
  const speedFromCombo = Math.min(22, (state.combo - 1) * 3);
  return Math.max(72, 136 - speedFromScore - speedFromCombo);
}

function update(dtMs) {
  if (!state) return;

  updateParticles(dtMs);

  if (state.mode !== "playing") return;

  state.phaseMs = Math.max(0, state.phaseMs - dtMs);
  state.phaseCooldown = Math.max(0, state.phaseCooldown - dtMs);
  state.comboTimer = Math.max(0, state.comboTimer - dtMs);

  if (state.comboTimer <= 0) {
    state.combo = 1;
  }

  state.accumulator += dtMs;
  const tickMs = getTickMs();

  while (state.accumulator >= tickMs && state.mode === "playing") {
    state.accumulator -= tickMs;
    stepSnake();
  }

  updateHud();
}

function stepSnake() {
  state.tick += 1;
  state.dir = state.nextDir;
  state.gateLock = Math.max(0, state.gateLock - 1);

  const head = state.snake[0];
  const next = {
    x: head.x + state.dir.x,
    y: head.y + state.dir.y,
  };

  const phasing = state.phaseMs > 0;

  if (next.x < 0 || next.x >= GRID || next.y < 0 || next.y >= GRID) {
    if (!phasing) {
      endRun("Wall hit. Phase was offline.");
      return;
    }

    next.x = (next.x + GRID) % GRID;
    next.y = (next.y + GRID) % GRID;
    state.status = "Wall phased.";
  }

  const gateIndex = state.gates.findIndex(gate => sameCell(gate, next));
  if (gateIndex >= 0 && state.gateLock === 0) {
    const exit = state.gates[gateIndex === 0 ? 1 : 0];
    next.x = exit.x;
    next.y = exit.y;
    state.gateLock = 4;
    state.phaseMs = Math.max(state.phaseMs, 420);
    state.score += 3;
    state.status = "Rift gate chained.";
    burstParticles(next, "#ffca58", 16);
    playSound("gate");
  }

  const hazardKey = keyOf(next);
  if (state.hazards.has(hazardKey)) {
    if (!phasing) {
      endRun("Saw cell collision.");
      return;
    }

    state.hazards.delete(hazardKey);
    state.score += 5;
    state.status = "Saw cell erased by phase.";
    burstParticles(next, "#ff3030", 14);
    playSound("hazard");
  }

  const bodyToCheck = state.growth > 0 ? state.snake : state.snake.slice(0, -1);
  const hitBody = bodyToCheck.some(part => sameCell(part, next));
  if (hitBody && !phasing) {
    endRun("Tail bite. Phase was offline.");
    return;
  }

  state.snake.unshift(next);

  if (sameCell(next, state.food)) {
    collectFood();
  }

  if (state.growth > 0) {
    state.growth -= 1;
  } else {
    state.snake.pop();
  }

  if (state.tick % 56 === 0 && state.score > 20) {
    spawnGates();
  }
}

function collectFood() {
  const chainActive = state.comboTimer > 0;
  state.combo = chainActive ? Math.min(9, state.combo + 1) : 1;
  state.comboTimer = COMBO_MS;
  state.eaten += 1;

  const base = state.food.type === "wild" ? 16 : 10;
  const gain = base * state.combo;
  state.score += gain;
  state.growth += state.food.type === "wild" ? 3 : 2;
  state.status = `Charge cut. +${gain}`;

  burstParticles(state.food, state.food.type === "wild" ? "#d7ff59" : "#74e7ff", 22);
  playSound(state.food.type === "wild" ? "wild" : "eat");

  if (state.eaten % 3 === 0) {
    addHazards(3);
    state.status = "Board heated. Saw cells spawned.";
  }

  if (state.eaten % 5 === 0) {
    spawnGates();
    state.status = "Rift gates shifted.";
  }

  spawnFood();
}

function burstParticles(cell, color, count) {
  const center = cellCenter(cell);
  for (let i = 0; i < count; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.8 + Math.random() * 2.4;
    particles.push({
      x: center.x,
      y: center.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 420 + Math.random() * 320,
      maxLife: 740,
      color,
    });
  }
}

function updateParticles(dtMs) {
  particles = particles
    .map(particle => ({
      ...particle,
      x: particle.x + particle.vx * (dtMs / 16),
      y: particle.y + particle.vy * (dtMs / 16),
      life: particle.life - dtMs,
    }))
    .filter(particle => particle.life > 0);
}

function getRank() {
  if (!state) return "D";
  if (state.combo >= 8 || state.score >= 650) return "S";
  if (state.combo >= 6 || state.score >= 420) return "A";
  if (state.combo >= 4 || state.score >= 220) return "B";
  if (state.combo >= 2 || state.score >= 80) return "C";
  return "D";
}

function updateHud() {
  if (!state) return;

  scoreValue.textContent = state.score;
  bestValue.textContent = Math.max(state.best, state.score);
  comboValue.textContent = `x${state.combo}`;
  rankValue.textContent = getRank();
  statusText.textContent = state.status;

  if (state.phaseMs > 0) {
    phaseValue.textContent = `${Math.ceil(state.phaseMs / 100) / 10}s`;
  } else if (state.phaseCooldown > 0) {
    phaseValue.textContent = `${Math.ceil(state.phaseCooldown / 100) / 10}s`;
  } else {
    phaseValue.textContent = "ready";
  }

  startButton.textContent = state.mode === "gameover" ? "Restart run" : state.mode === "menu" ? "Start run" : "Restart run";
  pauseButton.textContent = state.mode === "paused" ? "Resume" : "Pause";
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvasSize = Math.max(320, Math.floor(Math.min(rect.width, rect.height)));
  canvas.width = Math.floor(canvasSize * ratio);
  canvas.height = Math.floor(canvasSize * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  const padding = Math.max(18, Math.floor(canvasSize * 0.045));
  const cell = Math.floor((canvasSize - padding * 2) / GRID);
  const size = cell * GRID;
  board = {
    x: Math.floor((canvasSize - size) / 2),
    y: Math.floor((canvasSize - size) / 2),
    size,
    cell,
  };

  render();
}

function cellCenter(cell) {
  return {
    x: board.x + cell.x * board.cell + board.cell / 2,
    y: board.y + cell.y * board.cell + board.cell / 2,
  };
}

function cellRect(cell, inset = 1) {
  return {
    x: board.x + cell.x * board.cell + inset,
    y: board.y + cell.y * board.cell + inset,
    w: board.cell - inset * 2,
    h: board.cell - inset * 2,
  };
}

function roundedRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function render() {
  ctx.clearRect(0, 0, canvasSize, canvasSize);
  drawBackground();

  if (!state) return;

  drawGates();
  drawHazards();
  drawFood();
  drawSnake();
  drawParticles();
  drawFrameText();

  if (state.mode === "menu") {
    drawCenterPanel("SAWLINE", "Start run to enter the grid.");
  } else if (state.mode === "paused") {
    drawCenterPanel("PAUSED", "Press P or Resume.");
  } else if (state.mode === "gameover") {
    drawCenterPanel("RUN ENDED", state.status);
  }
}

function drawBackground() {
  ctx.fillStyle = "#070706";
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  const gradient = ctx.createRadialGradient(canvasSize * 0.62, canvasSize * 0.16, 10, canvasSize * 0.5, canvasSize * 0.45, canvasSize * 0.68);
  gradient.addColorStop(0, "rgba(255,48,48,0.16)");
  gradient.addColorStop(0.45, "rgba(116,231,255,0.05)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvasSize, canvasSize);

  ctx.strokeStyle = "rgba(245,241,232,0.055)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i += 1) {
    const p = board.x + i * board.cell;
    ctx.beginPath();
    ctx.moveTo(p, board.y);
    ctx.lineTo(p, board.y + board.size);
    ctx.stroke();

    const q = board.y + i * board.cell;
    ctx.beginPath();
    ctx.moveTo(board.x, q);
    ctx.lineTo(board.x + board.size, q);
    ctx.stroke();
  }

  ctx.strokeStyle = "#f5f1e8";
  ctx.lineWidth = 2;
  ctx.strokeRect(board.x, board.y, board.size, board.size);
}

function drawSnake() {
  const phasing = state.phaseMs > 0;

  state.snake.forEach((part, index) => {
    const rect = cellRect(part, index === 0 ? 1 : 2);
    const alpha = clamp(1 - index / (state.snake.length + 8), 0.38, 1);

    ctx.fillStyle = index === 0
      ? phasing ? "#74e7ff" : "#f5f1e8"
      : phasing ? `rgba(116,231,255,${0.42 + alpha * 0.36})` : `rgba(245,241,232,${0.35 + alpha * 0.42})`;

    roundedRect(rect.x, rect.y, rect.w, rect.h, Math.max(4, board.cell * 0.28));
    ctx.fill();

    if (index === 0) {
      drawHeadDetails(rect, phasing);
    }
  });
}

function drawHeadDetails(rect, phasing) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.fillStyle = "#050505";

  if (Math.abs(state.dir.x) > 0) {
    ctx.fillRect(cx + state.dir.x * rect.w * 0.16 - 2, cy - rect.h * 0.18, 4, 4);
    ctx.fillRect(cx + state.dir.x * rect.w * 0.16 - 2, cy + rect.h * 0.12, 4, 4);
  } else {
    ctx.fillRect(cx - rect.w * 0.18, cy + state.dir.y * rect.h * 0.16 - 2, 4, 4);
    ctx.fillRect(cx + rect.w * 0.12, cy + state.dir.y * rect.h * 0.16 - 2, 4, 4);
  }

  ctx.strokeStyle = phasing ? "#050505" : "#ff3030";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx - rect.w * 0.2, cy + rect.h * 0.18);
  ctx.lineTo(cx, cy + rect.h * 0.28);
  ctx.lineTo(cx + rect.w * 0.2, cy + rect.h * 0.18);
  ctx.stroke();
}

function drawFood() {
  if (!state.food) return;
  const center = cellCenter(state.food);
  const pulse = 1 + Math.sin(performance.now() / 150 + state.food.pulse) * 0.16;
  const r = board.cell * (state.food.type === "wild" ? 0.42 : 0.34) * pulse;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate(Math.PI / 4 + performance.now() / 900);
  ctx.fillStyle = state.food.type === "wild" ? "#d7ff59" : "#74e7ff";
  ctx.shadowColor = ctx.fillStyle;
  ctx.shadowBlur = 18;
  ctx.fillRect(-r / 2, -r / 2, r, r);
  ctx.restore();
}

function drawHazards() {
  ctx.save();
  ctx.strokeStyle = "#ff3030";
  ctx.fillStyle = "rgba(255,48,48,0.18)";
  ctx.lineWidth = 2;

  state.hazards.forEach(value => {
    const [x, y] = value.split(",").map(Number);
    const rect = cellRect({ x, y }, 3);
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y);
    ctx.lineTo(rect.x + rect.w, rect.y + rect.h);
    ctx.moveTo(rect.x + rect.w, rect.y);
    ctx.lineTo(rect.x, rect.y + rect.h);
    ctx.stroke();
  });

  ctx.restore();
}

function drawGates() {
  state.gates.forEach((gate, index) => {
    const center = cellCenter(gate);
    const radius = board.cell * 0.46;
    ctx.strokeStyle = index === 0 ? "#ffca58" : "#d7ff59";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = "rgba(245,241,232,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius * 0.58, 0, Math.PI * 2);
    ctx.stroke();
  });
}

function drawParticles() {
  particles.forEach(particle => {
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.fillStyle = particle.color.replace(")", `,${alpha})`).startsWith("rgba")
      ? particle.color
      : hexToRgba(particle.color, alpha);
    ctx.fillRect(particle.x, particle.y, 3, 3);
  });
}

function hexToRgba(hex, alpha) {
  const value = parseInt(hex.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawFrameText() {
  ctx.font = `${Math.max(10, board.cell * 0.54)}px "JetBrains Mono", monospace`;
  ctx.fillStyle = "rgba(245,241,232,0.62)";
  ctx.textBaseline = "top";
  ctx.fillText(`SCORE ${state.score}`, board.x, Math.max(8, board.y - board.cell * 1.35));

  ctx.textAlign = "right";
  ctx.fillText(`RANK ${getRank()}`, board.x + board.size, Math.max(8, board.y - board.cell * 1.35));
  ctx.textAlign = "left";
}

function drawCenterPanel(title, subtitle) {
  const w = Math.min(canvasSize - 46, 460);
  const h = 168;
  const x = (canvasSize - w) / 2;
  const y = (canvasSize - h) / 2;

  ctx.fillStyle = "rgba(5,5,5,0.82)";
  roundedRect(x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = "#f5f1e8";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#f5f1e8";
  ctx.font = `${Math.max(34, canvasSize * 0.066)}px "Clash Display", Impact, sans-serif`;
  ctx.textBaseline = "middle";
  ctx.fillText(title, canvasSize / 2, y + 60);

  ctx.fillStyle = "#9f9b91";
  ctx.font = `${Math.max(13, canvasSize * 0.018)}px "JetBrains Mono", monospace`;
  ctx.fillText(subtitle, canvasSize / 2, y + 112);
  ctx.fillText("WASD / ARROWS + SPACE", canvasSize / 2, y + 136);
  ctx.textAlign = "left";
}

function handleKey(event) {
  const key = event.key.toLowerCase();
  if (key === "backspace") {
    event.preventDefault();
    window.location.href = "./index.html#library";
    return;
  }
  const movementKeys = ["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", " "];
  if (movementKeys.includes(key)) event.preventDefault();

  if (!state) makeState("menu");

  if (key === "enter" && state.mode !== "playing") {
    startGame();
    return;
  }

  if (key === "r") {
    startGame();
    return;
  }

  if (key === "p") {
    togglePause();
    return;
  }

  if (key === "f") {
    toggleFullscreen();
    return;
  }

  if (key === " ") {
    if (state.mode === "menu" || state.mode === "gameover") {
      startGame();
    } else {
      activatePhase();
    }
    return;
  }

  const map = {
    arrowup: directions.up,
    w: directions.up,
    arrowdown: directions.down,
    s: directions.down,
    arrowleft: directions.left,
    a: directions.left,
    arrowright: directions.right,
    d: directions.right,
  };

  if (map[key]) {
    if (state.mode === "menu" || state.mode === "gameover") {
      startGame();
    }
    setDirection(map[key]);
  }
}

function toggleFullscreen() {
  const target = document.querySelector(".canvas-frame");
  if (!document.fullscreenElement) {
    target.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
}

function loop(now) {
  const dt = Math.min(90, now - lastTime);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function renderGameToText() {
  if (!state) return JSON.stringify({ mode: "uninitialized" });
  const head = state.snake[0];
  return JSON.stringify({
    mode: state.mode,
    grid: {
      cols: GRID,
      rows: GRID,
      origin: "top-left",
      axes: "x right, y down",
    },
    snake: {
      head,
      length: state.snake.length,
      direction: state.dir.name,
      phaseMs: Math.round(state.phaseMs),
      phaseCooldownMs: Math.round(state.phaseCooldown),
    },
    food: state.food ? { x: state.food.x, y: state.food.y, type: state.food.type } : null,
    gates: state.gates,
    hazards: [...state.hazards].slice(0, 24).map(value => {
      const [x, y] = value.split(",").map(Number);
      return { x, y };
    }),
    score: state.score,
    combo: state.combo,
    rank: getRank(),
    status: state.status,
  });
}

window.render_game_to_text = renderGameToText;
window.advanceTime = ms => {
  const steps = Math.max(1, Math.round(ms / (1000 / 60)));
  for (let i = 0; i < steps; i += 1) {
    update(1000 / 60);
  }
  render();
};

startButton.addEventListener("click", startGame);
pauseButton.addEventListener("click", togglePause);
phaseButton.addEventListener("click", activatePhase);
resetButton.addEventListener("click", startGame);
canvas.addEventListener("click", () => canvas.focus());
window.addEventListener("keydown", handleKey);
window.addEventListener("resize", resizeCanvas);
document.addEventListener("fullscreenchange", resizeCanvas);

document.querySelectorAll(".rail-button[data-jump]").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".rail-button[data-jump]").forEach(item => item.classList.remove("active"));
    button.classList.add("active");
    document.querySelector(button.dataset.jump)?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

makeState("menu");
resizeCanvas();
requestAnimationFrame(loop);
