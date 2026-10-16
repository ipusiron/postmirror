(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PostMirrorNW7 = api;
})(globalThis, function () {
  'use strict';

  // Codabar / NW-7 character patterns: seven alternating black/white elements.
  // 1 = wide, 0 = narrow. Pattern facts cross-checked against ZXing's Codabar table.
  const alphabet = '0123456789-$:/.+ABCD';
  const patterns = Object.freeze([
    3, 6, 9, 96, 18, 66, 33, 36, 48, 72, 12, 24, 69, 81, 84, 21, 26, 41, 11, 14
  ]);
  const failure = () => ({ status: 'unreadable', format: 'Codabar', text: null, start: null, stop: null });

  function cluster(values) {
    let low = Math.min(...values), high = Math.max(...values);
    for (let pass = 0; pass < 8; pass++) {
      const split = (low + high) / 2;
      const a = values.filter(value => value <= split), b = values.filter(value => value > split);
      if (!a.length || !b.length) return null;
      low = a.reduce((sum, value) => sum + value, 0) / a.length;
      high = b.reduce((sum, value) => sum + value, 0) / b.length;
    }
    if (low < 0.7 || high / low < 1.5 || high / low > 3.8) return null;
    return { low, high, split: (low + high) / 2 };
  }

  function decodeRuns(runs, before, after) {
    // A complete symbol has 7 elements per character plus one intercharacter gap.
    if (runs.length < 31 || runs.length > 655 || (runs.length + 1) % 8) return null;
    const bars = cluster(runs.filter((_, i) => i % 2 === 0));
    const spaces = cluster(runs.filter((_, i) => i % 8 === 1 || i % 8 === 3 || i % 8 === 5));
    if (!bars || !spaces || Math.min(before, after) < Math.min(bars.low, spaces.low) * 5) return null;
    let raw = '';
    for (let offset = 0; offset < runs.length; offset += 8) {
      let bits = 0;
      for (let i = 0; i < 7; i++) {
        const group = i % 2 ? spaces : bars;
        const wide = runs[offset + i] > group.split;
        const ratio = runs[offset + i] / (wide ? group.high : group.low);
        if (ratio < 0.55 || ratio > 1.45) return null;
        bits = bits * 2 + Number(wide);
      }
      const index = patterns.indexOf(bits);
      if (index < 0) return null;
      raw += alphabet[index];
      if (offset + 7 < runs.length) {
        // The separator is not a character element; allow narrow or wide gaps.
        const gap = runs[offset + 7];
        if (gap < spaces.low * 0.5 || gap > Math.max(spaces.low * 4, spaces.high * 1.45)) return null;
      }
    }
    return /^[ABCD][0-9\-$:/.+]{2,80}[ABCD]$/.test(raw) ? raw : null;
  }

  function luminance(image, x, y) {
    if (x < 0 || y < 0 || x > image.width - 1 || y > image.height - 1) return null;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const dx = x - x0, dy = y - y0;
    let value = 0;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const index = (Math.min(y0 + row, image.height - 1) * image.width + Math.min(x0 + col, image.width - 1)) * 4;
        const gray = image.data[index] * 0.299 + image.data[index + 1] * 0.587 + image.data[index + 2] * 0.114;
        const alpha = image.data[index + 3] / 255;
        value += (gray * alpha + 255 * (1 - alpha)) * (col ? dx : 1 - dx) * (row ? dy : 1 - dy);
      }
    }
    return value;
  }

  function scan(image, start, end, offset) {
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    const ux = (end.x - start.x) / length, uy = (end.y - start.y) / length;
    const margin = Math.max(24, length * 0.06);
    const values = [];
    // Half-pixel samples preserve subpixel edges without inventing new resolution.
    for (let distance = -margin; distance <= length + margin; distance += 0.5) {
      const value = luminance(image, start.x + ux * distance - uy * offset, start.y + uy * distance + ux * offset);
      if (value === null) {
        if (values.length) break;
      } else values.push(value);
    }
    return values;
  }

  function candidates(values) {
    if (values.length < 64) return [];
    const sorted = [...values].sort((a, b) => a - b);
    const dark = sorted[Math.floor(sorted.length * 0.1)], light = sorted[Math.floor(sorted.length * 0.9)];
    if (light - dark < 40) return [];
    const found = new Set();
    for (const fraction of [0.4, 0.5, 0.6]) {
      const threshold = dark + (light - dark) * fraction;
      const edges = [];
      let black = values[0] < threshold;
      if (black) continue; // Both quiet zones must be present.
      for (let i = 1; i < values.length; i++) {
        const next = values[i] < threshold;
        if (next !== black) {
          edges.push((i - 1 + (threshold - values[i - 1]) / (values[i] - values[i - 1])) * 0.5);
          black = next;
        }
      }
      if (black || edges.length < 32) continue;
      const runs = edges.slice(1).map((edge, i) => edge - edges[i]);
      const before = edges[0], after = (values.length - 1) * 0.5 - edges.at(-1);
      for (const widths of [runs, [...runs].reverse()]) {
        const raw = decodeRuns(widths, before, after);
        if (raw) found.add(raw);
      }
    }
    return [...found];
  }

  function read(image, region) {
    if (!image || !Number.isInteger(image.width) || !Number.isInteger(image.height)
      || image.width < 1 || image.height < 1 || image.width * image.height > 16777216
      || !(image.data instanceof Uint8ClampedArray) || image.data.length !== image.width * image.height * 4) return failure();
    const points = [region?.start, region?.end];
    if (points.some(point => !point || !Number.isFinite(point.x) || !Number.isFinite(point.y)
      || point.x < 0 || point.y < 0 || point.x >= image.width || point.y >= image.height)) return failure();
    const [start, end] = points, length = Math.hypot(end.x - start.x, end.y - start.y);
    if (length < 32 || length > 10000) return failure();
    const step = Math.max(1, Math.min(4, length / 300));
    const votes = new Map();
    for (const offset of [0, -step, step, -2 * step, 2 * step, -3 * step, 3 * step]) {
      for (const raw of candidates(scan(image, start, end, offset))) votes.set(raw, (votes.get(raw) || 0) + 1);
    }
    // Never choose between different decoded strings, or accept a single scanline.
    if (votes.size !== 1) return failure();
    const [[raw, count]] = votes;
    if (count < 3) return failure();
    return { status: 'read', format: 'Codabar', text: raw.slice(1, -1), start: raw[0], stop: raw.at(-1) };
  }

  return Object.freeze({ read });
});
