'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const messages = require('../messages.js');
const samples = require('../samples.js');

// Keep this list identical in the README tests when that document is completed.
const FORBIDDEN = [
  '既に', '全て', '分かる', '無い', 'インターフェース', 'か所', 'に限る', '想定していない',
  '自分宛てに限', '4ステート', '〒',
  'サーバ(?!ー)', 'ユーザ(?!ー)', 'ブラウザ(?!ー)', 'パラメータ(?!ー)', 'エディタ(?!ー)',
  'フォルダ(?!ー)', 'リポジトリ(?!ー)', 'マネージャ(?!ー)'
];

test('I18n: Japanese and English keys and parameters match exactly', () => {
  const keys = Object.keys(messages.ja).sort();
  assert.ok(keys.length > 0);
  assert.deepStrictEqual(keys, Object.keys(messages.en).sort());
  const params = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const key of keys) {
    assert.equal(typeof messages.ja[key], 'string');
    assert.equal(typeof messages.en[key], 'string');
    assert.deepStrictEqual(params(messages.ja[key]), params(messages.en[key]), key);
    if (/\.(one|other)$/.test(key)) {
      assert.ok(Object.hasOwn(messages.ja, key.replace(/\.(one|other)$/, '.one')));
      assert.ok(Object.hasOwn(messages.ja, key.replace(/\.(one|other)$/, '.other')));
    }
    if (params(messages.en[key]).includes('count')) assert.match(key, /\.(one|other)$/);
  }
  for (const sample of samples.barcodes) assert.ok(Object.hasOwn(messages.ja, sample.labelKey));
});

test('I18n: application and barcode core contain no Japanese literals or punctuation', () => {
  for (const file of ['app.js', 'barcode-core.js']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(text, /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/u, file);
  }
});

test('I18n: Japanese wording follows the shared forbidden list', () => {
  for (const [key, text] of Object.entries(messages.ja)) {
    for (const word of FORBIDDEN) assert.doesNotMatch(text, new RegExp(word), `${key}: ${word}`);
  }
});

test('I18n: every static HTML message has a dictionary entry', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const keys = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.length >= 5);
  for (const key of keys) assert.ok(Object.hasOwn(messages.ja, key), key);
});

test('I18n: the official barcode spelling is used throughout the screen sources', () => {
  for (const file of ['messages.js', 'index.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /カスタマーバーコード/);
  }
});

test('I18n: both lessons have matching 13 sections and seven separate quiz groups', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const blocks = ['ja', 'en'].map(language => {
    const start = html.indexOf(`<div id="learn-${language}"`);
    const end = language === 'ja' ? html.indexOf('<div id="learn-en"') : html.indexOf('id="language-announcement"');
    return html.slice(start, end);
  });
  for (const [index, language] of ['ja', 'en'].entries()) {
    const sectionIds = [...blocks[index].matchAll(new RegExp(`<section id="learn-${language}-(\\d+)"`, 'g'))].map(match => +match[1]);
    assert.deepStrictEqual(sectionIds, Array.from({ length: 13 }, (_, index) => index + 1));
    assert.equal([...blocks[index].matchAll(/<fieldset data-quiz="\d+">/g)].length, 7);
    const names = new Set([...blocks[index].matchAll(/name="(quiz-[^"]+)"/g)].map(match => match[1]));
    assert.deepStrictEqual([...names], Array.from({ length: 7 }, (_, index) => `quiz-${language}-${index + 1}`));
  }
  for (const word of FORBIDDEN) assert.doesNotMatch(blocks[0], new RegExp(word), word);
});
