// Local memory of the conversations already reported, kept separately for each Gmail account.
// Stored shape: one entry per conversation, `reports:<account>:<conversationId>` → timestamp in ms.
// One entry per conversation (rather than one object per account): two tabs reporting at the
// same time cannot erase each other's reports.

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const ALL_ACCOUNTS_PREFIX = 'reports:';

export function createRegistry({ storage, account }) {
  const prefix = `${ALL_ACCOUNTS_PREFIX}${account}:`;

  return {
    async reportedIds() {
      const entries = await storage.getByPrefix(prefix);
      return new Set(Object.keys(entries).map((key) => key.slice(prefix.length)));
    },
    // Reports added or erased elsewhere (another tab, dry-run reset).
    onChange(callback) {
      storage.onChange((key) => key.startsWith(prefix), callback);
    },
    async record(id, date) {
      await storage.set(`${prefix}${id}`, date.getTime());
    },
    // Gmail empties Spam after 30 days: no need to remember any longer.
    // Every account is purged, even those that are no longer opened.
    async purge(now) {
      const limit = now.getTime() - THIRTY_DAYS_MS;
      const entries = await storage.getByPrefix(ALL_ACCOUNTS_PREFIX);
      const expired = Object.keys(entries).filter((key) => entries[key] < limit);
      if (expired.length > 0) await storage.remove(expired);
    },
  };
}
