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

  function emptyRead(reason, pitch = null, angle = null) {
    return { status: 'unreadable', reasons: [reason], bars: Array(67).fill(null), guesses: Array(67).fill(null),
      confidence: Array(67).fill(null), pitchPx: pitch, angleDeg: angle, centers: Array(67).fill(null) };
  }

  function otsu(values) {
    const counts = new Uint32Array(256);
    let sum = 0, squares = 0;
    for (const value of values) {
      const rounded = clamp(Math.round(value), 0, 255);
      counts[rounded]++;
      sum += rounded;
      squares += rounded * rounded;
    }
    let leftCount = 0, leftSum = 0, best = -1, threshold = 127;
    for (let level = 0; level < 255; level++) {
      leftCount += counts[level];
      leftSum += counts[level] * level;
      const rightCount = values.length - leftCount;
      if (!leftCount || !rightCount) continue;
      const difference = leftSum / leftCount - (sum - leftSum) / rightCount;
      const score = leftCount * rightCount * difference * difference;
      if (score > best) {
        best = score;
        threshold = level;
      }
    }
    const variance = squares * values.length - sum * sum;
    return { threshold, separation: variance > 0 ? best / (values.length * variance) : 0 };
  }

  function channels(image) {
    const count = image.width * image.height;
    const luminance = new Float64Array(count), red = new Float64Array(count);
    for (let i = 0; i < count; i++) {
      const offset = 4 * i, alpha = image.data[offset + 3] / 255;
      red[i] = image.data[offset] * alpha + 255 * (1 - alpha);
      luminance[i] = (0.299 * image.data[offset] + 0.587 * image.data[offset + 1]
        + 0.114 * image.data[offset + 2]) * alpha + 255 * (1 - alpha);
    }
    const a = otsu(luminance), b = otsu(red);
    return b.separation > a.separation ? { gray: red, ...b } : { gray: luminance, ...a };
  }

  function bilinear(gray, width, height, x, y) {
    x = clamp(x - 0.5, 0, width - 1);
    y = clamp(y - 0.5, 0, height - 1);
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = Math.min(x0 + 1, width - 1), y1 = Math.min(y0 + 1, height - 1);
    const fx = x - x0, fy = y - y0;
    return (gray[y0 * width + x0] * (1 - fx) + gray[y0 * width + x1] * fx) * (1 - fy)
      + (gray[y1 * width + x0] * (1 - fx) + gray[y1 * width + x1] * fx) * fy;
  }

  function sauvola(gray, width, height, radius) {
    const stride = width + 1;
    const sum = new Float64Array(stride * (height + 1));
    const squares = new Float64Array(sum.length);
    for (let y = 0; y < height; y++) {
      let row = 0, rowSquared = 0;
      for (let x = 0; x < width; x++) {
        const value = gray[y * width + x], i = (y + 1) * stride + x + 1;
        row += value;
        rowSquared += value * value;
        sum[i] = sum[i - stride] + row;
        squares[i] = squares[i - stride] + rowSquared;
      }
    }
    return (x, y) => {
      const left = Math.max(0, Math.floor(x - radius)), right = Math.min(width, Math.ceil(x + radius));
      const top = Math.max(0, Math.floor(y - radius)), bottom = Math.min(height, Math.ceil(y + radius));
      const count = (right - left) * (bottom - top);
      const area = values => values[bottom * stride + right] - values[top * stride + right]
        - values[bottom * stride + left] + values[top * stride + left];
      const mean = area(sum) / count;
      const deviation = Math.sqrt(Math.max(0, area(squares) / count - mean * mean));
      return mean * (1 + 0.2 * (deviation / 128 - 1));
    };
  }

  function median(values) {
    const ordered = values.slice().sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
  }

  function lineFit(points) {
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; }
    const slope = (points.length * sxy - sx * sy) / (points.length * sxx - sx * sx);
    return { intercept: (sy - slope * sx) / points.length, slope };
  }

  function clockPeaks(profile, step, origin, pitch, thresholdAt) {
    const candidates = [];
    const half = Math.round(pitch / (2 * step));
    for (let i = half; i < profile.length - half; i++) {
      const value = profile[i];
      if (value > profile[i - 1] || value > profile[i + 1] || value > thresholdAt(origin + i * step)) continue;
      const left = Math.max(...profile.slice(i - half, i));
      const right = Math.max(...profile.slice(i + 1, i + half + 1));
      if (Math.min(left, right) - value < 16) continue;
      candidates.push({ i, value });
    }
    // Refine centers before suppressing duplicate minima on a noisy, flat bar.
    const refined = candidates.map(({ i, value }) => {
      const level = (value + Math.min(Math.max(...profile.slice(i - half, i)), Math.max(...profile.slice(i + 1, i + half + 1)))) / 2;
      let left = i, right = i;
      while (left > 0 && profile[left] < level) left--;
      while (right < profile.length - 1 && profile[right] < level) right++;
      const a = left + (profile[left] - level) / (profile[left] - profile[left + 1]);
      const b = right - (profile[right] - level) / (profile[right] - profile[right - 1]);
      return { u: origin + (a + b) * step / 2, width: (b - a) * step, value };
    }).filter(peak => peak.width >= 0.15 * pitch && peak.width <= 0.85 * pitch);
    refined.sort((a, b) => a.value - b.value);
    const selected = [];
    for (const peak of refined) {
      if (!selected.some(other => Math.abs(other.u - peak.u) < 0.65 * pitch)) selected.push(peak);
    }
    return selected.sort((a, b) => a.u - b.u);
  }

  function verticalEdges(sample, u, pitch) {
    const values = [];
    for (let i = -24; i <= 24; i++) {
      const v = i * pitch / 8;
      values.push((sample(u - pitch * 0.08, v) + sample(u, v) + sample(u + pitch * 0.08, v)) / 3);
    }
    const dark = Math.min(...values.slice(18, 31));
    // Measure the paper beside this bar, inside a possible translucent rectangle.
    // Distant paper can be brighter than the local paper after an overlay.
    let localPaper = 0;
    for (let i = -6; i <= 6; i++) {
      const v = i * pitch / 8;
      localPaper = Math.max(localPaper, sample(u - pitch * 0.5, v), sample(u + pitch * 0.5, v));
    }
    const paper = Math.min(Math.max(values[0], values.at(-1)), localPaper);
    if (paper - dark < 24) return null;
    const level = (paper + dark) / 2;
    let center = 18;
    for (let i = 19; i <= 30; i++) if (values[i] < values[center]) center = i;
    let left = center, right = center;
    while (left > 0 && values[left] < level) left--;
    while (right < 48 && values[right] < level) right++;
    if (left === 0 || right === 48) return null;
    const top = left + (values[left] - level) / (values[left] - values[left + 1]);
    const bottom = right - (values[right] - level) / (values[right] - values[right - 1]);
    return { top: (top - 24) / 8, bottom: (bottom - 24) / 8, contrast: paper - dark };
  }

  function timingReference(edges) {
    let best = Infinity, first = 0, last = 0;
    const distance = value => Math.min((value - 0.5) ** 2, (value - 1.5) ** 2, 0.16);
    for (let a = -0.6; a <= 0.601; a += 0.1) {
      for (let b = -0.6; b <= 0.601; b += 0.1) {
        let score = 0;
        for (let i = 0; i < 67; i++) {
          if (!edges[i]) continue;
          const center = a + (b - a) * i / 66;
          score += distance(center - edges[i].top) + distance(edges[i].bottom - center);
        }
        if (score < best) { best = score; first = a; last = b; }
      }
    }
    let fit = { intercept: first, slope: (last - first) / 66 };
    for (let iteration = 0; iteration < 3; iteration++) {
      const points = [];
      for (let i = 0; i < 67; i++) {
        if (!edges[i]) continue;
        const center = fit.intercept + fit.slope * i;
        const top = edges[i].top + (center - edges[i].top > 1 ? 1.5 : 0.5);
        const bottom = edges[i].bottom - (edges[i].bottom - center > 1 ? 1.5 : 0.5);
        if (Math.abs(top - center) < 0.3) points.push([i, top]);
        if (Math.abs(bottom - center) < 0.3) points.push([i, bottom]);
      }
      if (points.length >= 20) fit = lineFit(points);
    }
    return fit;
  }

  function readBarsInRegion(image, region, options = {}) {
    validateImage(image);
    if (!region) throw new TypeError('invalid-region');
    const start = point(region.start), end = point(region.end);
    const dx = end.x - start.x, dy = end.y - start.y;
    const length = Math.hypot(dx, dy), nominal = length / 66;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    if (nominal < 4) return emptyRead(nominal > 0 ? 'low-resolution' : 'region-too-small', nominal, angle);
    const inside = p => p.x >= 0.5 && p.x <= image.width - 0.5 && p.y >= 0.5 && p.y <= image.height - 0.5;
    if (!inside(start) || !inside(end)) return emptyRead('region-outside-image', nominal, angle);
    const ux = dx / length, uy = dy / length;
    const selected = channels(image);
    const sample = (u, v) => bilinear(selected.gray, image.width, image.height,
      start.x + ux * u - uy * v, start.y + uy * u + ux * v);
    const origin = -2 * nominal, step = nominal / 8;
    const profile = [];
    for (let i = 0; i <= 560; i++) {
      const u = origin + i * step;
      let value = 255;
      for (let j = -2; j <= 2; j++) value = Math.min(value, sample(u, j * nominal * 0.3));
      profile.push(value);
    }
    let peaks = clockPeaks(profile, step, origin, nominal, () => selected.threshold + 1);
    if (peaks.length < 60) {
      const local = sauvola(selected.gray, image.width, image.height, 3 * nominal);
      peaks = clockPeaks(profile, step, origin, nominal, u => local(start.x + ux * u, start.y + uy * u));
    }
    peaks = peaks.filter(peak => peak.u >= -1.4 * nominal && peak.u <= length + 1.4 * nominal);
    if (peaks.length < 60 || peaks.length > 67) return emptyRead(peaks.length ? 'bar-count' : 'no-bars', nominal, angle);
    const differences = peaks.slice(1).map((peak, i) => peak.u - peaks[i].u).filter(d => d > nominal * 0.65 && d < nominal * 1.35);
    const pitch = median(differences);
    if (pitch < 4) return emptyRead('low-resolution', pitch, angle);
    const aligned = Array(67).fill(null);
    let index = 0;
    for (let i = 0; i < peaks.length; i++) {
      if (i) index += Math.round((peaks[i].u - peaks[i - 1].u) / pitch);
      if (index < 0 || index > 66 || aligned[index]) return emptyRead('irregular-pitch', pitch, angle);
      aligned[index] = peaks[i];
    }
    if (index !== 66) return emptyRead('irregular-pitch', pitch, angle);
    const fit = lineFit(aligned.flatMap((peak, i) => peak ? [[i, peak.u]] : []));
    if (aligned.some((peak, i) => peak && Math.abs(peak.u - fit.intercept - i * fit.slope) > 0.2 * pitch)) {
      return emptyRead('irregular-pitch', pitch, angle);
    }
    const edges = aligned.map(peak => peak ? verticalEdges(sample, peak.u, fit.slope) : null);
    const reference = timingReference(edges);
    const result = emptyRead('bar-count', fit.slope, angle);
    for (let i = 0; i < 67; i++) {
      const peak = aligned[i], edge = edges[i];
      if (!peak) continue;
      const center = reference.intercept + reference.slope * i;
      const v = center * fit.slope;
      result.centers[i] = { x: start.x + ux * peak.u - uy * v, y: start.y + uy * peak.u + ux * v };
      if (!edge) { result.confidence[i] = 0; continue; }
      const up = center - 0.5 - edge.top, down = edge.bottom - center - 0.5;
      const guess = up > 0.5 ? (down > 0.5 ? 1 : 2) : (down > 0.5 ? 3 : 4);
      result.guesses[i] = guess;
      result.confidence[i] = clamp(Math.min(Math.abs(up - 0.5), Math.abs(down - 0.5)) / 0.5, 0, 1);
      let spaces = true;
      for (const offset of [-0.2, 0, 0.2]) {
        const height = v + offset * fit.slope;
        const ink = sample(peak.u, height);
        for (const direction of [-1, 1]) {
          const gap = Math.max(sample(peak.u + direction * 0.4 * fit.slope, height), sample(peak.u + direction * 0.5 * fit.slope, height));
          if (gap - ink < Math.max(12, edge.contrast * 0.12)) spaces = false;
        }
      }
      if (spaces && up >= -0.3 && up <= 1.3 && down >= -0.3 && down <= 1.3 && result.confidence[i] >= 0.2) result.bars[i] = guess;
    }
    // Both directions have long outer bars and matching semi-long inner markers.
    const outer = [result.bars[0], result.bars[66]], inner = [result.bars[1], result.bars[65]];
    if (outer.some(bar => bar !== null && bar !== 1) || inner.some(bar => bar !== null && bar !== 2 && bar !== 3)
        || (inner[0] !== null && inner[1] !== null && inner[0] !== inner[1])) {
      return emptyRead('start-stop', fit.slope, angle);
    }
    const found = result.centers.filter(Boolean).length;
    result.status = found < 67 ? 'unreadable' : result.bars.includes(null) ? 'partial' : 'read';
    result.reasons = result.status === 'read' ? [] : [found < 67 ? 'bar-count' : 'low-confidence'];
    result.angleDeg = angle + Math.atan(reference.slope) * 180 / Math.PI;
    return result;
  }

  return Object.freeze({ renderBarcode, applyMask, readBarsInRegion });
});
