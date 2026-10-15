'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('index.html');
const app = read('app.js');

test('HTML: five local deferred classic scripts in dependency order', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 5);
  assert.deepStrictEqual(scripts.map(match => /src="([^"]+)"/.exec(match[1])?.[1]), [
    'barcode-core.js', 'extract-core.js', 'samples.js', 'messages.js', 'app.js'
  ]);
  for (const [, attributes, body] of scripts) {
    assert.match(attributes, /\bdefer\b/);
    assert.doesNotMatch(attributes, /\btype\s*=/);
    assert.equal(body.trim(), '');
  }
});

test('HTML: no inline handlers, styles, or unsafe DOM insertion', () => {
  assert.doesNotMatch(html, /\s(?:on\w+|style)\s*=/i);
  assert.doesNotMatch(html + app, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('HTML: input IDs are unique and text entry does not opt into form persistence', () => {
  for (const id of ['bar-grid', 'bar-palette', 'bar-text', 'sample-select']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
  const textarea = /<textarea\b[^>]*id="bar-text"[^>]*>/.exec(html)[0];
  assert.doesNotMatch(html, /<form\b/i);
  assert.doesNotMatch(textarea, /\bname\s*=/i);
  for (const attribute of ['autocomplete="off"', 'spellcheck="false"', 'autocapitalize="off"']) {
    assert.ok(textarea.includes(attribute));
  }
});

test('HTML: no result persistence, URL writes, clipboard API, or script networking', () => {
  assert.doesNotMatch(app, /sessionStorage|indexedDB|document\.cookie|history\.(?:pushState|replaceState)/);
  assert.doesNotMatch(app, /location\.hash\s*=|navigator\.clipboard|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bWorker\s*\(/);
  const storageCalls = [...app.matchAll(/localStorage\.(?:getItem|setItem|removeItem)\(\s*['"]([^'"]+)['"]/g)];
  for (const call of storageCalls) assert.equal(call[1], 'postmirror.lang');
  const references = [...app.matchAll(/localStorage/g)];
  assert.equal(references.length, storageCalls.length);
});
