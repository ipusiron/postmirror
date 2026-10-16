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
  for (const file of ['app.js', 'barcode-core.js', 'image-core.js']) {
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
  const keys = [...html.matchAll(/data-i18n(?:-label)?="([^"]+)"/g)].map(match => match[1]);
  assert.ok(keys.length >= 5);
  for (const key of keys) assert.ok(Object.hasOwn(messages.ja, key), key);
});

test('I18n: the official barcode spelling is used throughout the screen sources', () => {
  for (const file of ['messages.js', 'index.html']) {
    assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /カスタマーバーコード/);
  }
  for (const language of ['ja', 'en']) {
    for (const [key, value] of Object.entries(messages[language])) {
      assert.doesNotMatch(value, /カスタマーバーコード/, `${language}.${key}`);
    }
  }
});

test('I18n: bar names use the translated official terminology', () => {
  assert.deepStrictEqual([1, 2, 3, 4].map(value => messages.en[`shape.${value}`]), [
    'Long bar', 'Semi-long bar (upper)', 'Semi-long bar (lower)', 'Timing bar'
  ]);
  for (const value of Object.values(messages.en)) assert.doesNotMatch(value, /Full bar|Ascender|Descender|Tracker/);
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /Full bar|Ascender|Descender|Tracker/);
});

test('I18n: overview symbols and shape separators come from the dictionary', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /(['"`])[SCE]\1/);
  for (const language of ['ja', 'en']) {
    for (const [section, symbol] of [['start', 'S'], ['cd', 'C'], ['stop', 'E']]) {
      assert.equal(messages[language][`overview.symbol.${section}`], symbol);
    }
    assert.match(messages[language]['figure.shapeLabel'], /\{value\}.*\{name\}/);
  }
  assert.match(app, /translate\('figure\.shapeLabel'/);
});

function languageBlock(html, id) {
  const start = html.indexOf(`<div id="${id}"`);
  const end = html.indexOf(`<!-- /${id} -->`, start);
  assert.ok(start >= 0 && end > start, id);
  return html.slice(start, end);
}

test('I18n: English text has no Japanese outside the explicit sample spans', () => {
  const japanese = /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/u;
  for (const [key, value] of Object.entries(messages.en)) {
    if (key !== 'language.target') assert.doesNotMatch(value, japanese, key);
  }
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  for (const id of ['learn-en', 'quiz-en']) {
    const english = languageBlock(html, id).replace(/<span\b[^>]*\bdata-ja-sample[^>]*>[^<]*<\/span>/g, '');
    assert.doesNotMatch(english, japanese, id);
  }
});

test('I18n: both lessons have 12 sections and both quiz panels have seven distinct groups', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const allNames = [];
  for (const language of ['ja', 'en']) {
    const learn = languageBlock(html, `learn-${language}`);
    const quiz = languageBlock(html, `quiz-${language}`);
    const sections = [...learn.matchAll(new RegExp(`<section id="learn-${language}-(\\d+)"`, 'g'))].map(match => +match[1]);
    assert.deepStrictEqual(sections, Array.from({ length: 12 }, (_, index) => index + 1));
    assert.equal([...learn.matchAll(/data-quiz="\d+"/g)].length, 0);
    assert.equal([...quiz.matchAll(/<fieldset data-quiz="\d+"/g)].length, 7);
    const names = [...new Set([...quiz.matchAll(/name="(quiz-[^"]+)"/g)].map(match => match[1]))];
    assert.deepStrictEqual(names, Array.from({ length: 7 }, (_, index) => `quiz-${language}-${index + 1}`));
    allNames.push(...names);
    if (language === 'ja') {
      for (const word of FORBIDDEN) assert.doesNotMatch(learn + quiz, new RegExp(word), word);
    }
  }
  assert.equal(new Set(allNames).size, 14);
});

test('I18n: neutral inspection labels and language-specific separators', () => {
  for (const file of ['messages.js', 'index.html']) {
    const text = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.doesNotMatch(text, /隠せた|■\s*Hidden| — /u, file);
  }
  assert.equal(messages.en['inspection.sectionAddress'], 'address number');
  assert.match(messages.ja['learn.stage'], /：/);
  assert.match(messages.en['learn.stage'], /: /);
});
