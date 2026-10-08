// Renderer-side view of the network settings. Storage, validation and encryption happen in the
// main process (src/main/secure-store.js); this only caches the last loaded/saved config.
//
// Events: 'change' { config }

export class NetworkSettings extends EventTarget {
  /** @type {{ stunUrls: string[], turn: { urls: string[], username: string, credential: string },
   *           cloudflare: { keyId: string, apiToken: string }, relayOnly: boolean } | null} */
  config = null;
  defaults = null;

  async load() {
    const result = await window.cc.settings.getNetwork();
    this.config = result.config;
    this.defaults = result.defaults;
    this.#emit();
    return this.config;
  }

  /** Returns { ok, errors }. On success the new config applies to the NEXT link. */
  async save(config) {
    const result = await window.cc.settings.setNetwork(config);
    if (result.ok) {
      this.config = result.config;
      this.#emit();
    }
    return result;
  }

  #emit() {
    this.dispatchEvent(new CustomEvent('change', { detail: { config: this.config } }));
  }
}
