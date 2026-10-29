'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { sources, output, bundleSource } = require('../build.js');

test('Build: delivered JavaScript exactly matches the current source files', () => {
  const actual = fs.readFileSync(path.join(__dirname, '..', output), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(actual, bundleSource(), 'Run npm run build after editing any runtime source file');
});

test('Build: the single classic script preserves the dependency order and parses', () => {
  assert.deepEqual(sources, ['barcode-core.js', 'extract-core.js', 'image-core.js', 'samples.js', 'messages.js', 'app.js']);
  const bundle = bundleSource();
  const labels = [...bundle.matchAll(/^\/\/ Source: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(labels, sources);
  assert.doesNotThrow(() => new vm.Script(bundle, { filename: output }));
});
