// One RTCPeerConnection to one remote peer, plus its media slots and DataChannels.
// See ARCHITECTURE §5. Never touches the DOM; reports everything through events.
//
// Events (CustomEvent.detail):
//   'state'         { state }             RTCPeerConnection.connectionState changes
//   'channel-open'  { name }              a DataChannel became usable
//   'channel-close' { name }
//   'message'       { channel, message }  a decoded protocol message (see protocol.js);
//                                         in-band 'sdp' / 'ice' signaling is handled here, not emitted
//   'signal-error'  { error }             in-band renegotiation failed
//   'datachannel'   { channel }           the peer opened an extra channel (see openChannel)
//
// In-band signaling ("perfect negotiation", ARCHITECTURE §5.3): once the control channel is
// open, every later renegotiation (ICE restart, future media) is exchanged over it. The
// answerer is the "polite" peer: on an offer collision it rolls back and accepts the other offer.

import { decodeMessage, encodeMessage } from './protocol.js';
import { enableOpusHifi } from './sdp.js';

const ICE_GATHER_TIMEOUT_MS = 4000;

// Media slots, in m-line order. Created up front so later media only needs replaceTrack().
const MEDIA_SLOTS = [
  { name: 'mic', kind: 'audio' },
  { name: 'screen', kind: 'video' },
  { name: 'screenAudio', kind: 'audio' },
];

const SCREEN_AUDIO_INDEX = MEDIA_SLOTS.findIndex((slot) => slot.name === 'screenAudio');

// Every remote description passes through here before setRemoteDescription().
function prepareRemote(description) {
  return { type: description.type, sdp: enableOpusHifi(description.sdp, SCREEN_AUDIO_INDEX) };
}

// Screen-share codec order, best first. Measured on screen content (ARCHITECTURE §8): AV1 keeps
// text sharp at low bitrates, VP9 is next (often hardware), VP8 is the safe baseline, and
// hardware H.264 smears small text. All are still negotiated, so the sender can switch between
// them later with setParameters() (see media/screen.js) without renegotiating.
export const SCREEN_CODEC_ORDER = ['video/AV1', 'video/VP9', 'video/VP8', 'video/H264'];

function preferScreenCodecs(transceiver) {
  const codecs = RTCRtpReceiver.getCapabilities('video')?.codecs ?? [];
  const rank = (codec) => {
    const index = SCREEN_CODEC_ORDER.indexOf(codec.mimeType);
    return index === -1 ? SCREEN_CODEC_ORDER.length : index; // rtx/red/fec and others keep their place after
  };
  try {
    transceiver.setCodecPreferences([...codecs].sort((a, b) => rank(a) - rank(b)));
  } catch {
    // Unusual codec list: keep Chromium's default order rather than failing the call.
  }
}

// Negotiated channels exist on both sides with fixed ids, no in-band "open" handshake needed.
const CHANNELS = [
  { name: 'control', id: 0 },
  { name: 'chat', id: 1 },
];

export class PeerSession extends EventTarget {
  #inBand = false;
  #makingOffer = false;
  #ignoreOffer = false;
  #signalQueue = Promise.resolve();

