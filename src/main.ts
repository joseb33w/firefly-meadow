import { supabase, hasSupabase, TABLE, SILENT_LIFESPAN_S, WISH_LIFESPAN_S, WISH_MAX_LEN, type FireflyRow } from './supabase';
import { startAmbient, playChime, playWishChime } from './audio';

const FADE_IN_MS = 2000;
const FADE_OUT_MS = 30 * 1000;
const STAR_COUNT = 140;
const MAX_OPTIMISTIC_TRACKED = 200;
const HIT_RADIUS_PX = 20;
const TOOLTIP_MS = 4000;
const TAP_DRIFT_TOLERANCE_PX = 14;

type Firefly = {
  id: string;
  bornAt: number;
  bx: number;
  by: number;
  hue: number;
  wish: string | null;
  lifespanMs: number;
  ax1: number; ax2: number; px1: number; px2: number; fx1: number; fx2: number;
  ay1: number; ay2: number; py1: number; py2: number; fy1: number; fy2: number;
  pulsePhase: number;
  pulseFreq: number;
  haloPhase: number;
  optimistic: boolean;
};

type Tooltip = {
  fireflyId: string;
  startedAt: number;
  lines: string[];
};

const canvas = document.getElementById('meadow') as HTMLCanvasElement;
const _ctx = canvas.getContext('2d', { alpha: false });
if (!_ctx) throw new Error('canvas 2d context unavailable');
const ctx: CanvasRenderingContext2D = _ctx;
const hudText = document.getElementById('hud-text') as HTMLSpanElement;
const helpBtn = document.getElementById('help-btn') as HTMLButtonElement;
const helpOverlay = document.getElementById('help-overlay') as HTMLDivElement;
const wishInput = document.getElementById('wish-input') as HTMLInputElement;
const wishCounter = document.getElementById('wish-counter') as HTMLSpanElement;

let dpr = 1;
let cssW = 1;
let cssH = 1;

function applyCanvasSize(): void {
  dpr = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
  const rect = canvas.getBoundingClientRect();
  cssW = Math.max(1, rect.width);
  cssH = Math.max(1, rect.height);
  const bufW = Math.max(1, Math.round(cssW * dpr));
  const bufH = Math.max(1, Math.round(cssH * dpr));
  if (canvas.width !== bufW) canvas.width = bufW;
  if (canvas.height !== bufH) canvas.height = bufH;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
applyCanvasSize();
window.addEventListener('resize', applyCanvasSize);
window.addEventListener('orientationchange', applyCanvasSize);
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', applyCanvasSize);
}

function pointFromEvent(e: { clientX: number; clientY: number }): { cssX: number; cssY: number; normX: number; normY: number } {
  const rect = canvas.getBoundingClientRect();
  const cssX = e.clientX - rect.left;
  const cssY = e.clientY - rect.top;
  const normX = Math.max(0, Math.min(1, cssX / Math.max(1, rect.width)));
  const normY = Math.max(0, Math.min(1, cssY / Math.max(1, rect.height)));
  return { cssX, cssY, normX, normY };
}

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
const stars: Star[] = (() => {
  const r = makeRng(pageLoadSeed);
  const out: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    out.push({ x: r(), y: r(), r: 0.35 + r() * 1.1, a: 0.25 + r() * 0.55, tw: 0.6 + r() * 1.2 });
  }
  return out;
})();

const fireflies = new Map<string, Firefly>();
let tooltip: Tooltip | null = null;
const knownAtSubscribe = new Set<string>();

function buildFirefly(row: { id: string; bornAt: number; bx: number; by: number; hue: number; wish: string | null; lifespanMs: number; optimistic: boolean }): Firefly {
  const r = makeRng(hashStringToSeed(row.id));
  return {
    id: row.id,
    bornAt: row.bornAt,
    bx: row.bx,
    by: row.by,
    hue: row.hue,
    wish: row.wish,
    lifespanMs: row.lifespanMs,
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
    haloPhase: r() * Math.PI * 2,
    optimistic: row.optimistic
  };
}

