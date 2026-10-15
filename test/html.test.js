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
  for (const id of ['bar-grid', 'bar-palette', 'bar-text', 'sample-select', 'result', 'inspection']) {
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

test('HTML: exact restrictive CSP, referrer, bilingual noscript and empty favicon', () => {
  const csp = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html)[1];
  assert.equal(csp, "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; base-uri 'none'; "
    + "form-action 'none'; frame-src 'none'; object-src 'none'; connect-src 'none'");
  assert.doesNotMatch(csp, /frame-ancestors/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.match(html, /<link rel="icon" href="data:,">/);
  const noScript = /<noscript>([\s\S]+?)<\/noscript>/.exec(html)[1];
  assert.match(noScript, /lang="ja"/);
  assert.match(noScript, /lang="en"/);
  assert.doesNotMatch(html, /〒/);
});

test('HTML: accessible tabs and the breakdown within details', () => {
  for (const id of ['tab-decode', 'tab-learn', 'panel-decode', 'panel-learn', 'lang-toggle']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
  assert.match(html, /role="tablist"/);
  for (const name of ['decode', 'learn']) {
    assert.match(html, new RegExp(`id="tab-${name}"[^>]+role="tab"[^>]+aria-controls="panel-${name}"`));
    assert.match(html, new RegExp(`id="panel-${name}"[^>]+role="tabpanel"[^>]+aria-labelledby="tab-${name}"`));
  }
  const details = /<details id="breakdown-details">([\s\S]+?)<\/details>/.exec(html)[1];
  assert.match(details, /<summary data-i18n="breakdown.summary">/);
  assert.match(details, /<table id="breakdown">/);
  assert.doesNotMatch(details, /id="(?:inspection|checksum)"/);
  assert.ok(read('style.css').replace(/\s/g, '').includes('[hidden]{display:none!important;}'));
});

test('HTML: Japanese sample annotations match the public examples and Q2 choices', () => {
  const samples = require('../samples.js');
  const allowed = new Set([...samples.extraction.map(sample => sample.addressB), samples.question2.addressB, ...samples.question2.choices]);
  const elements = [...html.matchAll(/<span\b([^>]*\bdata-ja-sample[^>]*)>([^<]*)<\/span>/g)];
  assert.ok(elements.length >= 10);
  for (const [, attributes, value] of elements) {
    assert.match(attributes, /lang="ja"/);
    if (attributes.includes('data-extract-text')) {
      assert.equal(value, '');
      continue;
    }
    assert.ok(allowed.has(value.replace(/&amp;/g, '&')), value);
  }
});

test('HTML: external links use the approved URLs and isolated new tabs', () => {
  const pages = ['06', '10', '11', '12', '13', '17', '18', '19', '20', '21', '22', '23', '25'];
  const allowed = new Set([
    ...pages.map(page => `https://www.post.japanpost.jp/service/search/zipcode/zipmanual/p${page}.html`),
    'https://www.post.japanpost.jp/service/discount/barcode.html',
    ...['image-exif-checker', 'image-diff-sec', 'qr-risk-radar'].map(slug => `https://ipusiron.github.io/${slug}/`)
  ]);
  const links = [...html.matchAll(/<a\b([^>]+)>/g)];
  assert.equal(links.length, allowed.size * 2);
  for (const [, attributes] of links) {
    const href = /href="([^"]+)"/.exec(attributes)?.[1];
    assert.ok(allowed.has(href), href);
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
  }
});
