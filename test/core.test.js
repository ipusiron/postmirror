'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../barcode-core.js');
const { vectors } = require('./official-vectors.json');

// Independent transcription of Japan Post manual p11, image/p12-1.gif.
const REFERENCE = [
  { id: '0', bars: [1, 4, 4], value: 0 },
  { id: '1', bars: [1, 1, 4], value: 1 },
  { id: '2', bars: [1, 3, 2], value: 2 },
  { id: '3', bars: [3, 1, 2], value: 3 },
  { id: '4', bars: [1, 2, 3], value: 4 },
  { id: '5', bars: [1, 4, 1], value: 5 },
  { id: '6', bars: [3, 2, 1], value: 6 },
  { id: '7', bars: [2, 1, 3], value: 7 },
  { id: '8', bars: [2, 3, 1], value: 8 },
  { id: '9', bars: [4, 1, 1], value: 9 },
  { id: '-', bars: [4, 1, 4], value: 10 },
  { id: 'CC1', bars: [3, 2, 4], value: 11 },
  { id: 'CC2', bars: [3, 4, 2], value: 12 },
  { id: 'CC3', bars: [2, 3, 4], value: 13 },
  { id: 'CC4', bars: [4, 3, 2], value: 14 },
  { id: 'CC5', bars: [2, 4, 3], value: 15 },
  { id: 'CC6', bars: [4, 2, 3], value: 16 },
  { id: 'CC7', bars: [4, 4, 1], value: 17 },
  { id: 'CC8', bars: [1, 1, 1], value: 18 }
];
const byId = new Map(REFERENCE.map(symbol => [symbol.id, symbol]));
const digits = REFERENCE.slice(0, 10).map(symbol => symbol.id);
const addressIds = REFERENCE.slice(0, 15).map(symbol => symbol.id);
const kasumigaseki = vectors.find(vector => vector.id === 17);

function referenceBars(vector) {
  if (vector.bars67 !== null) return vector.bars67.split(/\s+/).flatMap(group => [...group].map(Number));
  return [1, 3, ...[...vector.expanded20, vector.checkDigit].flatMap(id => byId.get(id).bars), 3, 1];
}

const original = referenceBars(kasumigaseki);
const symbols = result => result.chars.map(char => char.symbol);
const codes = (result, severity) => new Set(result.issues.filter(issue =>
  severity ? issue.severity === severity : issue.severity !== 'info').map(issue => issue.code));

function check(result, status, expectedCodes = []) {
  assert.equal(result.status, status);
  assert.deepStrictEqual(codes(result), new Set(expectedCodes));
}

function replaceChar(bars, index, pattern) {
  const result = bars.slice();
  result.splice(2 + 3 * index, 3, ...pattern);
  return result;
}

function customAddress(ids) {
  const address = [...ids, ...Array(13 - ids.length).fill('CC4')];
  return core.decodeBars(core.encodeChars([...'1000013', ...address]).bars);
}

test('Reference: 19 independent symbols, constants, and deeply frozen public data', () => {
  assert.deepStrictEqual(core.SYMBOLS, REFERENCE);
  assert.deepStrictEqual(core.START, [1, 3]);
  assert.deepStrictEqual(core.STOP, [3, 1]);
  assert.deepStrictEqual([core.BAR_COUNT, core.CHAR_COUNT, core.POSTAL_LENGTH, core.ADDRESS_LENGTH], [67, 21, 7, 13]);
  assert.deepStrictEqual(core.POSITION_CANDIDATES, { postal: digits, address: addressIds, cd: REFERENCE.map(item => item.id) });
  assert.deepStrictEqual(core.GEOMETRY, {
    longBar: 6, semiLongBar: 4, timingBar: 2, pitch: 2, barWidth: 1,
    space: 1, unitMmAt10pt: 0.6, semiLongBarInferred: true
  });
  const frozen = value => {
    if (!value || typeof value !== 'object') return;
    assert.ok(Object.isFrozen(value));
    for (const nested of Object.values(value)) frozen(nested);
  };
  frozen(core);
  assert.equal(globalThis.PostMirrorCore, core);
  assert.equal(vectors.length, 21);
  assert.deepStrictEqual(vectors.map(vector => vector.id), Array.from({ length: 21 }, (_, i) => i + 1));
  assert.equal(vectors.filter(vector => vector.bars67 !== null).length, 9);
});

for (const vector of vectors) {
  test(`Official ${vector.id}: symbols, checksum, display, and information`, () => {
    const encoded = core.encodeAddress(vector.postalCode, vector.addressNumber);
    assert.deepStrictEqual(encoded.chars, vector.expanded20);
    assert.equal(encoded.checkDigit, vector.checkDigit);
    assert.equal(encoded.bars.length, 67);
    assert.equal(encoded.truncated, vector.truncated);
    assert.equal(encoded.droppedCount, vector.droppedCount);
    assert.equal(encoded.chars.reduce((sum, id) => sum + byId.get(id).value, 0), vector.sum);
    const decoded = core.decodeBars(referenceBars(vector));
    check(decoded, 'ok');
    assert.deepStrictEqual(symbols(decoded), [...vector.expanded20, vector.checkDigit]);
    assert.equal(decoded.postalCode.display, vector.displayPostal);
    assert.equal(decoded.addressNumber.text, vector.displayAddress);
    assert.deepStrictEqual(codes(decoded, 'info'), new Set(vector.info));
    assert.equal(decoded.addressNumber.paddingCount, vector.expanded20.slice(7).filter(id => id === 'CC4').length);
    assert.equal(core.explainChecksum(decoded).knownSum, vector.sum);
  });
}

