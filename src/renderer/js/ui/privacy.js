// HIDE_IP_AND_PAYLOAD: for streaming or screenshots. While on:
//   - payload boxes show "[ HIDDEN · n CHARS · CLICK TO COPY ]" instead of the payload,
//     and a click copies the real content;
//   - IP addresses in KERNEL_LOG and status lines are masked (maskText);
//   - TURN address / user / Cloudflare key fields are dotted like passwords (CSS).
// The data itself is untouched: only what is drawn on screen changes.

import { maskIps } from '../core/log-report.js';
import { log } from '../core/logger.js';

const STORAGE_KEY = 'cc.privacy';

export class Privacy extends EventTarget {
  hidden = load();
  #boxes = new Set();

  constructor() {
    super();
    document.body.classList.toggle('hide-sensitive', this.hidden);
  }

  set(hidden) {
    this.hidden = Boolean(hidden);
    save(this.hidden);
    document.body.classList.toggle('hide-sensitive', this.hidden);
    this.refreshPayloads();
    this.dispatchEvent(new CustomEvent('change', { detail: { hidden: this.hidden } }));
  }

  /** Masks IP addresses in `text` while hiding is on; returns `text` unchanged otherwise. */
  maskText(text) {
    if (!this.hidden) return text;
    return maskIps(text);
  }

  /**
   * Registers a payload <textarea>. It must sit in a `.payload-box` wrapper, which draws the
   * HIDDEN label (data-mask). While hidden, a click copies the real content.
   */
  bindPayloadBox(textarea, { copyOnClick = true } = {}) {
    this.#boxes.add(textarea);
    textarea.addEventListener('input', () => this.#refresh(textarea));
    if (copyOnClick) {
      textarea.addEventListener('click', async () => {
        if (!this.hidden || !textarea.value) return;
        const copied = await window.cc.clipboard.writeText(textarea.value).catch(() => false);
        if (copied) log.info('Payload copied to clipboard.');
      });
    }
    this.#refresh(textarea);
  }

  /** Call after setting a payload box's value from code (no 'input' event fires then). */
  refreshPayloads() {
    for (const textarea of this.#boxes) this.#refresh(textarea);
  }

  #refresh(textarea) {
    const box = textarea.closest('.payload-box');
    if (!box) return;
    const length = textarea.value.length;
    box.classList.toggle('has-value', length > 0);
    box.dataset.mask = length ? `[ HIDDEN · ${length} CHARS · CLICK TO COPY ]` : '';
  }
}

function load() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY))?.hidden === true;
  } catch {
    return false;
  }
}

function save(hidden) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ hidden }));
  } catch {
    // per-device convenience only
  }
}
