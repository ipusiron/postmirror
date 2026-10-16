'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const api = require('../nw7-core.js');
const vectors = require('./nw7-vectors.json').vectors;

// Rasterize independent ZXing-C++ widths, without consulting the reader's table.
function fixture(vector, options = {}) {
  const scale = options.scale || 3, margin = options.margin ?? 40;
  const runs = vector.runs.map((n, i) => n * scale * (i % 8 === 7 && options.wideGap ? 3 : 1));
  const length = runs.reduce((a, b) => a + b, 0);
  const width = Math.ceil(length + margin * 2), height = 100;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  let left = margin;
  for (let i = 0; i < runs.length; i++) {
    if (i % 2 === 0) {
      for (let x = Math.ceil(left); x < left + runs[i]; x++) {
        for (let y = 15; y < 85; y++) {
          const k = (y * width + x) * 4;
          data[k] = data[k + 1] = data[k + 2] = 0;
        }
      }
    }
    left += runs[i];
  }
  return { image: { width, height, data }, region: {
    start: { x: margin + runs[0] / 2, y: 50 }, end: { x: margin + length - runs.at(-1) / 2, y: 50 }
  } };
}

for (const vector of vectors) {
  test(`NW-7: independent ${vector.format} vector ${vector.raw}`, () => {
    const { image, region } = fixture(vector);
    const result = api.read(image, region);
    if (vector.format !== 'Codabar') return assert.equal(result.status, 'unreadable');
    assert.deepEqual(result, { status: 'read', format: 'Codabar', text: vector.raw.slice(1, -1),
      start: vector.raw[0], stop: vector.raw.at(-1) });
  });
}

test('NW-7: wide separators, shadows, alpha and reverse scan direction', () => {
  const vector = vectors[0], { image, region } = fixture(vector, { wideGap: true });
  for (let k = 0; k < image.data.length; k += 4) {
    const x = (k / 4) % image.width;
    image.data[k] = image.data[k + 1] = image.data[k + 2] = image.data[k] * (0.65 + 0.3 * x / image.width);
    image.data[k + 3] = 210;
  }
  const before = image.data.slice();
  assert.equal(api.read(image, region).text, vector.raw.slice(1, -1));
  assert.equal(api.read(image, { start: region.end, end: region.start }).text, vector.raw.slice(1, -1));
  assert.deepEqual(image.data, before);
});

test('NW-7: rotated scan follows selected endpoints', () => {
  const { image, region } = fixture(vectors[0]);
  const rotated = { width: image.height, height: image.width, data: new Uint8ClampedArray(image.data.length) };
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      const from = (y * image.width + x) * 4, to = (x * rotated.width + image.height - 1 - y) * 4;
      rotated.data.set(image.data.subarray(from, from + 4), to);
    }
  }
  const rotate = p => ({ x: image.height - 1 - p.y, y: p.x });
  assert.equal(api.read(rotated, { start: rotate(region.start), end: rotate(region.end) }).text, vectors[0].raw.slice(1, -1));
});

test('NW-7: no guesses for blank, covered, truncated, or unsupported-length symbols', () => {
  const f = fixture(vectors[0]);
  for (const value of [0, 128, 255]) {
    const data = f.image.data.slice();
    for (let k = 0; k < data.length; k += 4) data[k] = data[k + 1] = data[k + 2] = value;
    assert.equal(api.read({ ...f.image, data }, f.region).status, 'unreadable');
  }
  for (const runs of [vectors[0].runs.slice(8), vectors[0].runs.slice(0, -8), vectors[0].runs.slice(0, 23)]) {
    const { image, region } = fixture({ runs });
    assert.equal(api.read(image, region).status, 'unreadable');
  }
  const tight = fixture(vectors[0], { margin: 1 });
  assert.equal(api.read(tight.image, tight.region).status, 'unreadable');
  for (let y = 0; y < f.image.height; y++) {
    for (let x = 100; x < 150; x++) {
      const k = (y * f.image.width + x) * 4;
      f.image.data[k] = f.image.data[k + 1] = f.image.data[k + 2] = 255;
    }
  }
  assert.equal(api.read(f.image, f.region).status, 'unreadable');
});

test('NW-7: require independent scanlines and reject contradictory readings', () => {
  const first = fixture(vectors[0]), second = fixture(vectors[1]);
  // Keep just one readable line; all other lines are white.
  const sparse = first.image.data.slice().fill(255);
  const row = first.image.width * 4;
  sparse.set(first.image.data.subarray(50 * row, 51 * row), 50 * row);
  assert.equal(api.read({ ...first.image, data: sparse }, first.region).status, 'unreadable');
  // Same dimensions, different terminal guard at the top and bottom.
  assert.equal(first.image.width, second.image.width);
  first.image.data.set(second.image.data.subarray(51 * row), 51 * row);
  assert.equal(api.read(first.image, first.region).status, 'unreadable');
});

test('NW-7: invalid inputs return no content without allocating huge images', () => {
  const f = fixture(vectors[0]);
  for (const image of [null, {}, { ...f.image, width: 1.5 }, { ...f.image, width: 100000 }, { ...f.image, data: [] }]) {
    assert.equal(api.read(image, f.region).text, null);
  }
  for (const region of [null, {}, { start: { x: NaN, y: 1 }, end: { x: 2, y: 2 } },
    { start: { x: -1, y: 1 }, end: { x: 2, y: 2 } }, { start: { x: 1, y: 1 }, end: { x: 2, y: 2 } }]) {
    assert.equal(api.read(f.image, region).status, 'unreadable');
  }
});

test('NW-7: static offline API has no DOM, communication, persistence, or random behavior', () => {
  const source = fs.readFileSync(require.resolve('../nw7-core.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:document|window|fetch|XMLHttpRequest|localStorage|sessionStorage|Date)\b|Math\.random/);
  const context = {};
  vm.runInNewContext(source, context);
  assert.equal(typeof context.PostMirrorNW7.read, 'function');
  assert.ok(Object.isFrozen(api));
});