for (const vector of vectors.filter(item => item.bars67 !== null)) {
  test(`Bars ${vector.id}: independent full 67-bar reference and grouped output`, () => {
    const expected = vector.bars67.split(/\s+/).flatMap(group => [...group].map(Number));
    assert.equal(expected.length, 67);
    const encoded = core.encodeAddress(vector.postalCode, vector.addressNumber);
    assert.deepStrictEqual(encoded.bars, expected);
    assert.equal(core.formatBarText(encoded.bars, { group: true }), vector.bars67);
  });
}

test('State 01: every single hidden character is restored in all 441 cases', () => {
  let count = 0;
  for (const vector of vectors) {
    for (let index = 0; index < 21; index += 1) {
      const decoded = core.decodeBars(core.maskChars(referenceBars(vector), [index]));
      check(decoded, 'recovered');
      assert.equal(decoded.chars[index].status, 'recovered');
      assert.deepStrictEqual(symbols(decoded), [...vector.expanded20, vector.checkDigit]);
      assert.equal(decoded.checksum.combinations, 1n);
      count += 1;
    }
  }
  assert.equal(count, 441);
});

test('State 02: every single hidden data bar retains all 21 symbols in 1323 cases', () => {
  let count = 0;
  for (const vector of vectors) {
    for (let index = 2; index < 65; index += 1) {
      const bars = referenceBars(vector);
      bars[index] = null;
      const decoded = core.decodeBars(bars);
      assert.ok(['ok', 'recovered'].includes(decoded.status));
      assert.deepStrictEqual(codes(decoded), new Set());
      assert.deepStrictEqual(symbols(decoded), [...vector.expanded20, vector.checkDigit]);
      count += 1;
    }
  }
  assert.equal(count, 1323);
});

test('State 03: hidden characters 2 and 3 have one assignment', () => {
  const decoded = core.decodeBars(core.maskChars(original, [2, 3]));
  check(decoded, 'recovered');
  assert.equal(decoded.checksum.combinations, 1n);
  assert.deepStrictEqual(decoded.checksum.assignments, [['0', '0']]);
  for (const index of [2, 3]) assert.deepStrictEqual([decoded.chars[index].status, decoded.chars[index].symbol], ['recovered', '0']);
});

test('State 04: hidden characters 5 and 6 have five ordered assignments', () => {
  const decoded = core.decodeBars(core.maskChars(original, [5, 6]));
  check(decoded, 'undetermined');
  assert.equal(decoded.checksum.combinations, 5n);
  assert.deepStrictEqual(decoded.chars[5].possible, ['0', '1', '2', '3', '4']);
  assert.deepStrictEqual(decoded.checksum.assignments, [['0', '4'], ['1', '3'], ['2', '2'], ['3', '1'], ['4', '0']]);
});

for (const [number, indexes, combinations] of [[5, [0, 1], 2n], [6, [7, 8], 12n], [7, [6, 20], 10n]]) {
  test(`State ${String(number).padStart(2, '0')}: hidden ${indexes} has ${combinations} combinations`, () => {
    const decoded = core.decodeBars(core.maskChars(original, indexes));
    check(decoded, 'undetermined');
    assert.equal(decoded.checksum.combinations, combinations);
    assert.equal(decoded.checksum.assignments.length, Number(combinations));
  });
}

test('State 08: all seven postal characters have 501529 combinations', () => {
  const decoded = core.decodeBars(core.maskChars(original, [0, 1, 2, 3, 4, 5, 6]));
  check(decoded, 'undetermined');
  assert.equal(decoded.checksum.combinations, 501529n);
  assert.equal(decoded.checksum.assignments, null);
  for (const char of decoded.chars.slice(0, 7)) assert.deepStrictEqual(char.possible, digits);
});

test('State 09: hidden last address character does not imply address-full', () => {
  const decoded = core.decodeBars(core.maskChars(referenceBars(vectors[14]), [19, 20]));
  check(decoded, 'undetermined');
  assert.equal(codes(decoded, 'info').has('address-full'), false);
});

test('State 10: 66 and 68 bars produce the complete empty result shape', () => {
  for (const bars of [original.slice(0, -1), [...original, 1]]) {
    assert.deepStrictEqual(core.decodeBars(bars), {
      status: 'invalid', barCount: bars.length, startStop: null, chars: [],
      checksum: { status: 'not-checked', knownSum: null, unknownCount: null, combinations: null, assignments: null },
      checkDigit: null, postalCode: null, addressNumber: null,
      issues: [{ code: 'bar-count', severity: 'error', count: bars.length }], alternatives: []
    });
  }
});

test('State 11: 214 is an invalid pattern', () => {
  const decoded = core.decodeBars(replaceChar(original, 0, [2, 1, 4]));
  check(decoded, 'invalid', ['invalid-pattern']);
  assert.deepStrictEqual(decoded.issues, [{ code: 'invalid-pattern', severity: 'error', charIndex: 0 }]);
  assert.equal(decoded.checksum.status, 'not-checked');
  assert.deepStrictEqual(decoded.chars[0], {
    index: 0, section: 'postal', bars: [2, 1, 4], status: 'invalid-pattern', partial: false,
    symbol: null, value: null, candidates: [], possible: []
  });
});

