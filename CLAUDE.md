# Bulk Phishing Report for Gmail

Chrome extension (Manifest V3, plain JavaScript, no build step) that reports as phishing the conversations checked in
Gmail's Spam folder, and can then delete them permanently.

## Rules
- Gmail is read-only for the agent: read the DOM, nothing more. Opening a conversation (it would be marked as read),
  reporting, deleting or checking anything is the maintainer's job, and so is any setting of the Google account.
  A check that would require it is recorded as "not verified", with its reason.
- Personal data stays out of tracked files and commit messages.
- Code, comments, docs and commit messages in English. Displayed text goes through `t()` (`src/i18n.js`) and lives
  in `_locales/en` and `_locales/fr`.
- Propose, then wait for agreement before any change.

## Architecture
| File | Role |
|---|---|
| `src/reporting.js` | Core: plan, run, pause, stop, lock, deletion, summary. No DOM, injected dependencies. |
| `src/registry.js` | Memory of reports: one key `reports:<account>:<id>` per conversation, purged after 30 days. |
| `src/gmail.js` | Adapter: the **only** code that drives Gmail's DOM. |
| `src/selectors.js` | The **only** place for Gmail's landmarks, all language-independent (`act` codes, roles, attributes), each with the date it was observed. |
| `src/interface.js` | Button, confirmation (deletion checkbox), progress, summary, badges, keyboard blocking. |
| `src/icon.js`, `src/styles.css` | « Signature » theme: Gmail's Material 3 shapes, the icon's red `#B32735`, brand banner at the top of dialogs. |
| `src/i18n.js`, `_locales/` | English (default) or French. Inside Gmail, Gmail's language (`<html lang>`); toolbar popup and extensions page, the browser's language. |

- Modules are loaded through `import()`, hence `web_accessible_resources` in the manifest.
- Icon PNGs are generated from the SVGs by `python icons/generate-png.py`; the 16 px SVG is drawn to the pixel.

## Design points
- Dry-run mode is kept in `chrome.storage.local` (key `dryRun`), never in the page. It finds the « Report phishing »
  item and the « Delete forever » button and stops there, without clicking them.
- Before every irreversible action: check that the displayed conversation is the right one (`conversationView(id)`),
  only accept a menu or a confirmation that **newly appeared**, and close every confirmation.
- Waits react to page modifications (`waitUntil` with a MutationObserver) and give up after 10 s.
- `use_dynamic_url` was tried, then removed: the extension no longer loaded in some Chromium browsers.
- Text coming from an email is inserted with `textContent` / `append`, never as HTML.
- Colours follow **Gmail's** theme, not the system's: `gmail.isDarkTheme()` reads the colour of the card behind the
  toolbar, and the interface puts the `gpr-dark` class on `<html>`. The toolbar popup, outside Gmail, follows the
  system theme.
- Displayed text and failure reasons exist in both catalogues with the same keys and placeholders; chrome.i18n has no
  plural rules, so singular and plural are separate keys (`…One` / `…Many`).

## Tests
- `npm test` (Node 24, `node:test`, no dependency), TDD (red, then green). The reporting core is tested with the
  doubles in `tests/fakes.js`; `tests/i18n.test.js` checks that both catalogues match and that every key used exists.
- The Gmail adapter and the interface are checked in the real Gmail by the maintainer, when the agent asks: say
  exactly what to reload and what to check.

## Release
- Bump `version` in `manifest.json`, then push a tag `v<version>`: `.github/workflows/release.yml` runs the tests,
  checks the tag against the manifest, and publishes a GitHub Release with the extension as a `.zip`.
