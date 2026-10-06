// Interface added to Gmail: button, dialogs and badges. Displayed text comes from _locales/ (English or French).

import { hookIcon } from './icon.js';
import { t, uiLanguage } from './i18n.js';

export function mountInterface({ gmail, reporting, registry, dryRun }) {
  let running = false;
  // Local copy of the memory, so as not to read the storage again on every Gmail change.
  let reportedIds = new Set();
  const button = el(
    'button',
    { class: 'gpr-button', type: 'button', lang: uiLanguage() },
    hookIcon(),
    t('reportSelection') + (dryRun ? t('dryRunSuffix') : ''),
  );
  button.hidden = true;
  button.addEventListener('click', (event) => {
    if (event.isTrusted) startRun();
  });

  function updateButton(rows) {
    gmail.placeButton(button, !running && gmail.isSpamListView() && gmail.hasSelection(rows));
  }

  // Our colours follow Gmail's theme (gpr-dark class on <html>, see styles.css).
  const applyTheme = () => document.documentElement.classList.toggle('gpr-dark', gmail.isDarkTheme());
  applyTheme();

  gmail.observe(() => {
    applyTheme();
    // Outside the Spam folder, nothing to do: above all, do not move the hidden button into the toolbar
    // of another view, which would trigger the observer again.
    if (!gmail.isSpamListView()) {
      button.hidden = true;
      return;
    }
    // Rows are looked up only once, for the button and for the badges.
    const rows = gmail.rows();
    updateButton(rows);
    gmail.markBadges(reportedIds, rows);
  });
  refreshBadges();
  registry.onChange(refreshBadges);

  // Badges are a convenience: a failed read (extension reloaded, for instance) must not block anything.
  async function refreshBadges() {
    try {
      reportedIds = await registry.reportedIds();
      gmail.markBadges(reportedIds);
    } catch (error) {
      console.warn('[Bulk Phishing Report] Badges not updated:', error);
    }
  }

  async function startRun() {
    if (running) return;
    running = true;
    let progress = null;
    let unblockKeyboard = () => {};
    try {
      // The selection is frozen here: navigating to each conversation loses the checked boxes.
      const plan = await reporting.plan(gmail.readSelection());
      const choice = await askConfirmation(plan, dryRun);
      if (!choice.confirmed) return;

      button.hidden = true;
      unblockKeyboard = blockKeyboard();
      const controller = new AbortController();
      progress = showProgress(plan.toReport.length, () => controller.abort());
      window.addEventListener('beforeunload', warnBeforeLeaving);
      const summary = await reporting.run(plan, {
        signal: controller.signal,
        deleteAfterReport: choice.deleteAfterReport,
        onProgress: progress.update,
      });
      progress.close();
      showSummary(summary, dryRun);
    } catch (error) {
      progress?.close();
      showMessage(t('runInterrupted'), t('errorMessage', error.message));
    } finally {
      unblockKeyboard();
      window.removeEventListener('beforeunload', warnBeforeLeaving);
      running = false;
      updateButton();
      await refreshBadges();
    }
  }
}

// Resolves to { confirmed, deleteAfterReport }: confirmed is false if the user cancels (or if there is nothing to report).
function askConfirmation(plan, dryRun) {
  const fresh = plan.toReport.length;
  const already = plan.alreadyReported.length;
  return new Promise((resolve) => {
    let close;
    // Tracked through our own events: a page script that ticked the box does not count.
    let deleteAfterReport = false;
    const answer = (confirmed) => {
      close();
      resolve({ confirmed, deleteAfterReport: confirmed && deleteAfterReport });
    };

    if (fresh === 0 && already === 0) {
      close = openDialog(
        el('h2', {}, t('nothingToReport')),
        el('p', {}, t('noConversationRecognised')),
        el('div', { class: 'gpr-actions' }, actionButton(t('close'), true, () => answer(false))),
      );
      return;
    }

    if (fresh === 0) {
      close = openDialog(
        el('h2', {}, t('nothingToReport')),
        el('p', {}, already === 1 ? t('alreadyReportedOne') : t('alreadyReportedMany', already)),
        el('div', { class: 'gpr-actions' }, actionButton(t('close'), true, () => answer(false))),
      );
      return;
    }

    close = openDialog(
      el('h2', {}, (fresh === 1 ? t('confirmTitleOne') : t('confirmTitleMany', fresh)) + (dryRun ? t('dryRunSuffix') : '')),
      ...(dryRun ? [el('p', {}, t('dryRunNotice'))] : []),
      // The list shows what will really be reported, however the boxes were checked.
      el('ul', {}, ...plan.toReport.map((conversation) => el('li', {}, ...describe(conversation)))),
      ...(already > 0
        ? [el('p', {}, already === 1 ? t('skippedOne') : t('skippedMany', already))]
        : []),
      deleteCheckbox(dryRun, (value) => {
        deleteAfterReport = value;
      }),
      el(
        'div',
        { class: 'gpr-actions' },
        actionButton(t('cancel'), false, () => answer(false)),
        actionButton(t('report'), true, () => answer(true)),
      ),
    );
  });
}

// Unchecked by default: deletion is permanent (Spam has no trash).
function deleteCheckbox(dryRun, onChange) {
  const checkbox = el('input', { type: 'checkbox' });
  checkbox.addEventListener('change', (event) => {
    if (event.isTrusted) onChange(checkbox.checked);
  });
  return el(
    'label',
    { class: 'gpr-option' },
    checkbox,
    dryRun ? t('deleteOptionDryRun') : t('deleteOption'),
  );
}

