// Displayed text (see _locales/). Inside Gmail, it follows Gmail's own language, read from the page's `lang`
// attribute, so that our button and dialogs speak like the Gmail around them; chrome.i18n can only follow the
// browser's language, so the catalogue is loaded by hand. Outside Gmail (toolbar popup, extensions page), and until
// the catalogue is loaded, chrome.i18n and the browser's language are used.

const LOCALES = ['en', 'fr'];
const DEFAULT_LOCALE = 'en';

let catalogue = null;
let locale = null;

// Catalogue for a page language such as « fr-CA »: its base language if we have it, English otherwise.
export function localeFor(pageLanguage) {
  const base = String(pageLanguage ?? '').split('-')[0].toLowerCase();
  return LOCALES.includes(base) ? base : DEFAULT_LOCALE;
}

// Same rules as chrome.i18n: $name$ is replaced by its placeholder's content, in which $1, $2… are the substitutions.
export function format(entry, substitutions) {
  return entry.message.replace(/\$([A-Za-z0-9_]+)\$/g, (_, name) =>
    (entry.placeholders?.[name.toLowerCase()]?.content ?? '').replace(/\$(\d)/g, (_, i) => String(substitutions[i - 1] ?? '')),
  );
}

// Inside Gmail: loads the catalogue matching Gmail's language. On failure, the browser's language stays in use.
export async function useGmailLanguage() {
  const wanted = localeFor(document.documentElement.lang);
  try {
    const response = await fetch(chrome.runtime.getURL(`_locales/${wanted}/messages.json`));
    catalogue = await response.json();
    locale = wanted;
  } catch (error) {
    console.warn('[Bulk Phishing Report] Catalogue not loaded, browser language used:', error);
  }
}

// A missing key shows the key itself, so that it is noticed rather than leaving a blank.
export function t(key, ...substitutions) {
  if (catalogue?.[key]) return format(catalogue[key], substitutions);
  return chrome.i18n.getMessage(key, substitutions.map(String)) || key;
}

// Language actually used for the displayed text, for the `lang` attribute of our own elements.
export function uiLanguage() {
  return locale ?? chrome.i18n.getMessage('@@ui_locale').replace('_', '-');
}
