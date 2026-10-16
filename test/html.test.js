'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const html = read('index.html');
const app = read('app.js');

test('HTML: six local deferred classic scripts in dependency order', () => {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 6);
  assert.deepStrictEqual(scripts.map(match => /src="([^"]+)"/.exec(match[1])?.[1]), [
    'barcode-core.js', 'extract-core.js', 'image-core.js', 'samples.js', 'messages.js', 'app.js'
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
  assert.doesNotMatch(app, /\blocation(?:\.\w+)?\s*=(?!=)|\blocation(?:\.\w+)?\.(?:assign|replace)\s*\(/);
  assert.doesNotMatch(app, /\bsendBeacon\b|\bEventSource\b/);
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
  for (const id of ['tab-decode', 'tab-lab', 'tab-learn', 'tab-quiz', 'panel-decode', 'panel-lab', 'panel-learn', 'panel-quiz', 'lang-toggle']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
  assert.match(html, /role="tablist"/);
  for (const name of ['decode', 'lab', 'learn', 'quiz']) {
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
  assert.equal(elements.length, [...html.matchAll(/\bdata-ja-sample\b/g)].length);
  for (const [, attributes, value] of elements) {
    assert.match(attributes, /lang="ja"/);
    if (attributes.includes('data-extract-text')) {
      assert.equal(value, '');
      continue;
    }
    assert.ok(allowed.has(value.replace(/&amp;/g, '&')), value);
  }
});

test('HTML: both symbol-table renderers include a textual bar pattern in each row', () => {
  assert.match(app, /bars\.append\(lessonSvg\(symbol\.bars, 'figure\.symbols'\), node\('bdi', symbol\.bars\.join\(' '\)\)\)/);
  assert.match(app, /bars\.append\(lessonSvg\(pattern, 'figure\.letters'\), node\('bdi', pattern\.join\(' '\)\)\)/);
  assert.match(app, /container\.append\(bands, node\('p', translate\('overview\.legend'\), 'legend'\)\)/);
});

test('HTML: external links use the approved URLs and isolated new tabs', () => {
  const pages = ['06', '10', '11', '12', '13', '17', '18', '19', '20', '21', '22', '23', '25'];
  const allowed = new Map([
    ...pages.map(page => `https://www.post.japanpost.jp/service/search/zipcode/zipmanual/p${page}.html`),
    'https://www.post.japanpost.jp/service/discount/barcode.html',
    ...['image-exif-checker', 'image-diff-sec', 'qr-risk-radar'].map(slug => `https://ipusiron.github.io/${slug}/`)
  ].map(url => [url, 2]));
  allowed.set('https://github.com/ipusiron/postmirror', 1);
  const links = [...html.matchAll(/<a\b([^>]+)>/g)];
  assert.equal(links.length, [...allowed.values()].reduce((sum, count) => sum + count, 0));
  const actual = new Map();
  for (const [, attributes] of links) {
    const href = /href="([^"]+)"/.exec(attributes)?.[1];
    assert.ok(allowed.has(href), href);
    actual.set(href, (actual.get(href) || 0) + 1);
    assert.match(attributes, /target="_blank"/);
    assert.match(attributes, /rel="noopener noreferrer"/);
  }
  assert.deepStrictEqual(actual, allowed);
});

test('HTML: image experiments use accessible canvases and one local file input', () => {
  for (const id of ['lab-sample', 'lab-mask', 'lab-character', 'lab-canvas', 'lab-status', 'lab-known', 'lab-judgment', 'lab-transfer']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
  }
  assert.match(html, /<canvas[^>]+id="lab-canvas"[^>]+role="img"/);
  assert.match(app, /setAttribute\('aria-label', translate\('lab\.canvas'/);
  const files = [...html.matchAll(/<input\b[^>]*type="file"[^>]*>/g)];
  assert.equal(files.length, 1);
  assert.match(files[0][0], /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(files[0][0], /\s(?:capture|multiple)(?:\s|=|>)/i);
  assert.doesNotMatch(html, /<img[^>]+src="blob:/);
  for (const id of ['photo-overview', 'photo-zoom', 'photo-result']) {
    assert.equal([...html.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1);
    assert.match(html, new RegExp(`<canvas[^>]+id="${id}"[^>]+role="img"`));
  }
  assert.doesNotMatch(app, /\.(?:capture|multiple)\s*=/);
  assert.doesNotMatch(app, /setAttribute\(\s*['"](?:capture|multiple)['"]/);
  assert.doesNotMatch(app, /createObjectURL|toDataURL|toBlob|getUserMedia/);
});
