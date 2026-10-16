// Notification sounds, synthesized with Web Audio (no sound files): cyberpunk-flavored and short.
// Never touches the DOM.
//
//   message     soft two-note synth chime with an echo        (chat message, incoming file)
//   console     fast bit-crushed data blips                   (errors/warnings, link up)
//   disconnect  falling, glitching saw alarm                  (the link went down)
//   ui          short tick; 'on' / 'off' variants rise/fall   (buttons, mic/deafen, screen share)
//
// Event sounds (message/console/disconnect) requested within EVENT_WINDOW_MS of each other are
// merged and only the most important one plays, so one incident never makes a chord of alarms.

const EVENT_PRIORITY = { message: 1, console: 2, disconnect: 3 };
const EVENT_WINDOW_MS = 150;
const HISTORY = 50;

export class SoundBoard {
  /** Master level 0–1 for everything. */
  volume = 0.6;
  eventsEnabled = true;
  uiEnabled = true;
  /** Last played sounds, newest last: [{ name, variant, at }] (for tests and debugging). */
  history = [];

  /** @type {AudioContext | null} */
  #context = null;
  #master = null;
  #pendingEvent = null;
  #pendingTimer = null;
  #speakers = null;

  /** @param {import('./speakers.js').Speakers} speakers sounds follow AUDIO_OUT */
  constructor(speakers) {
    this.#speakers = speakers;
  }

  /** Queue an event sound; the most important one in a short window wins. */
  event(name) {
    if (!(name in EVENT_PRIORITY)) return;
    if (!this.#pendingEvent || EVENT_PRIORITY[name] > EVENT_PRIORITY[this.#pendingEvent]) this.#pendingEvent = name;
    this.#pendingTimer ??= setTimeout(() => {
      const winner = this.#pendingEvent;
      this.#pendingEvent = this.#pendingTimer = null;
      if (this.eventsEnabled) this.play(winner);
    }, EVENT_WINDOW_MS);
  }

  /** UI sound: 'click' (default), 'on' or 'off'. */
  ui(variant = 'click') {
    if (this.uiEnabled) this.play('ui', variant);
  }

  /** Plays right away, ignoring the enabled flags (used by the TEST buttons too). */
  play(name, variant = '') {
    const ctx = this.#ensureContext();
    if (!ctx || this.volume <= 0) return;
    if (ctx.state === 'suspended') ctx.resume();
    const t = ctx.currentTime + 0.01;
    const out = this.#master;
    PLAYERS[name]?.(ctx, out, t, variant);
    this.history.push({ name, variant, at: Date.now() });
    if (this.history.length > HISTORY) this.history.shift();
  }

  setVolume(volume) {
    this.volume = Math.min(1, Math.max(0, Number(volume) || 0));
    if (this.#master) this.#master.gain.value = this.volume * MASTER_SCALE;
  }

  #ensureContext() {
    if (this.#context) return this.#context;
    try {
      this.#context = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
    this.#master = this.#context.createGain();
    this.#master.gain.value = this.volume * MASTER_SCALE;
    this.#master.connect(this.#context.destination);
    this.#speakers?.attach(this.#context); // AudioContext.setSinkId → same device as AUDIO_OUT
    return this.#context;
  }
}

// Keeps 100% at a polite level next to voice.
const MASTER_SCALE = 0.5;

const PLAYERS = { message: playMessage, console: playConsole, disconnect: playDisconnect, ui: playUi };

/**
 * Renders a sound offline at 100% volume and returns its AudioBuffer (no speakers involved).
 * Used by tests (not silent, not clipping) and to export previews.
 */
export async function renderSound(name, variant = '', seconds = 1.2) {
  const ctx = new OfflineAudioContext(2, Math.ceil(48000 * seconds), 48000);
  const master = ctx.createGain();
  master.gain.value = MASTER_SCALE;
  master.connect(ctx.destination);
  PLAYERS[name](ctx, master, 0.01, variant);
  return ctx.startRendering();
}

// --- building blocks ---------------------------------------------------------------------

function envelope(ctx, at, attack, hold, release, peak = 1) {
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + attack);
  gain.gain.setValueAtTime(peak, at + attack + hold);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  return gain;
}

function tone(ctx, out, { type = 'sine', freq, to, at, attack = 0.005, hold = 0.02, release = 0.08, peak = 0.5 }) {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + attack + hold + release);
  const env = envelope(ctx, at, attack, hold, release, peak);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + attack + hold + release + 0.05);
  return env;
}

