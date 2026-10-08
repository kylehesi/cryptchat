// Short authentication string (SAS) from the two DTLS fingerprints (ARCHITECTURE §6).
// Never touches the DOM.
//
// Why it works: DTLS only completes if each side's certificate matches the fingerprint in the
// SDP the other side received. A man-in-the-middle who swaps the payloads must use his own
// certificates, so A computes the code from (A, M1) and B from (M2, B): the codes differ.
// To make them match he would have to find a certificate whose hash hits the same 4 words +
// 2 digits (~38 bits) while the users wait. That is not feasible in real time.
//
// Events: 'change' { code, status: 'pending' | 'verified' } | null (no link)

import { log } from '../core/logger.js';
import { WORDS } from './words.js';

const SAS_CONTEXT = 'cryptchat-sas-v1';

/** Returns "sha-256 AB:CD:..." from the first a=fingerprint line, or null. */
export function extractFingerprint(sdp) {
  const match = /^a=fingerprint:(\S+) ([0-9A-Fa-f:]+)\s*$/m.exec(sdp ?? '');
  return match ? `${match[1].toLowerCase()} ${match[2].toUpperCase()}` : null;
}

/** Same result on both sides: the fingerprints are sorted before hashing. */
export async function computeVerificationCode(localSdp, remoteSdp) {
  const fingerprints = [extractFingerprint(localSdp), extractFingerprint(remoteSdp)];
  if (fingerprints.includes(null)) throw new Error('DTLS fingerprint missing from SDP.');
  fingerprints.sort();

  const data = new TextEncoder().encode(`${SAS_CONTEXT}\n${fingerprints.join('\n')}`);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  const number = String(hash[4] % 100).padStart(2, '0');
  return [WORDS[hash[0]], WORDS[hash[1]], WORDS[hash[2]], WORDS[hash[3]], number].join('-');
}

export class Verification extends EventTarget {
  /** @type {{ code: string, status: 'pending' | 'verified' } | null} */
  state = null;
  #session = null;

  /** @param {import('../net/connection.js').Connection} connection */
  constructor(connection) {
    super();
    this.connection = connection;

    connection.addEventListener('phase', ({ detail }) => {
      if (detail.phase === 'connected' && connection.session !== this.#session) this.#start(connection.session);
      if (detail.phase === 'idle' || detail.phase === 'failed') this.#reset();
    });
  }

  markVerified() {
    if (!this.state || this.state.status === 'verified') return;
    this.#set({ ...this.state, status: 'verified' });
    log.ok(`Link VERIFIED by you (${this.state.code}).`);
  }

  /** The codes did not match: assume an attacker in the middle and drop the link. */
  reportMismatch() {
    if (!this.state) return;
    log.err('VERIFICATION MISMATCH: possible man-in-the-middle. Link terminated. Exchange new payloads over a channel you trust.');
    this.connection.terminate();
  }

  async #start(session) {
    this.#session = session;
    try {
      const code = await computeVerificationCode(
        session.pc.currentLocalDescription?.sdp,
        session.pc.currentRemoteDescription?.sdp,
      );
      if (session !== this.#session) return;
      this.#set({ code, status: 'pending' });
      log.info(`Verification code: ${code}. Read it aloud with your peer; it must match.`);
    } catch (error) {
      log.err(`Could not compute verification code: ${error.message}`);
    }
  }

  #reset() {
    this.#session = null;
    if (this.state) this.#set(null);
  }

  #set(state) {
    this.state = state;
    this.dispatchEvent(new CustomEvent('change', { detail: state }));
  }
}
