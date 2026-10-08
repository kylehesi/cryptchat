import { log } from './core/logger.js';
import { mountLogPanel } from './ui/log-panel.js';
import { mountSettingsModal } from './ui/settings-modal.js';

const $ = (id) => document.getElementById(id);

mountLogPanel($('kernel-log'));

mountSettingsModal({
  dialog: $('settings-dialog'),
  openButton: $('btn-settings'),
  closeButton: $('btn-settings-close'),
});

const { electron, chrome } = window.cc.versions;
log.info('--- SYSTEM BOOT ---');
log.info(`Runtime: Electron ${electron} / Chromium ${chrome}`);
