// Audio output: device list, selection, and routing of every playback element to it.
// Never touches the DOM beyond the <audio> elements it is given.
//
// Events (CustomEvent.detail):
//   'devices'  { devices: [{ id, label }] }  output device list changed
//   'device'   { deviceId }                  selected output changed

import { log } from '../core/logger.js';
import { describeOutputError } from './device-errors.js';

const STORAGE_KEY = 'cc.audio-out';
const DEFAULT_ID = 'default';

export class Speakers extends EventTarget {
  /** @type {{ id: string, label: string }[]} */
  devices = [];
  deviceId = loadDeviceId();
  /** Playback targets routed to the selected device (peer voice, peer system audio, sounds). */
  elements = new Set();

  constructor() {
    super();
    navigator.mediaDevices.addEventListener('devicechange', () => this.refreshDevices());
  }

  /** Device names are only readable after media permission; call after the mic probe. */
  async refreshDevices() {
    const all = await navigator.mediaDevices.enumerateDevices();
    this.devices = all
      .filter((device) => device.kind === 'audiooutput')
      .map((device) => ({ id: device.deviceId, label: device.label || 'Speakers' }));

    if (this.devices.length && !this.devices.some((device) => device.id === this.deviceId)) {
      const fallback = this.devices.find((device) => device.id === DEFAULT_ID) ?? this.devices[0];
      if (this.deviceId !== DEFAULT_ID) log.warn(`Selected audio output is gone. Falling back to: ${fallback.label}`);
      await this.setDevice(fallback.id, { quiet: true });
    }
    this.#emit('devices', { devices: this.devices });
  }

  /** Routes `element` to the selected output now and on every later change. */
  attach(element) {
    this.elements.add(element);
    this.#route(element);
  }

  async setDevice(deviceId, { quiet = false } = {}) {
    this.deviceId = deviceId;
    saveDeviceId(deviceId);
    this.#emit('device', { deviceId });
    const results = await Promise.all([...this.elements].map((element) => this.#route(element)));
    if (!quiet && results.every(Boolean)) {
      log.info(`Audio output: ${this.devices.find((device) => device.id === deviceId)?.label ?? deviceId}`);
    }
  }

  /** Works for <audio> elements and AudioContexts (both have setSinkId / sinkId). */
  async #route(element) {
    // '' = system default for both; AudioContext does not accept the 'default' device ID.
    const target = this.deviceId === DEFAULT_ID ? '' : this.deviceId;
    if (typeof element.setSinkId !== 'function' || element.sinkId === target) return true;
    try {
      await element.setSinkId(target);
      return true;
    } catch (error) {
      log.err(`Could not switch audio output: ${describeOutputError(error)}. Keeping the previous device.`);
      return false;
    }
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

function loadDeviceId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || DEFAULT_ID;
  } catch {
    return DEFAULT_ID;
  }
}

function saveDeviceId(deviceId) {
  try {
    localStorage.setItem(STORAGE_KEY, deviceId);
  } catch {
    // per-device convenience only
  }
}