function addRow(row: FireflyRow, optimistic = false, fromRealtime = false): void {
  const existing = fireflies.get(row.id);
  if (existing) {
    if (existing.optimistic && !optimistic) existing.optimistic = false;
    return;
  }
  const bornAt = optimistic ? Date.now() : Date.parse(row.born_at);
  if (Number.isNaN(bornAt)) return;
  const lifespanMs = (row.lifespan_seconds ?? SILENT_LIFESPAN_S) * 1000;
  if (Date.now() - bornAt >= lifespanMs) return;
  const wish = (row.wish && row.wish.trim().length > 0) ? row.wish : null;
  fireflies.set(row.id, buildFirefly({
    id: row.id, bornAt, bx: row.x, by: row.y, hue: row.hue, wish, lifespanMs, optimistic
  }));
  scheduleHud();
  if (fromRealtime && wish && !knownAtSubscribe.has(row.id)) {
    playWishChime(row.hue);
  }
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
  const grad = ctx.createRadialGradient(cssW * 0.5, cssH * 0.62, Math.min(cssW, cssH) * 0.05, cssW * 0.5, cssH * 0.62, Math.max(cssW, cssH) * 0.95);
  grad.addColorStop(0, '#101427');
  grad.addColorStop(0.45, '#0a0c1c');
  grad.addColorStop(1, '#04050d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.fillStyle = '#000';
  ctx.globalAlpha = 0.18;
  const horizonY = cssH * 0.78;
  ctx.beginPath();
  ctx.moveTo(0, horizonY);
  ctx.bezierCurveTo(cssW * 0.3, horizonY - 18, cssW * 0.65, horizonY + 22, cssW, horizonY - 6);
  ctx.lineTo(cssW, cssH);
  ctx.lineTo(0, cssH);
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
    ctx.arc(s.x * cssW, s.y * cssH * 0.78, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function fireflyDriftedPos(f: Firefly, nowMs: number): { x: number; y: number } {
  const tSec = (nowMs - f.bornAt) / 1000;
  const dx = f.ax1 * Math.sin(f.fx1 * tSec + f.px1) + f.ax2 * Math.sin(f.fx2 * tSec + f.px2);
  const dy = f.ay1 * Math.sin(f.fy1 * tSec + f.py1) + f.ay2 * Math.sin(f.fy2 * tSec + f.py2);
  return { x: f.bx * cssW + dx, y: f.by * cssH + dy };
}

function fireflyEnvelope(f: Firefly, nowMs: number): number {
  const age = nowMs - f.bornAt;
  if (age < 0 || age >= f.lifespanMs) return 0;
  let envelope = 1;
  if (age < FADE_IN_MS) envelope = Math.sin((age / FADE_IN_MS) * (Math.PI * 0.5));
  const fadeOutStart = f.lifespanMs - FADE_OUT_MS;
  if (age > fadeOutStart) {
    const t = (age - fadeOutStart) / FADE_OUT_MS;
    envelope = Math.min(envelope, Math.cos(t * (Math.PI * 0.5)));
  }
  return Math.max(0, envelope);
}

function drawFirefly(f: Firefly, nowMs: number): void {
  const envelope = fireflyEnvelope(f, nowMs);
  if (envelope <= 0.001) return;

  const tSec = (nowMs - f.bornAt) / 1000;
  const { x, y } = fireflyDriftedPos(f, nowMs);

  const pulse = 0.78 + 0.22 * Math.sin(tSec * f.pulseFreq * Math.PI * 2 + f.pulsePhase);
  const intensity = envelope * pulse;
  const coreR = 2.2 + 1.0 * pulse;
  const haloR = 28 + 12 * pulse;
  const hue = f.hue;

  if (f.wish) {
    const auraPulse = 0.55 + 0.45 * Math.sin(tSec * Math.PI * 2 + f.haloPhase);
    const auraR = 56 + 14 * auraPulse;
    const auraAlpha = 0.12 * envelope * (0.4 + 0.6 * auraPulse);
    const aura = ctx.createRadialGradient(x, y, haloR * 0.6, x, y, auraR);
    aura.addColorStop(0, `hsla(${hue}, 55%, 70%, ${auraAlpha})`);
    aura.addColorStop(0.6, `hsla(${hue}, 50%, 55%, ${auraAlpha * 0.45})`);
    aura.addColorStop(1, `hsla(${hue}, 45%, 45%, 0)`);
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(x, y, auraR, 0, Math.PI * 2);
    ctx.fill();
  }

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

function wrapWish(text: string, maxWidth: number): string[] {
  ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const tentative = current ? `${current} ${w}` : w;
    if (ctx.measureText(tentative).width > maxWidth && current) {
      lines.push(current);
      current = w;
    } else {
      current = tentative;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text];
}

function drawTooltip(now: number): void {
  if (!tooltip) return;
  const f = fireflies.get(tooltip.fireflyId);
  if (!f || !f.wish) { tooltip = null; return; }
  const elapsed = now - tooltip.startedAt;
  if (elapsed >= TOOLTIP_MS) { tooltip = null; return; }

  let alpha = 1;
  if (elapsed < 350) alpha = elapsed / 350;
  else if (elapsed > TOOLTIP_MS - 500) alpha = Math.max(0, (TOOLTIP_MS - elapsed) / 500);
  if (alpha <= 0.005) return;

  const { x, y } = fireflyDriftedPos(f, Date.now());
  const maxWidth = Math.min(280, cssW - 40);
  ctx.font = '500 13px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif';
  const lineHeight = 17;
  const padX = 12;
  const padY = 9;

  const widest = tooltip.lines.reduce((mx, l) => Math.max(mx, ctx.measureText(l).width), 0);
  const rectW = Math.min(maxWidth + padX * 2, widest + padX * 2);
  const rectH = tooltip.lines.length * lineHeight + padY * 2;

  const aboveY = y - 24 - rectH;
  const belowY = y + 24;
  let rectY = aboveY;
  let flipped = false;
  if (aboveY < 8) {
    rectY = belowY;
    flipped = true;
  }

  let rectX = x - rectW / 2;
  rectX = Math.max(8, Math.min(cssW - rectW - 8, rectX));

  const tipCx = Math.max(rectX + 14, Math.min(rectX + rectW - 14, x));
  const r = 12;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(10, 12, 24, 0.92)';
  ctx.strokeStyle = `hsla(${f.hue}, 80%, 65%, 0.55)`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(rectX + r, rectY);
  ctx.lineTo(rectX + rectW - r, rectY);
  ctx.quadraticCurveTo(rectX + rectW, rectY, rectX + rectW, rectY + r);
  ctx.lineTo(rectX + rectW, rectY + rectH - r);
  ctx.quadraticCurveTo(rectX + rectW, rectY + rectH, rectX + rectW - r, rectY + rectH);
  ctx.lineTo(rectX + r, rectY + rectH);
  ctx.quadraticCurveTo(rectX, rectY + rectH, rectX, rectY + rectH - r);
  ctx.lineTo(rectX, rectY + r);
  ctx.quadraticCurveTo(rectX, rectY, rectX + r, rectY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(10, 12, 24, 0.92)';
  ctx.strokeStyle = `hsla(${f.hue}, 80%, 65%, 0.55)`;
  ctx.beginPath();
  if (!flipped) {
    ctx.moveTo(tipCx - 6, rectY + rectH);
    ctx.lineTo(tipCx, rectY + rectH + 7);
    ctx.lineTo(tipCx + 6, rectY + rectH);
  } else {
    ctx.moveTo(tipCx - 6, rectY);
    ctx.lineTo(tipCx, rectY - 7);
    ctx.lineTo(tipCx + 6, rectY);
  }
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 0;

  ctx.fillStyle = `hsla(${f.hue}, 90%, 86%, ${0.96 * alpha})`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (let i = 0; i < tooltip.lines.length; i++) {
    ctx.fillText(tooltip.lines[i], rectX + padX, rectY + padY + i * lineHeight, maxWidth);
  }
  ctx.restore();
}

function loop(now: number): void {
  applyCanvasSize();
  const nowMs = Date.now();

  let removed = false;
  for (const [id, f] of fireflies) {
    if (nowMs - f.bornAt >= f.lifespanMs) {
      fireflies.delete(id);
      removed = true;
      if (tooltip && tooltip.fireflyId === id) tooltip = null;
    }
  }
  if (removed) scheduleHud();

  drawBackground();
  drawStars(now);

  ctx.globalCompositeOperation = 'lighter';
  for (const f of fireflies.values()) drawFirefly(f, nowMs);
  ctx.globalCompositeOperation = 'source-over';

  drawTooltip(now);

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

async function releaseFirefly(normX: number, normY: number, wishText: string | null): Promise<void> {
  const hue = randomWarmHue();
  const id = genLocalId();
  const lifespanSec = wishText ? WISH_LIFESPAN_S : SILENT_LIFESPAN_S;
  recentOptimistic.add(id);
  if (recentOptimistic.size > MAX_OPTIMISTIC_TRACKED) {
    const it = recentOptimistic.values().next();
    if (!it.done) recentOptimistic.delete(it.value);
  }

  addRow({
    id,
    x: normX,
    y: normY,
    hue,
    wish: wishText,
    lifespan_seconds: lifespanSec,
    born_at: new Date().toISOString()
  }, true);
  playChime(hue);

  if (!supabase) return;
  const payload: Record<string, unknown> = { id, x: normX, y: normY, hue, lifespan_seconds: lifespanSec };
  if (wishText) payload.wish = wishText;
  const { error } = await supabase.from(TABLE).insert(payload);
  if (error) {
    fireflies.delete(id);
    scheduleHud();
    console.warn('[fireflymeadow] insert failed:', error.message);
  }
}

function hitTestFirefly(cssX: number, cssY: number, nowMs: number): Firefly | null {
  let best: { f: Firefly; d2: number } | null = null;
  const r2 = HIT_RADIUS_PX * HIT_RADIUS_PX;
  for (const f of fireflies.values()) {
    if (fireflyEnvelope(f, nowMs) <= 0.05) continue;
    const { x, y } = fireflyDriftedPos(f, nowMs);
    const dx = cssX - x;
    const dy = cssY - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= r2 && (!best || d2 < best.d2)) best = { f, d2 };
  }
  return best ? best.f : null;
}

function showTooltip(f: Firefly): void {
  if (!f.wish) return;
  const lines = wrapWish(f.wish, Math.min(260, cssW - 64));
  tooltip = { fireflyId: f.id, startedAt: performance.now(), lines };
}

function currentWishText(): string | null {
  const v = wishInput.value.trim();
  if (v.length === 0) return null;
  return v.slice(0, WISH_MAX_LEN);
}

function clearWishInput(): void {
  wishInput.value = '';
  updateWishCounter();
}

function updateWishCounter(): void {
  const len = wishInput.value.length;
  wishCounter.textContent = `${len}/${WISH_MAX_LEN}`;
  let state = 'ok';
  if (len >= WISH_MAX_LEN) state = 'danger';
  else if (len > 60) state = 'warn';
  wishCounter.dataset.state = state;
}
wishInput.addEventListener('input', updateWishCounter);
wishInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    wishInput.blur();
  }
});
updateWishCounter();

type DownState = {
  pointerId: number;
  cssX: number;
  cssY: number;
  normX: number;
  normY: number;
  startTarget: Firefly | null;
};
let down: DownState | null = null;

canvas.addEventListener('pointerdown', (e) => {
  if (down) return;
  startAmbient();
  const p = pointFromEvent(e);
  const hit = hitTestFirefly(p.cssX, p.cssY, Date.now());
  down = { pointerId: e.pointerId, cssX: p.cssX, cssY: p.cssY, normX: p.normX, normY: p.normY, startTarget: hit };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
});

canvas.addEventListener('pointerup', (e) => {
  if (!down || e.pointerId !== down.pointerId) return;
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  const p = pointFromEvent(e);
  const start = down;
  down = null;

  const nowMs = Date.now();
  if (start.startTarget) {
    const stillHit = hitTestFirefly(p.cssX, p.cssY, nowMs);
    if (stillHit && stillHit.id === start.startTarget.id) {
      showTooltip(stillHit);
    }
    return;
  }
  const dx = p.cssX - start.cssX;
  const dy = p.cssY - start.cssY;
  const movedFar = (dx * dx + dy * dy) > (TAP_DRIFT_TOLERANCE_PX * TAP_DRIFT_TOLERANCE_PX);
  const releaseX = movedFar ? p.normX : start.normX;
  const releaseY = movedFar ? p.normY : start.normY;
  const wishText = currentWishText();
  void releaseFirefly(releaseX, releaseY, wishText);
  if (wishText) clearWishInput();
});

canvas.addEventListener('pointercancel', (e) => {
  if (down && e.pointerId === down.pointerId) {
    try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    down = null;
  }
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function showHelp(): void { helpOverlay.classList.add('show'); }
function hideHelp(): void { helpOverlay.classList.remove('show'); }
helpBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); showHelp(); });
helpOverlay.addEventListener('pointerdown', (e) => { e.stopPropagation(); hideHelp(); });

async function seedFromDb(): Promise<void> {
  if (!supabase) return;
  const sinceIso = new Date(Date.now() - WISH_LIFESPAN_S * 1000).toISOString();
  const { data, error } = await supabase
    .from(TABLE)
    .select('id,x,y,hue,wish,lifespan_seconds,born_at')
    .gt('born_at', sinceIso)
    .order('born_at', { ascending: true })
    .limit(500);
  if (error) {
    console.warn('[fireflymeadow] seed query failed:', error.message);
    return;
  }
  for (const row of (data ?? []) as FireflyRow[]) {
    knownAtSubscribe.add(row.id);
    addRow(row, false, false);
  }
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
        addRow(row, false, true);
      }
    )
    .subscribe();
  const client = supabase;
  window.addEventListener('beforeunload', () => { void client.removeChannel(channel); });
}

if (import.meta.env.VITE_DEBUG === '1') {
  (window as unknown as { __ffm: unknown }).__ffm = {
    fireflies: () => Array.from(fireflies.values()).map((f) => {
      const p = fireflyDriftedPos(f, Date.now());
      return { id: f.id, bx: f.bx, by: f.by, hue: f.hue, wish: f.wish, lifespanMs: f.lifespanMs, x: p.x, y: p.y };
    }),
    tooltip: () => tooltip
      ? { fireflyId: tooltip.fireflyId, startedAt: tooltip.startedAt, lines: tooltip.lines, elapsedMs: performance.now() - tooltip.startedAt }
      : null,
    cssSize: () => ({ cssW, cssH, dpr })
  };
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
