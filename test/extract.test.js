'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractAddressNumber } = require('../extract-core.js');
const core = require('../barcode-core.js');
const { vectors } = require('./official-vectors.json');
const official = vectors.filter(vector => vector.sourceText !== null);

// Row 1 of the extraction table contains the 17 official addresses.
for (const vector of official) {
  test(`Extract official ${vector.id}: manual ${vector.source}`, () => {
    const extracted = extractAddressNumber(vector.sourceText);
    assert.equal(extracted.result, vector.addressNumber);
    assert.deepStrictEqual(extracted.warnings, []);
    assert.equal(extracted.steps.length, 8);
  });
}

const cases = [
  ['十一丁目六番地一号', '11-6-1'],
  ['南七線', '7'],
  ['第二十一地割', '21'],
  ['四丁六番十九号', '4-6-19'],
  ['十番', '10'],
  ['6丁目7-14　ABCビル2F201号室', '6-7-14-2-201'],
  ['9-7-6-A-1-1', '9-7-6A1-1'],
  ['6-7-L-B106', '6-7LB106'],
  ['３丁目２０－５', '3-20-5'],
  ['3丁目5-　郵便ビル', '3-5-'],
  ['2FB-3', '2-3'],
  ['百二番3号', '3', 'kanji-numeral-unsupported'],
  ['二二番', '', 'kanji-numeral-unsupported']
];

cases.forEach(([input, result, warning], index) => {
  test(`Extract row ${index + 2}: ${input}`, () => {
    const extracted = extractAddressNumber(input);
    assert.equal(extracted.result, result);
    assert.deepStrictEqual(extracted.warnings, warning ? [{ code: warning }] : []);
  });
});

test('Extract steps: all eight intermediate strings match the p19 example', () => {
  const extracted = extractAddressNumber('東3丁目-20-5　郵便・A&bコーポB604号');
  assert.deepStrictEqual(extracted, {
    result: '3-20-5B604', warnings: [], steps: [
      { id: 'normalize', text: '東3丁目-20-5 郵便・A&bコーポB604号' },
      { id: 'uppercase', text: '東3丁目-20-5 郵便・A&BコーポB604号' },
      { id: 'remove-symbols', text: '東3丁目-20-5 郵便ABコーポB604号' },
      { id: 'kanji-numerals', text: '東3丁目-20-5 郵便ABコーポB604号' },
      { id: 'replace', text: '-3--20-5-B604' },
      { id: 'collapse-hyphens', text: '-3-20-5-B604' },
      { id: 'trim-leading-hyphen', text: '3-20-5-B604' },
      { id: 'join-letters', text: '3-20-5B604' }
    ]
  });
});

for (const vector of official) {
  test(`Extract integration ${vector.id}: extracted text encodes to official S and CD`, () => {
    const extracted = extractAddressNumber(vector.sourceText);
    const encoded = core.encodeAddress(vector.postalCode, extracted.result);
    assert.deepStrictEqual(encoded.chars, vector.expanded20);
    assert.equal(encoded.checkDigit, vector.checkDigit);
    assert.equal(core.explainChecksum(core.decodeBars(encoded.bars)).knownSum, vector.sum);
    assert.equal(encoded.truncated, vector.truncated);
    assert.equal(encoded.droppedCount, vector.droppedCount);
  });
}

test('Extract contract: coverage, pure UMD API, and empty input', () => {
  assert.equal(official.length, 17);
  assert.equal(cases.length, 13);
  assert.equal(globalThis.PostMirrorExtract.extractAddressNumber, extractAddressNumber);
  assert.ok(Object.isFrozen(globalThis.PostMirrorExtract));
  const extracted = extractAddressNumber('');
  assert.equal(extracted.result, '');
  assert.deepStrictEqual(extracted.warnings, []);
  assert.equal(extracted.steps.length, 8);
  assert.ok(extracted.steps.every(step => step.text === ''));
  assert.throws(() => extractAddressNumber(null), TypeError);
});

test('Extract contract: supported numerals and every designated suffix', () => {
  const nine = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const suffixes = ['丁目', '丁', '番地', '番', '号', '地割', '線', 'の', 'ノ'];
  for (const suffix of suffixes) {
    for (let number = 1; number <= 99; number += 1) {
      const tens = Math.floor(number / 10);
      const unit = number % 10;
      const kanji = (tens ? (tens === 1 ? '' : nine[tens - 1]) + '十' : '') + (unit ? nine[unit - 1] : '');
      const result = extractAddressNumber(kanji + suffix);
      assert.equal(result.result, String(number), kanji + suffix);
      assert.deepStrictEqual(result.warnings, []);
    }
  }
  for (const unit of ['百二', '〇', '千', '万', '壱', '弐', '参', '拾', '二二', '十十']) {
    const result = extractAddressNumber(unit + '番');
    assert.equal(result.result, '');
    assert.deepStrictEqual(result.warnings, [{ code: 'kanji-numeral-unsupported' }]);
  }
  assert.equal(extractAddressNumber('二階').result, '');
});

test('Extract contract: NFKC, punctuation, floor suffix, and no padding or truncation', () => {
  for (const dash of ['‐', '‑', '‒', '–', '—', '―', '−']) assert.equal(extractAddressNumber(`1${dash}2`).result, '1-2');
  for (const [text, expected] of [
    ['①番Ⅱビル3号', '1-3'], ['1&2/3・4.5', '12345'], ['1#2(3~4、5', '1-2-3-4-5'],
    ['2F', '2'], ['2F201', '2-201'], ['2F階3', '2-3'], ['2FF3', '2-3'],
    ['F2', 'F2'], ['コーポー3', '3'], ['1234567890123456', '1234567890123456']
  ]) assert.equal(extractAddressNumber(text).result, expected, text);
});
