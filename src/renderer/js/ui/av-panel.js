// A.V._INTERFACE: mic selector, TOGGLE_MIC / DEAFEN, peer card icons and speaking glow.

export function mountAvPanel({ voice, microphone, micSelect, micButton, deafenButton, localCard, remoteCard }) {
  micButton.addEventListener('click', () => voice.toggleMic());
  deafenButton.addEventListener('click', () => voice.toggleDeafen());
  micSelect.addEventListener('change', () => microphone.setDevice(micSelect.value));

  microphone.addEventListener('devices', renderDevices);
  microphone.addEventListener('device', () => {
    micSelect.value = microphone.deviceId;
  });

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

  function renderDevices() {
    micSelect.replaceChildren(
      ...microphone.devices.map((device) => {
        const option = document.createElement('option');
        option.value = device.id;
        option.textContent = device.label;
        return option;
      }),
    );
    if (!microphone.devices.length) {
      const option = document.createElement('option');
      option.textContent = '[ NO DEVICES ]';
      micSelect.append(option);
    }
    micSelect.disabled = !microphone.devices.length;
    micSelect.value = microphone.deviceId;
  }

  renderCard(localCard, { micOn: voice.micOn, deafened: voice.deafened });
  renderCard(remoteCard, null);
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
