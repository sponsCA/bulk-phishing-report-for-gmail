// In-memory test doubles, to test the Reporting module without a browser.

export function memoryStorage() {
  const data = new Map();
  const storage = {
    // Number of upcoming writes that will fail (simulates unavailable storage).
    failingWrites: 0,
    async get(key) {
      return structuredClone(data.get(key));
    },
    async getByPrefix(prefix) {
      return Object.fromEntries(
        [...data].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [key, structuredClone(value)]),
      );
    },
    async set(key, value) {
      if (storage.failingWrites > 0) {
        storage.failingWrites--;
        throw new Error('Storage unavailable');
      }
      data.set(key, structuredClone(value));
    },
    async remove(keys) {
      for (const key of keys) data.delete(key);
    },
  };
  return storage;
}

// failures: { [conversationId]: value rejected by report() }
// onReport: called at the start of each report (may return a promise to block it)
// returnFailure: value rejected by returnToSpam()
// deleteFailures: { [conversationId]: value rejected by deleteForever() }
export function fakeGmail({ failures = {}, onReport = async () => {}, returnFailure, deleteFailures = {} } = {}) {
  const gmail = {
    reported: [],
    deleted: [],
    returnsToSpam: 0,
    async report(conversation) {
      await onReport(conversation);
      if (conversation.id in failures) throw failures[conversation.id];
      gmail.reported.push(conversation.id);
    },
    async deleteForever(conversation) {
      if (conversation.id in deleteFailures) throw deleteFailures[conversation.id];
      gmail.deleted.push(conversation.id);
    },
    async returnToSpam() {
      gmail.returnsToSpam++;
      if (returnFailure) throw returnFailure;
    },
  };
  return gmail;
}

// duringWait: called at each pause, to simulate an event during it
export function fakeClock({ start = new Date('2026-10-03T12:00:00Z'), duringWait = () => {} } = {}) {
  let instant = start.getTime();
  const clock = {
    waits: [],
    now: () => new Date(instant),
    advance(ms) {
      instant += ms;
    },
    async wait(ms) {
      clock.waits.push(ms);
      instant += ms;
      duringWait(ms);
    },
  };
  return clock;
}

export function conversations(...ids) {
  return ids.map((id) => ({ id, sender: `${id}@example.com`, subject: `Subject ${id}` }));
}
