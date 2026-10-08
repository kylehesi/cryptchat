// Voice call: puts the mic on the 'mic' slot, plays the peer's voice, mute/deafen, state sync.
// Never touches the DOM.
//
// Mute/deafen follow Discord semantics: deafen also mutes the mic; undeafen restores the mic
// to what it was before; unmuting while deafened undeafens.
//
// Events (CustomEvent.detail):
//   'local-state'   { micOn, deafened }
//   'remote-state'  { micOn, deafened } | null (no peer)
//   'speaking'      { who: 'local' | 'remote', speaking }

import { log } from '../core/logger.js';

export class Voice extends EventTarget {
  micMuted = false;
  deafened = false;
  /** @type {{ micOn: boolean, deafened: boolean } | null} */
  remoteState = null;

  #session = null;
  #mutedBeforeDeafen = false;
  #playback = new Audio();
  #stopLocalActivity = null;
  #stopRemoteActivity = null;

  /**
   * @param {{ connection: import('../net/connection.js').Connection,
   *           microphone: import('./microphone.js').Microphone,
   *           activity: import('./voice-activity.js').VoiceActivity }} deps
   */
  constructor({ connection, microphone, activity }) {
    super();
    this.connection = connection;
    this.microphone = microphone;
    this.activity = activity;
    this.#playback.autoplay = true;

    connection.addEventListener('phase', ({ detail }) => {
      if (detail.phase === 'connected' && connection.session !== this.#session) this.#startCall(connection.session);
      if (detail.phase === 'idle' || detail.phase === 'failed') this.#endCall();
    });

    connection.addEventListener('channel-open', ({ detail }) => {
      if (detail.name === 'control') this.#sendState();
    });

    connection.addEventListener('peer-message', ({ detail }) => {
      const { channel, message } = detail;
      if (channel !== 'control' || message.type !== 'state') return;
      if (typeof message.mic !== 'boolean' || typeof message.deaf !== 'boolean') return;
      this.#setRemoteState({ micOn: message.mic, deafened: message.deaf });
    });

    // Device or DSP change mid-call: swap the track on the sender, no renegotiation needed.
    microphone.addEventListener('track', ({ detail }) => {
      const { track } = detail;
      if (track) track.enabled = this.micOn;
      if (this.#session && track) this.#session.slots.mic.sender.replaceTrack(track);
      this.#watchLocal(track);
    });
  }

  get micOn() {
    return !this.micMuted && !this.deafened;
  }

  toggleMic() {
    if (this.deafened) {
      this.deafened = false;
      this.micMuted = false;
    } else {
      this.micMuted = !this.micMuted;
    }
    log.info(this.micOn ? 'Microphone live.' : 'Microphone muted.');
    this.#apply();
  }

  toggleDeafen() {
    if (this.deafened) {
      this.deafened = false;
      this.micMuted = this.#mutedBeforeDeafen;
      log.info('Audio output restored.');
    } else {
      this.#mutedBeforeDeafen = this.micMuted;
      this.deafened = true;
      log.info('Deafened: output and microphone muted.');
    }
    this.#apply();
  }

  async #startCall(session) {
    this.#session = session;

    const remoteTrack = session.slots.mic.receiver.track;
    this.#playback.srcObject = new MediaStream([remoteTrack]);
    this.#playback.muted = this.deafened;
    this.#playback.play().catch(() => {});
    this.#stopRemoteActivity = this.activity.watch(remoteTrack, (speaking) => {
      this.#emit('speaking', { who: 'remote', speaking: speaking && Boolean(this.remoteState?.micOn) });
    });

    try {
      const track = await this.microphone.acquire(); // fires 'track', which attaches it to the sender
      const label = this.microphone.devices.find((device) => device.id === this.microphone.deviceId)?.label;
      log.ok(`Voice channel open. Mic: ${label ?? track.label}`);
    } catch (error) {
      log.err(`Microphone unavailable (${error.name}). Listen-only mode.`);
    }
  }

  #endCall() {
    if (!this.#session) return;
    this.#session = null;
    this.microphone.release();
    this.#playback.srcObject = null;
    this.#stopRemoteActivity?.();
    this.#stopRemoteActivity = null;
    this.#setRemoteState(null);
  }

  #watchLocal(track) {
    this.#stopLocalActivity?.();
    this.#stopLocalActivity = track
      ? this.activity.watch(track, (speaking) => this.#emit('speaking', { who: 'local', speaking }))
      : null;
  }

  #apply() {
    if (this.microphone.track) this.microphone.track.enabled = this.micOn;
    this.#playback.muted = this.deafened;
    this.#emit('local-state', { micOn: this.micOn, deafened: this.deafened });
    this.#sendState();
  }

  #sendState() {
    this.connection.send('control', 'state', { mic: this.micOn, deaf: this.deafened });
  }

  #setRemoteState(state) {
    this.remoteState = state;
    this.#emit('remote-state', state);
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}
