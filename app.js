(function () {
  'use strict';

  const core = globalThis.PostMirrorCore;
  const samples = globalThis.PostMirrorSamples;
  const messages = globalThis.PostMirrorMessages;
  const state = {
    bars: Array(67).fill(undefined), selected: 0, result: null,
    lastSample: null, errors: [], announcement: null
  };
  const element = id => document.getElementById(id);
  const record = (key, params = {}) => ({ key, params });
  const plural = (key, count, params = {}) => record(`${key}.${count === 1 ? 'one' : 'other'}`, { count, ...params });
  const translate = (key, params = {}) => messages.ja[key].replace(/\{(\w+)\}/g, (_, name) => String(params[name]));
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
      number: index + 1, section: translate(`section.${group.section}`),
      character: group.number || 1, offset: index - group.start + 1,
      shape: translate(`shape.${shapeKey(state.bars[index])}`)
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
  }

  function setBar(value, advance, focus) {
    state.bars[state.selected] = value;
    state.announcement = barLabel(state.selected);
    if (advance) state.selected = Math.min(66, state.selected + 1);
    changed();
    selectBar(state.selected, focus);
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
    state.bars = core.encodeAddress(sample.postalCode, sample.addressNumber).bars;
    state.lastSample = Number(event.target.value);
    state.selected = 0;
    state.announcement = record('sample.loaded', { sample: translate(sample.labelKey) });
    changed();
  });

  element('bar-text').addEventListener('input', event => {
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
    } else renderErrors();
  });

  for (const target of document.querySelectorAll('[data-i18n]')) target.textContent = translate(target.dataset.i18n);
  element('bar-text').placeholder = translate('text.placeholder');
  element('bar-grid').setAttribute('aria-label', translate('input.group'));
  element('bar-palette').setAttribute('aria-label', translate('palette.label'));
  buildInput();
  changed();
})();
