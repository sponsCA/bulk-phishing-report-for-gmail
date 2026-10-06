import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReporting } from '../src/reporting.js';
import { createRegistry } from '../src/registry.js';
import { memoryStorage, fakeGmail, fakeClock, conversations } from './fakes.js';

function mount({
  storage = memoryStorage(),
  account = '0',
  gmail = fakeGmail(),
  clock = fakeClock(),
  random = () => 0.5,
} = {}) {
  const registry = createRegistry({ storage, account });
  const reporting = createReporting({
    gmail,
    registry,
    wait: clock.wait,
    now: clock.now,
    random,
  });
  return { reporting, gmail, clock, storage };
}

async function reportAll(reporting, selection) {
  return reporting.run(await reporting.plan(selection));
}

const DAY_MS = 24 * 60 * 60 * 1000;
const ids = (list) => list.map((c) => c.id);

test('plan: a fresh selection is entirely to report', async () => {
  const { reporting } = mount();

  const plan = await reporting.plan(conversations('a', 'b'));

  assert.deepEqual(ids(plan.toReport), ['a', 'b']);
  assert.deepEqual(plan.alreadyReported, []);
});

test('run: reports every conversation of the plan and lists them as reported', async () => {
  const { reporting, gmail } = mount();

  const plan = await reporting.plan(conversations('a', 'b'));
  const summary = await reporting.run(plan);

  assert.deepEqual(gmail.reported, ['a', 'b']);
  assert.deepEqual(ids(summary.reported), ['a', 'b']);
});

test('the run returns to the Spam list once, at the end', async () => {
  const { reporting, gmail } = mount();

  await reporting.run(await reporting.plan(conversations('a', 'b')));

  assert.equal(gmail.returnsToSpam, 1);
});

test('a 1 to 2 s pause separates two reports, never after the last one', async () => {
  const low = mount({ random: () => 0 });
  const high = mount({ random: () => 0.9999 });

  await low.reporting.run(await low.reporting.plan(conversations('a', 'b', 'c')));
  await high.reporting.run(await high.reporting.plan(conversations('a', 'b', 'c')));

  assert.deepEqual(low.clock.waits, [1000, 1000]);
  assert.deepEqual(high.clock.waits, [1999, 1999]);
});

test('the time spent on a conversation counts towards the pause: only the rest is waited', async () => {
  const clock = fakeClock();
  const gmail = fakeGmail({ onReport: async () => clock.advance(600) });
  const { reporting } = mount({ clock, gmail, random: () => 0.5 });

  await reportAll(reporting, conversations('a', 'b', 'c'));

  assert.deepEqual(clock.waits, [900, 900]);
});

test('processing longer than the pause adds no wait', async () => {
  const clock = fakeClock();
  const gmail = fakeGmail({ onReport: async () => clock.advance(2500) });
  const { reporting } = mount({ clock, gmail });

  await reportAll(reporting, conversations('a', 'b'));

  assert.deepEqual(clock.waits, []);
  assert.deepEqual(gmail.reported, ['a', 'b']);
});

test('conversations already reported are recognised and skipped afterwards', async () => {
  const { reporting, gmail } = mount();
  await reportAll(reporting, conversations('a', 'b'));

  const plan = await reporting.plan(conversations('a', 'b', 'c'));
  const summary = await reporting.run(plan);

  assert.deepEqual(ids(plan.toReport), ['c']);
  assert.deepEqual(ids(plan.alreadyReported), ['a', 'b']);
  assert.deepEqual(ids(summary.skipped), ['a', 'b']);
  assert.deepEqual(gmail.reported, ['a', 'b', 'c']);
});

test('a selection entirely already reported leaves nothing to report', async () => {
  const { reporting } = mount();
  await reportAll(reporting, conversations('a', 'b'));

  const plan = await reporting.plan(conversations('a', 'b'));

  assert.deepEqual(plan.toReport, []);
  assert.deepEqual(ids(plan.alreadyReported), ['a', 'b']);
});

test('the memory of reports is kept separately for each account', async () => {
  const storage = memoryStorage();
  const account0 = mount({ storage, account: '0' });
  const account1 = mount({ storage, account: '1' });
  await reportAll(account0.reporting, conversations('a'));

  const plan = await account1.reporting.plan(conversations('a'));

  assert.deepEqual(ids(plan.toReport), ['a']);
});

test('two tabs of the same account reporting at the same time keep all their reports', async () => {
  const storage = memoryStorage();
  const tab1 = mount({ storage });
  const tab2 = mount({ storage });

  await Promise.all([
    reportAll(tab1.reporting, conversations('a')),
    reportAll(tab2.reporting, conversations('b')),
  ]);
  const plan = await tab1.reporting.plan(conversations('a', 'b'));

  assert.deepEqual(ids(plan.alreadyReported), ['a', 'b']);
});

test('an empty plan reports nothing, does not pause and does not navigate', async () => {
  const { reporting, gmail, clock } = mount();
  await reportAll(reporting, conversations('a'));
  gmail.returnsToSpam = 0;

  const summary = await reportAll(reporting, conversations('a'));

  assert.deepEqual(gmail.reported, ['a']);
  assert.deepEqual(clock.waits, []);
  assert.equal(gmail.returnsToSpam, 0);
  assert.deepEqual(ids(summary.skipped), ['a']);
});

