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

// Evaluation data use a different stream from development data. Neither changes between runs.
const TUNING_SEED = 0x2a10c0de;
const EVALUATION_SEED = 0x2a20babe;

function referenceRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    return (value >>> 0) / 4294967296;
  };
}

function referenceBlur(source, width, height, sigma) {
  if (!sigma) return source.slice();
  const radius = Math.ceil(sigma * 3), weights = [];
  let normalizer = 0;
  for (let i = 0; i <= radius; i++) {
    weights.push(Math.exp(-i * i / (2 * sigma * sigma)));
    normalizer += weights[i] * (i ? 2 : 1);
  }
  for (let i = 0; i <= radius; i++) weights[i] /= normalizer;
  const horizontal = new Float32Array(source.length), output = new Float32Array(source.length);
  const left = [], right = [];
  for (let i = 1; i <= radius; i++) {
    left[i] = Int32Array.from({ length: width }, (_, x) => Math.max(0, x - i));
    right[i] = Int32Array.from({ length: width }, (_, x) => Math.min(width - 1, x + i));
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let value = source[row + x] * weights[0];
      for (let i = 1; i <= radius; i++) value += (source[row + left[i][x]] + source[row + right[i][x]]) * weights[i];
      horizontal[row + x] = value;
    }
  }
  for (let y = 0; y < height; y++) {
    const above = [], below = [];
    for (let i = 1; i <= radius; i++) { above[i] = Math.max(0, y - i) * width; below[i] = Math.min(height - 1, y + i) * width; }
    for (let x = 0; x < width; x++) {
      let value = horizontal[y * width + x] * weights[0];
      for (let i = 1; i <= radius; i++) value += (horizontal[above[i] + x] + horizontal[below[i] + x]) * weights[i];
      output[y * width + x] = value;
    }
  }
  return output;
}

function referenceRaster(bars, pitch, angle, seed, translated = true) {
  const random = referenceRandom(seed);
  const rad = angle * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad);
  const width = Math.ceil(pitch * (66.5 * Math.abs(c) + 3 * Math.abs(s) + 10));
  const height = Math.ceil(pitch * (66.5 * Math.abs(s) + 3 * Math.abs(c) + 10));
  const cx = width / 2 + (translated ? random() - 0.5 : 0);
  const cy = height / 2 + (translated ? random() - 0.5 : 0);
  const gray = new Float32Array(width * height);
  const short = core.GEOMETRY.timingBar / core.GEOMETRY.pitch / 2;
  const tall = core.GEOMETRY.longBar / core.GEOMETRY.pitch / 2;
  const half = core.GEOMETRY.barWidth / core.GEOMETRY.pitch / 2;
  // An inverse map at four independently chosen subpixel centers, without production helpers.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let ink = 0;
      for (const oy of [0.25, 0.75]) {
        for (const ox of [0.25, 0.75]) {
          const rx = (x + ox - cx) / pitch, ry = (y + oy - cy) / pitch;
          const along = c * rx + s * ry + 33;
          const down = -s * rx + c * ry;
          const nearest = Math.floor(along + 0.5);
          if (nearest < 0 || nearest > 66 || Math.abs(along - nearest) >= half) continue;
          const type = bars[nearest];
          if (type && down >= -([1, 2].includes(type) ? tall : short) && down < ([1, 3].includes(type) ? tall : short)) ink++;
        }
      }
      gray[y * width + x] = 255 * (1 - ink / 4);
    }
  }
  return { width, height, gray, region: {
    start: { x: cx - 33 * pitch * c, y: cy - 33 * pitch * s }, end: { x: cx + 33 * pitch * c, y: cy + 33 * pitch * s }
  }, pitch, angle };
}

function referenceImage(raster, blurRatio = 0, noise = 0, seed = EVALUATION_SEED) {
  const gray = referenceBlur(raster.gray, raster.width, raster.height, raster.pitch * blurRatio);
  const random = referenceRandom(seed), image = pixels(raster.width, raster.height);
  let spare = null;
  for (let i = 0; i < gray.length; i++) {
    let gaussian = 0;
    if (noise) {
      if (spare === null) {
        const radius = Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))), angle = random() * 2 * Math.PI;
        gaussian = radius * Math.cos(angle);
        spare = radius * Math.sin(angle);
      } else { gaussian = spare; spare = null; }
    }
    image.data[4 * i] = image.data[4 * i + 1] = image.data[4 * i + 2] = gray[i] + gaussian * noise;
  }
  return image;
}

