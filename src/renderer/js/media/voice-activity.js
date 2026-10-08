// "Is this track speaking?" via an AnalyserNode RMS level with a short hold time.

const THRESHOLD_DB = -48;
const HOLD_MS = 250;
const TICK_MS = 50;

export class VoiceActivity {
  /** @type {AudioContext | null} */
  #context = null;
  #watchers = new Set();
  #timer = null;

  /** Calls onChange(true|false) when `track` starts/stops speaking. Returns a stop function. */
  watch(track, onChange) {
    this.#context ??= new AudioContext();
    if (this.#context.state === 'suspended') this.#context.resume();

    const source = this.#context.createMediaStreamSource(new MediaStream([track]));
    const analyser = this.#context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);

    const watcher = { analyser, samples: new Float32Array(analyser.fftSize), onChange, speaking: false, lastLoud: 0 };
    this.#watchers.add(watcher);
    this.#timer ??= setInterval(() => this.#tick(), TICK_MS);

    return () => {
      source.disconnect();
      this.#watchers.delete(watcher);
      if (watcher.speaking) onChange(false);
      if (!this.#watchers.size) {
        clearInterval(this.#timer);
        this.#timer = null;
      }
    };
  }

  #tick() {
    const now = performance.now();
    for (const watcher of this.#watchers) {
      watcher.analyser.getFloatTimeDomainData(watcher.samples);
      let sum = 0;
      for (const sample of watcher.samples) sum += sample * sample;
      const db = 20 * Math.log10(Math.sqrt(sum / watcher.samples.length) || 1e-10);

      if (db > THRESHOLD_DB) watcher.lastLoud = now;
      const speaking = now - watcher.lastLoud < HOLD_MS;
      if (speaking !== watcher.speaking) {
        watcher.speaking = speaking;
        watcher.onChange(speaking);
      }
    }
  }
}
