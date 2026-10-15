(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.PostMirrorExtract = api;
})(globalThis, function () {
  'use strict';

  const KANJI_DIGITS = Object.freeze({
    一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9
  });

  function convertNumeral(unit) {
    if (Object.hasOwn(KANJI_DIGITS, unit)) return String(KANJI_DIGITS[unit]);
    const tens = /^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/.exec(unit);
    if (!tens) return null;
    return String((tens[1] ? KANJI_DIGITS[tens[1]] : 1) * 10 + (tens[2] ? KANJI_DIGITS[tens[2]] : 0));
  }

  function replaceNonExtracted(text) {
    const chars = Array.from(text);
    const isLetter = char => typeof char === 'string' && /^[A-Z]$/.test(char);
    let result = '';
    let pendingHyphen = false;
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index];
      const isolatedLetter = isLetter(char) && !isLetter(chars[index - 1]) && !isLetter(chars[index + 1]);
      const floorSuffix = char === 'F' && /^[0-9]$/.test(chars[index - 1] || '') && !isLetter(chars[index + 1]);
      const keep = /^[0-9-]$/.test(char) || (isolatedLetter && !floorSuffix);
      if (keep) {
        if (pendingHyphen) result += '-';
        result += char;
        pendingHyphen = false;
      } else {
        pendingHyphen = true;
      }
    }
    return result;
  }

  function extractAddressNumber(addressB) {
    if (typeof addressB !== 'string') throw new TypeError('Address B must be a string');
    const steps = [];
    const warnings = [];
    let text = addressB;
    const step = (id, transform) => {
      text = transform(text);
      steps.push({ id, text });
    };
    // 日本郵便のマニュアルp19。規定のない正規化は1文字ずつ適用する。
    step('normalize', value => Array.from(value, char => char.normalize('NFKC')).join('').replace(/[\u2010-\u2015\u2212]/g, '-'));
    step('uppercase', value => value.replace(/[a-z]/g, char => char.toUpperCase()));
    step('remove-symbols', value => value.replace(/[&/・.]/g, ''));
    step('kanji-numerals', value => value.replace(
      /([一二三四五六七八九十〇百千万壱弐参拾]+)(丁目|番地|地割|丁|番|号|線|の|ノ)/g,
      (match, unit, suffix) => {
        const converted = convertNumeral(unit);
        if (converted !== null) return converted + suffix;
        if (!warnings.some(warning => warning.code === 'kanji-numeral-unsupported')) {
          warnings.push({ code: 'kanji-numeral-unsupported' });
        }
        return match;
      }
    ));
    step('replace', replaceNonExtracted);
    step('collapse-hyphens', value => value.replace(/-+/g, '-'));
    step('trim-leading-hyphen', value => value.replace(/^-/, ''));
    step('join-letters', value => value.replace(/-([A-Z])/g, '$1').replace(/([A-Z])-/g, '$1'));
    return { result: text, steps, warnings };
  }

  return Object.freeze({ extractAddressNumber });
});