function shiftedRegion(raster, seed, amount = 1) {
  const random = referenceRandom(seed), rad = raster.angle * Math.PI / 180;
  const shift = position => {
    const u = (random() * 2 - 1) * raster.pitch * amount;
    const v = (random() - 0.5) * raster.pitch * amount;
    return { x: position.x + u * Math.cos(rad) - v * Math.sin(rad), y: position.y + u * Math.sin(rad) + v * Math.cos(rad) };
  };
  return { start: shift(raster.region.start), end: shift(raster.region.end) };
}

function examples(seed) {
  const random = referenceRandom(seed), result = official.map(value => ({ ...value }));
  for (let i = 0; i < 20; i++) {
    const digit = () => String(Math.floor(random() * 10));
    const postal = Array.from({ length: 7 }, digit).join('');
    const address = `${digit()}${digit()}-${digit()}-${String.fromCharCode(65 + Math.floor(random() * 26))}${digit()}${digit()}`;
    result.push({ id: `fictional-${i}`, bars: core.encodeAddress(postal, address).bars });
  }
  return result;
}

function referenceMask(image, raster, kind) {
  const p = raster.pitch, mid = raster.region.start.y;
  const left = raster.region.start.x - 0.75 * p, right = raster.region.end.x + 0.75 * p;
  const top = mid - 2 * p, bottom = mid + 2 * p;
  const output = { ...image, data: image.data.slice() };
  if (kind === 'none') return output;
  let x0 = left, x1 = right, y0 = top, y1 = bottom;
  if (kind === 'character') { x0 = raster.region.start.x + 22.5 * p; x1 = x0 + 3 * p; y0 = mid - 1.5 * p; y1 = mid + 1.5 * p; }
  if (kind === 'upper') y1 = mid;
  if (kind.startsWith('line')) { const thick = kind === 'line-1' ? p : p / 4; y0 = mid - thick / 2; y1 = mid + thick / 2; }
  const block = kind.startsWith('mosaic') ? Number(kind.split('-')[1]) * p : 0;
  const blocks = new Map();
  const gray = new Float32Array(image.width * image.height);
  for (let i = 0; i < gray.length; i++) gray[i] = image.data[4 * i];
  const blurred = kind.startsWith('blur') ? referenceBlur(gray, image.width, image.height, Number(kind.split('-')[1]) * p) : null;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (x + 0.5 < x0 || x + 0.5 >= x1 || y + 0.5 < y0 || y + 0.5 >= y1) continue;
      const i = y * image.width + x;
      if (block) {
        const key = [Math.floor((x + 0.5 - x0) / block), Math.floor((y + 0.5 - y0) / block)].join('/');
        if (!blocks.has(key)) blocks.set(key, []);
        blocks.get(key).push(i);
      } else {
        let value = 0;
        if (kind.startsWith('translucent')) value = (gray[i] + (kind === 'translucent-white' ? 255 : 0)) / 2;
        if (blurred) value = blurred[i];
        output.data[4 * i] = output.data[4 * i + 1] = output.data[4 * i + 2] = value;
      }
    }
  }
  for (const indexes of blocks.values()) {
    const mean = indexes.reduce((sum, i) => sum + gray[i], 0) / indexes.length;
    for (const i of indexes) output.data[4 * i] = output.data[4 * i + 1] = output.data[4 * i + 2] = mean;
  }
  return output;
}

function translucentImage(image, raster, color) {
  const output = { ...image, data: image.data.slice() };
  const cx = (raster.region.start.x + raster.region.end.x) / 2;
  const cy = (raster.region.start.y + raster.region.end.y) / 2;
  const angle = raster.angle * Math.PI / 180;
  const halfWidth = raster.pitch * (66.5 * Math.abs(Math.cos(angle)) + 3 * Math.abs(Math.sin(angle)) + 1) / 2;
  const halfHeight = raster.pitch * (66.5 * Math.abs(Math.sin(angle)) + 3 * Math.abs(Math.cos(angle)) + 1) / 2;
  for (let y = Math.max(0, Math.ceil(cy - halfHeight - 0.5)); y < Math.min(image.height, cy + halfHeight - 0.5); y++) {
    for (let x = Math.max(0, Math.ceil(cx - halfWidth - 0.5)); x < Math.min(image.width, cx + halfWidth - 0.5); x++) {
      const i = (y * image.width + x) * 4;
      output.data[i] = output.data[i + 1] = output.data[i + 2] = (image.data[i] + color) / 2;
    }
  }
  return output;
}

