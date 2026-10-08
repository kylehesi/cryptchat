// TEST_TURN: proves TURN servers + credentials work by asking them for a relay candidate.

const TEST_TIMEOUT_MS = 8000;

/**
 * @param {RTCIceServer[]} iceServers  TURN servers to test
 * @returns {Promise<{ ok: boolean, ms: number, relays: string[], errors: string[] }>}
 */
export async function testTurn(iceServers) {
  const started = performance.now();
  const relays = [];
  const errors = [];

  let pc;
  try {
    pc = new RTCPeerConnection({ iceServers, iceTransportPolicy: 'relay' });
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
