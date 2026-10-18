// Small SDP edits.

const OPUS_HIFI_PARAMS = { stereo: '1', 'sprop-stereo': '1', maxaveragebitrate: '128000' };

/**
 * Adds stereo + 128 kbps to Opus in the m-section at `mLineIndex`.
 *
 * Applied to the REMOTE description before setRemoteDescription(): the remote fmtp tells our
 * encoder what the peer can receive, so this makes our system-audio sender encode stereo at a
 * high bitrate. Only remote SDP is touched; local SDP munging is restricted in Chromium.
 */
export function enableOpusHifi(sdp, mLineIndex) {
  const lines = sdp.split('\r\n');
  let section = -1;
  let opusPayloadType = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('m=')) {
      section += 1;
      opusPayloadType = null;
      continue;
    }
    if (section !== mLineIndex) continue;

    const rtpmap = /^a=rtpmap:(\d+) opus\/48000\/2$/i.exec(line);
    if (rtpmap) {
      opusPayloadType = rtpmap[1];
      continue;
    }

    const prefix = `a=fmtp:${opusPayloadType} `;
    if (opusPayloadType && line.startsWith(prefix)) {
      const params = new Map(line.slice(prefix.length).split(';').map((pair) => pair.split('=')));
      for (const [key, value] of Object.entries(OPUS_HIFI_PARAMS)) params.set(key, value);
      lines[i] = prefix + [...params].map(([key, value]) => (value === undefined ? key : `${key}=${value}`)).join(';');
    }
  }

  return lines.join('\r\n');
}

/**
 * Rewrites an ICE candidate line ("candidate:…") so Chromium treats it as a new candidate:
 * `generation` set, `ufrag` dropped (Chromium then fills in the current remote credentials).
 *
 * Chromium keeps one connection per remote address and only replaces it for a candidate of a
 * higher generation. HOLD_OPEN uses that to restart checks that already gave up (see
 * PeerSession.holdOpen), and every later remote candidate must then go up as well, or an ICE
 * restart could not replace the connections HOLD_OPEN left behind.
 */
export function withGeneration(candidate, generation) {
  const [head, ...rest] = candidate.split(' ');
  const base = [head, ...rest.slice(0, 7)]; // foundation component transport priority address port typ type
  const extras = rest.slice(7);
  for (let i = 0; i + 1 < extras.length; i += 2) {
    if (extras[i] !== 'generation' && extras[i] !== 'ufrag') base.push(extras[i], extras[i + 1]);
  }
  return [...base, 'generation', String(generation)].join(' ');
}