test('reports less than 30 days old are kept', async () => {
  const { reporting, clock } = mount();
  await reportAll(reporting, conversations('recent'));
  clock.advance(29 * DAY_MS);

  const plan = await reporting.plan(conversations('recent'));

  assert.deepEqual(ids(plan.alreadyReported), ['recent']);
});

test('a report more than 30 days old is already forgotten when planning', async () => {
  const { reporting, clock } = mount();
  await reportAll(reporting, conversations('old'));
  clock.advance(31 * DAY_MS);

  const plan = await reporting.plan(conversations('old'));

  assert.deepEqual(ids(plan.toReport), ['old']);
  assert.deepEqual(plan.alreadyReported, []);
});

test('reports more than 30 days old are erased for every account, not only the current one', async () => {
  const storage = memoryStorage();
  const clock = fakeClock();
  const otherAccount = mount({ storage, clock, account: 'u/1' });
  const currentAccount = mount({ storage, clock, account: 'u/0' });
  await reportAll(otherAccount.reporting, conversations('old'));
  clock.advance(31 * DAY_MS);

  await currentAccount.reporting.plan(conversations('a'));

  assert.deepEqual(await storage.getByPrefix('reports:'), {});
});

test('example from the spec: 5 selected, 2 already reported, 1 failing', async () => {
  const gmail = fakeGmail({ failures: { c4: new Error('Menu not found') } });
  const { reporting } = mount({ gmail });
  await reportAll(reporting, conversations('c1', 'c2'));

  const plan = await reporting.plan(conversations('c1', 'c2', 'c3', 'c4', 'c5'));
  const summary = await reporting.run(plan);

  assert.deepEqual(ids(plan.toReport), ['c3', 'c4', 'c5']);
  assert.deepEqual(ids(summary.reported), ['c3', 'c5']);
  assert.deepEqual(
    summary.failed.map((e) => ({ id: e.conversation.id, reason: e.reason })),
    [{ id: 'c4', reason: 'Menu not found' }],
  );
  assert.deepEqual(ids(summary.skipped), ['c1', 'c2']);
});

test('a failed conversation is not remembered and remains to be reported', async () => {
  const gmail = fakeGmail({ failures: { a: new Error('Timed out') } });
  const { reporting } = mount({ gmail });
  await reportAll(reporting, conversations('a'));

  const plan = await reporting.plan(conversations('a'));

  assert.deepEqual(ids(plan.toReport), ['a']);
});

test('a rejection that is not an Error still gives a readable reason', async () => {
  const gmail = fakeGmail({ failures: { a: 'Gmail is not responding' } });
  const { reporting } = mount({ gmail });

  const summary = await reportAll(reporting, conversations('a'));

  assert.equal(summary.failed[0].reason, 'Gmail is not responding');
});

test('progress is notified after each conversation', async () => {
  const gmail = fakeGmail({ failures: { b: new Error('Timed out') } });
  const { reporting } = mount({ gmail });
  const events = [];

  const plan = await reporting.plan(conversations('a', 'b', 'c'));
  await reporting.run(plan, { onProgress: (e) => events.push(e) });

  assert.deepEqual(
    events.map((e) => ({ index: e.index, total: e.total, id: e.conversation.id, result: e.result, reason: e.reason })),
    [
      { index: 1, total: 3, id: 'a', result: 'reported', reason: undefined },
      { index: 2, total: 3, id: 'b', result: 'failed', reason: 'Timed out' },
      { index: 3, total: 3, id: 'c', result: 'reported', reason: undefined },
    ],
  );
});

test('failing to return to the Spam list does not prevent returning the summary', async () => {
  const gmail = fakeGmail({ returnFailure: new Error('Spam list not found') });
  const { reporting } = mount({ gmail });

  const summary = await reportAll(reporting, conversations('a'));

  assert.deepEqual(ids(summary.reported), ['a']);
});

test('a memory failure after a successful report interrupts the run without counting a failure', async () => {
  const { reporting, gmail, storage } = mount();
  const plan = await reporting.plan(conversations('a', 'b'));
  storage.failingWrites = 1;

  await assert.rejects(reporting.run(plan), /Storage unavailable/);

  // 'a' really was reported to Google: the run does not go on with a broken memory.
  assert.deepEqual(gmail.reported, ['a']);
});

test('a stop during a conversation finishes it, then stops', async () => {
  const controller = new AbortController();
  const gmail = fakeGmail({
    onReport: async (c) => {
      if (c.id === 'b') controller.abort();
    },
  });
  const { reporting } = mount({ gmail });
  const plan = await reporting.plan(conversations('a', 'b', 'c', 'd'));

  const summary = await reporting.run(plan, { signal: controller.signal });

  assert.deepEqual(gmail.reported, ['a', 'b']);
  assert.deepEqual(ids(summary.reported), ['a', 'b']);
  assert.deepEqual(ids(summary.notProcessed), ['c', 'd']);
  assert.equal(summary.stoppedByUser, true);
  assert.equal(gmail.returnsToSpam, 1);
});