// The browser asks for confirmation before leaving or reloading Gmail during a run.
function warnBeforeLeaving(event) {
  event.preventDefault();
  event.returnValue = '';
}

function showProgress(total, onStop) {
  const text = el('p', {}, t('progress', 0, total));
  const bar = el('span');
  const track = el('div', { class: 'gpr-progress' }, bar);
  const stopButton = actionButton(t('stop'), false, () => {
    stopButton.disabled = true;
    stopButton.textContent = t('stopping');
    onStop();
  });
  const close = openDialog(
    el('h2', {}, t('runningTitle')),
    track,
    text,
    el('div', { class: 'gpr-actions' }, stopButton),
  );
  // Stop stays reachable from the keyboard (Enter or Space) while keys are blocked.
  stopButton.focus();
  return {
    update: ({ index }) => {
      text.textContent = t('progress', index, total);
      bar.style.width = `${(index / total) * 100}%`;
    },
    close,
  };
}

function showSummary(summary, dryRun) {
  const reported = summary.reported.length;
  const counts = [reported === 1 ? t('reportedOne') : t('reportedMany', reported), t('failedCount', summary.failed.length)];
  if (summary.deleted.length > 0) counts.push(t('deletedCount', summary.deleted.length));
  if (summary.skipped.length > 0) counts.push(t('skippedCount', summary.skipped.length));
  if (summary.stoppedByUser) counts.push(t('notProcessedCount', summary.notProcessed.length));
  const title = summary.stoppedByUser ? t('stoppedTitle') : t('doneTitle');

  const close = openDialog(
    el('h2', {}, title + (dryRun ? t('dryRunSuffix') : '')),
    el(
      'div',
      { class: 'gpr-counts' },
      ...counts.map((figure, i) =>
        el('span', { class: i === 0 && reported > 0 ? 'gpr-count gpr-ok' : 'gpr-count' }, figure),
      ),
    ),
    ...(summary.failed.length > 0
      ? [
          el('p', {}, t('reportByHand')),
          el(
            'ul',
            {},
            ...summary.failed.map(({ conversation, reason }) =>
              el('li', {}, ...describe(conversation), t('withReason', reason)),
            ),
          ),
        ]
      : []),
    ...(summary.notDeleted.length > 0
      ? [
          el('p', {}, t('deleteByHand')),
          el(
            'ul',
            {},
            ...summary.notDeleted.map(({ conversation, reason }) => el('li', {}, ...describe(conversation), t('withReason', reason))),
          ),
        ]
      : []),
    el('div', { class: 'gpr-actions' }, actionButton(t('close'), true, () => close())),
  );
}

function showMessage(title, message) {
  const close = openDialog(
    el('h2', {}, title),
    el('p', {}, message),
    el('div', { class: 'gpr-actions' }, actionButton(t('close'), true, () => close())),
  );
}

function openDialog(...content) {
  const backdrop = el(
    'div',
    { class: 'gpr-backdrop', lang: uiLanguage() },
    el(
      'div',
      { class: 'gpr-dialog', role: 'dialog', 'aria-modal': 'true' },
      // Brand banner: it is clear at once that the dialog comes from the extension, not from Gmail.
      el('div', { class: 'gpr-header' }, hookIcon(), 'Bulk Phishing Report'),
      el('div', { class: 'gpr-body' }, ...content),
    ),
  );
  // A click in our dialogs must neither take the focus nor be seen by Gmail as a click
  // "outside": otherwise Gmail would close the ⋮ menu the extension is using.
  backdrop.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  document.body.appendChild(backdrop);
  return () => backdrop.remove();
}

// Sender and subject come from the spam: <bdi> keeps their direction characters
// (Arabic text, U+202E…) from flipping the rest of the line.
function describe(conversation) {
  return [el('bdi', {}, conversation.sender), ' — ', el('bdi', {}, conversation.subject)];
}

// Action of each button in our dialogs, to activate them from the keyboard while keys are blocked.
const buttonActions = new WeakMap();

// Only the user's clicks count, not those simulated by a page script.
function actionButton(text, primary, onClick) {
  const button = el('button', { type: 'button', class: primary ? 'gpr-primary' : '' }, text);
  button.addEventListener('click', (event) => {
    if (event.isTrusted) onClick();
  });
  buttonActions.set(button, onClick);
  return button;
}

// During a run, Gmail's keyboard shortcuts (j/k, u…) could change the displayed conversation
// between two steps: the user's keys no longer reach Gmail.
// Capturing listener on window: it runs before Gmail's for keydown and keyup; keypress,
// which Gmail listens to earlier, is not fired when keydown is cancelled (observed on 2026-10-03).
// Keys simulated by the extension itself (Escape) are not blocked.
function blockKeyboard() {
  const block = (event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // Enter or Space on a button of our dialogs activates it, without Gmail seeing the key.
    const action = buttonActions.get(event.target);
    const activation = event.type === 'keydown' && (event.key === 'Enter' || event.key === ' ');
    if (activation && action && !event.target.disabled) action();
  };
  const types = ['keydown', 'keypress', 'keyup'];
  for (const type of types) window.addEventListener(type, block, true);
  return () => {
    for (const type of types) window.removeEventListener(type, block, true);
  };
}

function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}