function metrics(result, expected) {
  const original = core.decodeBars(expected), decoded = core.decodeBars(result.bars);
  const wrong = result.bars.filter((value, index) => value !== null && value !== expected[index]).length;
  const complete = result.status === 'read' && result.bars.every((value, index) => value === expected[index]);
  const confirmedWrong = ['ok', 'recovered'].includes(decoded.status)
    && (decoded.postalCode.digits !== original.postalCode.digits || decoded.addressNumber.text !== original.addressNumber.text);
  return { complete: Number(complete), partial: Number(result.status === 'partial'), unreadable: Number(result.status === 'unreadable'),
    wrong, confirmedWrong: Number(confirmedWrong), known: result.bars.filter(value => value !== null).length };
}

function verifyShape(result) {
  assert.deepEqual(Object.keys(result).sort(), ['angleDeg', 'bars', 'centers', 'confidence', 'guesses', 'pitchPx', 'reasons', 'status']);
  for (const name of ['bars', 'guesses', 'confidence', 'centers']) assert.equal(result[name].length, 67);
  for (let i = 0; i < 67; i++) {
    assert.ok([null, 1, 2, 3, 4].includes(result.bars[i]));
    assert.ok(result.confidence[i] === null || (result.confidence[i] >= 0 && result.confidence[i] <= 1));
    if (result.confidence[i] === null || result.confidence[i] < 0.2) assert.equal(result.bars[i], null);
    if (result.centers[i] === null) assert.equal(result.bars[i], null);
  }
}

function grid(seed, visit) {
  let count = 0;
  for (const [ordinal, vector] of examples(seed).entries()) {
    for (const pitch of [6, 7.5, 9, 12]) {
      for (const angle of [0, -5, 5, -10, 10]) {
        const caseSeed = (seed + ordinal * 10000 + pitch * 100 + angle + 11) >>> 0;
        const raster = referenceRaster(vector.bars, pitch, angle, caseSeed);
        for (const blur of [0, 0.25]) {
          for (const noise of [0, 8]) {
            const image = referenceImage(raster, blur, noise, caseSeed + noise);
            const region = shiftedRegion(raster, caseSeed + noise + Math.round(blur * 100));
            visit({ vector, pitch, angle, blur, noise, image, region, raster, name: `p${pitch}/a${angle}/b${blur}/n${noise}` });
            count++;
          }
        }
      }
    }
  }
  return count;
}

const MASK_KINDS = ['fill', 'character', 'upper', 'line-1', 'line-0.25', 'translucent-black', 'translucent-white',
  'mosaic-0.5', 'mosaic-1', 'mosaic-2', 'blur-0.5', 'blur-1', 'blur-2'];
const ZERO_WRONG = new Set(['fill', 'character', 'upper', 'line-1', 'line-0.25', 'blank', 'outside']);

function outsideCases(seed, visit) {
  for (const [i, vector] of examples(seed).entries()) {
    for (const pitch of [3, 4, 5]) {
      const raster = referenceRaster(vector.bars, pitch, 0, seed + i);
      visit({ name: `pitch-${pitch}`, vector, image: referenceImage(raster), region: raster.region });
    }
    const raster = referenceRaster(vector.bars, 8, 0, seed + i, false);
    const clear = referenceImage(raster);
    for (const blur of [0.5, 1]) visit({ name: `strong-blur-${blur}`, vector, image: referenceImage(raster, blur), region: raster.region });
    visit({ name: 'noise-25', vector, image: referenceImage(raster, 0.25, 25, seed + i), region: shiftedRegion(raster, seed + i) });
    for (const shift of [1, 1.5, 2]) {
      const region = { start: { x: raster.region.start.x + shift * 8, y: raster.region.start.y + shift * 8 },
        end: { x: raster.region.end.x + shift * 8, y: raster.region.end.y + shift * 8 } };
      visit({ name: `shift-${shift}`, vector, image: clear, region });
    }
    visit({ name: 'blank', vector, image: pixels(clear.width, clear.height), region: raster.region });
    visit({ name: 'outside', vector, image: clear, region: { start: { x: -1, y: raster.region.start.y }, end: raster.region.end } });
    for (const kind of MASK_KINDS) visit({ name: kind, vector, image: referenceMask(clear, raster, kind), region: raster.region });
    visit({ name: 'mosaic-0.25', vector, image: referenceMask(clear, raster, 'mosaic-0.25'), region: raster.region });
  }
}