test('a stop during the pause prevents the next conversation', async () => {
  const controller = new AbortController();
  const clock = fakeClock({ duringWait: () => controller.abort() });
  const { reporting, gmail } = mount({ clock });
  const plan = await reporting.plan(conversations('a', 'b', 'c'));

  const summary = await reporting.run(plan, { signal: controller.signal });

  assert.deepEqual(gmail.reported, ['a']);
  assert.deepEqual(ids(summary.notProcessed), ['b', 'c']);
  assert.equal(summary.stoppedByUser, true);
});

test('a stop requested before the start reports nothing', async () => {
  const controller = new AbortController();
  controller.abort();
  const { reporting, gmail } = mount();
  const plan = await reporting.plan(conversations('a', 'b'));

  const summary = await reporting.run(plan, { signal: controller.signal });

  assert.deepEqual(gmail.reported, []);
  assert.deepEqual(ids(summary.notProcessed), ['a', 'b']);
  assert.equal(summary.stoppedByUser, true);
  assert.equal(gmail.returnsToSpam, 0);
});

test('a second run during the first one is refused', async () => {
  let release;
  const blocked = new Promise((r) => (release = r));
  const gmail = fakeGmail({ onReport: () => blocked });
  const { reporting } = mount({ gmail });
  const plan = await reporting.plan(conversations('a'));

  const first = reporting.run(plan);
  assert.equal(reporting.running, true);
  await assert.rejects(reporting.run(plan), /already in progress/);

  release();
  await first;
  assert.equal(reporting.running, false);
  assert.deepEqual(gmail.reported, ['a']);
});

test('an unexpected error releases the lock: a new run remains possible', async () => {
  const { reporting, storage, gmail } = mount();
  const plan = await reporting.plan(conversations('a'));
  storage.failingWrites = 1;
  await assert.rejects(reporting.run(plan), /Storage unavailable/);
  assert.equal(reporting.running, false);

  await reportAll(reporting, conversations('b'));

  assert.deepEqual(gmail.reported, ['a', 'b']);
});

test('a stop during a conversation does not wait for the next pause', async () => {
  const controller = new AbortController();
  const gmail = fakeGmail({
    onReport: async (c) => {
      if (c.id === 'b') controller.abort();
    },
  });
  const { reporting, clock } = mount({ gmail });
  const plan = await reporting.plan(conversations('a', 'b', 'c'));

  await reporting.run(plan, { signal: controller.signal });

  assert.equal(clock.waits.length, 1);
});

test('a stop during the last conversation is still announced as a stop', async () => {
  const controller = new AbortController();
  const gmail = fakeGmail({
    onReport: async (c) => {
      if (c.id === 'b') controller.abort();
    },
  });
  const { reporting } = mount({ gmail });
  const plan = await reporting.plan(conversations('a', 'b'));

  const summary = await reporting.run(plan, { signal: controller.signal });

  assert.deepEqual(gmail.reported, ['a', 'b']);
  assert.equal(summary.stoppedByUser, true);
  assert.deepEqual(summary.notProcessed, []);
});

test('deletion requested: each reported conversation is then deleted', async () => {
  const { reporting, gmail } = mount();
  const plan = await reporting.plan(conversations('a', 'b'));

  const summary = await reporting.run(plan, { deleteAfterReport: true });

  assert.deepEqual(gmail.deleted, ['a', 'b']);
  assert.deepEqual(ids(summary.deleted), ['a', 'b']);
});

test('without deletion requested, no conversation is deleted', async () => {
  const { reporting, gmail } = mount();

  const summary = await reportAll(reporting, conversations('a'));

  assert.deepEqual(gmail.deleted, []);
  assert.deepEqual(summary.deleted, []);
});

test('a conversation whose report failed is never deleted', async () => {
  const gmail = fakeGmail({ failures: { b: new Error('Message ⋮ menu not found') } });
  const { reporting } = mount({ gmail });
  const plan = await reporting.plan(conversations('a', 'b'));

  await reporting.run(plan, { deleteAfterReport: true });

  assert.deepEqual(gmail.deleted, ['a']);
});

test('a failed deletion leaves the conversation reported and remembered, to be deleted by hand', async () => {
  const gmail = fakeGmail({ deleteFailures: { a: new Error('Delete button not found') } });
  const { reporting } = mount({ gmail });
  const plan = await reporting.plan(conversations('a', 'b'));

  const summary = await reporting.run(plan, { deleteAfterReport: true });

  assert.deepEqual(ids(summary.reported), ['a', 'b']);
  assert.deepEqual(summary.failed, []);
  assert.deepEqual(ids(summary.deleted), ['b']);
  assert.deepEqual(
    summary.notDeleted.map(({ conversation, reason }) => [conversation.id, reason]),
    [['a', 'Delete button not found']],
  );
  const next = await reporting.plan(conversations('a'));
  assert.deepEqual(ids(next.alreadyReported), ['a']);
});
