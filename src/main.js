import { createGmailAdapter } from './gmail.js';
import { createRegistry } from './registry.js';
import { createReporting } from './reporting.js';
import { chromeStorage } from './chrome-storage.js';
import { mountInterface } from './interface.js';
import { useGmailLanguage } from './i18n.js';

// Dry-run mode: chosen in the extension's toolbar popup. Kept in the extension's storage,
// not in the page's: Gmail's scripts can neither read nor change it.
export async function start() {
  // Our texts follow Gmail's language, read once when the page loads.
  await useGmailLanguage();
  const storage = chromeStorage();
  // If this setting cannot be read, we stop (the error goes to the console):
  // better no button than a real run mistaken for a dry run.
  const dryRun = (await storage.get('dryRun')) === true;
  // The mode is fixed when the page loads, so never changed in the middle of a run:
  // a change reloads Gmail (the browser asks for confirmation if a run is in progress).
  storage.onChange((key) => key === 'dryRun', () => location.reload());
  const gmail = createGmailAdapter({ dryRun });
  // The dry run has its own memory, so as never to hide a conversation that was not really reported.
  const account = dryRun ? `dry-run-${gmail.account()}` : gmail.account();
  const registry = createRegistry({ storage, account });
  const reporting = createReporting({
    gmail,
    registry,
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  mountInterface({ gmail, reporting, registry, dryRun });
}
