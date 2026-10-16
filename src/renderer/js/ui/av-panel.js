// A.V._INTERFACE: MIC_SRC / AUDIO_OUT selectors, TOGGLE_MIC / DEAFEN, peer card icons, speaking glow.

export function mountAvPanel({ voice, microphone, speakers, connection, micSelect, outSelect, voiceVolume, micButton, deafenButton, localCard, remoteCard }) {
  // Peer voice volume, on the remote card (one card per peer later, one slider each).
  bindVolume(voiceVolume, voice.volume, 'VOICE_VOL', (value) => voice.setVolume(value));
  connection.addEventListener('phase', ({ detail }) => {
    voiceVolume.disabled = detail.phase !== 'connected' && detail.phase !== 'reconnecting';
  });

  micButton.addEventListener('click', () => voice.toggleMic());
  deafenButton.addEventListener('click', () => voice.toggleDeafen());
  micSelect.addEventListener('change', () => microphone.setDevice(micSelect.value));
  outSelect.addEventListener('change', () => speakers.setDevice(outSelect.value));

  microphone.addEventListener('devices', () => fillSelect(micSelect, microphone.devices, microphone.deviceId));
  microphone.addEventListener('device', () => selectValue(micSelect, microphone.deviceId));
  speakers.addEventListener('devices', () => fillSelect(outSelect, speakers.devices, speakers.deviceId));
  speakers.addEventListener('device', () => selectValue(outSelect, speakers.deviceId));

  voice.addEventListener('local-state', ({ detail }) => {
    micButton.classList.toggle('is-off', !detail.micOn);
    deafenButton.classList.toggle('is-off', detail.deafened);
    renderCard(localCard, detail);
  });

  voice.addEventListener('remote-state', ({ detail }) => renderCard(remoteCard, detail));

  voice.addEventListener('speaking', ({ detail }) => {
    const card = detail.who === 'local' ? localCard : remoteCard;
    card.classList.toggle('is-speaking', detail.speaking);
  });

  renderCard(localCard, { micOn: voice.micOn, deafened: voice.deafened });
  renderCard(remoteCard, null);
}

/**
 * Wires a 0–100 range input to a 0–1 volume setter. Shows the value in the fill, the tooltip,
 * and an optional <output>.
 */
export function bindVolume(input, initial, label, setVolume, output = null) {
  const show = (percent) => {
    input.value = String(percent);
    input.style.setProperty('--fill', `${percent}%`);
    input.title = `${label} ${percent}%`;
    if (output) output.textContent = `${percent}%`;
  };
  show(Math.round(initial * 100));
  input.addEventListener('input', () => {
    const percent = Number(input.value);
    show(percent);
    setVolume(percent / 100);
  });
}

function fillSelect(select, devices, selectedId) {
  select.replaceChildren(
    ...devices.map((device) => {
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.label;
      return option;
    }),
  );
  if (!devices.length) {
    const option = document.createElement('option');
    option.textContent = '[ NO DEVICES ]';
    select.append(option);
  }
  select.disabled = !devices.length;
  selectValue(select, selectedId);
}

/** Selects `value` and mirrors the full device name into the tooltip (the box truncates it). */
function selectValue(select, value) {
  select.value = value;
  select.title = select.selectedOptions[0]?.textContent ?? '';
}

/** state = { micOn, deafened } or null (unknown / no peer: neutral icons). */
function renderCard(card, state) {
  const mic = card.querySelector('[data-role="mic"]');
  const audio = card.querySelector('[data-role="audio"]');
  const micOff = state ? !state.micOn : false;
  const deaf = state ? state.deafened : false;

  setIcon(mic, micOff ? 'i-mic-off' : 'i-mic');
  setIcon(audio, deaf ? 'i-headphones-off' : 'i-headphones');
  mic.classList.toggle('is-off', micOff);
  audio.classList.toggle('is-off', deaf);
  mic.setAttribute('aria-label', micOff ? 'Microphone muted' : 'Microphone');
  audio.setAttribute('aria-label', deaf ? 'Deafened' : 'Audio output');
}

function setIcon(svg, symbolId) {
  svg.querySelector('use').setAttribute('href', `#${symbolId}`);
}