test('State 12: replacing character 0 with 2 fails the checksum', () => {
  check(core.decodeBars(replaceChar(original, 0, [1, 3, 2])), 'invalid', ['checksum-mismatch']);
});

test('State 13: a fully read non-digit in the postal section is preserved and rejected', () => {
  const chars = kasumigaseki.expanded20.slice();
  chars[0] = 'CC4';
  const decoded = core.decodeBars(core.encodeChars(chars).bars);
  check(decoded, 'invalid', ['postal-not-digit']);
  assert.equal(decoded.checksum.status, 'ok');
  assert.equal(decoded.chars[0].symbol, 'CC4');
});

for (const [number, transform, expected] of [
  [14, 'rotate180', ['orientation', 'postal-not-digit', 'checksum-mismatch']],
  [15, 'flip', ['orientation', 'checksum-mismatch']],
  [16, 'reverse', ['postal-not-digit', 'checksum-mismatch']]
]) {
  test(`State ${number}: ${transform} is reported without automatic correction`, () => {
    const decoded = core.decodeBars(core.transformBars(original, transform));
    check(decoded, 'invalid', expected);
    assert.deepStrictEqual(decoded.alternatives, [{ transform, status: 'ok' }]);
  });
}

test('State 17: reverse also suggests a recoverable alternative', () => {
  const decoded = core.decodeBars(core.transformBars(core.maskChars(original, [10]), 'reverse'));
  assert.equal(decoded.status, 'invalid');
  assert.ok(decoded.alternatives.some(item => item.transform === 'reverse' && item.status === 'recovered'));
});

test('State 18: mismatched start bar reports its exact position', () => {
  const bars = original.slice();
  bars[0] = 4;
  const decoded = core.decodeBars(bars);
  check(decoded, 'invalid', ['start-stop']);
  assert.deepStrictEqual(decoded.issues, [{ code: 'start-stop', severity: 'error', barIndex: 0 }]);
});

test('State 19: hidden start bars preserve decoded content and warn', () => {
  const bars = original.slice();
  bars[0] = bars[1] = null;
  const decoded = core.decodeBars(bars);
  check(decoded, 'ok', ['start-stop-unknown']);
  assert.equal(decoded.startStop, 'unknown');
});

for (const [number, ids, expected, display] of [
  [20, ['CC5'], ['reserved-cc'], '[CC5]'],
  [21, ['1', 'CC4', '2'], ['cc4-middle'], '1[CC4]2'],
  [22, ['CC1', '-', '1'], ['letter-incomplete'], '[CC1]-1'],
  [23, ['CC3', '7'], ['letter-undefined'], '[CC3+7]'],
  [24, ['-', '1'], ['leading-hyphen'], '-1'],
  [25, ['1', '-', '-', '2'], ['double-hyphen'], '1--2'],
  [26, ['1', '-', 'CC1', '0'], ['hyphen-next-to-letter'], '1-A']
]) {
  test(`State ${number}: ${expected[0]}`, () => {
    const decoded = customAddress(ids);
    check(decoded, 'ok', expected);
    assert.equal(decoded.addressNumber.text, display);
  });
}

test('State 27: hyphen before padding is information rather than a warning', () => {
  const decoded = customAddress(['1', '-']);
  check(decoded, 'ok');
  assert.deepStrictEqual(codes(decoded, 'info'), new Set(['hyphen-before-padding']));
});

test('State 28: a synthetic mirror ambiguity remains an uncorrected valid result', () => {
  const encoded = core.encodeAddress('1234567', '1-2-3-1111118');
  const decoded = core.decodeBars(encoded.bars);
  check(decoded, 'ok', ['mirror-ambiguous']);
  assert.equal(encoded.checkDigit, 'CC7');
  assert.deepStrictEqual(codes(decoded, 'info'), new Set(['address-full']));
  assert.deepStrictEqual(decoded.alternatives, []);
  const reversed = core.decodeBars(core.transformBars(encoded.bars, 'reverse'));
  assert.equal(reversed.status, 'ok');
  assert.equal(reversed.postalCode.digits, '0299999');
  assert.equal(reversed.addressNumber.text, '9-7-8-9345678');
  assert.equal(reversed.checkDigit.symbol, '9');
});

test('State 29: synthetic business reply bulk number', () => {
  const decoded = core.decodeBars(core.encodeAddress('0008790', '001').bars);
  check(decoded, 'ok');
  assert.deepStrictEqual(codes(decoded, 'info'), new Set(['business-reply-bulk']));
});

test('State 30: a hidden CD can absorb another read error', () => {
  const bars = core.maskChars(original, [20]);
  bars[3] = 4;
  const decoded = core.decodeBars(bars);
  check(decoded, 'recovered');
  assert.deepStrictEqual([decoded.chars[20].status, decoded.checkDigit.symbol], ['recovered', '-']);
  assert.equal(decoded.postalCode.display, '000-0013');
});

