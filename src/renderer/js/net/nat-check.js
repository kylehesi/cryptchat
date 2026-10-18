// NAT_CHECK: tells upfront whether this network can make a direct link or needs TURN, before
// anyone wastes a payload exchange on it.
//
// One socket asks two STUN servers for its public address. If the NAT maps that socket to the
// same public port for both servers (endpoint-independent mapping), the peer can usually punch
// through and no TURN is needed. A different port per server (symmetric NAT) usually means TURN.
// Chromium reports one srflx candidate per distinct mapping, so "one mapping" is only conclusive
// if each server also answers on its own: that is checked in parallel.

const GATHER_TIMEOUT_MS = 8000;

/**
 * Gathers candidates for `stunUrls` on one RTCPeerConnection.
 * @returns {Promise<{ candidates: { type: string, protocol: string, address: string, port: number, relatedAddress: string | null, relatedPort: number | null }[], errors: string[] }>}
 */
async function gather(stunUrls) {
  const candidates = [];
  const errors = [];
  const pc = new RTCPeerConnection({ iceServers: [{ urls: stunUrls }] });
  pc.addEventListener('icecandidate', ({ candidate }) => {
    if (candidate?.address) {
      const { type, protocol, address, port, relatedAddress, relatedPort } = candidate;
      candidates.push({ type, protocol, address, port, relatedAddress, relatedPort });
    }
  });
  pc.addEventListener('icecandidateerror', (event) => errors.push(`${event.url}: ${event.errorCode} ${event.errorText}`.trim()));
  pc.createDataChannel('nat-check');
  await pc.setLocalDescription();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  pc.close();
  return { candidates, errors };
}

const isIPv4 = (address) => /^\d{1,3}(\.\d{1,3}){3}$/.test(address);
const isCgnat = (address) => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(address); // 100.64.0.0/10
const isGlobalIPv6 = (address) => /^[23][0-9a-f]{0,3}:/i.test(address); // 2000::/3

/**
 * Pure verdict from what was gathered (unit-tested).
 * @param {{ combined: { type: string, protocol: string, address: string, port: number, relatedAddress: string | null, relatedPort: number | null }[],
 *           answeredAlone: number, serverCount: number }} input
 *   combined: candidates from one socket asking all servers; answeredAlone: how many servers
 *   gave a public address when asked on their own.
 * @returns {{ verdict: 'open' | 'direct' | 'symmetric' | 'blocked' | 'unknown', needsTurn: boolean | null, cgnat: boolean, ipv6: boolean, detail: string }}
 */
export function classifyNat({ combined, answeredAlone, serverCount }) {
  const udp = combined.filter((c) => c.protocol === 'udp');
  const hosts = udp.filter((c) => c.type === 'host' && isIPv4(c.address));
  const srflx = udp.filter((c) => c.type === 'srflx' && isIPv4(c.address));
  const cgnat = hosts.some((c) => isCgnat(c.address));
  const ipv6 = udp.some((c) => c.type === 'host' && isGlobalIPv6(c.address));
  const result = (verdict, needsTurn, detail) => ({ verdict, needsTurn, cgnat, ipv6, detail });

  if (!srflx.length) {
    return result('blocked', true, 'No STUN server answered: outgoing UDP looks blocked. Only TURN (ideally over TCP/TLS 443) can connect.');
  }

  // Public mappings per local socket ("base"). Without a known base, group them all together.
  const byBase = new Map();
  for (const c of srflx) {
    const base = c.relatedPort ? `${c.relatedAddress}:${c.relatedPort}` : '?';
    if (!byBase.has(base)) byBase.set(base, new Set());
    byBase.get(base).add(`${c.address}:${c.port}`);
  }
  if ([...byBase.values()].some((mappings) => mappings.size > 1)) {
    return result('symmetric', true, 'Symmetric NAT: each server sees a different public port. A direct link is unlikely; use TURN.');
  }

  if (srflx.every((c) => hosts.some((h) => h.address === c.address))) {
    return result('open', false, 'No NAT: this PC has a public IPv4 address. A direct link should work.');
  }
  if (serverCount < 2 || answeredAlone < 2) {
    return result('unknown', null, serverCount < 2
      ? 'Only one STUN server is configured, so the NAT type cannot be compared. Add a second one in Settings → NETWORK.'
      : 'Only one STUN server answered, so the NAT type cannot be compared. Try again.');
  }
  return result('direct', false, 'Cone NAT: every server sees the same public port. A direct link should work, unless the peer is behind a symmetric NAT.');
}

/**
 * Runs the check against the configured STUN servers.
 * @param {string[]} stunUrls
 */
export async function checkNat(stunUrls) {
  const started = performance.now();
  const [combined, ...alone] = await Promise.all([gather(stunUrls), ...stunUrls.slice(0, 2).map((url) => gather([url]))]);
  const answeredAlone = alone.filter((run) => run.candidates.some((c) => c.type === 'srflx')).length;
  return {
    ...classifyNat({ combined: combined.candidates, answeredAlone, serverCount: stunUrls.length }),
    errors: [...new Set([...combined.errors, ...alone.flatMap((run) => run.errors)])],
    ms: Math.round(performance.now() - started),
  };
}
