// Microphone: device list, selection, DSP options, and the live capture track.
// Never touches the DOM.
//
// The mic is only open while a call is running (acquire/release); idle means no capture.
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
  processing = { ...DEFAULT_PROCESSING };
  /** @type {MediaStreamTrack | null} */
  track = null;

  constructor() {
    super();
    const saved = loadPrefs();
    if (typeof saved.deviceId === 'string') this.deviceId = saved.deviceId;
    for (const key of Object.keys(DEFAULT_PROCESSING)) {
      if (typeof saved.processing?.[key] === 'boolean') this.processing[key] = saved.processing[key];
    }
    navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDevices());
  }

  /** Device labels stay empty until capture has been allowed once, so open and close the mic briefly. */
  async init() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    await this.refreshDevices();
  }

  async refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all
      .filter((device) => device.kind === 'audioinput')
      .map((device) => ({ id: device.deviceId, label: device.label || 'Microphone' }));

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
    this.#setTrack(await this.#capture());
    return this.track;
  }

  release() {
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
    const old = this.track;
    const next = await this.#capture();
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
      if (track === this.track) log.warn('Microphone stopped (device unplugged?).');
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
