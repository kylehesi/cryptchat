// "LINK: SRFLX · 23 ms · ↑48k ↓1.2M · LOSS 0.0%" in the KERNEL_LOG header.

export function mountLinkStatus({ connection, element }) {
  let lastStats = null;

  connection.addEventListener('link-stats', ({ detail }) => {
    lastStats = detail;
    render();
  });
  connection.addEventListener('phase', ({ detail }) => {
    if (detail.phase === 'idle') lastStats = null;
    render();
  });

  function render() {
    const { phase } = connection;
    element.classList.toggle('is-online', phase === 'connected');
    element.classList.toggle('is-unstable', phase === 'reconnecting');

    if (phase === 'reconnecting') {
      element.textContent = 'LINK: UNSTABLE';
    } else if (phase === 'connected' && lastStats) {
      const parts = [`LINK: ${routeLabel(lastStats.route)}`];
      if (lastStats.rttMs != null) parts.push(`${lastStats.rttMs} ms`);
      if (lastStats.upKbps != null) parts.push(`↑${formatRate(lastStats.upKbps)} ↓${formatRate(lastStats.downKbps)}`);
      if (lastStats.lossPct != null) parts.push(`LOSS ${lastStats.lossPct.toFixed(1)}%`);
      element.textContent = parts.join(' · ');
    } else if (phase === 'connected' || phase === 'connecting') {
      element.textContent = 'LINK: ...';
    } else {
      element.textContent = 'LINK: OFFLINE';
    }
  }

  render();
}

function routeLabel(route) {
  const types = [route.localType, route.remoteType];
  if (types.includes('relay')) return 'RELAY';
  if (types.every((type) => type === 'host')) return 'HOST';
  return 'SRFLX';
}

/** kbps → "48k" / "1.2M" (bits per second). */
function formatRate(kbps) {
  return kbps >= 1000 ? `${(kbps / 1000).toFixed(1)}M` : `${kbps}k`;
}
