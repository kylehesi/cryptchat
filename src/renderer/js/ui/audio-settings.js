import { log } from '../core/logger.js';

/** AUDIO_DSP checkboxes in the settings dialog. Each checkbox has data-key = a Microphone.processing key. */
export function mountAudioSettings({ microphone, container }) {
  for (const input of container.querySelectorAll('input[data-key]')) {
    const key = input.dataset.key;
    input.checked = microphone.processing[key];

    input.addEventListener('change', async () => {
      try {
        await microphone.setProcessing({ [key]: input.checked });
        log.info(`${input.closest('label').textContent.trim()}: ${input.checked ? 'ON' : 'OFF'}`);
      } catch (error) {
        log.err(`Could not apply audio setting: ${error.message}`);
      }
    });
  }
}
