(function () {
  'use strict';

  const core = globalThis.PostMirrorCore;
  const samples = globalThis.PostMirrorSamples;
  const messages = globalThis.PostMirrorMessages;
  const state = {
    bars: Array(67).fill(undefined), selected: 0, result: null,
    lastSample: null, errors: [], announcement: null, undo: null
  };
  const element = id => document.getElementById(id);
  const record = (key, params = {}) => ({ key, params });
  const plural = (key, count, params = {}) => record(`${key}.${count === 1 ? 'one' : 'other'}`, { count, ...params });
  const translate = (key, params = {}) => messages.ja[key].replace(/\{(\w+)\}/g, (_, name) =>
    params[name]?.key ? message(params[name]) : String(params[name]));
  const message = item => translate(item.key, item.params);
  const node = (tag, text, className) => {
    const result = document.createElement(tag);
    if (text !== undefined) result.textContent = text;
    if (className) result.className = className;
    return result;
  };
  const svgNode = (tag, attributes = {}) => {
    const result = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attributes)) result.setAttribute(key, value);
    return result;
  };
  const groups = [
    { section: 'start', start: 0, length: 2, number: '' },
    ...Array.from({ length: 21 }, (_, index) => ({
      section: index < 7 ? 'postal' : index < 20 ? 'address' : 'cd',
      start: 2 + 3 * index, length: 3, number: index < 7 ? index + 1 : index < 20 ? index - 6 : '', index
    })),
    { section: 'stop', start: 65, length: 2, number: '' }
  ];
  const sections = [
    ['start', 0, 2], ['postal', 2, 21], ['address', 23, 39], ['cd', 62, 3], ['stop', 65, 2]
  ];
  const groupFor = index => groups.find(group => index >= group.start && index < group.start + group.length);
  const shapeKey = value => value === undefined ? 'empty' : value === null ? 'unknown' : value;
  const complete = () => state.bars.every(value => value !== undefined);
  const buttons = [];
  const cards = [];

  function barLabel(index) {
    const group = groupFor(index);
    return record(group.length === 2 ? 'bar.markerLabel' : 'bar.label', {
      number: index + 1, section: record(`section.${group.section}`),
      character: group.number || 1, offset: index - group.start + 1,
      shape: record(`shape.${shapeKey(state.bars[index])}`)
    });
  }

  function drawBar(parent, value, x, y, scale) {
    const geometry = core.GEOMETRY;
    const long = geometry.longBar;
    const height = value === 1 ? long : value === 4 ? geometry.timingBar : geometry.semiLongBar;
    const offset = value === 3 ? long - height : value === 4 ? (long - height) / 2 : 0;
    const unknown = value === null || value === undefined;
    parent.append(svgNode('rect', {
      x, y: y + (unknown ? 0 : offset * scale), width: geometry.barWidth * scale,
      height: (unknown ? long : height) * scale,
      class: value === undefined ? 'empty-bar' : value === null ? 'unknown-bar' : 'bar-shape'
    }));
    if (value === null) {
      for (let i = 0; i < long - 1; i += 1) {
        parent.append(svgNode('line', { x1: x, y1: y + (i + 1) * scale, x2: x + scale, y2: y + i * scale, class: 'hatch' }));
      }
      const mark = svgNode('text', { x: x + scale / 2, y: y + 4 * scale, class: 'unknown-mark' });
      mark.textContent = translate('symbol.unknown');
      parent.append(mark);
    }
  }

  function shapeSvg(value) {
    const svg = svgNode('svg', { viewBox: '0 0 24 36', 'aria-hidden': 'true' });
    drawBar(svg, value, 9.5, 3, 5);
    return svg;
  }

  function buildInput() {
    for (const group of groups) {
      const card = node('div', undefined, `bar-card${group.length === 2 ? ' marker-card' : ''}`);
      card.setAttribute('role', 'group');
      const label = translate('card.label', { section: translate(`section.${group.section}`), number: group.number });
      card.setAttribute('aria-label', label);
      card.append(node('p', label, 'card-heading'));
      card.append(node('p', translate('card.range', { start: group.start + 1, end: group.start + group.length }), 'card-range'));
      const row = node('div', undefined, 'card-bars');
      for (let index = group.start; index < group.start + group.length; index += 1) {
        const button = node('button', undefined, 'bar-button');
        button.type = 'button';
        button.dataset.barIndex = index;
        button.addEventListener('click', () => selectBar(index, false));
        row.append(button);
        buttons.push(button);
      }
      const symbol = node('p', undefined, 'card-symbol');
      card.append(row, symbol);
      element('bar-grid').append(card);
      cards.push({ group, symbol });
    }
    for (const value of [1, 2, 3, 4, null]) {
      const button = node('button', undefined, 'palette-button');
      button.type = 'button';
      button.dataset.value = value === null ? '?' : value;
      button.setAttribute('aria-label', translate(`shape.${shapeKey(value)}`));
      button.append(shapeSvg(value), node('span', value === null ? '?' : String(value)));
      button.addEventListener('click', () => setBar(value, true, false));
      element('bar-palette').append(button);
    }
    const select = element('sample-select');
    const placeholder = node('option', translate('sample.choose'));
    placeholder.value = '';
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder);
    samples.barcodes.forEach((sample, index) => {
      const option = node('option', translate(sample.labelKey));
      option.value = index;
      select.append(option);
    });
  }

  function renderSelection() {
    buttons.forEach((button, index) => {
      button.tabIndex = index === state.selected ? 0 : -1;
      button.setAttribute('aria-pressed', String(index === state.selected));
    });
    element('selected-bar').textContent = translate('input.selected', { number: state.selected + 1 });
  }

  function selectBar(index, focus) {
    state.selected = Math.max(0, Math.min(66, index));
    renderSelection();
    if (focus) buttons[state.selected].focus({ preventScroll: true });
    if (focus) buttons[state.selected].scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }

  function renderOverview() {
    const svg = svgNode('svg', { viewBox: '0 0 670 94', role: 'img', class: 'overview-svg' });
    svg.setAttribute('aria-label', translate('overview.title'));
    svg.setAttribute('aria-describedby', 'overview-summary');
    state.bars.forEach((value, index) => {
      const group = svgNode('g', { 'data-overview-index': index, 'data-value': shapeKey(value) });
      drawBar(group, value, index * core.GEOMETRY.pitch * 5 + 2.5, 5, 5);
      svg.append(group);
    });
    if (inspectable()) {
      for (const char of state.result.chars) {
        const label = inspectionLabel(char);
        const x = (2 + char.index * 3) * 10 + 12.5;
        const color = char.status === 'read' || char.status === 'recovered' ? 'warn' : 'ok';
        svg.append(svgNode('rect', { x: x - 9, y: 39, width: 18, height: 19, class: `inspection-background ${color}` }));
        const mark = svgNode('text', { x, y: 54, class: `overview-inspection ${color}`, 'data-inspection': char.status });
        mark.textContent = message(label).split(' ')[0];
        const title = svgNode('title');
        title.textContent = message(label);
        mark.append(title);
        svg.append(mark);
      }
    }
    const summaries = [];
    for (const [section, start, length] of sections) {
      const x = start * 10;
      svg.append(svgNode('rect', { x, y: 62, width: length * 10, height: 30, class: `band band-${section}` }));
      if (['postal', 'address'].includes(section)) {
        const label = svgNode('text', { x: x + length * 5, y: 84, class: 'band-label', 'data-band-width': length * 10 });
        label.textContent = translate(`section.${section}`);
        svg.append(label);
      } else {
        const pattern = svgNode('path', { d: `M${x + 2} 67h${length * 10 - 4}m0 8h-${length * 10 - 4}`, class: 'hatch' });
        svg.append(pattern);
        const symbol = svgNode('text', { x: x + length * 5, y: 85, class: 'band-symbol' });
        symbol.textContent = { start: 'S', cd: 'C', stop: 'E' }[section];
        svg.append(symbol);
      }
      summaries.push(message(plural('overview.summary', state.bars.slice(start, start + length).filter(x => x !== undefined).length, {
        section: translate(`section.${section}`), total: length
      })));
    }
    element('overview').replaceChildren(svg);
    element('overview-summary').textContent = summaries.join(' ');
  }

  function renderInput() {
    buttons.forEach((button, index) => {
      button.dataset.value = shapeKey(state.bars[index]);
      button.setAttribute('aria-label', message(barLabel(index)));
      button.replaceChildren(shapeSvg(state.bars[index]));
    });
    cards.forEach(({ group, symbol }) => {
      const char = state.result?.chars[group.index];
      symbol.textContent = group.length === 2 ? translate('symbol.marker')
        : char ? char.symbol ?? translate('symbol.unknown') : translate('symbol.pending');
      if (char && inspectable()) {
        symbol.append(node('br'), inspectionBadge(char));
      }
    });
    const count = state.bars.filter(value => value !== undefined).length;
    element('input-progress').textContent = message(plural('input.progress', count));
    renderSelection();
    renderOverview();
    element('input-announcement').textContent = state.announcement ? message(state.announcement) : '';
  }

  function visibleChar(char) {
    return /[\s\p{Cc}\p{Cf}\u202a-\u202e\u2066-\u2069\u200b-\u200f]/u.test(char)
      ? `U+${char.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}` : char;
  }

  function renderErrors() {
    const container = element('text-errors');
    container.replaceChildren();
    for (const error of state.errors) {
      const paragraph = node('p');
      if (error.key === 'text.invalid-char') {
        for (const part of messages.ja[error.key].split(/(\{\w+\})/)) {
          if (part === '{char}') paragraph.append(node('bdi', visibleChar(error.params.char)));
          else paragraph.append(document.createTextNode(part.replace(/\{(\w+)\}/g, (_, key) => error.params[key])));
        }
      } else paragraph.textContent = message(error);
      container.append(paragraph);
    }
    element('bar-text').setAttribute('aria-invalid', String(state.errors.some(item => item.key !== 'text.accepted')));
  }

  function changed(fromText = false) {
    state.result = complete() ? core.decodeBars(state.bars) : null;
    if (!fromText) {
      element('bar-text').value = complete() ? core.formatBarText(state.bars, { group: true }) : '';
      state.errors = [];
    }
    renderInput();
    renderErrors();
    renderControls();
    renderResult();
  }

  function setBar(value, advance, focus) {
    state.undo = null;
    state.bars[state.selected] = value;
    state.announcement = barLabel(state.selected);
    if (advance) state.selected = Math.min(66, state.selected + 1);
    changed();
    selectBar(state.selected, focus);
  }

  function remember() {
    state.undo = { bars: state.bars.slice(), selected: state.selected, lastSample: state.lastSample };
  }

  function rangeValues() {
    const values = ['range-start', 'range-end'].map(id => {
      const text = element(id).value.trim();
      return text === '' ? NaN : Number(text);
    });
    return values.every(value => Number.isInteger(value) && value >= 1 && value <= 67) && values[0] <= values[1] ? values : null;
  }

  function renderControls() {
    element('undo').disabled = state.undo === null;
    element('clear').disabled = state.bars.every(value => value === undefined) && element('bar-text').value === '';
    element('range-apply').disabled = rangeValues() === null;
    element('range-reason').textContent = rangeValues() === null ? translate('range.invalid') : '';
    element('mask-reason').hidden = state.lastSample !== null;
    document.querySelectorAll('[data-preset]').forEach(button => { button.disabled = state.lastSample === null; });
  }

  function judgment(result) {
    const has = code => result.issues.some(issue => issue.code === code);
    if (has('bar-count')) return record('judgment.bar-count');
    if (result.alternatives.length || has('orientation')) return record('judgment.direction');
    if (has('start-stop')) return record('judgment.start-stop');
    if (has('invalid-pattern') || has('no-candidate')) return record('judgment.pattern');
    if (has('postal-not-digit')) return record('judgment.postal-not-digit');
    if (has('checksum-contradiction')) return record('judgment.checksum-contradiction');
    if (has('checksum-mismatch')) return record('judgment.checksum-mismatch');
    return record(`judgment.${result.status}`);
  }

  function inspectable() {
    return state.result !== null && !['not-checked', 'contradiction'].includes(state.result.checksum.status);
  }

  function inspectionLabel(char) {
    if (char.status === 'read') return record(char.partial ? 'inspection.partial' : 'inspection.read');
    if (char.status === 'recovered') return record('inspection.recovered');
    if (['candidates', 'hidden'].includes(char.status) && char.possible.length >= 2) {
      return plural('inspection.hidden', char.possible.length);
    }
    return record('inspection.unavailable');
  }

  function inspectionBadge(char) {
    const color = char.status === 'read' || char.status === 'recovered' ? 'warn' : 'ok';
    const badge = node('span', message(inspectionLabel(char)), `inspection-label ${color}`);
    badge.dataset.inspection = char.status;
    badge.dataset.charIndex = char.index;
    return badge;
  }

  function appendMessage(parent, item, tag = 'p') {
    const child = node(tag, message(item));
    child.dataset.messageKey = item.key;
    parent.append(child);
    return child;
  }

  function valueToken(text, indexes) {
    const token = node('span', undefined, 'value-token');
    token.append(node('bdi', text));
    if (indexes.some(index => state.result.chars[index].status === 'recovered')) {
      token.append(node('span', translate('result.calculated'), 'calculated-mark'));
    }
    return token;
  }

  function renderReadable() {
    const result = state.result;
    const postal = element('postal-result');
    postal.dataset.value = result.postalCode.display;
    [...result.postalCode.digits].forEach((digit, index) => {
      if (index === 3) postal.append(document.createTextNode('-'));
      postal.append(valueToken(digit, [index]));
    });
    for (const issue of result.issues.filter(item => item.code === 'postal-not-digit')) {
      appendMessage(element('postal-notes'), record('result.nonDigit', { position: issue.charIndex + 1 }));
    }
    const address = element('address-result');
    address.dataset.value = result.addressNumber.text;
    result.addressNumber.tokens.forEach(token => address.append(valueToken(token.text, token.charIndexes)));
    if (result.addressNumber.text === '') address.textContent = translate('result.emptyAddress');
  }

  function issueMessage(issue) {
    const description = issue.code === 'bar-count' ? plural('issue.bar-count', issue.count) : record(`issue.${issue.code}`);
    if (issue.charIndex !== undefined) {
      return record('issue.position', { position: issue.charIndex + 1, detail: description });
    }
    if (issue.barIndex !== undefined) {
      return record('issue.barPosition', { position: issue.barIndex + 1, detail: description });
    }
    return description;
  }

  function renderInspection() {
    const container = element('inspection');
    const result = state.result;
    if (!inspectable()) {
      appendMessage(container, record(`inspection.${result.checksum.status}`));
      return;
    }
    const leaked = chars => chars.filter(char => char.status === 'read' || char.status === 'recovered').length;
    appendMessage(container, plural('inspection.postalSummary', leaked(result.chars.slice(0, 7))));
    appendMessage(container, plural('inspection.summary', leaked(result.chars.slice(7, 20)), {
      section: translate('section.address'), total: 13
    }));
    if (!state.bars.includes(null)) appendMessage(container, record('inspection.hint'));
    const list = node('ul', undefined, 'inspection-list');
    for (const char of result.chars) {
      const item = node('li');
      item.append(document.createTextNode(translate('inspection.item', {
        position: char.index + 1, section: translate(`section.${char.section}`), label: ''
      })), inspectionBadge(char));
      list.append(item);
    }
    container.append(list);
    if (result.checksum.combinations !== null) {
      const count = result.checksum.combinations;
      appendMessage(container, record(`inspection.combinations.${count === 1n ? 'one' : 'other'}`, { count: count.toString() }));
      appendMessage(container, record('inspection.ruleLimit'));
    }
    if (result.chars.some(char => char.status === 'recovered')) appendMessage(container, record('inspection.assumption'));
    if ([0, 1, 65, 66].some(index => state.bars[index] === null)) appendMessage(container, record('inspection.markers'));
    if (state.bars.slice(50, 62).includes(null)) appendMessage(container, record('inspection.padding'));
    if (!result.chars.some(char => ['hidden', 'candidates'].includes(char.status))) {
      appendMessage(container, record('inspection.cover'));
    }
  }

  function checkValue(value) {
    if (value === null) return translate('symbol.unknown');
    return value < 10 ? String(value) : translate('checksum.symbolValue', { value, symbol: core.SYMBOLS[value].id });
  }

  function renderChecksum() {
    const container = element('checksum');
    const parts = core.explainChecksum(state.result);
    if (parts === null) {
      appendMessage(container, record('checksum.unavailable'));
      return;
    }
    for (const section of ['postal', 'address']) {
      const terms = parts[`${section}Terms`];
      appendMessage(container, record(`checksum.${section}`, {
        terms: terms.map(term => term === null ? '?' : String(term)).join(translate('checksum.plus')),
        sum: terms.includes(null) ? '?' : terms.reduce((sum, value) => sum + value, 0)
      }));
    }
    if (parts.unknownCount) {
      appendMessage(container, plural('checksum.unknown', parts.unknownCount, { sum: parts.knownSum }));
    } else {
      appendMessage(container, record('checksum.total', {
        sum: parts.knownSum, quotient: Math.floor(parts.knownSum / 19), remainder: parts.remainder
      }));
      appendMessage(container, record(parts.remainder === 0 ? 'checksum.zero' : 'checksum.expected', {
        remainder: parts.remainder, expected: checkValue(parts.expected)
      }));
    }
    appendMessage(container, record('checksum.read', {
      read: checkValue(parts.read),
      match: translate(parts.match === null ? 'checksum.noComparison' : parts.match ? 'checksum.match' : 'checksum.mismatch')
    }));
    if (parts.match === false) {
      appendMessage(container, record('checksum.disagree', { expected: checkValue(parts.expected), read: checkValue(parts.read) }));
    }
  }

  function renderBreakdown() {
    const table = element('breakdown');
    const columns = ['position', 'section', 'bars', 'symbol', 'value', 'inspection'];
    const head = node('thead');
    const heading = node('tr');
    columns.forEach(column => {
      const cell = node('th', translate(`column.${column}`));
      cell.scope = 'col';
      heading.append(cell);
    });
    head.append(heading);
    const body = node('tbody');
    for (const char of state.result.chars) {
      const row = node('tr');
      row.dataset.charIndex = char.index;
      row.dataset.status = char.status;
      const cells = {};
      for (const column of columns) {
        const cell = node('td');
        cell.dataset.label = translate(`column.${column}`);
        cell.dataset.column = column;
        row.append(cell);
        cells[column] = cell;
      }
      cells.position.textContent = translate('breakdown.position', { position: char.index + 1 });
      cells.section.textContent = translate(`section.${char.section}`);
      const barText = char.bars.map(value => value === null ? '?' : String(value)).join(' ');
      const svg = svgNode('svg', { viewBox: '0 0 36 36', role: 'img', class: 'mini-bars' });
      svg.setAttribute('aria-label', translate('breakdown.barText', { bars: barText }));
      char.bars.forEach((value, index) => drawBar(svg, value, index * 12 + 3, 3, 5));
      cells.bars.append(svg, node('bdi', barText));
      cells.symbol.append(node('bdi', char.symbol ?? '?'));
      const letter = state.result.addressNumber.tokens.find(token => token.type === 'letter' && token.charIndexes.includes(char.index));
      if (letter) {
        const description = letter.charIndexes[0] === char.index ? record('breakdown.control')
          : record('breakdown.letter', { digit: char.symbol, letter: letter.text });
        appendMessage(cells.symbol, description);
      }
      cells.value.textContent = char.value === null ? '?' : String(char.value);
      if (inspectable()) cells.inspection.append(inspectionBadge(char));
      else cells.inspection.textContent = translate('inspection.unavailable');
      if (['invalid-pattern', 'no-candidate'].includes(char.status)) {
        const mask = node('button', translate('character.mask'));
        mask.type = 'button';
        mask.dataset.maskChar = char.index;
        mask.addEventListener('click', () => {
          remember();
          state.bars = core.maskChars(state.bars, [char.index]);
          state.announcement = record('character.masked', { position: char.index + 1 });
          changed();
          element('judgment').scrollIntoView({ block: 'nearest' });
        });
        cells.inspection.append(mask);
      }
      body.append(row);
    }
    table.append(head, body);
  }

  function renderResult() {
    const ids = ['judgment', 'alternatives', 'postal-result', 'address-result', 'postal-notes', 'issues', 'inspection', 'checksum', 'breakdown'];
    ids.forEach(id => element(id).replaceChildren());
    element('result').hidden = state.result === null;
    if (state.result === null) {
      delete element('postal-result').dataset.value;
      delete element('address-result').dataset.value;
      delete element('judgment').dataset.messageKey;
      return;
    }
    const status = judgment(state.result);
    element('judgment').textContent = message(status);
    element('judgment').dataset.messageKey = status.key;
    for (const alternative of state.result.alternatives) {
      const button = node('button', translate(`transform.${alternative.transform}`));
      button.type = 'button';
      button.dataset.transform = alternative.transform;
      button.addEventListener('click', () => {
        remember();
        state.bars = core.transformBars(state.bars, alternative.transform);
        state.announcement = record('transform.applied');
        changed();
      });
      element('alternatives').append(button);
    }
    renderReadable();
    state.result.issues.forEach(issue => {
      const item = appendMessage(element('issues'), issueMessage(issue), 'li');
      item.dataset.issue = issue.code;
    });
    renderInspection();
    renderChecksum();
    renderBreakdown();
  }

  element('bar-grid').addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const group = groupFor(state.selected);
    const groupIndex = groups.indexOf(group);
    const moves = {
      ArrowLeft: state.selected - 1, ArrowRight: state.selected + 1,
      ArrowUp: groups[Math.max(0, groupIndex - 1)].start,
      ArrowDown: groups[Math.min(groups.length - 1, groupIndex + 1)].start,
      Home: 0, End: 66
    };
    const aliases = { f: 1, a: 2, d: 3, t: 4, '?': null, '1': 1, '2': 2, '3': 3, '4': 4 };
    if (Object.hasOwn(moves, event.key)) selectBar(moves[event.key], true);
    else if (Object.hasOwn(aliases, event.key.toLowerCase())) setBar(aliases[event.key.toLowerCase()], true, true);
    else if (event.key === 'Delete' || event.key === 'Backspace') {
      setBar(undefined, false, false);
      selectBar(state.selected - (event.key === 'Backspace' ? 1 : 0), true);
    } else return;
    event.preventDefault();
  });

  element('sample-select').addEventListener('change', event => {
    const sample = samples.barcodes[Number(event.target.value)];
    remember();
    state.bars = core.encodeAddress(sample.postalCode, sample.addressNumber).bars;
    state.lastSample = Number(event.target.value);
    state.selected = 0;
    state.announcement = record('sample.loaded', { sample: record(sample.labelKey) });
    changed();
  });

  element('bar-text').addEventListener('input', event => {
    state.undo = null;
    const parsed = core.parseBarText(event.target.value);
    state.errors = parsed.errors.map(error => record(`text.${error.code}`, { position: error.index + 1, char: error.char }));
    if (parsed.bars && parsed.bars.length !== 67) {
      state.errors = [plural(parsed.bars.length < 67 ? 'barsShort' : 'barsLong', Math.abs(parsed.bars.length - 67), {
        total: parsed.bars.length
      })];
    }
    if (parsed.bars?.length === 67) {
      state.bars = parsed.bars;
      state.errors = [record('text.accepted')];
      state.announcement = record('text.accepted');
      changed(true);
    } else {
      renderErrors();
      renderControls();
    }
  });

  element('clear').addEventListener('click', () => {
    if (element('clear').disabled) return;
    remember();
    state.bars = Array(67).fill(undefined);
    state.selected = 0;
    state.announcement = record('actions.cleared');
    changed();
  });
  element('undo').addEventListener('click', () => {
    if (state.undo === null) return;
    Object.assign(state, state.undo, { undo: null, announcement: record('actions.undone') });
    element('sample-select').value = state.lastSample === null ? '' : String(state.lastSample);
    changed();
  });
  element('mask-presets').addEventListener('click', event => {
    const button = event.target.closest('[data-preset]');
    if (!button || button.disabled || state.lastSample === null) return;
    remember();
    const sample = samples.barcodes[state.lastSample];
    const bars = core.encodeAddress(sample.postalCode, sample.addressNumber).bars;
    const preset = button.dataset.preset;
    if (preset === 'cd') bars.fill(null, 62, 65);
    if (preset === 'central') for (let index = 0; index < 21; index += 1) bars[3 + index * 3] = null;
    if (preset === 'latter') bars.fill(null, 44);
    if (preset === 'all') bars.fill(null);
    state.bars = bars;
    state.announcement = record('mask.applied', { preset: record(`mask.${preset}`) });
    changed();
  });
  for (const id of ['range-start', 'range-end']) element(id).addEventListener('input', renderControls);
  element('range-apply').addEventListener('click', () => {
    const range = rangeValues();
    if (range === null) return;
    remember();
    const [start, end] = range;
    state.bars = state.bars.slice();
    state.bars.fill(null, start - 1, end);
    state.announcement = plural('range.applied', end - start + 1, { start, end });
    changed();
  });

  for (const target of document.querySelectorAll('[data-i18n]')) target.textContent = translate(target.dataset.i18n);
  element('bar-text').placeholder = translate('text.placeholder');
  element('bar-grid').setAttribute('aria-label', translate('input.group'));
  element('bar-palette').setAttribute('aria-label', translate('palette.label'));
  buildInput();
  changed();
})();
