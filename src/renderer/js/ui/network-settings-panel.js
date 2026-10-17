import { log } from '../core/logger.js';
import { staticTurn } from '../net/ice-config.js';
import { testTurn } from '../net/turn-test.js';

/** NETWORK section of the settings dialog: edit, test and save STUN/TURN settings. */
export function mountNetworkSettings({ networkSettings, privacy, els }) {
  const { stun, cfKey, cfToken, turnUrls, turnUser, turnPass, relayOnly, testButton, defaultsButton, saveButton, status } = els;

  networkSettings.addEventListener('change', ({ detail }) => fill(detail.config));

  defaultsButton.addEventListener('click', () => {
    fill(networkSettings.defaults);
    setStatus('Defaults loaded. Press SAVE to keep them.');
  });

  saveButton.addEventListener('click', async () => {
    saveButton.disabled = true;
    try {
      const result = await networkSettings.save(read());
      if (result.ok) {
        setStatus('Saved (encrypted). Applies to the next link.', 'ok');
        log.info('Network settings saved. They apply to the next link.');
      } else {
        setStatus(result.errors.join('\n'), 'err');
      }
    } finally {
      saveButton.disabled = false;
    }
  });

  // Tests exactly what is in the form (saved or not): custom TURN and/or Cloudflare.
  testButton.addEventListener('click', async () => {
    const config = read();
    testButton.disabled = true;
    try {
      const servers = staticTurn(config);
      const notes = [];
      if (config.cloudflare.keyId || config.cloudflare.apiToken) {
        setStatus('Requesting Cloudflare TURN credentials...');
        const minted = await window.cc.turn.cloudflare(config.cloudflare.keyId, config.cloudflare.apiToken);
        if (minted.ok) servers.push(...minted.iceServers);
        else notes.push(`Cloudflare: ${minted.error}`);
      }
      if (!servers.length) {
        setStatus(notes.length ? `TURN FAILED.\n${notes.join('\n')}` : 'Enter a Cloudflare key or a custom TURN URL first.', 'err');
        return;
      }

      setStatus('Testing TURN relay...');
      const result = await testTurn(servers);
      if (result.ok) {
        setStatus([`TURN OK in ${result.ms} ms: ${result.relays.join(', ')}`, ...notes].join('\n'), notes.length ? undefined : 'ok');
        log.ok(`TEST_TURN passed (${result.ms} ms).`);
      } else {
        const why = [...notes, ...result.errors];
        if (!why.length) why.push('No relay candidate (wrong URL or credentials, or blocked port).');
        setStatus(`TURN FAILED.\n${why.join('\n')}`, 'err');
        log.err(`TEST_TURN failed: ${why[0]}`);
      }
    } catch (error) {
      setStatus(`TURN FAILED: ${error.message}`, 'err');
    } finally {
      testButton.disabled = false;
    }
  });

  function fill(config) {
    if (!config) return;
    stun.value = config.stunUrls.join('\n');
    cfKey.value = config.cloudflare?.keyId ?? '';
    cfToken.value = config.cloudflare?.apiToken ?? '';
    turnUrls.value = config.turn.urls.join('\n');
    turnUser.value = config.turn.username;
    turnPass.value = config.turn.credential;
    relayOnly.checked = config.relayOnly;
  }

  function read() {
    const lines = (textarea) => textarea.value.split('\n').map((line) => line.trim()).filter(Boolean);
    return {
      stunUrls: lines(stun),
      turn: { urls: lines(turnUrls), username: turnUser.value.trim(), credential: turnPass.value },
      cloudflare: { keyId: cfKey.value.trim(), apiToken: cfToken.value.trim() },
      relayOnly: relayOnly.checked,
    };
  }

  // Status lines can contain a TURN server IP: keep the raw text, draw it masked if needed.
  let lastStatus = { text: '', kind: undefined };
  privacy.addEventListener('change', () => setStatus(lastStatus.text, lastStatus.kind));

  function setStatus(text, kind) {
    lastStatus = { text, kind };
    status.textContent = privacy.maskText(text);
    status.classList.toggle('is-ok', kind === 'ok');
    status.classList.toggle('is-err', kind === 'err');
  }
}
