// Microphone: device list, selection, DSP options, and the live capture track.
// Never touches the DOM.
//
// The mic is only open while a call is running (acquire/release); idle means no capture, not
// even at startup: device names are readable without capturing, because the main process grants
// our own page the media permission (see hardenSession in main.js).
//
// Events (CustomEvent.detail):
//   'devices'  { devices: [{ id, label }] }  input device list changed
//   'device'   { deviceId }                  selected device changed
//   'track'    { track }                     the live track was replaced (or null)

import { log } from '../core/logger.js';

const STORAGE_KEY = 'cc.audio';
const DEFAULT_PROCESSING = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

export class Microphone extends EventTarget {
  /** @type {{ id: string, label: string }[]} */
  devices = [];
  deviceId = 'default';
  labelsHidden = false; // true if the system hid device names (then the first call fills them in)
  processing = { ...DEFAULT_PROCESSING };
  /** @type {MediaStreamTrack | null} */
  track = null;
  #generation = 0; // bumped by release(); captures that finish later are discarded

  constructor() {
    super();
    const saved = loadPrefs();
    if (typeof saved.deviceId === 'string') this.deviceId = saved.deviceId;
    for (const key of Object.keys(DEFAULT_PROCESSING)) {
      if (typeof saved.processing?.[key] === 'boolean') this.processing[key] = saved.processing[key];
    }
    navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDevices());
  }

  async init() {
    await this.refreshDevices();
  }

  async refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    const inputs = all.filter((device) => device.kind === 'audioinput');
    this.labelsHidden = inputs.some((device) => !device.label);
    this.devices = inputs.map((device) => ({ id: device.deviceId, label: device.label || 'Microphone' }));

    if (this.devices.length && !this.devices.some((device) => device.id === this.deviceId)) {
      const fallback = this.devices.find((device) => device.id === 'default') ?? this.devices[0];
      log.warn(`Selected microphone is gone. Falling back to: ${fallback.label}`);
      await this.setDevice(fallback.id);
    }
    this.#emit('devices', { devices: this.devices });
  }

  /** Opens the mic (if not already open) and returns its track. */
  async acquire() {
    if (this.track) return this.track;
    const generation = this.#generation;
    const track = await this.#capture();
    if (generation !== this.#generation) {
      track.stop(); // released while getUserMedia was pending: never leave the mic open
      return null;
    }
    this.#setTrack(track);
    return this.track;
  }

  release() {
    this.#generation += 1; // any capture still in flight is now stale
    this.track?.stop();
    this.#setTrack(null);
  }

  async setDevice(deviceId) {
    this.deviceId = deviceId;
    this.#save();
    this.#emit('device', { deviceId });
    if (this.track) await this.#recapture();
  }

  async setProcessing(changes) {
    Object.assign(this.processing, changes);
    this.#save();
    if (this.track) await this.#recapture();
  }

  // Chromium cannot switch device or DSP on a live track reliably, so capture a new one.
  async #recapture() {
    const generation = this.#generation;
    const old = this.track;
    const next = await this.#capture();
    if (generation !== this.#generation || this.track !== old) {
      next.stop(); // the call ended (or another change won) meanwhile
      return;
    }
    next.enabled = old?.enabled ?? true;
    this.#setTrack(next);
    old?.stop();
  }

  async #capture() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: this.deviceId }, channelCount: 1, ...this.processing },
    });
    const track = stream.getAudioTracks()[0];
    track.addEventListener('ended', () => {
      if (track === this.track) log.warn('Microphone stopped (unplugged, or taken over by another app). Pick a mic in MIC_SRC to continue.');
    });
    return track;
  }

  #setTrack(track) {
    this.track = track;
    this.#emit('track', { track });
  }

  #save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ deviceId: this.deviceId, processing: this.processing }));
    } catch {
      // per-device convenience only
    }
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? {};
  } catch {
    return {};
  }
}
