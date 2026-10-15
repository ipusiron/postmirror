'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const sourceFiles = ['barcode-core.js', 'extract-core.js'];
const testFiles = fs.readdirSync(__dirname).filter(file => file.endsWith('.js')).map(file => `test/${file}`);

for (const file of [...sourceFiles, ...testFiles]) {
  test(`Format: ${file} has no line longer than 160 characters`, () => {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => assert.ok([...line].length <= 160, `${file}:${index + 1} has ${[...line].length} characters`));
  });
}

for (const [file, minimum] of [['barcode-core.js', 200], ['extract-core.js', 60]]) {
  test(`Format: ${file} has at least ${minimum} lines`, () => {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').trimEnd().split(/\r?\n/);
    assert.ok(lines.length >= minimum, `${file}: ${lines.length} lines`);
  });
}
