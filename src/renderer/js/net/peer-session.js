// One RTCPeerConnection to one remote peer, plus its media slots and DataChannels.
// See ARCHITECTURE §5. Never touches the DOM; reports everything through events.
//
// Events (CustomEvent.detail):
//   'state'         { state }             RTCPeerConnection.connectionState changes
//   'channel-open'  { name }              a DataChannel became usable
//   'channel-close' { name }
//   'message'       { channel, message }  a decoded protocol message (see protocol.js)

import { decodeMessage, encodeMessage } from './protocol.js';

const ICE_GATHER_TIMEOUT_MS = 4000;

// Media slots, in m-line order. Created up front so later media only needs replaceTrack().
const MEDIA_SLOTS = [
  { name: 'mic', kind: 'audio' },
  { name: 'screen', kind: 'video' },
  { name: 'screenAudio', kind: 'audio' },
];

// Negotiated channels exist on both sides with fixed ids, no in-band "open" handshake needed.
const CHANNELS = [
  { name: 'control', id: 0 },
  { name: 'chat', id: 1 },
];

export class PeerSession extends EventTarget {
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
    }

    for (const { name, id } of CHANNELS) {
      const channel = this.pc.createDataChannel(name, { negotiated: true, id, ordered: true });
      channel.addEventListener('open', () => this.#emit('channel-open', { name }));
      channel.addEventListener('close', () => this.#emit('channel-close', { name }));
      channel.addEventListener('message', (event) => {
        const message = decodeMessage(event.data);
        if (message) this.#emit('message', { channel: name, message });
      });
      this.channels[name] = channel;
    }

    this.pc.addEventListener('connectionstatechange', () => {
      this.#emit('state', { state: this.pc.connectionState });
    });
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
    await this.pc.setRemoteDescription({ type: 'offer', sdp });

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
    await this.pc.setRemoteDescription(answer);
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
