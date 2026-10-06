// Gmail adapter: the only module that touches Gmail's DOM.
// Failure reasons are shown to the user in the summary, hence translated (see _locales/).

import { hookIcon } from './icon.js';
import { t } from './i18n.js';
import { URLS, ATTRIBUTES, CONVERSATION_ID_FORMAT, SELECTORS } from './selectors.js';

const OBSERVATION_DELAY_MS = 250;
const STEP_TIMEOUT_MS = 10_000;
// Fallback check, in case a change goes through no DOM modification at all.
const FALLBACK_INTERVAL_MS = 500;
const ESCAPE_TIMEOUT_MS = 1_000;

export function createGmailAdapter({ dryRun = false } = {}) {
  // Spam list page where the selection was read, to come back to it (#spam/p2…).
  let listUrl = URLS.defaultSpamList;

  function account() {
    return URLS.account(location.pathname);
  }

  function isSpamListView() {
    return URLS.spamList.test(location.hash);
  }

  function rows() {
    return allVisible(SELECTORS.row);
  }

  function readConversation(row) {
    const id = row.querySelector(SELECTORS.conversationId)?.getAttribute(ATTRIBUTES.conversationId);
    if (!id || !CONVERSATION_ID_FORMAT.test(id)) return null;
    const sender = row.querySelector(SELECTORS.sender);
    return {
      id,
      sender: sender?.getAttribute(ATTRIBUTES.senderEmail) ?? sender?.textContent.trim() ?? '',
      subject: row.querySelector(SELECTORS.subject)?.textContent.trim() ?? '',
    };
  }

  // For the button: one checked box is enough, no need to read each conversation.
  function hasSelection(list = rows()) {
    return list.some((row) => row.querySelector(SELECTORS.checkedBox));
  }

  function readSelection() {
    if (!isSpamListView()) return [];
    listUrl = location.hash;
    return rows()
      .filter((row) => row.querySelector(SELECTORS.checkedBox))
      .map(readConversation)
      .filter(Boolean);
  }

  // Puts the button right after « Not spam », on the same row; otherwise at the end of the toolbar.
  function placeButton(button, visible) {
    const toolbar = firstVisible(SELECTORS.toolbar);
    if (toolbar) {
      const anchor = firstVisible(SELECTORS.notSpamButton, toolbar);
      if (anchor && anchor.nextElementSibling !== button) anchor.after(button);
      else if (!anchor && button.parentElement !== toolbar) toolbar.appendChild(button);
    }
    button.hidden = !visible;
  }

  function markBadges(ids, list = rows()) {
    if (!isSpamListView()) return;
    for (const row of list) {
      const conversation = readConversation(row);
      const badge = row.querySelector('.gpr-badge');
      if (conversation && ids.has(conversation.id)) {
        if (!badge) {
          const host = row.querySelector(SELECTORS.badgeHost) ?? row.querySelector(SELECTORS.subject)?.parentElement;
          host?.prepend(createBadge());
        }
      } else {
        badge?.remove();
      }
    }
  }

  // Gmail's theme (light or dark), which does not necessarily follow the system's: we look at
  // the colour of the card behind the toolbar (white in the light theme, observed on 2026-10-05).
  function isDarkTheme() {
    for (let node = firstVisible(SELECTORS.toolbar) ?? document.body; node; node = node.parentElement) {
      const [r, g, b, alpha = 1] = getComputedStyle(node).backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
      if (b !== undefined && alpha >= 0.5) return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
    }
    return false;
  }

  // Calls `callback` after a change of the page or of the selection: on the next frame
  // (the button appears together with Gmail's), then at most once every 250 ms
  // while changes keep coming, since Gmail modifies the page continuously.
  function observe(callback) {
    let scheduled = false;
    let lastCall = -Infinity;
    const run = () => {
      scheduled = false;
      lastCall = performance.now();
      callback();
    };
    const trigger = () => {
      if (scheduled) return;
      scheduled = true;
      const delay = lastCall + OBSERVATION_DELAY_MS - performance.now();
      if (delay > 0) setTimeout(run, delay);
      else requestAnimationFrame(run);
    };
    new MutationObserver(trigger).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-checked'],
    });
    window.addEventListener('hashchange', trigger);
    trigger();
  }

  // Reproduces the manual gesture: from the list, open, ⋮ menu of the last message,
  // Report phishing, confirm. The dry run stops before the menu item:
  // it never triggers the irreversible action, even if Gmail removed its confirmation.
  async function report(conversation) {
    // The identifier goes into the URL and into a selector: no unexpected format.
    if (!CONVERSATION_ID_FORMAT.test(conversation.id)) throw new Error(t('invalidConversationId'));
    // No return to the list between two conversations: the expected view is recognised by its
    // identifier. We only close what a previous failure may have left open.
    await closeLeftovers();

    location.hash = URLS.conversation(conversation.id);
    // The view of THIS conversation, not that of another one still displayed (reading pane, keyboard shortcut).
    const expectedView = () => firstVisible(SELECTORS.conversationView(conversation.id));
    await waitUntil(expectedView, t('conversationNotOpened'));

    // Only the ⋮ of THIS conversation's messages, even if another one is still displayed.
    const menuButton = await waitUntil(() => {
      const view = expectedView();
      return allVisible(SELECTORS.messageMenuHost)
        .filter((host) => view && subjectOf(host) === view)
        .at(-1)
        ?.querySelector(SELECTORS.messageMenuButton);
    }, t('messageMenuNotFound'));
    // The item must appear because of this click: an item already displayed elsewhere is not the right one.
    const itemsBefore = new Set(allVisible(SELECTORS.reportPhishingItem));
    click(menuButton);
    const item = await waitUntil(
      () => allVisible(SELECTORS.reportPhishingItem).find((e) => !itemsBefore.has(e)),
      t('reportItemNotFound'),
    );

    if (dryRun) {
      await closeMenu(menuButton, item);
      return;
    }

    // Only a confirmation opened by this click is accepted, never another Gmail dialog.
    const dialogsBefore = new Set(allVisible(SELECTORS.dialog));
    click(item);
    const dialog = await waitUntil(
      () => allVisible(SELECTORS.dialog).find((d) => !dialogsBefore.has(d)),
      t('confirmationNotShown'),
    );
    try {
      const confirm = await waitUntil(
        () => firstVisible(SELECTORS.confirmButton, dialog),
        t('confirmButtonNotFound'),
      );
      // Last check before the irreversible action.
      if (!expectedView()) throw new Error(t('viewChangedBeforeConfirm'));
      click(confirm);
    } catch (error) {
      // Never leave open a confirmation that pressing Enter would validate.
      const cancel = firstVisible(SELECTORS.cancelButton, dialog);
      if (cancel) click(cancel);
      else pressEscape();
      throw error;
    }
    // Gmail closes its confirmation as soon as the click is taken into account: if it stays open,
    // the report probably did not go through, and it counts as a failure.
    await waitUntil(() => !isVisible(dialog), t('confirmationNotClosed'));
  }

  // Closes the ⋮ menu without choosing anything: Escape, otherwise a second click on ⋮.
  async function closeMenu(menuButton, item) {
    pressEscape();
    try {
      await waitUntil(() => !isVisible(item), t('menuStillOpen'), ESCAPE_TIMEOUT_MS);
    } catch {
      click(menuButton);
      await waitUntil(() => !isVisible(item), t('menuStillOpen'));
    }
  }

  // Permanently deletes the conversation, already reported. In a dry run, the button is only
  // found, never clicked.
  async function deleteForever(conversation) {
    if (!CONVERSATION_ID_FORMAT.test(conversation.id)) throw new Error(t('invalidConversationId'));
    await closeLeftovers();
    const expectedView = () => firstVisible(SELECTORS.conversationView(conversation.id));
    // After the report, Gmail may have gone back to the list: the conversation is reopened.
    if (!expectedView()) {
      location.hash = URLS.conversation(conversation.id);
      await waitUntil(expectedView, t('conversationNotReopened'));
    }
    // With boxes checked in the list (reading pane), the button would delete the whole selection.
    if (hasSelection()) throw new Error(t('conversationsChecked'));

    const button = await waitUntil(
      () => firstVisible(SELECTORS.deleteForeverButton),
      t('deleteButtonNotFound'),
    );
    if (dryRun) return;

    // Last check before the irreversible action.
    if (!expectedView()) throw new Error(t('viewChangedBeforeDelete'));
    const dialogsBefore = new Set(allVisible(SELECTORS.dialog));
    click(button);
    // Deleted once its view disappears. An unexpected dialog is cancelled rather than blindly confirmed.
    const outcome = await waitUntil(
      () => (!expectedView() ? 'deleted' : allVisible(SELECTORS.dialog).find((d) => !dialogsBefore.has(d))),
      t('stillDisplayedAfterDelete'),
    );
    if (outcome !== 'deleted') {
      const cancel = firstVisible(SELECTORS.cancelButton, outcome);
      if (cancel) click(cancel);
      else pressEscape();
      throw new Error(t('unexpectedConfirmation'));
    }
  }

  async function returnToSpam() {
    await closeLeftovers();
    if (location.hash !== listUrl) location.hash = listUrl;
    // Back on the list as soon as no conversation is displayed any more. Do not wait for rows:
    // the list may be empty (last spam deleted), and the wait would last until the timeout (10 s).
    await waitUntil(() => isSpamListView() && !firstVisible(SELECTORS.conversationSubject), t('spamListNotShown'));
  }

  // After a failure, a ⋮ menu or a Gmail confirmation may stay open and make the next
  // conversation fail. « Cancel » never sends a report.
  async function closeLeftovers() {
    // Only the message's ⋮ menu (found by its « Report phishing » item), not Gmail's other menus.
    const open = () => [
      ...allVisible(SELECTORS.dialog),
      ...allVisible(SELECTORS.reportPhishingItem),
    ];
    if (open().length === 0) return;
    for (const dialog of allVisible(SELECTORS.dialog)) {
      const cancel = firstVisible(SELECTORS.cancelButton, dialog);
      if (cancel) click(cancel);
    }
    pressEscape();
    await waitUntil(() => open().length === 0, t('leftoversOpen'));
  }

  return {
    account,
    isSpamListView,
    rows,
    hasSelection,
    readSelection,
    placeButton,
    markBadges,
    isDarkTheme,
    observe,
    report,
    deleteForever,
    returnToSpam,
  };
}