function mulberry32(seed) {
  return function () {
    let value = seed += 0x6d2b79f5;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function randomChars(random) {
  return Array.from({ length: 20 }, (_, i) => REFERENCE[Math.floor(random() * (i < 7 ? 10 : 15))].id);
}

test('Property 01: 1000 seeded round trips retain symbols and textual bars', () => {
  const random = mulberry32(0x1152026);
  for (let i = 0; i < 1000; i += 1) {
    const chars = randomChars(random);
    const expectedCD = REFERENCE[(19 - chars.reduce((sum, id) => sum + byId.get(id).value, 0) % 19) % 19].id;
    const encoded = core.encodeChars(chars);
    const decoded = core.decodeBars(encoded.bars);
    assert.equal(decoded.status, 'ok');
    assert.deepStrictEqual(symbols(decoded), [...chars, expectedCD]);
    for (const group of [true, false]) {
      assert.deepStrictEqual(core.parseBarText(core.formatBarText(encoded.bars, { group })), { bars: encoded.bars, errors: [] });
    }
  }
});

test('Property 02: 171 symbol mutations split into 141 invalid and 30 other symbols', () => {
  let invalid = 0;
  let other = 0;
  for (const reference of REFERENCE) {
    const chars = [...kasumigaseki.expanded20];
    const base = [1, 3, ...chars.flatMap(id => byId.get(id).bars), ...reference.bars, 3, 1];
    for (let position = 0; position < 3; position += 1) {
      for (let bar = 1; bar <= 4; bar += 1) {
        if (bar === reference.bars[position]) continue;
        const changed = base.slice();
        changed[62 + position] = bar;
        const char = core.decodeBars(changed).chars[20];
        if (char.status === 'invalid-pattern') invalid += 1;
        else {
          assert.notEqual(char.symbol, reference.id);
          other += 1;
        }
      }
    }
  }
  assert.deepStrictEqual([invalid, other], [141, 30]);
});

test('Property 03: all 4221 full-barcode single-bar mutations are detected', () => {
  let count = 0;
  for (const vector of vectors) {
    const base = referenceBars(vector);
    for (let index = 0; index < 67; index += 1) {
      for (let bar = 1; bar <= 4; bar += 1) {
        if (bar === base[index]) continue;
        const changed = base.slice();
        changed[index] = bar;
        assert.equal(core.decodeBars(changed).status, 'invalid', `${vector.id}/${index}/${bar}`);
        count += 1;
      }
    }
  }
  assert.equal(count, 4221);
});

test('Property 04: 57 partial symbols contain 27 direct reads, nine at each position', () => {
  const counts = [0, 0, 0];
  let pairs = 0;
  for (const reference of REFERENCE) {
    for (let position = 0; position < 3; position += 1) {
      const bars = original.slice();
      bars.splice(62, 3, ...reference.bars);
      bars[62 + position] = null;
      const char = core.decodeBars(bars).chars[20];
      const expected = REFERENCE.filter(item => item.bars.every((bar, i) => i === position || bar === reference.bars[i]));
      assert.deepStrictEqual(char.candidates, expected.map(item => item.id));
      if (char.status === 'read') counts[position] += 1;
      if (char.candidates.length === 2) pairs += 1;
    }
  }
  assert.deepStrictEqual(counts, [9, 9, 9]);
  assert.equal(pairs, 30);
});

test('Property 05: exchanging characters 6 and 7 does not change the checksum', () => {
  const changed = original.slice();
  changed.splice(20, 6, ...original.slice(23, 26), ...original.slice(20, 23));
  assert.equal(core.decodeBars(changed).status, 'ok');
});

test('Property 06: transformations are involutions and rotation composes reverse and flip', () => {
  for (const bars of [original, [1, 2, 3, 4, null], []]) {
    for (const kind of ['reverse', 'flip', 'rotate180']) {
      assert.deepStrictEqual(core.transformBars(core.transformBars(bars, kind), kind), bars);
    }
    assert.deepStrictEqual(core.transformBars(bars, 'rotate180'), core.transformBars(core.transformBars(bars, 'reverse'), 'flip'));
  }
});

test('Property 07: all 19 patterns are closed under reverse and flip', () => {
  const patterns = new Set(REFERENCE.map(item => item.bars.join('')));
  for (const item of REFERENCE) {
    for (const transform of ['reverse', 'flip']) assert.ok(patterns.has(core.transformBars(item.bars, transform).join('')));
  }
});

test('Property 08: 1000 seeded checksums are valid symbols with independent values', () => {
  const random = mulberry32(0xcd115);
  for (let i = 0; i < 1000; i += 1) {
    const chars = Array.from({ length: 20 }, () => REFERENCE[Math.floor(random() * 19)].id);
    const expected = REFERENCE[(19 - chars.reduce((sum, id) => sum + byId.get(id).value, 0) % 19) % 19].id;
    assert.equal(core.checkDigitFor(chars), expected);
  }
});

const invalidCases = [
  () => assert.deepStrictEqual(core.parseBarText(''), { bars: null, errors: [{ code: 'empty' }] }),
  () => assert.deepStrictEqual(core.parseBarText('13 114 5'), { bars: null, errors: [{ code: 'invalid-char', index: 7, char: '5' }] }),
  () => assert.deepStrictEqual(core.parseBarText('１３'), { bars: [1, 3], errors: [] }),
  () => assert.deepStrictEqual(core.parseBarText('1　 3'), { bars: [1, 3], errors: [] }),
  () => assert.deepStrictEqual(core.parseBarText('fadt?'), { bars: [1, 2, 3, 4, null], errors: [] }),
  () => assert.deepStrictEqual(core.parseBarText('x'), { bars: null, errors: [{ code: 'invalid-char', index: 0, char: 'x' }] }),
  () => assert.deepStrictEqual(core.parseBarText('①'), { bars: null, errors: [{ code: 'invalid-char', index: 0, char: '①' }] }),
  () => assert.deepStrictEqual(core.parseBarText('1😀3'), { bars: null, errors: [{ code: 'invalid-char', index: 1, char: '😀' }] }),
  () => assert.deepStrictEqual(core.parseBarText('x'.repeat(25)), {
    bars: null, errors: Array.from({ length: 20 }, (_, index) => ({ code: 'invalid-char', index, char: 'x' }))
  }),
  () => assert.deepStrictEqual(core.parseBarText('1'.repeat(1000)), { bars: Array(1000).fill(1), errors: [] }),
  () => assert.deepStrictEqual(core.parseBarText('1'.repeat(1001)), { bars: null, errors: [{ code: 'too-long' }] }),
  () => { for (const value of ['abc', [0], [5], ['1']]) assert.throws(() => core.decodeBars(value), TypeError); },
  () => assert.throws(() => core.formatBarText([undefined]), TypeError),
  () => assert.throws(() => core.maskChars(original.slice(1), [0]), TypeError),
  () => { for (const index of [21, 1.5]) assert.throws(() => core.maskChars(original, [index]), RangeError); },
  () => assert.throws(() => core.transformBars([1, 2], 'turn'), TypeError),
  () => {
    for (const postal of ['100-001', '1-000013']) {
      assert.throws(() => core.encodeAddress(postal, ''), { name: 'RangeError', code: 'postal-format' });
    }
  },
  () => assert.deepStrictEqual(core.encodeAddress('１００－００１３', '1-3-2-503').bars, original),
  () => assert.throws(() => core.encodeAddress('1000013', '1-3-2-503号'), { name: 'RangeError', code: 'address-format' }),
  () => assert.deepStrictEqual(core.encodeAddress('2730102', '3-20-5b604').bars, referenceBars(vectors[6])),
  () => assert.throws(() => core.checkDigitFor(Array(19).fill('0')), RangeError)
];

invalidCases.forEach((run, index) => test(`Input ${String(index + 1).padStart(2, '0')}: specified boundary or invalid input`, run));

test('BWIPP regression: S divisible by 19 emits a three-bar zero CD', () => {
  const encoded = core.encodeAddress('1008792', '');
  assert.equal(encoded.checkDigit, '0');
  assert.deepStrictEqual(encoded.bars.slice(62, 65), [1, 4, 4]);
  assert.equal(encoded.bars.length, 67);
  assert.equal(core.checkDigitFor(vectors[17].expanded20), '0');
  assert.equal(core.checkDigitFor(Array(20).fill('0')), '0');
  assert.equal(core.decodeBars(referenceBars(vectors[17])).status, 'ok');
});

const addressTerms = [1, 10, 3, 10, 2, 10, 5, 0, 3, 14, 14, 14, 14];
const explanationCases = [
  [original, [1, 0, 0, 0, 0, 1, 3], 105, 0, 10, 9, 9, true, 114, 0],
  [core.maskChars(original, [20]), [1, 0, 0, 0, 0, 1, 3], 105, 0, 10, 9, null, null, 105, 1],
  [core.maskChars(original, [0]), [null, 0, 0, 0, 0, 1, 3], 104, 1, 9, null, 9, null, 113, 1],
  [replaceChar(original, 0, [1, 3, 2]), [2, 0, 0, 0, 0, 1, 3], 106, 0, 11, 8, 9, false, 115, 0]
];

explanationCases.forEach(([bars, postalTerms, knownSum, unknownCount, remainder, expected, read, match, total, unknown], index) => {
  test(`Explain ${index + 1}: checksum terms retain the pre-recovery evidence`, () => {
    const decoded = core.decodeBars(bars);
    assert.deepStrictEqual(core.explainChecksum(decoded), {
      postalTerms, addressTerms, knownSum, unknownCount, remainder, expected, read, match
    });
    assert.equal(decoded.checksum.knownSum, total);
    assert.equal(decoded.checksum.unknownCount, unknown);
  });
});

test('Contract: no-candidate and checksum contradiction keep distinct states', () => {
  const noCandidate = core.decodeBars(replaceChar(original, 0, [4, 3, null]));
  check(noCandidate, 'invalid', ['no-candidate']);
  assert.equal(noCandidate.chars[0].status, 'no-candidate');
  assert.equal(noCandidate.checksum.status, 'not-checked');
  assert.deepStrictEqual(noCandidate.chars[0].possible, []);
  const impossible = replaceChar(core.maskChars(original, [0]), 20, [3, 2, 4]);
  const contradiction = core.decodeBars(impossible);
  check(contradiction, 'invalid', ['checksum-contradiction']);
  assert.equal(contradiction.checksum.status, 'contradiction');
  assert.equal(contradiction.checksum.combinations, 0n);
  assert.equal(contradiction.checksum.assignments, null);
  assert.equal(contradiction.chars[0].status, 'contradiction');
  assert.deepStrictEqual(contradiction.chars[0].possible, []);
  assert.equal(contradiction.chars[0].symbol, null);
});

test('Contract: all hidden bars use exact large BigInt counts without enumeration', () => {
  const decoded = core.decodeBars(Array(67).fill(null));
  check(decoded, 'undetermined', ['start-stop-unknown']);
  assert.equal(decoded.checksum.combinations, 10n ** 7n * 15n ** 13n);
  assert.equal(decoded.checksum.assignments, null);
  assert.equal(decoded.checksum.knownSum, 0);
  assert.equal(decoded.checksum.unknownCount, 21);
  assert.equal(decoded.checkDigit, null);
  assert.deepStrictEqual(decoded.postalCode, { digits: '???????', display: '???-????', complete: false });
  for (const char of decoded.chars) {
    assert.equal(char.status, 'hidden');
    assert.deepStrictEqual(char.possible, char.index < 7 ? digits : char.index < 20 ? addressIds : REFERENCE.map(item => item.id));
  }
});

test('Contract: marker precedence, error suppression, and issue ordering', () => {
  const reversed = core.transformBars(original, 'flip');
  reversed[0] = null;
  const oriented = core.decodeBars(reversed);
  assert.equal(oriented.startStop, 'orientation');
  assert.deepStrictEqual(codes(oriented), new Set(['orientation', 'checksum-mismatch', 'start-stop-unknown']));
  reversed[66] = 4;
  const mismatch = core.decodeBars(reversed);
  assert.equal(mismatch.startStop, 'mismatch');
  assert.equal(codes(mismatch).has('start-stop-unknown'), false);
  const chars = [...'1000013', '-', 'CC5', ...Array(11).fill('CC4')];
  const bars = core.encodeChars(chars).bars;
  bars[0] = null;
  const decoded = core.decodeBars(bars);
  assert.deepStrictEqual(decoded.issues, [
    { code: 'start-stop-unknown', severity: 'warning' },
    { code: 'leading-hyphen', severity: 'warning', charIndex: 7 },
    { code: 'reserved-cc', severity: 'warning', charIndex: 8 }
  ]);
  bars[66] = 4;
  assert.deepStrictEqual(core.decodeBars(bars).issues, [{ code: 'start-stop', severity: 'error', barIndex: 66 }]);
});

test('Contract: letter candidates, unknown control, and uncertain padding retain token provenance', () => {
  const bars = core.encodeAddress('1000013', 'A1').bars;
  const ranged = core.decodeBars(core.maskChars(bars, [8, 20]));
  assert.equal(ranged.addressNumber.text, '[A-J]1');
  assert.deepStrictEqual(ranged.addressNumber.tokens[0], { type: 'letter-range', text: '[A-J]', charIndexes: [7, 8] });
  assert.equal(ranged.addressNumber.complete, false);
  const hiddenControl = core.decodeBars(core.maskChars(bars, [7, 20]));
  assert.deepStrictEqual(hiddenControl.addressNumber.tokens[0], { type: 'unknown', text: '?', charIndexes: [7, 8] });
  const padding = core.decodeBars(core.maskChars(original, [18, 20]));
  assert.equal(padding.addressNumber.text, '1-3-2-503…?');
  assert.equal(padding.addressNumber.paddingCount, 1);
  assert.deepStrictEqual(padding.addressNumber.tokens.slice(-2), [
    { type: 'padding-candidate', text: '…', charIndexes: [16, 17] },
    { type: 'unknown', text: '?', charIndexes: [18] }
  ]);
  assert.equal(codes(padding).has('cc4-middle'), false);
});

test('Contract: letters, aliases, UTF-16 error positions, and null explanations', () => {
  for (let i = 0; i < 26; i += 1) assert.equal(core.letterFor(`CC${Math.floor(i / 10) + 1}`, i % 10), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[i]);
  for (const [control, digit] of [['CC3', 6], ['CC4', 0], ['CC1', -1], ['CC2', '1'], ['CC1', 1.5]]) {
    assert.equal(core.letterFor(control, digit), null);
  }
  assert.deepStrictEqual(core.parseBarText('ＦＡＤＴ？,|\t\n\u00a0'), { bars: [1, 2, 3, 4, null], errors: [] });
  assert.deepStrictEqual(core.parseBarText('1😀x').errors, [
    { code: 'invalid-char', index: 1, char: '😀' }, { code: 'invalid-char', index: 3, char: 'x' }
  ]);
  assert.deepStrictEqual(core.parseBarText(' ,|\t\u3000'), { bars: null, errors: [{ code: 'empty' }] });
  assert.equal(core.explainChecksum(core.decodeBars([])), null);
  assert.equal(core.explainChecksum(core.decodeBars(replaceChar(original, 0, [2, 1, 4]))), null);
  assert.equal(core.formatBarText([1, null, 3], { group: true }), '1?3');
});

test('Contract: pure calls preserve input arrays and reject sparse or unknown entries', () => {
  const bars = Object.freeze(original.slice());
  const chars = Object.freeze(kasumigaseki.expanded20.slice());
  assert.deepStrictEqual(core.maskChars(bars, [0, 0]), core.maskChars(bars, [0]));
  core.decodeBars(bars);
  core.encodeChars(chars);
  core.formatBarText(bars);
  core.transformBars(bars, 'reverse');
  assert.deepStrictEqual(bars, original);
  for (const fn of [core.decodeBars, core.formatBarText, bars => core.transformBars(bars, 'flip')]) {
    for (const invalid of [Array(67), [undefined], [NaN], [true], null]) assert.throws(() => fn(invalid), TypeError);
  }
  assert.throws(() => core.encodeChars(Array(20).fill('X')), RangeError);
  assert.throws(() => core.checkDigitFor(Array(20)), RangeError);
  assert.throws(() => core.maskChars(bars, [-1]), RangeError);
});

test('Review 25: restored mirror inputs warn in both directions without alternatives', () => {
  const bars = core.maskChars(core.encodeAddress('1234567', '1-2-3-1111118').bars, [20]);
  for (const input of [bars, core.transformBars(bars, 'reverse')]) {
    const result = core.decodeBars(input);
    check(result, 'recovered', ['mirror-ambiguous']);
    assert.deepStrictEqual(result.alternatives, []);
  }
  assert.equal(core.decodeBars(core.transformBars(bars, 'reverse')).postalCode.display, '029-9999');
  assert.deepStrictEqual(core.decodeBars(Array(67).fill(null)).issues, [
    { code: 'start-stop-unknown', severity: 'warning' }
  ]);
});

test('Review 26 and 36: partial means at least one hidden bar in every character state', () => {
  const partial = original.slice();
  partial[2] = null;
  const read = core.decodeBars(partial).chars[0];
  assert.deepStrictEqual([read.status, read.partial, read.symbol], ['read', true, '1']);
  const inputs = [
    original, partial, core.maskChars(original, [0]), core.maskChars(original, [0, 1]), Array(67).fill(null),
    replaceChar(original, 0, [4, 3, null]), replaceChar(original, 9, [null, null, 1])
  ];
  const states = new Set();
  for (const input of inputs) {
    for (const char of core.decodeBars(input).chars) {
      assert.equal(char.partial, char.bars.includes(null));
      states.add(char.status);
    }
  }
  for (const state of ['read', 'recovered', 'hidden', 'no-candidate', 'contradiction']) assert.ok(states.has(state));
});

function reviewAddress(ids) {
  return core.encodeChars([...'1000013', ...ids, ...Array(13 - ids.length).fill('CC4')]).bars;
}

for (const [ids, text, charIndexes] of [
  [['CC1', '-', '1'], '[CC1]', [7]], [['CC3', '7'], '[CC3+7]', [7, 8]], [['CC5'], '[CC5]', [7]]
]) {
  test(`Review 27: ${text} is a reserved token`, () => {
    assert.deepStrictEqual(core.decodeBars(reviewAddress(ids)).addressNumber.tokens[0], { type: 'reserved', text, charIndexes });
  });
}

test('Review 27 and 36: letter candidates use ranges, commas, and only defined letters', () => {
  const cases = [];
  const range = core.maskChars(core.encodeAddress('1000013', 'A1').bars, [8, 20]);
  cases.push([range, '[A-J]', [7, 8]]);
  const pair = core.maskChars(core.encodeAddress('1000013', 'A1').bars, [20]);
  pair[27] = null;
  cases.push([pair, '[A,B]', [7, 8]]);
  const mixed = core.maskChars(reviewAddress(['CC1', '1']), [20]);
  mixed[27] = mixed[28] = null;
  cases.push([mixed, '[A-C,E,F]', [7, 8]]);
  const upper = core.maskChars(core.encodeAddress('1000013', 'U1').bars, [8, 20]);
  cases.push([upper, '[U-Z]', [7, 8]]);
  const onlyZ = replaceChar(core.maskChars(reviewAddress(['CC3', '5']), [20]), 8, [null, null, 1]);
  cases.push([onlyZ, '[Z]', [7, 8]]);
  const noDigit = reviewAddress(['CC1', '-', '1']);
  noDigit[3] = noDigit[26] = noDigit[27] = null;
  cases.push([noDigit, '[CC1+?]', [7, 8]]);
  assert.deepStrictEqual(core.decodeBars(noDigit).chars[8].possible, ['-', 'CC1']);
  const noLetter = core.maskChars(reviewAddress(['CC3', '8']), [20]);
  noLetter[27] = noLetter[28] = null;
  cases.push([noLetter, '[CC3+?]', [7, 8]]);
  assert.deepStrictEqual(core.decodeBars(noLetter).chars[8].possible, ['7', '8', 'CC3']);
  for (const [bars, text, charIndexes] of cases) {
    const result = core.decodeBars(bars);
    assert.equal(result.status, 'undetermined');
    assert.deepStrictEqual(result.addressNumber.tokens[0], { type: 'letter-range', text, charIndexes });
  }
});

test('Review 28: only completed defined letters trigger adjacent hyphen warnings', () => {
  for (const ids of [
    ['1', '-', 'CC3', '7'], [...'12345678901-', 'CC1'], ['CC1', '-', '1']
  ]) assert.equal(codes(core.decodeBars(reviewAddress(ids))).has('hyphen-next-to-letter'), false);
  const range = core.maskChars(reviewAddress(['1', '-', 'CC1', '0']), [10, 20]);
  assert.equal(codes(core.decodeBars(range)).has('hyphen-next-to-letter'), false);
});

test('Review 29: each middle CC4 warns even across an undecided character', () => {
  const first = core.decodeBars(reviewAddress(['1', 'CC4', 'CC4', '2']));
  assert.deepStrictEqual(first.issues, [
    { code: 'cc4-middle', severity: 'warning', charIndex: 8 },
    { code: 'cc4-middle', severity: 'warning', charIndex: 9 }
  ]);
  const second = core.decodeBars(core.maskChars(reviewAddress(['1', 'CC4', '2', '5']), [9, 20]));
  assert.equal(second.status, 'undetermined');
  assert.deepStrictEqual(second.issues, [{ code: 'cc4-middle', severity: 'warning', charIndex: 8 }]);
});

test('Review 30: hyphen warnings identify each pair or single adjacent hyphen', () => {
  assert.deepStrictEqual(core.decodeBars(reviewAddress(['1', '-', '-', '-', '2'])).issues, [
    { code: 'double-hyphen', severity: 'warning', charIndex: 9 },
    { code: 'double-hyphen', severity: 'warning', charIndex: 10 }
  ]);
  assert.deepStrictEqual(core.decodeBars(reviewAddress(['CC1', '0', '-', 'CC2', '9'])).issues, [
    { code: 'hyphen-next-to-letter', severity: 'warning', charIndex: 9 }
  ]);
});

test('Review 31 and 32: non-digit postal display and explicit whitespace boundaries', () => {
  const chars = kasumigaseki.expanded20.slice();
  chars[0] = 'CC4';
  const result = core.decodeBars(core.encodeChars(chars).bars);
  assert.deepStrictEqual(result.postalCode, { digits: '?000013', display: '?00-0013', complete: false });
  assert.deepStrictEqual(result.issues, [{ code: 'postal-not-digit', severity: 'error', charIndex: 0 }]);
  assert.deepStrictEqual(core.parseBarText('1\uFEFF3'), { bars: [1, 3], errors: [] });
  assert.deepStrictEqual(core.parseBarText('1\u200B3'), {
    bars: null, errors: [{ code: 'invalid-char', index: 1, char: '\u200B' }]
  });
});

test('Review 36: errors suppress information and issue sorting is exact', () => {
  const bad = core.decodeBars(replaceChar(referenceBars(vectors[14]), 0, [1, 1, 4]));
  assert.deepStrictEqual(bad.issues, [{ code: 'checksum-mismatch', severity: 'error' }]);
  assert.deepStrictEqual(core.decodeBars(core.transformBars(original, 'rotate180')).issues, [
    { code: 'checksum-mismatch', severity: 'error' }, { code: 'orientation', severity: 'error' },
    ...[1, 2, 3, 4, 6].map(charIndex => ({ code: 'postal-not-digit', severity: 'error', charIndex }))
  ]);
  assert.equal(bad.checksum.status, 'mismatch');
  for (const vector of vectors) assert.equal(core.decodeBars(referenceBars(vector)).barCount, 67);
});

test('Review 36: a partially read CD is still independent evidence', () => {
  const bars = referenceBars(vectors[6]);
  bars[62] = null;
  const decoded = core.decodeBars(bars);
  assert.equal(decoded.chars[20].status, 'read');
  assert.equal(decoded.chars[20].partial, true);
  const { read, expected, match } = core.explainChecksum(decoded);
  assert.deepStrictEqual({ read, expected, match }, { read: 0, expected: 0, match: true });
});

test('Review 36: special-number branches require complete relevant data', () => {
  for (const [postal, address, expected] of [
    ['1238695', '215', ['po-box-bulk']], ['1238785', '001', ['business-reply-bulk']], ['1000013', '1', []]
  ]) assert.deepStrictEqual(codes(core.decodeBars(core.encodeAddress(postal, address).bars), 'info'), new Set(expected));
  const hidden = core.decodeBars(core.maskChars(referenceBars(vectors[18]), [10, 20]));
  assert.equal(hidden.status, 'undetermined');
  assert.deepStrictEqual(codes(hidden, 'info'), new Set());
});

test('Review 36: assignments stop after exactly twenty solutions', () => {
  const twenty = core.maskChars(referenceBars(vectors[5]), [0, 20]);
  twenty[6] = null;
  const twentyOne = core.maskChars(referenceBars(vectors[5]), [0, 1]);
  twentyOne[13] = twentyOne[62] = null;
  for (const [bars, count, size] of [[twenty, 20n, 20], [twentyOne, 21n, null], [core.maskChars(original, [0, 1, 6]), 30n, null]]) {
    const result = core.decodeBars(bars);
    assert.equal(result.status, 'undetermined');
    assert.equal(result.checksum.combinations, count);
    assert.equal(result.checksum.assignments?.length ?? null, size);
  }
});

test('Review 36: text length uses UTF-16 code units', () => {
  assert.deepStrictEqual(core.parseBarText('😀'.repeat(501)), { bars: null, errors: [{ code: 'too-long' }] });
});

test('Samples: eight published inputs agree with six independent reference fields', () => {
  const samples = require('../samples.js');
  assert.equal(samples.barcodes.length, 8);
  const referenceIds = [17, 20, 18, 19, 14, 16, 6, 2];
  samples.barcodes.forEach((sample, index) => {
    const vector = vectors.find(item => item.id === referenceIds[index]);
    const encoded = core.encodeAddress(sample.postalCode, sample.addressNumber);
    assert.deepStrictEqual([
      sample.postalCode, sample.addressNumber, encoded.checkDigit, encoded.bars, encoded.truncated, encoded.droppedCount
    ], [
      vector.postalCode, vector.addressNumber, vector.checkDigit, referenceBars(vector), vector.truncated, vector.droppedCount
    ]);
    assert.equal(sample.version, '2026-10-15');
    assert.ok(sample.sourcePages.length > 0);
  });
});
