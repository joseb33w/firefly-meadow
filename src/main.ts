import { supabase, hasSupabase, TABLE, type FireflyRow } from './supabase';
import { startAmbient, playChime } from './audio';

const LIFE_MS = 5 * 60 * 1000;
const FADE_IN_MS = 2000;
const FADE_OUT_MS = 30 * 1000;
const STAR_COUNT = 140;
const MAX_OPTIMISTIC_TRACKED = 200;

type Firefly = {
  id: string;
  bornAt: number;
  bx: number;
  by: number;
  hue: number;
  ax1: number; ax2: number; px1: number; px2: number; fx1: number; fx2: number;
  ay1: number; ay2: number; py1: number; py2: number; fy1: number; fy2: number;
  pulsePhase: number;
  pulseFreq: number;
  optimistic: boolean;
};

const canvas = document.getElementById('meadow') as HTMLCanvasElement;
const _ctx = canvas.getContext('2d', { alpha: false });
if (!_ctx) throw new Error('canvas 2d context unavailable');
const ctx: CanvasRenderingContext2D = _ctx;
const hudText = document.getElementById('hud-text') as HTMLSpanElement;
const helpBtn = document.getElementById('help-btn') as HTMLButtonElement;
const helpOverlay = document.getElementById('help-overlay') as HTMLDivElement;

let dpr = Math.min(window.devicePixelRatio || 1, 2);
let W = window.innerWidth;
let H = window.innerHeight;

function resize(): void {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.max(1, Math.floor(W * dpr));
  canvas.height = Math.max(1, Math.floor(H * dpr));
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);

const pageLoadSeed = Math.floor(Math.random() * 1_000_000_000) >>> 0;

function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStringToSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Star = { x: number; y: number; r: number; a: number; tw: number };
let stars: Star[] = [];
function buildStars(): void {
  const r = makeRng(pageLoadSeed);
  stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: r(),
      y: r(),
      r: 0.35 + r() * 1.1,
      a: 0.25 + r() * 0.55,
      tw: 0.6 + r() * 1.2
    });
  }
}
buildStars();

const fireflies = new Map<string, Firefly>();

function buildFirefly(id: string, bornAt: number, bx: number, by: number, hue: number, optimistic = false): Firefly {
  const r = makeRng(hashStringToSeed(id));
  return {
    id,
    bornAt,
    bx,
    by,
    hue,
    ax1: 60 + r() * 60,
    ax2: 16 + r() * 22,
    px1: r() * Math.PI * 2,
    px2: r() * Math.PI * 2,
    fx1: 0.04 + r() * 0.05,
    fx2: 0.22 + r() * 0.20,
    ay1: 60 + r() * 60,
    ay2: 16 + r() * 22,
    py1: r() * Math.PI * 2,
    py2: r() * Math.PI * 2,
    fy1: 0.04 + r() * 0.05,
    fy2: 0.22 + r() * 0.20,
    pulsePhase: r() * Math.PI * 2,
    pulseFreq: 0.22 + r() * 0.18,
    optimistic
  };
}

function addRow(row: FireflyRow, optimistic = false): void {
  const existing = fireflies.get(row.id);
  if (existing) {
    if (existing.optimistic && !optimistic) existing.optimistic = false;
    return;
  }
  const bornAt = optimistic ? Date.now() : Date.parse(row.born_at);
  if (Number.isNaN(bornAt)) return;
  if (Date.now() - bornAt >= LIFE_MS) return;
  fireflies.set(row.id, buildFirefly(row.id, bornAt, row.x, row.y, row.hue, optimistic));
  scheduleHud();
}

let hudDirty = true;
function scheduleHud(): void { hudDirty = true; }

let prevHudText = '';
function renderHud(): void {
  if (!hudDirty) return;
  const n = fireflies.size;
  const txt = n === 0
    ? 'tap to begin'
    : n === 1
      ? '1 firefly glowing'
      : `${n} fireflies glowing`;
  if (txt !== prevHudText) {
    hudText.textContent = txt;
    prevHudText = txt;
  }
  hudDirty = false;
}

