// Rebuilds assets/embedded-data.js from i18n/*.json and the mock data.
// Run after every change to those files: node tools/build-embed.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const read = p => JSON.parse(readFileSync(new URL('../' + p, import.meta.url), 'utf8'));
const bag = { it:read('i18n/it.json'), en:read('i18n/en.json'), data:read('data/flexidata_mock_data.json') };
writeFileSync(new URL('../assets/embedded-data.js', import.meta.url),
  '/* Copia di i18n/*.json e data/flexidata_mock_data.json, generata da tools/build-embed.mjs. Usata solo se fetch fallisce (apertura diretta di index.html). */\n'
  + 'window.__FLEX_EMBED__=' + JSON.stringify(bag) + ';\n');
console.log('embedded-data.js rebuilt');
