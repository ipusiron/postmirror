'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../barcode-core.js');
const imaging = require('../image-core.js');
const { vectors } = require('./official-vectors.json');
const official = vectors.filter(vector => vector.bars67 !== null).map(vector => ({
  id: vector.id, bars: vector.bars67.replace(/\s/g, '').split('').map(Number)
}));
const example = official.find(vector => vector.id === 17).bars;
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} vs ${expected}`);

function pixels(width, height, value = 255) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = value;
    data[4 * i + 3] = 255;
  }
  return { width, height, data };
}

test('Image render: default bounds, centered region and opaque RGBA', () => {
  const { image, region } = imaging.renderBarcode(example);
  assert.equal(image.width, 596);
  assert.equal(image.height, 88);
  assert.deepEqual(region, { start: { x: 34, y: 44 }, end: { x: 562, y: 44 } });
  assert.ok(image.data instanceof Uint8ClampedArray);
  assert.equal(image.data.length, image.width * image.height * 4);
  for (let i = 3; i < image.data.length; i += 4) assert.equal(image.data[i], 255);
  const dark = [];
  for (let i = 0; i < image.width * image.height; i++) if (image.data[4 * i] < 255) dark.push(i);
  assert.equal(Math.min(...dark.map(i => i % image.width)), 32);
  assert.equal(Math.max(...dark.map(i => i % image.width)), 563);
  assert.equal(Math.min(...dark.map(i => Math.floor(i / image.width))), 32);
  assert.equal(Math.max(...dark.map(i => Math.floor(i / image.width))), 55);
});

test('Image render: height ratios 6:4:2 and upper/lower placement', () => {
  const bars = Array.from({ length: 67 }, (_, i) => i % 4 + 1);
  const { image, region } = imaging.renderBarcode(bars);
  for (let index = 0; index < 4; index++) {
    const x = Math.floor(region.start.x + index * 8);
    const rows = Array.from({ length: image.height }, (_, y) => y).filter(y => image.data[(y * image.width + x) * 4] === 0);
    assert.equal(rows.length, [24, 16, 16, 8][index]);
    assert.equal(rows[0], [32, 32, 40, 40][index]);
    assert.equal(rows.at(-1), [55, 47, 55, 47][index]);
  }
});

test('Image render: rotated bounds, exact center and fractional pitch', () => {
  for (const pitch of [6, 7.5, 12]) {
    for (const angle of [-10, 0, 5, 90]) {
      const { image, region } = imaging.renderBarcode(example, { pxPerPitch: pitch, angleDeg: angle });
      const rad = angle * Math.PI / 180;
      const c = Math.cos(rad), s = Math.sin(rad);
      assert.equal(image.width, Math.ceil(Math.abs(c) * 66.5 * pitch + Math.abs(s) * 3 * pitch + 8 * pitch));
      assert.equal(image.height, Math.ceil(Math.abs(s) * 66.5 * pitch + Math.abs(c) * 3 * pitch + 8 * pitch));
      close((region.start.x + region.end.x) / 2, image.width / 2);
      close((region.start.y + region.end.y) / 2, image.height / 2);
      close(region.start.x, image.width / 2 - 33 * pitch * c);
      close(region.start.y, image.height / 2 - 33 * pitch * s);
      close(Math.hypot(region.end.x - region.start.x, region.end.y - region.start.y), 66 * pitch);
      assert.ok(image.data.some(value => value > 0 && value < 255) || pitch !== 7.5);
    }
  }
});

test('Image render: reproducible seed, blur and noise, preserved bars', () => {
  const before = example.slice();
  const options = { pxPerPitch: 6, angleDeg: 5, blurSigmaPx: 1.5, noiseSigma: 8, seed: 12345 };
  const first = imaging.renderBarcode(example, options);
  assert.deepEqual(imaging.renderBarcode(example, options), first);
  assert.notDeepEqual(imaging.renderBarcode(example, { ...options, seed: 12346 }).image.data, first.image.data);
  assert.deepEqual(example, before);
});

test('Image render: 4x4 area coverage and explicit gray colors', () => {
  const { image, region } = imaging.renderBarcode(Array(67).fill(1), { pxPerPitch: 7.5, foreground: 32, background: 224 });
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < 9; x++) {
      const px = Math.floor(region.start.x) - 4 + x;
      let count = 0;
      for (const sx of [0.125, 0.375, 0.625, 0.875]) {
        for (const sy of [0.125, 0.375, 0.625, 0.875]) {
          if (Math.abs(px + sx - region.start.x) < 1.875 && y + sy >= region.start.y - 11.25
              && y + sy < region.start.y + 11.25) count++;
        }
      }
      assert.equal(image.data[(y * image.width + px) * 4], 224 - 12 * count);
    }
  }
});

const maskCases = [
  { kind: 'fill' }, { kind: 'translucent', alpha: 0.5 }, { kind: 'mosaic', blockPx: 2.5 },
  { kind: 'blur', sigmaPx: 1.2 }, { kind: 'line', start: { x: 3, y: 4 }, end: { x: 10, y: 8 }, thicknessPx: 2 }
];
for (const mask of maskCases) {
  test(`Image mask ${mask.kind}: bounded writes, clipping, source and arguments are unchanged`, () => {
    const source = pixels(13, 11);
    for (let i = 0; i < source.data.length; i += 4) source.data[i] = source.data[i + 1] = source.data[i + 2] = (i * 37) % 256;
    const before = source.data.slice();
    for (const rect of [{ x: 2.2, y: 3.2, width: 7.1, height: 5.1 }, { x: -2, y: -3, width: 8, height: 8 }]) {
      const args = { ...mask, rect };
      const saved = structuredClone(args);
      const result = imaging.applyMask(source, args);
      assert.deepEqual(args, saved);
      assert.notEqual(result.data, source.data);
      assert.notDeepEqual(result.data, before);
      assert.deepEqual(source.data, before);
      for (let y = 0; y < source.height; y++) {
        for (let x = 0; x < source.width; x++) {
          if (x + 0.5 >= rect.x && x + 0.5 < rect.x + rect.width && y + 0.5 >= rect.y && y + 0.5 < rect.y + rect.height) continue;
          const i = (y * source.width + x) * 4;
          assert.deepEqual(result.data.slice(i, i + 4), before.slice(i, i + 4));
        }
      }
    }
  });
}

test('Image mask: black default fill and translucent black/white with alpha endpoints', () => {
  const source = pixels(4, 4, 128);
  const rect = { x: 0, y: 0, width: 4, height: 4 };
  assert.equal(imaging.applyMask(source, { kind: 'fill', rect }).data[0], 0);
  for (const color of [0, 255]) {
    for (const alpha of [0, 0.5, 1]) {
      const result = imaging.applyMask(source, { kind: 'translucent', rect, alpha, color });
      assert.equal(result.data[0], new Uint8ClampedArray([128 * (1 - alpha) + color * alpha])[0]);
    }
  }
});

test('Image mask: mosaic grid begins at the rectangle origin', () => {
  const source = pixels(6, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) source.data[(y * 6 + x) * 4] = 20 * x;
  const result = imaging.applyMask(source, { kind: 'mosaic', rect: { x: 1, y: 0, width: 4, height: 3 }, blockPx: 2 });
  assert.deepEqual(Array.from({ length: 6 }, (_, x) => result.data[x * 4]), [0, 30, 30, 70, 70, 100]);
});

test('Image mask: Gaussian sigma uses ceil(3 sigma) support and normalized weights', () => {
  const source = pixels(11, 11, 0);
  source.data[(5 * 11 + 5) * 4] = 255;
  const result = imaging.applyMask(source, { kind: 'blur', rect: { x: 0, y: 0, width: 11, height: 11 }, sigmaPx: 1 });
  const sum = Array.from({ length: 7 }, (_, i) => Math.exp(-((i - 3) ** 2) / 2)).reduce((a, b) => a + b);
  assert.equal(result.data[(5 * 11 + 5) * 4], Math.round(255 / sum ** 2));
  assert.equal(result.data[(5 * 11 + 6) * 4], Math.round(255 * Math.exp(-0.5) / sum ** 2));
  assert.equal(result.data[(5 * 11 + 9) * 4], 0);
});

test('Image mask: line endpoints, thickness and default color', () => {
  const result = imaging.applyMask(pixels(10, 10), {
    kind: 'line', start: { x: 2.5, y: 4.5 }, end: { x: 7.5, y: 4.5 }, thicknessPx: 1
  });
  const dark = [];
  for (let i = 0; i < 100; i++) if (result.data[4 * i] === 0) dark.push(i);
  assert.deepEqual(dark, [42, 43, 44, 45, 46, 47]);
});

test('Image contract: invalid shapes, values and nonfinite options are rejected', () => {
  for (const bars of [[], Array(67), Array(67).fill(5)]) assert.throws(() => imaging.renderBarcode(bars), TypeError);
  for (const options of [{ pxPerPitch: 0 }, { angleDeg: NaN }, { noiseSigma: -1 }, { foreground: 300 }]) {
    assert.throws(() => imaging.renderBarcode(example, options), RangeError);
  }
  assert.throws(() => imaging.applyMask({}, { kind: 'fill' }), TypeError);
  assert.throws(() => imaging.applyMask(pixels(2, 2), { kind: 'unknown' }), TypeError);
  assert.throws(() => imaging.applyMask(pixels(2, 2), { kind: 'blur', rect: { x: 0, y: 0, width: 2, height: 2 } }), RangeError);
});

test('Image contract: classic global and CommonJS APIs need no DOM, canvas or nondeterminism', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'image-core.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:document|window|Date|fetch|Worker|localStorage|sessionStorage|indexedDB)\b|Math\.random|decodeBars|checkDigit/i);
  const context = { PostMirrorCore: { GEOMETRY: core.GEOMETRY }, Uint8ClampedArray };
  vm.runInNewContext(source, context);
  assert.deepEqual(Object.keys(context.PostMirrorImage), Object.keys(imaging));
  assert.ok(Object.isFrozen(imaging));
  assert.deepEqual(context.PostMirrorImage.renderBarcode(example).image.data, imaging.renderBarcode(example).image.data);
});
