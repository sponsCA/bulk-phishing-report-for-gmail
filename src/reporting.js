// Core of the extension: decides what to report and reports conversations one after another.
// Knows nothing about the DOM: Gmail, the registry and time are injected.

// Random interval of 1 to 2 s between the start of two reports, so as not to chain them
// like a robot. The time spent processing a conversation counts towards this interval.
const MIN_INTERVAL_MS = 1000;
const INTERVAL_SPREAD_MS = 1000;

export function createReporting({
  gmail,
  registry,
  wait,
  random = Math.random,
  now = () => new Date(),
}) {
  let running = false;

  async function plan(selection) {
    // First forget reports older than 30 days, so that they can be reported again.
    await registry.purge(now());
    const already = await registry.reportedIds();
    return {
      toReport: selection.filter((c) => !already.has(c.id)),
      alreadyReported: selection.filter((c) => already.has(c.id)),
    };
  }

  // deleteAfterReport: permanently delete each conversation after it has been reported successfully.
  async function run(planned, { onProgress = () => {}, signal, deleteAfterReport = false } = {}) {
    // The core has no access to the browser's translations; the interface never starts a second run anyway.
    if (running) throw new Error('A run is already in progress.');
    running = true;
    try {
      const total = planned.toReport.length;
      const summary = {
        reported: [],
        failed: [],
        skipped: [...planned.alreadyReported],
        deleted: [],
        // Reported but not deleted: to be deleted by hand.
        notDeleted: [],
        notProcessed: [],
        stoppedByUser: false,
      };
      const stopRequested = (i) => {
        if (!signal?.aborted) return false;
        summary.notProcessed = planned.toReport.slice(i);
        return true;
      };

      let previousStart = null;
      for (const [i, conversation] of planned.toReport.entries()) {
        // Checked before the pause (immediate stop) and after it (stop requested during the pause).
        if (stopRequested(i)) break;
        if (previousStart !== null) {
          const interval = MIN_INTERVAL_MS + Math.floor(random() * INTERVAL_SPREAD_MS);
          const remaining = interval - (now().getTime() - previousStart);
          if (remaining > 0) await wait(remaining);
          if (stopRequested(i)) break;
        }
        previousStart = now().getTime();
        try {
          await gmail.report(conversation);
        } catch (error) {
          const reason = reasonOf(error);
          summary.failed.push({ conversation, reason });
          onProgress({ index: i + 1, total, conversation, result: 'failed', reason });
          continue;
        }
        // Outside the try: a broken memory is not a failed report. It interrupts the run,
        // so as not to report conversations that could not be remembered.
        await registry.record(conversation.id, now());
        summary.reported.push(conversation);
        if (deleteAfterReport) {
          // A failure here does not undo the report, already made and remembered.
          try {
            await gmail.deleteForever(conversation);
            summary.deleted.push(conversation);
          } catch (error) {
            summary.notDeleted.push({ conversation, reason: reasonOf(error) });
          }
        }
        onProgress({ index: i + 1, total, conversation, result: 'reported' });
      }
      // A stop during the last conversation is still a stop for the user.
      summary.stoppedByUser = signal?.aborted ?? false;
      // No navigation if no conversation was opened.
      if (summary.reported.length + summary.failed.length > 0) await returnToSpam();
      return summary;
    } finally {
      running = false;
    }
  }

  async function returnToSpam() {
    try {
      await gmail.returnToSpam();
    } catch (error) {
      // The summary matters more than a failed navigation: the user can click Spam.
      console.warn('[Bulk Phishing Report] Could not return to the Spam list:', error);
    }
  }

  return {
    plan,
    run,
    get running() {
      return running;
    },
  };
}

function reasonOf(error) {
  return error instanceof Error ? error.message : String(error);
}
