// The extension's toolbar popup: choice of the dry-run mode, and reset of its memory.
// Gmail tabs reload by themselves when the mode changes (see src/main.js).
// Displayed text comes from _locales/ (English or French).

import { t, uiLanguage } from '../src/i18n.js';

document.documentElement.lang = uiLanguage();
for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);

const toggle = document.getElementById('dry-run');
const status = document.getElementById('status');
const dryRunArea = document.getElementById('dry-run-area');
const message = document.getElementById('message');
// Memory of the dry run, separate from that of real reports (see src/main.js and src/registry.js).
const DRY_RUN_PREFIX = 'reports:dry-run-';

function showStatus() {
  dryRunArea.hidden = !toggle.checked;
  message.textContent = '';
  status.textContent = toggle.checked ? t('dryRunStatus') : t('realModeStatus');
}

const { dryRun } = await chrome.storage.local.get('dryRun');
toggle.checked = dryRun === true;
showStatus();

toggle.addEventListener('change', async () => {
  if (toggle.checked) await chrome.storage.local.set({ dryRun: true });
  else await chrome.storage.local.remove('dryRun');
  showStatus();
});

// Forgets the conversations "reported" in a dry run, to try again on them.
// The memory of real reports is not touched; the badges disappear at once in Gmail.
document.getElementById('reset').addEventListener('click', async () => {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(DRY_RUN_PREFIX));
  await chrome.storage.local.remove(keys);
  message.textContent =
    keys.length === 0 ? t('nothingToReset') : keys.length === 1 ? t('resetDoneOne') : t('resetDoneMany', keys.length);
});
