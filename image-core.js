(function (root, factory) {
  'use strict';
  const core = typeof module === 'object' && module.exports ? require('./barcode-core.js') : root.PostMirrorCore;
  const api = factory(core.GEOMETRY);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PostMirrorImage = api;
})(globalThis, function (geometry) {
  'use strict';

  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function number(value, fallback, low, high = Infinity) {
    const result = value === undefined ? fallback : value;
    if (!Number.isFinite(result) || result < low || result > high) throw new RangeError('invalid-number');
    return result;
  }

  function validateImage(image) {
    if (!image || !Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height)
        || image.width < 1 || image.height < 1 || !(image.data instanceof Uint8ClampedArray)
        || image.data.length !== image.width * image.height * 4) throw new TypeError('invalid-image');
  }

  function point(value) {
    if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) throw new TypeError('invalid-point');
    return value;
  }

  function randomSource(seed) {
    let state = number(seed, 1, 0, 0xffffffff) >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function gaussian(values, width, height, sigma, channels) {
    if (sigma === 0) return values.slice();
    const radius = Math.ceil(3 * sigma);
    const weights = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma ** 2)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    weights.forEach((weight, i) => { weights[i] = weight / total; });
    const temp = new Float64Array(values.length);
    const output = new Float64Array(values.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let channel = 0; channel < channels; channel++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            sum += values[(y * width + clamp(x + k, 0, width - 1)) * channels + channel] * weights[k + radius];
          }
          temp[(y * width + x) * channels + channel] = sum;
        }
      }
    }
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        for (let channel = 0; channel < channels; channel++) {
          let sum = 0;
          for (let k = -radius; k <= radius; k++) {
            sum += temp[(clamp(y + k, 0, height - 1) * width + x) * channels + channel] * weights[k + radius];
          }
          output[(y * width + x) * channels + channel] = sum;
        }
      }
    }
    return output;
  }

  function renderBarcode(bars, options = {}) {
    if (!Array.isArray(bars) || bars.length !== 67 || Array.from(bars).some(bar => ![1, 2, 3, 4, null].includes(bar))) {
      throw new TypeError('invalid-bars');
    }
    const pitch = number(options.pxPerPitch, 8, Number.EPSILON);
    const angle = number(options.angleDeg, 0, -Infinity) * Math.PI / 180;
    const margin = number(options.marginPitches, 4, 0) * pitch;
    const foreground = number(options.foreground, 0, 0, 255);
    const background = number(options.background, 255, 0, 255);
    const sigma = number(options.blurSigmaPx, 0, 0);
    const noise = number(options.noiseSigma, 0, 0);
    const random = randomSource(options.seed);
    const unit = pitch / geometry.pitch;
    const halfWidth = geometry.barWidth * unit / 2;
    const longHalf = geometry.longBar * unit / 2;
    const shortHalf = geometry.timingBar * unit / 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const span = 66 * pitch + 2 * halfWidth;
    const width = Math.ceil(Math.abs(cos) * span + Math.abs(sin) * 2 * longHalf + 2 * margin);
    const height = Math.ceil(Math.abs(sin) * span + Math.abs(cos) * 2 * longHalf + 2 * margin);
    if (!Number.isSafeInteger(width * height) || width * height > 16777216) throw new RangeError('image-too-large');
    let gray = new Float64Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let covered = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const dx = x + (sx + 0.5) / 4 - width / 2;
            const dy = y + (sy + 0.5) / 4 - height / 2;
            const u = cos * dx + sin * dy;
            const v = -sin * dx + cos * dy;
            const index = Math.round(u / pitch + 33);
            if (index < 0 || index >= 67 || Math.abs(u - (index - 33) * pitch) >= halfWidth) continue;
            const bar = bars[index];
            const upper = bar === 1 || bar === 2 ? longHalf : shortHalf;
            const lower = bar === 1 || bar === 3 ? longHalf : shortHalf;
            if (bar !== null && v >= -upper && v < lower) covered++;
          }
        }
        gray[y * width + x] = background + (foreground - background) * covered / 16;
      }
    }
    if (sigma) gray = gaussian(gray, width, height, sigma, 1);
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < gray.length; i++) {
      const perturbation = noise ? Math.sqrt(-2 * Math.log(Math.max(random(), 1e-12))) * Math.cos(2 * Math.PI * random()) * noise : 0;
      data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = gray[i] + perturbation;
      data[4 * i + 3] = 255;
    }
    const center = index => ({ x: width / 2 + (index - 33) * pitch * cos, y: height / 2 + (index - 33) * pitch * sin });
    return { image: { width, height, data }, region: { start: center(0), end: center(66) } };
  }

  function rectangle(rect, width, height) {
    point(rect);
    number(rect.width, undefined, 0);
    number(rect.height, undefined, 0);
    return {
      left: clamp(Math.ceil(rect.x - 0.5), 0, width), right: clamp(Math.ceil(rect.x + rect.width - 0.5), 0, width),
      top: clamp(Math.ceil(rect.y - 0.5), 0, height), bottom: clamp(Math.ceil(rect.y + rect.height - 0.5), 0, height)
    };
  }

  function applyMask(image, mask) {
    validateImage(image);
    if (!mask || !['fill', 'translucent', 'mosaic', 'blur', 'line'].includes(mask.kind)) throw new TypeError('invalid-mask');
    const { width, height } = image;
    const data = image.data.slice();
    const color = number(mask.color, 0, 0, 255);
    const alpha = number(mask.alpha, 0.5, 0, 1);
    let rect = mask.rect;
    let start, dx, dy, lengthSquared, radius;
    if (mask.kind === 'line') {
      start = point(mask.start);
      const end = point(mask.end);
      dx = end.x - start.x;
      dy = end.y - start.y;
      lengthSquared = dx * dx + dy * dy;
      radius = number(mask.thicknessPx, undefined, Number.EPSILON) / 2;
      rect = rect || { x: Math.min(start.x, end.x) - radius, y: Math.min(start.y, end.y) - radius,
        width: Math.abs(dx) + 2 * radius, height: Math.abs(dy) + 2 * radius };
    }
    const bounds = rectangle(rect, width, height);
    const block = mask.kind === 'mosaic' ? number(mask.blockPx, undefined, Number.EPSILON) : 0;
    const blurred = mask.kind === 'blur'
      ? gaussian(image.data, width, height, number(mask.sigmaPx, undefined, 0), 4) : null;
    const blocks = new Map();
    if (block) {
      for (let y = bounds.top; y < bounds.bottom; y++) {
        for (let x = bounds.left; x < bounds.right; x++) {
          const key = `${Math.floor((x + 0.5 - rect.x) / block)},${Math.floor((y + 0.5 - rect.y) / block)}`;
          const sums = blocks.get(key) || [0, 0, 0, 0, 0];
          for (let c = 0; c < 4; c++) sums[c] += image.data[(y * width + x) * 4 + c];
          sums[4]++;
          blocks.set(key, sums);
        }
      }
    }
    for (let y = bounds.top; y < bounds.bottom; y++) {
      for (let x = bounds.left; x < bounds.right; x++) {
        const index = (y * width + x) * 4;
        if (mask.kind === 'line') {
          const t = lengthSquared ? clamp(((x + 0.5 - start.x) * dx + (y + 0.5 - start.y) * dy) / lengthSquared, 0, 1) : 0;
          if (Math.hypot(x + 0.5 - start.x - t * dx, y + 0.5 - start.y - t * dy) > radius) continue;
        }
        if (blurred) {
          for (let c = 0; c < 4; c++) data[index + c] = blurred[index + c];
        } else if (block) {
          const key = `${Math.floor((x + 0.5 - rect.x) / block)},${Math.floor((y + 0.5 - rect.y) / block)}`;
          const sums = blocks.get(key);
          for (let c = 0; c < 4; c++) data[index + c] = sums[c] / sums[4];
        } else {
          const opacity = mask.kind === 'translucent' ? alpha : 1;
          const sourceAlpha = image.data[index + 3] / 255;
          const resultAlpha = opacity + sourceAlpha * (1 - opacity);
          for (let c = 0; c < 3; c++) {
            data[index + c] = resultAlpha ? (color * opacity + image.data[index + c] * sourceAlpha * (1 - opacity)) / resultAlpha : 0;
          }
          data[index + 3] = resultAlpha * 255;
        }
      }
    }
    return { width, height, data };
  }

  return Object.freeze({ renderBarcode, applyMask });
});
