let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let ambientStarted = false;
let mutedByUser = false;

function ensureCtx(): AudioContext | null {
  if (mutedByUser) return null;
  if (ctx) return ctx;
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!AC) return null;
  ctx = new AC();
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.32;
  masterGain.connect(ctx.destination);
  return ctx;
}

function resumeIfNeeded() {
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

export function startAmbient(): void {
  const c = ensureCtx();
  if (!c || !masterGain || ambientStarted) return;
  resumeIfNeeded();
  ambientStarted = true;

  const bufSize = 2 * c.sampleRate;
  const buf = c.createBuffer(1, bufSize, c.sampleRate);
  const data = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < bufSize; i++) {
    const w = (Math.random() * 2 - 1) * 0.5;
    last = (last + 0.02 * w) / 1.02;
    data[i] = last * 3.5;
  }

  const noise = c.createBufferSource();
  noise.buffer = buf;
  noise.loop = true;

  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 420;
  lp.Q.value = 0.6;

  const noiseGain = c.createGain();
  noiseGain.gain.value = 0;
  noiseGain.gain.setTargetAtTime(0.22, c.currentTime, 4.0);

  const lfo = c.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.08;
  const lfoGain = c.createGain();
  lfoGain.gain.value = 0.08;
  lfo.connect(lfoGain).connect(noiseGain.gain);

  noise.connect(lp).connect(noiseGain).connect(masterGain);
  noise.start();
  lfo.start();

  const warble = c.createOscillator();
  warble.type = 'sine';
  warble.frequency.value = 96;
  const warbleGain = c.createGain();
  warbleGain.gain.value = 0;
  warbleGain.gain.setTargetAtTime(0.05, c.currentTime, 6.0);
  const warbleLfo = c.createOscillator();
  warbleLfo.type = 'sine';
  warbleLfo.frequency.value = 0.04;
  const warbleLfoGain = c.createGain();
  warbleLfoGain.gain.value = 6;
  warbleLfo.connect(warbleLfoGain).connect(warble.frequency);
  warble.connect(warbleGain).connect(masterGain);
  warble.start();
  warbleLfo.start();
}

export function playChime(hue: number): void {
  const c = ensureCtx();
  if (!c || !masterGain) return;
  resumeIfNeeded();
  const t = c.currentTime;
  const clamped = Math.max(0, Math.min(60, hue));
  const t01 = clamped / 60;
  const baseFreq = 880 - t01 * 260;

  const tones = [baseFreq, baseFreq * 1.5, baseFreq * 2];
  const gains = [0.18, 0.10, 0.06];

  tones.forEach((freq, i) => {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gains[i], t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    osc.connect(g).connect(masterGain!);
    osc.start(t);
    osc.stop(t + 1.7);
  });
}

export function muteAudio(): void {
  mutedByUser = true;
  if (masterGain) masterGain.gain.setTargetAtTime(0, ctx!.currentTime, 0.4);
}
