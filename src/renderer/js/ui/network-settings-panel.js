import { log } from '../core/logger.js';
import { testTurn } from '../net/turn-test.js';

/** NETWORK section of the settings dialog: edit, test and save STUN/TURN settings. */
export function mountNetworkSettings({ networkSettings, els }) {
  const { stun, turnUrls, turnUser, turnPass, relayOnly, testButton, defaultsButton, saveButton, status } = els;

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

  testButton.addEventListener('click', async () => {
    const { turn } = read();
    if (!turn.urls.length) {
      setStatus('Enter a TURN URL first.', 'err');
      return;
    }
    testButton.disabled = true;
    setStatus('Testing TURN relay...');
    try {
      const result = await testTurn(turn);
      if (result.ok) {
        setStatus(`TURN OK in ${result.ms} ms: ${result.relays.join(', ')}`, 'ok');
        log.ok(`TEST_TURN passed (${result.ms} ms).`);
      } else {
        const why = result.errors.length ? result.errors.join('\n') : 'No relay candidate (wrong URL or credentials, or blocked port).';
        setStatus(`TURN FAILED.\n${why}`, 'err');
        log.err(`TEST_TURN failed: ${why.split('\n')[0]}`);
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
      relayOnly: relayOnly.checked,
    };
  }

  function setStatus(text, kind) {
    status.textContent = text;
    status.classList.toggle('is-ok', kind === 'ok');
    status.classList.toggle('is-err', kind === 'err');
  }
}
