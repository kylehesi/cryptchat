import { log } from '../core/logger.js';
import { appendToLog } from './scroll-log.js';

const MAX_LINES = 300;

const timeFormat = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
});

/**
 * Renders log entries into `container`, auto-scrolling only if the user is already at the bottom.
 * With HIDE_IP_AND_PAYLOAD on, IP addresses are masked; toggling it redraws the existing lines.
 */
export function mountLogPanel(container, privacy) {
  const render = (entry) => {
    const line = document.createElement('div');
    line.className = `log-line log-${entry.level}`;
    line.textContent = `[${timeFormat.format(entry.time)}] ${privacy.maskText(entry.message)}`;
    return line;
  };

  privacy.addEventListener('change', () => {
    container.replaceChildren(...log.history().slice(-MAX_LINES).map(render));
    container.scrollTop = container.scrollHeight;
  });

  return log.subscribe((entry) => appendToLog(container, render(entry), MAX_LINES));
}
