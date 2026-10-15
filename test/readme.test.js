'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../barcode-core.js');
const extract = require('../extract-core.js');
const messages = require('../messages.js');
const vectors = require('./official-vectors.json').vectors;
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const docs = { ja: read('README.md'), en: read('README.en.md') };
const FORBIDDEN = [
  '既に', '全て', '分かる', '無い', 'インターフェース', 'か所', 'に限る', '想定していない',
  '自分宛てに限', '4ステート', '〒',
  'サーバ(?!ー)', 'ユーザ(?!ー)', 'ブラウザ(?!ー)', 'パラメータ(?!ー)', 'エディタ(?!ー)',
  'フォルダ(?!ー)', 'リポジトリ(?!ー)', 'マネージャ(?!ー)'
];
const headings = [
  ['# PostMirror - 郵便物のバーコードから住所の何が読めるかを確かめる',
    '# PostMirror - See What the Barcode on Your Mail Reveals'],
  ['## 🌐 デモページ', '## 🌐 Demo'], ['## 📸 スクリーンショット', '## 📸 Screenshots'],
  ['## ✨ 機能', '## ✨ Features'], ['## 📖 使い方', '## 📖 How to use'],
  ['## 🎯 ユースケース', '## 🎯 Use cases'],
  ['### このツールならではの使い方', '### Uses specific to this tool'],
  ['### 一般的な用途', '### General uses'],
  ['## 🔬 技術的な説明', '## 🔬 Technical details'], ['## 🔒 セキュリティ', '## 🔒 Security'],
  ['## ⚠️ 注意', '## ⚠️ Notes'], ['## ❓ FAQ', '## ❓ FAQ'],
  ['## 🔗 関連ツール', '## 🔗 Related tools'], ['## 🧪 テスト', '## 🧪 Tests'],
  ['## 📁 ディレクトリー構造', '## 📁 Directory structure'], ['## 💻 動作環境', '## 💻 Requirements'],
  ['## 📄 ライセンス', '## 📄 License'], ['## 🛠️ このツールについて', '## 🛠️ About this tool']
];
const withoutCode = text => text.replace(/```[^\n]*\n[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
const body = text => text.replace(/^<!--[\s\S]*?-->\s*/, '');

function recalculated() {
  const sample = core.encodeAddress('1000013', '1-3-2-503');
  const individual = core.encodeAddress('1008792', '');
  let changes = 0, invalid = 0, other = 0, masks = 0, unique = 0, two = 0;
  for (const symbol of core.SYMBOLS) {
    for (let i = 0; i < 3; i++) {
      masks++;
      const candidates = core.SYMBOLS.filter(s => s.bars.every((b, j) => j === i || b === symbol.bars[j]));
      if (candidates.length === 1) unique++;
      else { assert.equal(candidates.length, 2); two++; }
      for (let value = 1; value <= 4; value++) {
        if (value === symbol.bars[i]) continue;
        changes++;
        const changed = symbol.bars.map((b, j) => j === i ? value : b);
        if (core.SYMBOLS.some(s => s.bars.every((b, j) => b === changed[j]))) other++;
        else invalid++;
      }
    }
  }
  const count = indexes => Number(core.decodeBars(core.maskChars(sample.bars, indexes)).checksum.combinations);
  const long = vectors.find(v => v.addressNumber === '29-1524-23-2-501');
  const extracted = extract.extractAddressNumber(long.sourceText).result;
  const truncated = core.decodeBars(core.encodeAddress(long.postalCode, extracted).bars).addressNumber.text;
  assert.equal(extracted, '29-1524-23-2-501');
  assert.equal(truncated, '29-1524-23-2-');
  return { values: [core.explainChecksum(core.decodeBars(sample.bars)).knownSum, Number(sample.checkDigit),
    changes, invalid, other, masks, unique, count([0, 1]), count([7, 8]), count([0, 1, 2, 3, 4, 5, 6]),
    core.explainChecksum(core.decodeBars(individual.bars)).knownSum, Number(individual.checkDigit),
    truncated.length, extracted.length], two };
}

const patterns = {
  ja: [/合計(\d+)からCD＝(\d+)/, /変える(\d+)通りのうち、(\d+)通りは表にない並び、(\d+)通りは別の記号/,
    /隠す(\d+)通りのうち、(\d+)通り/, /隠すと(\d+)通り、.*?なら(\d+)通り.*?隠しても([\d,]+)通り/,
    /合計(\d+)からCD＝(\d+)/, /抜き出した(\d+)文字のうち(\d+)文字/],
  en: [/sum (\d+) restores CD = (\d+)/, /produces (\d+) cases: (\d+) are absent from the table, and (\d+) become/,
    /Of (\d+) cases.*?symbols, (\d+) are uniquely/, /leaves (\d+) combinations;.*?leaves (\d+) combinations.*?leaves ([\d,]+)/,
    /sum (\d+) gives CD = (\d+)/, /contains (\d+) characters, but only (\d+) characters/]
};

for (const [language, text] of Object.entries(docs)) {
  test(`README ${language}: 14 use-case numbers are extracted and recalculated`, () => {
    const start = language === 'ja' ? '### このツールならではの使い方' : '### Uses specific to this tool';
    const cases = text.split(start)[1].split('\n### ')[0].match(/^\d+\. .+$/gm);
    assert.equal(cases.length, 6);
    const values = [];
    for (const [i, pattern] of patterns[language].entries()) {
      const source = cases[[0, 1, 2, 3, 5, 4][i]];
      const matches = [...source.matchAll(new RegExp(pattern.source, 'g'))];
      assert.equal(matches.length, 1, source);
      const numbers = matches[0].slice(1).map(n => Number(n.replace(/,/g, '')));
      values.push(...(i === 5 ? numbers.reverse() : numbers));
    }
    assert.equal(values.length, 14);
    const result = recalculated();
    assert.deepEqual(values, result.values);
    assert.deepEqual(values, [105, 9, 171, 141, 30, 57, 27, 2, 12, 501529, 209, 0, 13, 16]);
    const extra = cases[2].match(language === 'ja' ? /、(\d+)通りは2候補/ : /and (\d+) have two candidates/);
    assert.ok(extra);
    assert.equal(Number(extra[1]), result.two);
  });

  test(`README ${language}: headings, language link and series are complete`, () => {
    const actual = withoutCode(body(text)).match(/^#+ .+$/gm);
    assert.deepEqual(actual, headings.map(row => row[language === 'ja' ? 0 : 1]));
    assert.doesNotMatch(withoutCode(body(text)), /^#{1,6}[^# \n]|^\d+\.[^ \n]/m);
    assert.ok(body(text).startsWith(language === 'ja' ? '[English](README.en.md) · 日本語' : 'English · [日本語](README.md)'));
    assert.ok(text.includes(language === 'ja' ? '**Day115 - 生成AIで作るセキュリティツール200**'
      : '**Day115 - Security Tools with Generative AI 200**'));
    assert.equal((text.match(/img\.shields\.io\//g) || []).length, 5);
  });

  test(`README ${language}: character table and calculation examples match the core`, () => {
    const rows = [...text.matchAll(/^\| (\d|CC[1-8]|-) \| ([1-4]{3}) \| (\d+) \|$/gm)];
    assert.equal(rows.length, 19);
    assert.deepEqual(rows.map(m => [m[1], m[2], Number(m[3])]), core.SYMBOLS.map(s => [s.id, s.bars.join(''), s.value]));
    const sums = [...text.matchAll(/^S = (\d+).*?CD = (\d+)/gm)];
    assert.equal(sums.length, 2);
    assert.deepEqual(sums.map(m => [Number(m[1]), Number(m[2])]), [[105, 9], [209, 0]]);
    assert.ok(text.includes('CD = (19 − (S mod 19)) mod 19'));
  });

  test(`README ${language}: all PNG files are referenced with captions in the right language`, () => {
    const dir = language === 'ja' ? 'assets' : 'assets/en';
    const refs = [...text.matchAll(/!\[[^\]]*\]\((assets\/[^)]+\.png)\)/g)].map(m => m[1]);
    const files = fs.readdirSync(path.join(root, dir)).filter(f => f.endsWith('.png')).map(f => `${dir}/${f}`);
    assert.deepEqual(refs.slice().sort(), files.sort());
    assert.equal(refs.length, language === 'ja' ? 4 : 3);
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(root, ref)));
      assert.ok(fs.statSync(path.join(root, ref)).size <= 300 * 1024);
    }
    const section = text.split(language === 'ja' ? '## 📸 スクリーンショット' : '## 📸 Screenshots')[1].split('\n## ')[0];
    assert.equal((section.match(/^> \*[^\n]+\*$/gm) || []).length, refs.length);
    if (language === 'en') assert.ok(refs.every(ref => !ref.endsWith('/screenshot4.png')));
  });

  test(`README ${language}: directory tree lists every file and directory with descriptions`, () => {
    const section = text.split(language === 'ja' ? '## 📁 ディレクトリー構造' : '## 📁 Directory structure')[1];
    const tree = section.match(/```text\n([\s\S]*?)\n```/)[1].split('\n');
    const paths = [], stack = [];
    for (const [i, line] of tree.entries()) {
      assert.match(line, /# \S.+$/);
      if (i === 0) { assert.match(line, /^postmirror\//); continue; }
      const match = line.match(/^([│ ]*)(?:├── |└── )([^ ]+)/);
      assert.ok(match, line);
      const depth = match[1].length / 4;
      stack.length = depth;
      const name = match[2];
      paths.push([...stack, name].join('/'));
      if (name.endsWith('/')) stack.push(name.slice(0, -1));
    }
    const actual = [];
    function walk(dir = '') {
      for (const item of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        if (item.name === '.git') continue;
        const name = dir + item.name;
        actual.push(name + (item.isDirectory() ? '/' : ''));
        if (item.isDirectory()) walk(name + '/');
      }
    }
    walk();
    assert.deepEqual(paths.sort(), actual.sort());
  });

  test(`README ${language}: spelling, emphasis and project boilerplate`, () => {
    for (const word of FORBIDDEN) assert.doesNotMatch(text, new RegExp(word, 'u'));
    for (const section of body(text).split(/^#{1,3} .+$/m)) {
      assert.ok((section.match(/\*\*/g) || []).length / 2 <= 2);
    }
    assert.doesNotMatch(text, /^\s*(?:- |\d+\. )\*\*/m);
    assert.doesNotMatch(withoutCode(text).replace(/^\|.*$/gm, ''), /：\s*$/m);
    const about = text.split(language === 'ja' ? '## 🛠️ このツールについて' : '## 🛠️ About this tool')[1];
    assert.match(about, /page_id=44607/);
    assert.doesNotMatch(about, /42163/);
    assert.ok(about.includes(language === 'ja' ? '生成AIで作るセキュリティツール200' : 'Security Tools with Generative AI 200'));
    assert.ok(about.includes(language === 'ja' ? '開発されました。' : 'was developed'));
    assert.ok(about.includes(language === 'ja' ? '100日間にわたり' : 'over 100 days'));
    assert.doesNotMatch(text, /\u6e1a|\u4ed5\u69d8\u66f8|\u8abf\u67fb\u5831\u544a|\u70b9\u691c\u8a18\u9332|[CD]:[\\/]|\{\{|\{%/);
  });

  test(`README ${language}: independent-project notice matches the screen`, () => {
    const notes = text.split(language === 'ja' ? '## ⚠️ 注意' : '## ⚠️ Notes')[1].split('\n## ')[0].trim();
    const notice = messages[language]['footer.independent'];
    assert.equal(typeof notice, 'string');
    const joined = notes.replace(/\n/g, language === 'ja' ? '' : ' ');
    assert.ok(joined.startsWith(notice));
    const claims = text.replace(/^Q\. 日本郵便の公式ツールですか。$/gm, '')
      .replace(/^Q\. Is this an official Japan Post tool\?$/gm, '')
      .replace(/Unofficial/gi, '').replace(/非公式/g, '');
    assert.doesNotMatch(claims, /Japan Post Official|公式ツール|official (?:Japan Post )?tool/i);
  });
}

test('README: YAML is a block with stable identity and a boolean hub flag', () => {
  const yaml = docs.ja.match(/^<!--\n---\n([\s\S]*?)\n---\n-->/);
  assert.ok(yaml);
  for (const [key, value] of Object.entries({ id: 'day115', slug: 'postmirror',
    repo_url: '"https://github.com/ipusiron/postmirror"', demo_url: '"https://ipusiron.github.io/postmirror/"' })) {
    assert.ok(yaml[1].split('\n').includes(`${key}: ${value}`));
  }
  for (const key of ['category_ja', 'category_en', 'tags']) assert.match(yaml[1], new RegExp(`^${key}:\\n  - .+`, 'm'));
  assert.match(yaml[1], /^hub: (true|false)$/m);
  assert.doesNotMatch(docs.en, /<!--\s*---/);
});

test('README: forbidden words exactly match the i18n list', () => {
  const other = read('test/i18n.test.js').match(/const FORBIDDEN = \[([\s\S]*?)\];/)[1];
  const entries = [...other.matchAll(/'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(FORBIDDEN, entries);
});

test('README: one search spelling, name origin, and no Japanese/Latin spacing', () => {
  assert.equal((docs.ja.match(/カスタマーバーコード/g) || []).length, 1);
  assert.doesNotMatch(docs.en + read('index.html') + Object.values(messages.ja).join(''), /カスタマーバーコード/);
  const intro = body(docs.ja).split('\n## ')[0];
  assert.match(intro, /ポストミラー/);
  assert.match(intro, /まずは手元にある自分宛ての郵便物で試してください。\n\n名前のPostは、郵便とSNSの投稿/);
  assert.match(docs.en, /Start with mail addressed to you\.\n\nThe name: "post" means both mail and a social media post/);
  const prose = withoutCode(body(docs.ja)).replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/^#{1,6} |^(?:\d+\.|[-*>]|Q\.|A\.) /gm, '')
    .replace(/^\[Day\d{3} /gm, '[');
  assert.doesNotMatch(prose, /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}] +[A-Za-z0-9]/u);
  assert.doesNotMatch(prose, /[A-Za-z0-9] +[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u);
});

test('README English: no untranslated prose and every customer barcode sentence identifies Japan', () => {
  const prose = withoutCode(docs.en.split('\n').slice(1).join('\n')).replace(/^\|.*$/gm, '');
  assert.doesNotMatch(prose, /[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef]/u);
  const sentences = prose.split(/(?<=[.!?])\s+|\n/).filter(s => /customer barcode/i.test(s));
  assert.ok(sentences.length >= 4);
  for (const sentence of sentences) assert.match(sentence, /Japan Post|Japanese/);
});
