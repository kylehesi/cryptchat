// "Look here": highlights elements until the user has seen them, and flashes the taskbar button
// while the window is in the background.
//
// A marked element glows (class is-unseen + tone) as long as the window is not focused. Once the
// window is focused, it stays bright for SEEN_DELAY_MS and then fades back.

const SEEN_DELAY_MS = 3000;
const TONES = ['accent', 'warn', 'danger'];

export class Attention {
  flashEnabled = true;
  #unseen = new Set(); // elements waiting for the user to look
  #timers = new WeakMap();

  constructor() {
    window.addEventListener('focus', () => {
      for (const element of this.#unseen) this.#clearLater(element);
      this.#unseen.clear();
    });
  }

  get focused() {
    return document.hasFocus() && document.visibilityState === 'visible';
  }

  /**
   * Highlights `elements` (falsy entries are ignored). tone: 'accent' | 'warn' | 'danger'.
   * flash: also flash the taskbar button if the window is in the background.
   */
  mark(elements, { tone = 'accent', flash = true } = {}) {
    for (const element of [elements].flat()) {
      if (!element) continue;
      clearTimeout(this.#timers.get(element));
      element.classList.remove(...TONES.map((name) => `is-unseen-${name}`));
      element.classList.add('is-unseen', `is-unseen-${tone}`);
      if (this.focused) this.#clearLater(element);
      else this.#unseen.add(element);
    }
    if (flash && this.flashEnabled && !this.focused) window.cc.window.flash();
  }

  #clearLater(element) {
    clearTimeout(this.#timers.get(element));
    this.#timers.set(element, setTimeout(() => {
      element.classList.remove('is-unseen', ...TONES.map((name) => `is-unseen-${name}`));
    }, SEEN_DELAY_MS));
  }
}
