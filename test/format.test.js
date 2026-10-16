'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const sourceFiles = ['barcode-core.js', 'extract-core.js', 'image-core.js', 'nw7-core.js', 'samples.js', 'messages.js', 'app.js', 'style.css'];
const testFiles = fs.readdirSync(__dirname).filter(file => file.endsWith('.js')).map(file => `test/${file}`);

for (const file of [...sourceFiles, ...testFiles]) {
  test(`Format: ${file} has no line longer than 160 characters`, () => {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => assert.ok([...line].length <= 160, `${file}:${index + 1} has ${[...line].length} characters`));
  });
}

const minimums = [['barcode-core.js', 200], ['extract-core.js', 60], ['samples.js', 40], ['messages.js', 100],
  ['image-core.js', 200], ['index.html', 100], ['style.css', 150], ['app.js', 300]];
for (const [file, minimum] of minimums) {
  test(`Format: ${file} has at least ${minimum} lines`, () => {
    const lines = fs.readFileSync(path.join(root, file), 'utf8').trimEnd().split(/\r?\n/);
    assert.ok(lines.length >= minimum, `${file}: ${lines.length} lines`);
  });
}

test('Format: index.html has no line longer than 250 characters', () => {
  const lines = fs.readFileSync(path.join(root, 'index.html'), 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => assert.ok([...line].length <= 250, `index.html:${index + 1}`));
});
