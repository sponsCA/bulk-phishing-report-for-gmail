import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { localeFor, format } from '../src/i18n.js';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');
const catalogue = (locale) => JSON.parse(read(`_locales/${locale}/messages.json`));
const LOCALES = ['en', 'fr'];

// Keys used by the code: t('key', …) in the scripts, data-i18n="key" in the popup, __MSG_key__ in the manifest.
function usedKeys() {
  const sources = [
    ...readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js')).map((f) => read(`src/${f}`)),
    read('popup/popup.js'),
  ].join('\n');
  return new Set([
    ...[...sources.matchAll(/\bt\('([A-Za-z0-9_]+)'/g)].map((m) => m[1]),
    ...[...read('popup/popup.html').matchAll(/data-i18n="([A-Za-z0-9_]+)"/g)].map((m) => m[1]),
    ...[...read('manifest.json').matchAll(/__MSG_([A-Za-z0-9_]+)__/g)].map((m) => m[1]),
  ]);
}

test('the manifest declares English as the default locale', () => {
  assert.equal(JSON.parse(read('manifest.json')).default_locale, 'en');
});

test('English and French catalogues have the same keys', () => {
  assert.deepEqual(Object.keys(catalogue('fr')).sort(), Object.keys(catalogue('en')).sort());
});

test('each message has the same placeholders in both languages, all of them used', () => {
  for (const [key, english] of Object.entries(catalogue('en'))) {
    const french = catalogue('fr')[key];
    assert.deepEqual(french.placeholders ?? {}, english.placeholders ?? {}, key);
    for (const locale of LOCALES) {
      const message = catalogue(locale)[key].message;
      for (const name of Object.keys(english.placeholders ?? {})) {
        assert.ok(message.includes(`$${name}$`), `${locale}/${key} does not use $${name}$`);
      }
    }
  }
});

test('every key used by the code exists, and every key in the catalogue is used', () => {
  const used = usedKeys();
  const defined = new Set(Object.keys(catalogue('en')));
  assert.deepEqual([...used].filter((k) => !defined.has(k)), [], 'used but not defined');
  assert.deepEqual([...defined].filter((k) => !used.has(k)), [], 'defined but not used');
});

test('no French text is left hard-coded in the scripts, the popup or the manifest', () => {
  const files = [
    ...readdirSync(new URL('src/', root)).filter((f) => f.endsWith('.js')).map((f) => `src/${f}`),
    'popup/popup.js',
    'popup/popup.html',
    'manifest.json',
  ];
  for (const file of files) {
    const withoutComments = read(file).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.doesNotMatch(withoutComments, /[éèàùçêôî]/, file);
  }
});

test("Gmail's page language picks the catalogue: French or English, English for any other language", () => {
  assert.equal(localeFor('fr'), 'fr');
  assert.equal(localeFor('fr-CA'), 'fr');
  assert.equal(localeFor('en-GB'), 'en');
  assert.equal(localeFor('de'), 'en');
  assert.equal(localeFor(''), 'en');
  assert.equal(localeFor(undefined), 'en');
});

test('a message is formatted with its placeholders, in order', () => {
  assert.equal(format(catalogue('en').progress, [3, 10]), '3/10 processed…');
  assert.equal(format(catalogue('fr').afterSeconds, ['Menu introuvable', 10]), 'Menu introuvable (après 10 s)');
  assert.equal(format(catalogue('fr').close, []), 'Fermer');
});

test('every message of both catalogues formats without a leftover placeholder', () => {
  for (const locale of LOCALES) {
    for (const [key, entry] of Object.entries(catalogue(locale))) {
      const values = Object.keys(entry.placeholders ?? {}).map((_, i) => `value${i + 1}`);
      assert.doesNotMatch(format(entry, values), /\$/, `${locale}/${key}`);
    }
  }
});