function noiseBurst(ctx, out, { at, duration = 0.03, freq = 3000, q = 1.5, peak = 0.3 }) {
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  gain.gain.value = peak;
  source.connect(filter).connect(gain).connect(out);
  source.start(at);
}

/** Coarse quantizer: the "8-bit" grit of the console sound. */
function bitCrusher(ctx, steps = 12) {
  const shaper = ctx.createWaveShaper();
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.round(x * steps) / steps;
  }
  shaper.curve = curve;
  return shaper;
}

function echo(ctx, out, delaySeconds = 0.14, feedback = 0.32, wet = 0.35) {
  const input = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = delaySeconds;
  const fb = ctx.createGain();
  fb.gain.value = feedback;
  const wetGain = ctx.createGain();
  wetGain.gain.value = wet;
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2400;
  input.connect(out); // dry
  input.connect(delay).connect(tone).connect(fb).connect(delay);
  tone.connect(wetGain).connect(out);
  return input;
}

// --- the four sounds -----------------------------------------------------------------------

/** Soft: two warm notes a fifth apart, slow attack, low-passed, with a synth-wave echo. */
function playMessage(ctx, out, t) {
  const bus = echo(ctx, out);
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1800;
  filter.connect(bus);
  for (const [freq, at] of [[659.25, t], [987.77, t + 0.12]]) {
    tone(ctx, filter, { type: 'triangle', freq, at, attack: 0.02, hold: 0.06, release: 0.32, peak: 0.42 });
    tone(ctx, filter, { type: 'sine', freq: freq * 2, at, attack: 0.02, hold: 0.03, release: 0.2, peak: 0.08 });
  }
}

/** Technical: a quick arpeggio of square blips through a bit-crusher, plus a data tick. */
function playConsole(ctx, out, t) {
  const crusher = bitCrusher(ctx, 10);
  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 500;
  crusher.connect(filter).connect(out);
  [1568, 2349, 1760, 2637, 2093].forEach((freq, i) => {
    tone(ctx, crusher, { type: 'square', freq, at: t + i * 0.045, attack: 0.002, hold: 0.018, release: 0.02, peak: 0.16 });
  });
  noiseBurst(ctx, out, { at: t, duration: 0.02, freq: 6000, q: 3, peak: 0.12 });
  noiseBurst(ctx, out, { at: t + 0.23, duration: 0.025, freq: 4500, q: 3, peak: 0.1 });
}

/** Alarm: a falling detuned saw, low-pass closing, gated into glitchy stutters. */
function playDisconnect(ctx, out, t) {
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 6;
  filter.frequency.setValueAtTime(3200, t);
  filter.frequency.exponentialRampToValueAtTime(260, t + 0.55);
  const gate = ctx.createGain();
  // Stutter: chop the first part into 35 ms slices, then let the tail fall.
  for (let i = 0; i < 6; i++) {
    gate.gain.setValueAtTime(i % 2 ? 0.15 : 1, t + i * 0.035);
  }
  gate.gain.setValueAtTime(1, t + 0.21);
  filter.connect(gate).connect(out);
  for (const detune of [-14, 14]) {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.exponentialRampToValueAtTime(98, t + 0.6);
    const env = envelope(ctx, t, 0.005, 0.25, 0.4, 0.28);
    osc.connect(env).connect(filter);
    osc.start(t);
    osc.stop(t + 0.72);
  }
  noiseBurst(ctx, out, { at: t + 0.02, duration: 0.06, freq: 1200, q: 0.8, peak: 0.18 });
}

/** UI: a crisp tick. 'on' adds a rising double blip, 'off' a falling one. */
function playUi(ctx, out, t, variant) {
  noiseBurst(ctx, out, { at: t, duration: 0.012, freq: 4200, q: 2, peak: 0.22 });
  if (variant === 'on' || variant === 'off') {
    const [first, second] = variant === 'on' ? [1320, 1980] : [1980, 1180];
    tone(ctx, out, { type: 'square', freq: first, at: t + 0.005, attack: 0.002, hold: 0.025, release: 0.03, peak: 0.08 });
    tone(ctx, out, { type: 'square', freq: second, at: t + 0.06, attack: 0.002, hold: 0.03, release: 0.04, peak: 0.08 });
  } else {
    tone(ctx, out, { type: 'sine', freq: 2600, at: t, attack: 0.001, hold: 0.008, release: 0.03, peak: 0.12 });
  }
}
