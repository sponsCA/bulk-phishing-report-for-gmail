// The only place that knows Gmail's structure. Update it here when Google changes its interface.
// No landmark depends on displayed text: the extension works whatever Gmail's language.
// Landmarks observed on 2026-10-03.

// Gmail URLs: account path, and the part after # for the Spam view.
export const URLS = {
  // The account is identified by the whole path after /mail/ (u/1, u/0/d/<delegation>, b/<id>/u/0…),
  // so that delegated mailboxes do not share the main account's memory.
  // Empty path (/mail/) = account u/0.
  account: (path) => path.replace(/^\/mail\/?/, '').replace(/\/+$/, '') || 'u/0',
  // Spam list, page 1 (#spam) or following pages (#spam/p2…)
  spamList: /^#spam(\/p\d+)?$/,
  defaultSpamList: '#spam',
  conversation: (id) => `#spam/${id}`,
};

// Conversation identifier as Gmail writes it in data-legacy-thread-id (16 hexadecimal digits).
// Any other format is ignored: it goes neither into the URL, nor into the memory, nor into a selector.
export const CONVERSATION_ID_FORMAT = /^[0-9a-f]{16}$/;

export const ATTRIBUTES = {
  conversationId: 'data-legacy-thread-id',
  senderEmail: 'email',
};

export const SELECTORS = {
  // Conversation list
  row: 'div[role="main"] tr.zA',
  checkedBox: '[role="checkbox"][aria-checked="true"]',
  conversationId: `[${ATTRIBUTES.conversationId}]`,
  sender: `.yW [${ATTRIBUTES.senderEmail}]`,
  subject: '.bog',
  // Where to put the « Signalé » badge in a row (otherwise: before the subject)
  badgeHost: '.y6',
  toolbar: 'div[gh="mtb"]',
  // « Not spam »: Gmail's internal action code
  notSpamButton: '[role="button"][act="18"]',
  // « Delete forever »: the only deletion offered in Spam (no trash).
  // Observed in the list toolbar, and confirmed by a real deletion from a conversation (2026-10-04).
  deleteForeverButton: '[role="button"][act="17"]',

  // Open conversation
  // Message bodies: content controlled by the sender, where the extension never looks for anything.
  messageBody: '.a3s',
  // Subject of an open conversation; it carries the identifier of the displayed conversation.
  conversationSubject: 'div[role="main"] h2.hP',
  conversationView: (id) => `div[role="main"] h2.hP[${ATTRIBUTES.conversationId}="${id}"]`,
  // Container of the ⋮ menu, one per displayed message (the last one = last message).
  // The ⋮ is the <button> it contains (its aria-labelledby points to it).
  messageMenuHost: 'div[role="main"] [data-is-menu-hoisted="true"]',
  messageMenuButton: 'button',
  // « Report phishing » item: Gmail's internal action type
  reportPhishingItem: '[role="menuitem"][data-action-type="30"]',

  // Gmail's confirmation dialog (Material component): buttons found by their action
  dialog: '[role="alertdialog"]',
  confirmButton: '[data-mdc-dialog-action="ok"]',
  cancelButton: '[data-mdc-dialog-action="cancel"]',
};