  /**
   * @param {RTCConfiguration} rtcConfig
   * @param {'offerer' | 'answerer'} role
   */
  constructor(rtcConfig, role) {
    super();
    this.role = role;
    this.pc = new RTCPeerConnection(rtcConfig);
    this.slots = {};
    this.channels = {};

    // The offerer defines the m-lines. The answerer must not add its own: they would not
    // match the offer. It adopts the offer's transceivers in acceptOffer() instead.
    if (role === 'offerer') {
      for (const slot of MEDIA_SLOTS) {
        this.slots[slot.name] = this.pc.addTransceiver(slot.kind, { direction: 'sendrecv' });
      }
      preferScreenCodecs(this.slots.screen);
    }

    for (const { name, id } of CHANNELS) {
      const channel = this.pc.createDataChannel(name, { negotiated: true, id, ordered: true });
      channel.addEventListener('open', () => {
        if (name === 'control') this.#enableInBandSignaling();
        this.#emit('channel-open', { name });
      });
      channel.addEventListener('close', () => this.#emit('channel-close', { name }));
      channel.addEventListener('message', (event) => {
        const message = decodeMessage(event.data);
        if (!message) return;
        if (name === 'control' && (message.type === 'sdp' || message.type === 'ice')) {
          // Strictly sequential: an answer must not overtake the offer it belongs to.
          this.#signalQueue = this.#signalQueue.then(() => this.#handleSignal(message));
          return;
        }
        this.#emit('message', { channel: name, message });
      });
      this.channels[name] = channel;
    }

    this.pc.addEventListener('connectionstatechange', () => {
      this.#emit('state', { state: this.pc.connectionState });
    });

    // Channels the peer opens on the fly (e.g. one per file transfer). Negotiated channels
    // never show up here.
    this.pc.addEventListener('datachannel', ({ channel }) => this.#emit('datachannel', { channel }));
  }

  /** Opens an extra reliable, ordered channel over the existing SCTP link (no renegotiation). */
  openChannel(label) {
    return this.pc.createDataChannel(label, { ordered: true });
  }

  /** Offerer: returns the complete offer (all ICE candidates included). */
  async createOffer() {
    await this.pc.setLocalDescription();
    await this.#waitForIceGathering();
    return this.pc.localDescription;
  }

  /** Answerer: applies the remote offer and returns the complete answer. */
  async acceptOffer(offer) {
    // Hold back the offer's candidates until our own gathering is done. Otherwise ICE checks
    // can succeed on a fast path within milliseconds, Chromium stops gathering, and the answer
    // ships without our public (srflx) candidate.
    const { sdp, candidates } = splitCandidates(offer.sdp);
    await this.pc.setRemoteDescription(prepareRemote({ type: 'offer', sdp }));

    // Transceivers created by the offer come back in m-line order, as recvonly.
    const transceivers = this.pc.getTransceivers();
    MEDIA_SLOTS.forEach((slot, index) => {
      const transceiver = transceivers[index];
      if (transceiver?.receiver.track.kind !== slot.kind) {
        throw new Error(`Offer layout mismatch at slot "${slot.name}".`);
      }
      transceiver.direction = 'sendrecv';
      this.slots[slot.name] = transceiver;
    });
    preferScreenCodecs(this.slots.screen); // the answer lists codecs in our order

    await this.pc.setLocalDescription();
    await this.#waitForIceGathering();
    const answer = this.pc.localDescription;

    for (const candidate of candidates) {
      await this.pc.addIceCandidate(candidate).catch(() => {}); // one bad candidate must not kill the rest
    }
    return answer;
  }

  /** Offerer: applies the remote answer. ICE starts connecting right after. */
  async acceptAnswer(answer) {
    await this.pc.setRemoteDescription(prepareRemote(answer));
  }

  /** Restarts ICE (new credentials, fresh candidates). Negotiated in-band over the control channel. */
  restartIce() {
    if (this.#inBand) this.pc.restartIce();
  }

  /** Sends a protocol message. Returns false if the channel is not open. */
  send(channelName, type, fields) {
    const channel = this.channels[channelName];
    if (channel?.readyState !== 'open') return false;
    channel.send(encodeMessage(type, fields));
    return true;
  }

  close() {
    for (const channel of Object.values(this.channels)) channel.close();
    this.pc.close();
  }

  /**
   * Says 'bye' and closes once the message has actually left the buffer (or after a timeout).
   * Closing right away would drop it whenever the link is busy, e.g. during a file transfer,
   * and the peer would only notice through the 30 s "link lost" timeout.
   */
  async closeGracefully(timeoutMs = 2000) {
    this.send('control', 'bye');
    const control = this.channels.control;
    const deadline = performance.now() + timeoutMs;
    while (control.readyState === 'open' && control.bufferedAmount > 0 && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, 150)); // let the last packet leave the socket
    this.close();
  }

  // Called once the control channel opens. The copy-paste bootstrap is complete by then, so
  // negotiationneeded can only mean a real renegotiation (e.g. restartIce()).
  #enableInBandSignaling() {
    if (this.#inBand) return;
    this.#inBand = true;

    this.pc.addEventListener('negotiationneeded', () => this.#onNegotiationNeeded());
    this.pc.addEventListener('icecandidate', ({ candidate }) => {
      if (candidate) this.send('control', 'ice', { candidate: candidate.toJSON() });
    });
  }

  async #onNegotiationNeeded() {
    try {
      this.#makingOffer = true;
      await this.pc.setLocalDescription();
      this.send('control', 'sdp', { description: this.pc.localDescription.toJSON() });
    } catch (error) {
      this.#emit('signal-error', { error });
    } finally {
      this.#makingOffer = false;
    }
  }

  async #handleSignal(message) {
    const { pc } = this;
    try {
      if (message.type === 'sdp') {
        const description = message.description;
        const validType = description?.type === 'offer' || description?.type === 'answer';
        if (!validType || typeof description.sdp !== 'string') return;

        const collision = description.type === 'offer' && (this.#makingOffer || pc.signalingState !== 'stable');
        const polite = this.role === 'answerer';
        this.#ignoreOffer = !polite && collision;
        if (this.#ignoreOffer) return;

        await pc.setRemoteDescription(prepareRemote(description)); // rolls back on collision
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.send('control', 'sdp', { description: pc.localDescription.toJSON() });
        }
      } else {
        const candidate = message.candidate;
        if (candidate === null || typeof candidate !== 'object') return;
        try {
          await pc.addIceCandidate(candidate);
        } catch (error) {
          if (!this.#ignoreOffer) throw error; // candidates for an offer we ignored are expected to fail
        }
      }
    } catch (error) {
      this.#emit('signal-error', { error });
    }
  }

  /** Resolves when gathering completes, or after a timeout with whatever was gathered. */
  #waitForIceGathering() {
    const { pc } = this;
    if (pc.iceGatheringState === 'complete') return Promise.resolve(true);

    return new Promise((resolve) => {
      const done = (complete) => {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve(complete);
      };
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') done(true);
      };
      const timer = setTimeout(() => done(false), ICE_GATHER_TIMEOUT_MS);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }

  #emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
}

/** Removes a=candidate lines from an SDP and returns them as RTCIceCandidateInit objects. */
function splitCandidates(sdp) {
  const kept = [];
  const candidates = [];
  const mids = [];
  let mLineIndex = -1;

  for (const line of sdp.split('\r\n')) {
    if (line.startsWith('m=')) mLineIndex += 1;
    if (line.startsWith('a=mid:')) mids[mLineIndex] = line.slice('a=mid:'.length);

    if (line.startsWith('a=candidate:')) {
      candidates.push({ candidate: line.slice('a='.length), sdpMLineIndex: mLineIndex });
    } else if (line !== 'a=end-of-candidates') {
      kept.push(line);
    }
  }

  // a=mid usually comes after the candidates within a section, so fill it in afterwards.
  for (const candidate of candidates) candidate.sdpMid = mids[candidate.sdpMLineIndex] ?? null;
  return { sdp: kept.join('\r\n'), candidates };
}