function createBadge() {
  const badge = document.createElement('span');
  badge.className = 'gpr-badge';
  badge.append(hookIcon(), t('badgeReported'));
  return badge;
}

// Visible Gmail elements, excluding the extension's own dialogs
// and message bodies, which a sender could disguise as a Gmail button.
function allVisible(selector, root = document) {
  return [...root.querySelectorAll(selector)].filter(
    (element) => isVisible(element) && !element.closest(`.gpr-backdrop, ${SELECTORS.messageBody}`),
  );
}

// Subject of the conversation `element` belongs to: the first ancestor that contains
// a conversation subject; null if it contains several (impossible to decide).
function subjectOf(element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const subjects = allVisible(SELECTORS.conversationSubject, node);
    if (subjects.length > 0) return subjects.length === 1 ? subjects[0] : null;
  }
  return null;
}

function firstVisible(selector, root = document) {
  return allVisible(selector, root)[0];
}

// Displayed and not hidden by `visibility: hidden` (Gmail could hide a menu or a confirmation that way).
function isVisible(element) {
  return !!element && element.getClientRects().length > 0 && element.checkVisibility({ visibilityProperty: true });
}

// Gmail reacts to the full mouse sequence, not only to `click`.
function click(element) {
  for (const type of ['mousedown', 'mouseup', 'click']) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
}

function pressEscape() {
  const target = document.activeElement ?? document.body;
  for (const type of ['keydown', 'keyup']) {
    target.dispatchEvent(new KeyboardEvent(type, { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true }));
  }
}

// Waits until `find` returns a truthy value, or fails with `failureReason` after `timeoutMs`.
// `find` is re-evaluated on every page modification: we move on as soon as Gmail is done, with no fixed delay.
function waitUntil(find, failureReason, timeoutMs = STEP_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const immediate = find();
    if (immediate) return resolve(immediate);

    let done = false;
    const finish = (action) => {
      done = true;
      observer.disconnect();
      clearInterval(fallback);
      clearTimeout(limit);
      action();
    };
    const check = () => {
      if (done) return;
      const result = find();
      if (result) finish(() => resolve(result));
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
    const fallback = setInterval(check, FALLBACK_INTERVAL_MS);
    const limit = setTimeout(
      () => finish(() => reject(new Error(t('afterSeconds', failureReason, timeoutMs / 1000)))),
      timeoutMs,
    );
  });
}