test('Image read: all 2320 independent in-range images and both translucent colors match exactly', () => {
  const failures = [];
  const count = grid(EVALUATION_SEED, item => {
    for (const color of [null, 0, 255]) {
      let image = item.image;
      if (color !== null) {
        image = translucentImage(image, item.raster, color);
      }
      const result = imaging.readBarsInRegion(image, item.region);
      const measured = metrics(result, item.vector.bars);
      if (!measured.complete || measured.wrong || measured.confirmedWrong) {
        failures.push({ id: item.vector.id, name: item.name, color, status: result.status, ...measured });
      }
      verifyShape(result);
    }
  });
  assert.equal(count, 2320);
  assert.equal(failures.length, 0, JSON.stringify({ count: failures.length, first: failures.slice(0, 12) }));
});

test('Image read: reversed region preserves order and swaps upper/lower without automatic orientation', () => {
  for (const vector of examples(EVALUATION_SEED)) {
    for (const angle of [-10, 0, 10]) {
      const raster = referenceRaster(vector.bars, 7.5, angle, EVALUATION_SEED);
      const image = referenceImage(raster, 0.25, 8);
      const region = shiftedRegion(raster, EVALUATION_SEED + 1);
      const forward = imaging.readBarsInRegion(image, region);
      const reverse = imaging.readBarsInRegion(image, { start: region.end, end: region.start });
      assert.deepEqual(forward.bars, vector.bars);
      assert.deepEqual(reverse.bars, core.transformBars(forward.bars, 'rotate180'));
      assert.equal(reverse.status, 'read');
    }
  }
});

test('Image read: masks, boundary cases and independent held-out data have zero false confirmations', () => {
  let count = 0;
  const failures = [];
  outsideCases(EVALUATION_SEED, item => {
    const result = imaging.readBarsInRegion(item.image, item.region);
    const measured = metrics(result, item.vector.bars);
    const problems = [];
    verifyShape(result);
    if (ZERO_WRONG.has(item.name) && measured.wrong) problems.push('wrong-bars');
    if (measured.confirmedWrong) problems.push('false-confirmation');
    if (item.name === 'pitch-3' && (result.status !== 'unreadable' || !result.reasons.includes('low-resolution'))) problems.push('resolution');
    if (item.name === 'fill' && result.status !== 'unreadable' && measured.known !== 0) problems.push('fill');
    if (item.name === 'character') {
      const expected = item.vector.bars.map((bar, i) => i >= 23 && i <= 25 ? null : bar);
      if (JSON.stringify(result.bars) !== JSON.stringify(expected)) problems.push('character-bars');
      const decoded = core.decodeBars(result.bars);
      if (decoded.status !== 'recovered') problems.push('character-recovery');
    }
    if ((item.name.startsWith('translucent') || item.name === 'mosaic-0.25') && !measured.complete) problems.push('should-read');
    if (problems.length) failures.push({ name: item.name, id: item.vector.id, problems, status: result.status, ...measured });
    count++;
  });
  assert.ok(count >= 300);
  assert.notEqual(TUNING_SEED, EVALUATION_SEED);
  assert.equal(failures.length, 0, JSON.stringify({ count: failures.length, first: failures.slice(0, 20) }));
});

test('Image read: source/region immutability, no-bar confidence, colors and invalid regions', () => {
  const raster = referenceRaster(example, 8, 0, TUNING_SEED);
  const image = referenceImage(raster), saved = image.data.slice(), region = structuredClone(raster.region);
  const result = imaging.readBarsInRegion(image, region);
  assert.deepEqual(result.bars, example);
  assert.deepEqual(image.data, saved);
  assert.deepEqual(region, raster.region);
  for (let i = 0; i < 67; i++) {
    close(result.centers[i].x, raster.region.start.x + i * 8, 0.7);
    close(result.centers[i].y, raster.region.start.y, 0.7);
  }
  const blank = imaging.readBarsInRegion(pixels(image.width, image.height), region);
  assert.equal(blank.status, 'unreadable');
  assert.ok(blank.bars.every(value => value === null));
  assert.ok(blank.confidence.every(value => value === null));
  for (let i = 0; i < image.data.length; i += 4) image.data[i + 2] = 255;
  assert.deepEqual(imaging.readBarsInRegion(image, region).bars, example);
  assert.equal(imaging.readBarsInRegion(image, { start: region.start, end: region.start }).status, 'unreadable');
  assert.throws(() => imaging.readBarsInRegion(image, { start: { x: NaN, y: 0 }, end: region.end }), TypeError);
});

module.exports = { TUNING_SEED, EVALUATION_SEED, grid, outsideCases, metrics, examples, referenceRaster, referenceImage,
  shiftedRegion, referenceMask, translucentImage, ZERO_WRONG, MASK_KINDS };
