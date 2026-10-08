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
