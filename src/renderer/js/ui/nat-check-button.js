import { log } from '../core/logger.js';
import { checkNat } from '../net/nat-check.js';

/** [ NAT_CHECK ] in the CONNECTION_MATRIX header: does this network need TURN? */
export function mountNatCheck({ networkSettings, button }) {
  button.addEventListener('click', async () => {
    const config = networkSettings.config;
    if (!config) return;
    if (!config.stunUrls.length) {
      show('err', 'No STUN server configured. Add two in Settings → NETWORK.');
      log.err('NAT_CHECK: no STUN server configured. Add two in Settings → NETWORK.', { notify: false });
      return;
    }

    button.disabled = true;
    button.classList.add('is-busy');
    log.info(`NAT_CHECK: asking ${config.stunUrls.length} STUN server(s) for this PC's public address...`);
    try {
      const result = await checkNat(config.stunUrls);
      const hasTurn = Boolean(config.cloudflare?.keyId || config.turn.urls.length);

      if (result.needsTurn === false) {
        show('ok', result.detail);
        log.ok(`NAT_CHECK (${result.ms} ms): ${result.detail}`);
      } else if (result.needsTurn && hasTurn) {
        show('warn', `${result.detail} TURN is configured.`);
        log.warn(`NAT_CHECK (${result.ms} ms): ${result.detail} TURN is configured, so the link can still open.`);
      } else if (result.needsTurn) {
        show('err', `${result.detail} No TURN configured.`);
        log.err(`NAT_CHECK (${result.ms} ms): ${result.detail} Set up TURN in Settings → NETWORK before exchanging payloads.`);
      } else {
        show('warn', result.detail);
        log.warn(`NAT_CHECK (${result.ms} ms): ${result.detail}`);
      }
      if (result.cgnat) log.info('NAT_CHECK: your ISP shares one public address between customers (CGNAT, 100.64.x.x). If links fail, use TURN.');
      if (result.ipv6) log.info('NAT_CHECK: this PC also has public IPv6. If the peer has it too, a direct link can work even through strict NATs.');
      if (result.verdict === 'blocked' && result.errors.length) log.info(`NAT_CHECK: ${result.errors[0]}`);
    } catch (error) {
      show('err', `NAT check failed: ${error.message}`);
      log.err(`NAT_CHECK failed: ${error.message}`);
    } finally {
      button.classList.remove('is-busy');
      button.disabled = false;
    }
  });

  /** Colors the button by the result; the verdict is in its tooltip until the next check. */
  function show(kind, text) {
    button.classList.remove('is-ok', 'is-warn', 'is-err');
    button.classList.add(`is-${kind}`);
    button.title = `${text}\nClick to check again.`;
  }
}