function drawBackground(): void {
  const grad = ctx.createRadialGradient(W * 0.5, H * 0.62, Math.min(W, H) * 0.05, W * 0.5, H * 0.62, Math.max(W, H) * 0.95);
  grad.addColorStop(0, '#101427');
  grad.addColorStop(0.45, '#0a0c1c');
  grad.addColorStop(1, '#04050d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.18;
  const horizonY = H * 0.78;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.bezierCurveTo(W * 0.3, horizonY - 18, W * 0.65, horizonY + 22, W, horizonY - 6);
  ctx.lineTo(W, H);
  ctx.lineTo(0, H);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawStars(t: number): void {
  ctx.save();
  for (const s of stars) {
    const tw = 0.7 + 0.3 * Math.sin(t * 0.0006 * s.tw + s.x * 12.0);
    ctx.globalAlpha = s.a * tw;
    ctx.fillStyle = '#e9ecff';
    ctx.beginPath();
    ctx.arc(s.x * W, s.y * H * 0.78, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawFirefly(f: Firefly, nowMs: number): void {
  const age = nowMs - f.bornAt;
  if (age < 0 || age >= LIFE_MS) return;

  let envelope = 1;
  if (age < FADE_IN_MS) {
    envelope = Math.sin((age / FADE_IN_MS) * (Math.PI * 0.5));
  }
  const fadeOutStart = LIFE_MS - FADE_OUT_MS;
  if (age > fadeOutStart) {
    const t = (age - fadeOutStart) / FADE_OUT_MS;
    envelope = Math.min(envelope, Math.cos(t * (Math.PI * 0.5)));
  }
  if (envelope <= 0.001) return;

  const tSec = age / 1000;
  const dx = f.ax1 * Math.sin(f.fx1 * tSec + f.px1) + f.ax2 * Math.sin(f.fx2 * tSec + f.px2);
  const dy = f.ay1 * Math.sin(f.fy1 * tSec + f.py1) + f.ay2 * Math.sin(f.fy2 * tSec + f.py2);

  const x = f.bx * W + dx;
  const y = f.by * H + dy;

  const pulse = 0.78 + 0.22 * Math.sin(tSec * f.pulseFreq * Math.PI * 2 + f.pulsePhase);
  const intensity = envelope * pulse;

  const coreR = 2.2 + 1.0 * pulse;
  const haloR = 28 + 12 * pulse;
  const hue = f.hue;

  const halo = ctx.createRadialGradient(x, y, 0, x, y, haloR);
  halo.addColorStop(0,    `hsla(${hue}, 95%, 78%, ${0.55 * intensity})`);
  halo.addColorStop(0.25, `hsla(${hue}, 92%, 65%, ${0.30 * intensity})`);
  halo.addColorStop(0.55, `hsla(${hue}, 88%, 55%, ${0.13 * intensity})`);
  halo.addColorStop(1,    `hsla(${hue}, 80%, 45%, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, haloR, 0, Math.PI * 2);
  ctx.fill();

  const core = ctx.createRadialGradient(x, y, 0, x, y, coreR * 4);
  core.addColorStop(0,    `hsla(50, 100%, 96%, ${0.95 * intensity})`);
  core.addColorStop(0.35, `hsla(${hue}, 100%, 80%, ${0.65 * intensity})`);
  core.addColorStop(1,    `hsla(${hue}, 90%, 60%, 0)`);
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, coreR * 4, 0, Math.PI * 2);
  ctx.fill();
}

let lastRender = 0;
function loop(now: number): void {
  if (now - lastRender < 14) {
    requestAnimationFrame(loop);
    return;
  }
  lastRender = now;
  const nowMs = Date.now();

  let removed = false;
  for (const [id, f] of fireflies) {
    if (nowMs - f.bornAt >= LIFE_MS) {
      fireflies.delete(id);
      removed = true;
    }
  }
  if (removed) scheduleHud();

  drawBackground();
  drawStars(now);

  ctx.globalCompositeOperation = 'lighter';
  for (const f of fireflies.values()) drawFirefly(f, nowMs);
  ctx.globalCompositeOperation = 'source-over';

  renderHud();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function randomWarmHue(): number {
  return Math.floor(15 + Math.random() * 45);
}

function genLocalId(): string {
  const c = window.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  c.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

const recentOptimistic = new Set<string>();

async function releaseFirefly(clientX: number, clientY: number): Promise<void> {
  const rect = canvas.getBoundingClientRect();
  const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
  const hue = randomWarmHue();
  const id = genLocalId();
  recentOptimistic.add(id);
  if (recentOptimistic.size > MAX_OPTIMISTIC_TRACKED) {
    const it = recentOptimistic.values().next();
    if (!it.done) recentOptimistic.delete(it.value);
  }

  const optimisticRow: FireflyRow = {
    id,
    x: nx,
    y: ny,
    hue,
    born_at: new Date().toISOString()
  };
  addRow(optimisticRow, true);
  playChime(hue);

  if (!supabase) return;
  const { error } = await supabase
    .from(TABLE)
    .insert({ id, x: nx, y: ny, hue });
  if (error) {
    fireflies.delete(id);
    scheduleHud();
    console.warn('[fireflymeadow] insert failed:', error.message);
  }
}

let pointerActive = false;
canvas.addEventListener('pointerdown', (e) => {
  pointerActive = true;
  startAmbient();
  void releaseFirefly(e.clientX, e.clientY);
});
canvas.addEventListener('pointerup', () => { pointerActive = false; });
canvas.addEventListener('pointercancel', () => { pointerActive = false; });
canvas.addEventListener('contextmenu', (e) => { if (pointerActive) e.preventDefault(); });

function showHelp(): void { helpOverlay.classList.add('show'); }
function hideHelp(): void { helpOverlay.classList.remove('show'); }
helpBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); showHelp(); });
helpOverlay.addEventListener('pointerdown', (e) => { e.stopPropagation(); hideHelp(); });

async function seedFromDb(): Promise<void> {
  if (!supabase) return;
  const sinceIso = new Date(Date.now() - LIFE_MS).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .select('id,x,y,hue,born_at')
    .gt('born_at', sinceIso)
    .order('born_at', { ascending: true })
    .limit(500);
  if (error) {
    console.warn('[fireflymeadow] seed query failed:', error.message);
    return;
  }
  for (const row of (data ?? []) as FireflyRow[]) addRow(row, false);
}

function subscribeRealtime(): void {
  if (!supabase) return;
  const channel = supabase
    .channel('fireflies-stream')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: TABLE },
      (payload) => {
        const row = payload.new as FireflyRow;
        if (recentOptimistic.has(row.id)) {
          const existing = fireflies.get(row.id);
          if (existing) existing.optimistic = false;
          return;
        }
        addRow(row, false);
      }
    )
    .subscribe();
  const client = supabase;
  window.addEventListener('beforeunload', () => { void client.removeChannel(channel); });
}

if (!hasSupabase) {
  console.warn('[fireflymeadow] Supabase env vars missing — running in local-only mode.');
  prevHudText = '';
  hudText.textContent = 'offline · tap to glow';
} else {
  void seedFromDb();
  subscribeRealtime();
}

renderHud();
