import { formatLogReport } from '../core/log-report.js';
import { log } from '../core/logger.js';

/** [ COPY_LOG ] in the KERNEL_LOG header: the log for a bug report, personal details masked. */
export function mountCopyLog({ button }) {
  button.addEventListener('click', async () => {
    const { electron, chrome } = window.cc.versions;
    const report = formatLogReport(log.history(), {
      version: window.cc.version,
      electron,
      chrome,
      platform: navigator.userAgentData?.platform || 'Windows',
    });
    const copied = await window.cc.clipboard.writeText(report.text).catch(() => false);
    if (copied) {
      log.info(`KERNEL_LOG copied (${report.lines} lines). IPs, hosts, payloads and names are masked; read it once before posting it.`, { notify: false });
    } else {
      log.warn('Could not copy the log to the clipboard.', { notify: false });
    }
  });
}
