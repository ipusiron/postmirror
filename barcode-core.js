(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PostMirrorCore = api;
})(globalThis, function () {
  'use strict';

  // Japan Post postal code and barcode manual, p11 and p12.
  const SYMBOLS = Object.freeze([
    ['0', [1, 4, 4]], ['1', [1, 1, 4]], ['2', [1, 3, 2]],
    ['3', [3, 1, 2]], ['4', [1, 2, 3]], ['5', [1, 4, 1]],
    ['6', [3, 2, 1]], ['7', [2, 1, 3]], ['8', [2, 3, 1]],
    ['9', [4, 1, 1]], ['-', [4, 1, 4]], ['CC1', [3, 2, 4]],
    ['CC2', [3, 4, 2]], ['CC3', [2, 3, 4]], ['CC4', [4, 3, 2]],
    ['CC5', [2, 4, 3]], ['CC6', [4, 2, 3]], ['CC7', [4, 4, 1]],
    ['CC8', [1, 1, 1]]
  ].map(([id, bars], value) => Object.freeze({ id, bars: Object.freeze(bars), value })));
  const START = Object.freeze([1, 3]);
  const STOP = Object.freeze([3, 1]);
  const BAR_COUNT = 67;
  const CHAR_COUNT = 21;
  const POSTAL_LENGTH = 7;
  const ADDRESS_LENGTH = 13;
  const POSITION_CANDIDATES = Object.freeze({
    postal: Object.freeze(SYMBOLS.slice(0, 10).map(symbol => symbol.id)),
    address: Object.freeze(SYMBOLS.slice(0, 15).map(symbol => symbol.id)),
    cd: Object.freeze(SYMBOLS.map(symbol => symbol.id))
  });
  const GEOMETRY = Object.freeze({
    longBar: 6, semiLongBar: 4, timingBar: 2, pitch: 2, barWidth: 1,
    space: 1, unitMmAt10pt: 0.6, semiLongBarInferred: true
  });
  const BY_ID = new Map(SYMBOLS.map(symbol => [symbol.id, symbol]));
  const BY_PATTERN = new Map(SYMBOLS.map(symbol => [symbol.bars.join(''), symbol]));
  const isDigit = id => typeof id === 'string' && /^[0-9]$/.test(id);
  const isControl = id => ['CC1', 'CC2', 'CC3'].includes(id);
  const isKnown = char => char.status === 'read' || char.status === 'recovered';
  const mod19 = value => ((value % 19) + 19) % 19;

  function validateBars(bars) {
    if (!Array.isArray(bars)) throw new TypeError('Bars must be an array');
    for (const bar of bars) {
      if (bar !== null && ![1, 2, 3, 4].includes(bar)) {
        throw new TypeError('Each bar must be 1, 2, 3, 4, or null');
      }
    }
  }

  function parseBarText(text) {
    if (typeof text !== 'string') return { bars: null, errors: [{ code: 'empty' }] };
    if (text.length > 1000) return { bars: null, errors: [{ code: 'too-long' }] };
    const bars = [];
    const errors = [];
    const aliases = { F: 1, A: 2, D: 3, T: 4 };
    let index = 0;
    for (const char of text) {
      const code = char.codePointAt(0);
      const eligible = code <= 0x7f || (code >= 0xff01 && code <= 0xff5e) || /\s/u.test(char);
      const normalized = eligible ? char.normalize('NFKC') : '';
      if (normalized.length === 1 && /[\s,|]/u.test(normalized)) {
        // Separators do not consume a bar position.
      } else if (normalized.length === 1 && /^[1-4]$/.test(normalized)) {
        bars.push(Number(normalized));
      } else if (normalized.length === 1 && Object.hasOwn(aliases, normalized.toUpperCase())) {
        bars.push(aliases[normalized.toUpperCase()]);
      } else if (normalized === '?') {
        bars.push(null);
      } else if (errors.length < 20) {
        errors.push({ code: 'invalid-char', index, char });
      }
      index += char.length;
    }
    if (!bars.length && !errors.length) errors.push({ code: 'empty' });
    return { bars: errors.length ? null : bars, errors };
  }

  function formatBarText(bars, options = {}) {
    validateBars(bars);
    const text = bars.map(bar => bar === null ? '?' : String(bar)).join('');
    if (!options.group || bars.length !== BAR_COUNT) return text;
    const groups = [text.slice(0, 2)];
    for (let start = 2; start < 65; start += 3) groups.push(text.slice(start, start + 3));
    groups.push(text.slice(65));
    return groups.join(' ');
  }

  function checkDigitFor(chars) {
    if (!Array.isArray(chars) || chars.length !== 20) throw new RangeError('Exactly 20 symbols are required');
    let sum = 0;
    for (const id of chars) {
      if (!BY_ID.has(id)) throw new RangeError('Unknown symbol');
      sum += BY_ID.get(id).value;
    }
    return SYMBOLS[mod19(-sum)].id;
  }

  function encodeChars(chars) {
    const checkDigit = checkDigitFor(chars);
    const bars = [...START];
    for (const id of [...chars, checkDigit]) bars.push(...BY_ID.get(id).bars);
    bars.push(...STOP);
    return { chars: chars.slice(), checkDigit, bars };
  }

  function formatError(code) {
    const error = new RangeError(code);
    error.code = code;
    return error;
  }

  function encodeAddress(postalCode, addressNumber) {
    if (typeof postalCode !== 'string') throw formatError('postal-format');
    const postal = postalCode.normalize('NFKC');
    if (!/^\d{3}-?\d{4}$/.test(postal)) throw formatError('postal-format');
    if (typeof addressNumber !== 'string') throw formatError('address-format');
    const address = addressNumber.normalize('NFKC').toUpperCase();
    if (!/^[0-9A-Z-]*$/.test(address)) throw formatError('address-format');
    const expanded = [];
    for (const char of address) {
      if (/^[A-Z]$/.test(char)) {
        const ordinal = char.charCodeAt(0) - 65;
        expanded.push(`CC${Math.floor(ordinal / 10) + 1}`, String(ordinal % 10));
      } else {
        expanded.push(char);
      }
    }
    const droppedCount = Math.max(0, expanded.length - ADDRESS_LENGTH);
    const addressChars = expanded.slice(0, ADDRESS_LENGTH);
    while (addressChars.length < ADDRESS_LENGTH) addressChars.push('CC4');
    return {
      ...encodeChars([...postal.replace('-', ''), ...addressChars]),
      truncated: droppedCount > 0, droppedCount
    };
  }

  function transformBars(bars, kind) {
    validateBars(bars);
    if (!['reverse', 'flip', 'rotate180'].includes(kind)) throw new TypeError('Unknown transformation');
    const transformed = bars.map(bar => {
      if (kind === 'reverse') return bar;
      return bar === 2 ? 3 : bar === 3 ? 2 : bar;
    });
    return kind === 'flip' ? transformed : transformed.reverse();
  }

  function maskChars(bars, charIndexes) {
    validateBars(bars);
    if (bars.length !== BAR_COUNT) throw new TypeError('Exactly 67 bars are required');
    if (!Array.isArray(charIndexes)) throw new RangeError('Character indexes must be an array');
    const masked = bars.slice();
    for (const index of charIndexes) {
      if (!Number.isInteger(index) || index < 0 || index >= CHAR_COUNT) throw new RangeError('Invalid character index');
      masked.fill(null, 2 + 3 * index, 5 + 3 * index);
    }
    return masked;
  }

  function letterFor(controlId, digit) {
    if (!isControl(controlId) || !Number.isInteger(digit) || digit < 0 || digit > 9) return null;
    const ordinal = (Number(controlId.slice(2)) - 1) * 10 + digit;
    return ordinal < 26 ? String.fromCharCode(65 + ordinal) : null;
  }

  function readCharacter(bars, index, issues) {
    const section = index < 7 ? 'postal' : index < 20 ? 'address' : 'cd';
    const partial = bars.includes(null);
    let candidates;
    let status;
    if (!partial) {
      const symbol = BY_PATTERN.get(bars.join(''));
      candidates = symbol ? [symbol.id] : [];
      status = symbol ? 'read' : 'invalid-pattern';
    } else {
      candidates = POSITION_CANDIDATES[section].filter(id =>
        bars.every((bar, i) => bar === null || BY_ID.get(id).bars[i] === bar));
      status = candidates.length === 0 ? 'no-candidate'
        : bars.every(bar => bar === null) ? 'hidden'
          : candidates.length === 1 ? 'read' : 'candidates';
    }
    const symbol = status === 'read' ? candidates[0] : null;
    if (status === 'invalid-pattern' || status === 'no-candidate') {
      issues.push({ code: status, severity: 'error', charIndex: index });
    }
    if (section === 'postal' && symbol !== null && !isDigit(symbol)) {
      issues.push({ code: 'postal-not-digit', severity: 'error', charIndex: index });
    }
    return {
      index, section, bars, status, partial, symbol,
      value: symbol === null ? null : BY_ID.get(symbol).value,
      candidates, possible: candidates.slice()
    };
  }

  function uncheckedChecksum() {
    return { status: 'not-checked', knownSum: null, unknownCount: null, combinations: null, assignments: null };
  }

  // Residue counts use BigInt; no candidate product is materialized.
  function extendCounts(counts, candidates) {
    const next = Array(19).fill(0n);
    for (let residue = 0; residue < 19; residue += 1) {
      for (const id of candidates) next[(residue + BY_ID.get(id).value) % 19] += counts[residue];
    }
    return next;
  }

  function solveChecksum(chars, issues) {
    if (chars.some(char => ['invalid-pattern', 'no-candidate'].includes(char.status))) return uncheckedChecksum();
    const unknown = chars.filter(char => char.status !== 'read');
    const knownSum = chars.reduce((sum, char) => sum + (char.value === null ? 0 : char.value), 0);
    const checksum = { status: 'ok', knownSum, unknownCount: unknown.length, combinations: null, assignments: null };
    if (!unknown.length) {
      if (knownSum % 19 !== 0) {
        checksum.status = 'mismatch';
        issues.push({ code: 'checksum-mismatch', severity: 'error' });
      }
      return checksum;
    }
    const unit = Array(19).fill(0n);
    unit[0] = 1n;
    const prefix = [unit];
    const suffix = Array(unknown.length + 1);
    suffix[unknown.length] = unit;
    for (const char of unknown) prefix.push(extendCounts(prefix[prefix.length - 1], char.candidates));
    for (let i = unknown.length - 1; i >= 0; i -= 1) suffix[i] = extendCounts(suffix[i + 1], unknown[i].candidates);
    const target = mod19(-knownSum);
    checksum.combinations = prefix[unknown.length][target];
    for (let i = 0; i < unknown.length; i += 1) {
      const char = unknown[i];
      char.possible = char.candidates.filter(id => {
        const remaining = mod19(target - BY_ID.get(id).value);
        return prefix[i].some((count, residue) => count > 0n && suffix[i + 1][mod19(remaining - residue)] > 0n);
      });
      if (!char.possible.length) {
        char.status = 'contradiction';
      } else if (char.possible.length === 1) {
        char.status = 'recovered';
        char.symbol = char.possible[0];
        char.value = BY_ID.get(char.symbol).value;
      }
    }
    if (checksum.combinations === 0n) {
      checksum.status = 'contradiction';
      issues.push({ code: 'checksum-contradiction', severity: 'error' });
    } else {
      checksum.status = unknown.every(isKnown) ? 'recovered' : 'undetermined';
    }
    if (checksum.combinations > 0n && checksum.combinations <= 20n) {
      checksum.assignments = [];
      // Only visit prefixes with a valid suffix. At most 20 solutions exist.
      const visit = (index, remaining, assignment) => {
        if (index === unknown.length) {
          checksum.assignments.push(assignment);
          return;
        }
        for (const id of unknown[index].possible) {
          const next = mod19(remaining - BY_ID.get(id).value);
          if (suffix[index + 1][next] > 0n) visit(index + 1, next, [...assignment, id]);
        }
      };
      visit(0, target, []);
    }
    return checksum;
  }

  function checkStartStop(bars, issues) {
    const positions = [0, 1, 65, 66];
    const actual = positions.map(index => bars[index]);
    const compatible = expected => actual.every((bar, index) => bar === null || bar === expected[index]);
    const normal = compatible([1, 3, 3, 1]);
    const orientation = compatible([1, 2, 2, 1]);
    if (!normal && !orientation) {
      const index = actual.findIndex((bar, i) => bar !== null && bar !== [1, 3, 3, 1][i]);
      issues.push({ code: 'start-stop', severity: 'error', barIndex: positions[index] });
      return 'mismatch';
    }
    if (actual.includes(null)) issues.push({ code: 'start-stop-unknown', severity: 'warning' });
    if (normal) return actual.includes(null) ? 'unknown' : 'normal';
    issues.push({ code: 'orientation', severity: 'error' });
    return 'orientation';
  }

  function letterRange(letters) {
    const groups = [];
    for (let i = 0; i < letters.length;) {
      let end = i;
      while (end + 1 < letters.length && letters[end + 1].charCodeAt(0) === letters[end].charCodeAt(0) + 1) end += 1;
      if (end - i >= 2) groups.push(`${letters[i]}-${letters[end]}`);
      else groups.push(...letters.slice(i, end + 1));
      i = end + 1;
    }
    return `[${groups.join(',')}]`;
  }

  function describeAddress(chars, issues) {
    const address = chars.slice(7, 20);
    const tokens = [];
    const add = (type, text, charIndexes) => tokens.push({ type, text, charIndexes });
    const issue = (code, severity, charIndex) => issues.push({ code, severity, charIndex });
    let end = 13;
    while (end > 0 && isKnown(address[end - 1]) && address[end - 1].symbol === 'CC4') end -= 1;
    const paddingCount = 13 - end;
    for (let i = 0; i < end; i += 1) {
      const char = address[i];
      const next = address[i + 1];
      const id = char.symbol;
      if (!isKnown(char)) {
        const indexes = [char.index];
        if (next && isKnown(next) && isDigit(next.symbol) && char.possible.some(isControl)) {
          indexes.push(next.index);
          i += 1;
        }
        add('unknown', '?', indexes);
      } else if (isDigit(id) || id === '-') {
        add('char', id, [char.index]);
      } else if (isControl(id)) {
        if (i === 12) {
          const ranges = { CC1: '[A-J]', CC2: '[K-T]', CC3: '[U-Z]' };
          add('letter-range', ranges[id], [char.index]);
          issue('truncated-letter', 'info', char.index);
        } else if (isKnown(next) && isDigit(next.symbol)) {
          const letter = letterFor(id, Number(next.symbol));
          add(letter ? 'letter' : 'reserved', letter || `[${id}+${next.symbol}]`, [char.index, next.index]);
          if (!letter) issue('letter-undefined', 'warning', char.index);
          i += 1;
        } else if (!isKnown(next)) {
          const letters = next.possible.filter(isDigit).map(digit => letterFor(id, Number(digit))).filter(Boolean);
          add('letter-range', letters.length ? letterRange(letters) : `[${id}+?]`, [char.index, next.index]);
          i += 1;
        } else {
          add('reserved', `[${id}]`, [char.index]);
          issue('letter-incomplete', 'warning', char.index);
        }
      } else if (id === 'CC4') {
        const maybePadding = address.slice(i).every(item => !isKnown(item) || item.symbol === 'CC4');
        if (maybePadding) {
          const indexes = [char.index];
          while (i + 1 < end && isKnown(address[i + 1]) && address[i + 1].symbol === 'CC4') {
            i += 1;
            indexes.push(address[i].index);
          }
          add('padding-candidate', '\u2026', indexes);
        } else {
          add('padding-middle', '[CC4]', [char.index]);
          issue('cc4-middle', 'warning', char.index);
        }
      } else {
        add('reserved', `[${id}]`, [char.index]);
        issue('reserved-cc', 'warning', char.index);
      }
    }
    if (address[0].symbol === '-') issue('leading-hyphen', 'warning', 7);
    for (let i = 1; i < address.length; i += 1) {
      if (address[i - 1].symbol === '-' && address[i].symbol === '-') issue('double-hyphen', 'warning', i + 7);
    }
    for (let i = 0; i < tokens.length; i += 1) {
      if (tokens[i].type !== 'letter') continue;
      for (const adjacent of [tokens[i - 1], tokens[i + 1]]) {
        if (adjacent && adjacent.type === 'char' && adjacent.text === '-') {
          const index = adjacent.charIndexes[0];
          if (!issues.some(item => item.code === 'hyphen-next-to-letter' && item.charIndex === index)) {
            issue('hyphen-next-to-letter', 'warning', index);
          }
        }
      }
    }
    if (paddingCount && end > 0 && address[end - 1].symbol === '-') issue('hyphen-before-padding', 'info', end + 6);
    if (isKnown(address[12]) && address[12].symbol !== 'CC4') {
      issue('address-full', 'info', 19);
      if (address[12].symbol === '-') issue('truncated-hyphen', 'info', 19);
    }
    if (paddingCount === 13) issues.push({ code: 'individual-number', severity: 'info' });
    if (chars.slice(0, 20).every(isKnown)) {
      const postal = chars.slice(0, 7).map(char => char.symbol).join('');
      const number = address.slice(0, end).map(char => char.symbol).join('');
      if (/^\d{1,4}$/.test(number) && paddingCount && (/91$/.test(postal) || /^\d{3}869\d$/.test(postal))) {
        issues.push({ code: 'po-box-bulk', severity: 'info' });
      }
      if (/^\d{3}$/.test(number) && paddingCount === 10 && (/90$/.test(postal) || /^\d{3}878\d$/.test(postal))) {
        issues.push({ code: 'business-reply-bulk', severity: 'info' });
      }
    }
    return {
      text: tokens.map(token => token.text).join(''), tokens, paddingCount,
      complete: !tokens.some(token => ['unknown', 'letter-range', 'padding-candidate'].includes(token.type))
    };
  }

  function decodeInternal(bars, inspectOrientation) {
    const issues = [];
    const result = {
      status: 'invalid', barCount: bars.length, startStop: null, chars: [],
      checksum: uncheckedChecksum(), checkDigit: null, postalCode: null,
      addressNumber: null, issues, alternatives: []
    };
    if (bars.length !== BAR_COUNT) {
      issues.push({ code: 'bar-count', severity: 'error', count: bars.length });
      return result;
    }
    result.startStop = checkStartStop(bars, issues);
    for (let index = 0; index < CHAR_COUNT; index += 1) {
      result.chars.push(readCharacter(bars.slice(2 + index * 3, 5 + index * 3), index, issues));
    }
    const chars = result.chars;
    result.checksum = solveChecksum(chars, issues);
    if (isKnown(chars[20])) result.checkDigit = { symbol: chars[20].symbol, value: chars[20].value };
    const digits = chars.slice(0, 7).map(char => isDigit(char.symbol) ? char.symbol : '?').join('');
    result.postalCode = { digits, display: `${digits.slice(0, 3)}-${digits.slice(3)}`, complete: !digits.includes('?') };
    result.addressNumber = describeAddress(chars, issues);
    const hasError = issues.some(issue => issue.severity === 'error');
    result.status = hasError ? 'invalid' : result.checksum.status === 'ok' ? 'ok' : result.checksum.status;
    if (hasError) result.issues = issues.filter(issue => issue.severity === 'error' || issue.code === 'start-stop-unknown');
    if (inspectOrientation) {
      if (result.status === 'invalid') {
        for (const transform of ['rotate180', 'flip', 'reverse']) {
          const alternative = decodeInternal(transformBars(bars, transform), false);
          if (alternative.status !== 'invalid') result.alternatives.push({ transform, status: alternative.status });
        }
      } else {
        const reversed = decodeInternal(transformBars(bars, 'reverse'), false);
        if (reversed.status !== 'invalid' && /[0-9]/.test(reversed.postalCode.digits)) {
          result.issues.push({ code: 'mirror-ambiguous', severity: 'warning' });
        }
      }
    }
    const severity = { error: 0, warning: 1, info: 2 };
    result.issues.sort((left, right) => severity[left.severity] - severity[right.severity]
      || (left.charIndex ?? -1) - (right.charIndex ?? -1)
      || (left.code < right.code ? -1 : left.code > right.code ? 1 : 0));
    return result;
  }

  function decodeBars(bars) {
    validateBars(bars);
    return decodeInternal(bars, true);
  }

  function explainChecksum(result) {
    if (!result.chars.length || result.checksum.status === 'not-checked') return null;
    // Recovered symbols remain unknown terms in the explanation.
    const terms = result.chars.slice(0, 20).map(char => char.status === 'read' ? char.value : null);
    const knownSum = terms.reduce((sum, value) => sum + (value === null ? 0 : value), 0);
    const unknownCount = terms.filter(value => value === null).length;
    const expected = unknownCount === 0 ? mod19(-knownSum) : null;
    const read = result.chars[20].status === 'read' ? result.chars[20].value : null;
    return {
      postalTerms: terms.slice(0, 7), addressTerms: terms.slice(7), knownSum, unknownCount,
      remainder: knownSum % 19, expected, read,
      match: expected !== null && read !== null ? expected === read : null
    };
  }

  return Object.freeze({
    SYMBOLS, START, STOP, BAR_COUNT, CHAR_COUNT, POSTAL_LENGTH, ADDRESS_LENGTH, POSITION_CANDIDATES, GEOMETRY,
    parseBarText, formatBarText, decodeBars, checkDigitFor, encodeChars, encodeAddress,
    transformBars, maskChars, letterFor, explainChecksum
  });
});
