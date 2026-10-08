// TEST_TURN: proves a TURN server + credentials work by asking it for a relay candidate.

const TEST_TIMEOUT_MS = 8000;

/**
 * @param {{ urls: string[], username: string, credential: string }} turn
 * @returns {Promise<{ ok: boolean, ms: number, relays: string[], errors: string[] }>}
 */
export async function testTurn(turn) {
  const started = performance.now();
  const relays = [];
  const errors = [];

  let pc;
  try {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: turn.urls, username: turn.username, credential: turn.credential }],
      iceTransportPolicy: 'relay',
    });
  } catch (error) {
    return { ok: false, ms: 0, relays, errors: [error.message] };
  }

  pc.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate?.type === 'relay') relays.push(`relay via ${(candidate.relayProtocol ?? candidate.protocol ?? '?').toUpperCase()}`);
  });
  pc.addEventListener('icecandidateerror', (event) => {
    errors.push(`${event.url}: ${event.errorCode} ${event.errorText}`.trim());
  });

  pc.createDataChannel('turn-test');
  await pc.setLocalDescription();

  await new Promise((resolve) => {
    const timer = setTimeout(resolve, TEST_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  pc.close();

  return { ok: relays.length > 0, ms: Math.round(performance.now() - started), relays: [...new Set(relays)], errors: [...new Set(errors)] };
}
