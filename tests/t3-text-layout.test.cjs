const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, require: name => { if (name === './resource') return load('app/apps/t3/resource.ts'); assert.ok(name in imports, name); return imports[name]; }, ...globals });
  return module.exports;
}
const wrap = load('app/graphics/textwrap.ts');
let hub;
test.before(async () => { hub = load('app/apps/t3/hub-view-model.ts', { '@evenrealities/pretext': await import('@evenrealities/pretext'), '../../graphics/textwrap': wrap }); });
// Deliberately different rounded glyph and shaped widths expose legacy measurements.
const font = { lineHeight: 17, getGlyph: () => ({ dwidthX: 20 }), measureText: text => Array.from(text).reduce((n, ch) => n + (ch === 'W' ? 9.5 : ch === 'i' ? 2.25 : 5.5), 0) - (text.match(/AV/g)?.length || 0) * 2 };

test('pagination packs native font lines to actual inner width and available height', () => {
  const source = 'Wi AV transcript content with measured spacing. '.repeat(60);
  const box = { font, width: 603, height: 390, lineHeight: 21 };
  const pages = hub.paginateText(source, box);
  assert.ok(pages.length > 1);
  for (const [index, page] of pages.entries()) {
    const lines = page.split('\n'); assert.ok(lines.length <= 18);
    if (index < pages.length - 1) assert.equal(lines.length, 18);
    assert.ok(lines.every(line => font.measureText(line) <= box.width));
  }
  assert.equal(pages.join(' ').replace(/\s+/g, ' ').trim(), source.trim());
});

test('native measured wrapping uses whole words and splits only words too wide for the viewport', () => {
  const lines = wrap.wrapText(font, 'iiiiiiii WWWW next', 50);
  assert.deepEqual(Array.from(lines), ['iiiiiiii', 'WWWW', 'next']);
  const long = 'W'.repeat(120) + '🙂';
  const pages = hub.paginateText(long, { font, width: 50, height: 42, lineHeight: 21 });
  assert.equal(pages.join('').replace(/\n/g, ''), long);
  assert.ok(pages.every(page => page.split('\n').every(line => font.measureText(line) <= 50)));
});

test('hard newlines, blank paragraphs and fenced code indentation survive pagination', () => {
  const source = 'Intro\n\n\n```ts\n  const my_value = 1;\n  if (my_value < 2) {\n    use(my_value);\n  }\n```\n\nTail';
  const plain = hub.plainText(source);
  assert.equal(plain, 'Intro\n\n\n  const my_value = 1;\n  if (my_value < 2) {\n    use(my_value);\n  }\n\nTail');
  const pages = hub.paginateMessageText(plain, { font, width: 600, height: 63, lineHeight: 21 });
  assert.equal(pages.join('\n'), plain);
});

test('larger font sizes consume measured line pitch instead of squeezing line spacing', () => {
  const source = 'A line\n'.repeat(30);
  const small = hub.paginateText(source, { font, width: 600, height: 390 });
  const large = hub.paginateText(source, { font: { ...font, lineHeight: 21 }, width: 600, height: 390 });
  assert.equal(small[0].split('\n').length, 18); assert.equal(large[0].split('\n').length, 15);
});

function fontSettings(initial = {}) {
  const values = new Map(Object.entries(initial)); const loads = [];
  const selection = load('app/graphics/ui-fonts.ts', {
    '../extensions/style': {sharedStyle:()=>({}),sharedStyleRevision:()=>0,onSharedStyle(){}},
    './bdffont': { getFont: () => font }, './ttf-font': { TtfFont: { load: (...args) => { loads.push(args); return { ...font, lineHeight: args[1] + 3 }; } } },
    './installed-fonts': { ensurePreinstalledFonts() {}, installedFontPath: value => '/fonts/' + value, getInstalledFont: () => null },
    '../native/settings-store': { getStringSetting: (key, fallback) => values.get(key) ?? fallback, setStringSetting: (key, value) => values.set(key, value), onSettingsStoreChanged() {} },
  });
  return { selection, values, loads };
}

test('Inter 17 replaces prior defaults once while deliberate font choices remain available', () => {
  const key = 'display.uiFont2';
  for (const initial of [{}, { [key]: JSON.stringify({ kind: 'ttf', file: 'Roboto-Light.ttf', size: 14 }) }, { [key]: JSON.stringify({ kind: 'ttf', file: 'Roboto-Regular.ttf', size: 14 }), 'display.uiFont.regularDefault1': '1' }, { [key]: JSON.stringify({ kind: 'ttf', file: 'Roboto-Regular.ttf', size: 16 }), 'display.uiFont.regular16Default1': '1' }]) {
    const h = fontSettings(initial); assert.equal(h.selection.getUiFontSelection().file, 'Inter_18pt-Regular.ttf'); assert.equal(h.selection.getUiFontSelection().size, 17);
    h.selection.setUiFontSelection({ kind: 'ttf', file: 'Roboto-Light.ttf', size: 14 });
    assert.equal(h.selection.getUiFontSelection().file, 'Roboto-Light.ttf');
  }
  for (const chosen of [{ kind: 'ttf', file: 'Other.ttf', size: 14 }, { kind: 'ttf', file: 'Roboto-Light.ttf', size: 16 }, { kind: 'bitmap', face: 'terminusv' }]) {
    const h = fontSettings({ [key]: JSON.stringify(chosen) });
    assert.deepEqual(JSON.parse(JSON.stringify(h.selection.getUiFontSelection())), chosen);
  }
});

test('Inter 16 migrates once to 17 and a later explicit 16px choice stays selected', () => {
  const key = 'display.uiFont2';
  const h = fontSettings({ [key]: JSON.stringify({ kind: 'ttf', file: 'Inter_18pt-Regular.ttf', size: 16 }), 'display.uiFont.inter16Default1': '1' });
  assert.equal(h.selection.getUiFontSelection().size, 17);
  h.selection.setUiFontSelection({ kind: 'ttf', file: 'Inter_18pt-Regular.ttf', size: 16 });
  assert.equal(h.selection.getUiFontSelection().size, 16);
});

test('UI font resolution requests crisp pixels while terminal keeps its existing raster mode', () => {
  const h = fontSettings({ 'terminal.font': JSON.stringify({ kind: 'ttf', file: 'RobotoMono-Regular.ttf', size: 14 }) });
  h.selection.getDefaultSmallFont();
  assert.ok(h.loads.some(call => call[0].endsWith('Inter_18pt-Regular.ttf') && call[3] === 'crisp'));
  h.loads.length = 0; h.selection.getTerminalFontConfig();
  assert.ok(h.loads.every(call => call[3] !== 'crisp'));
});

test('crisp and antialiased font modes have separate cached rasters and atlas identities with equal layout', () => {
  const calls = [];
  function packet(coverage) { return Uint8Array.from([192, 1, 0, 0, 0, 0, 2, 0, 1, 0, ...coverage]); }
  const { TtfFont } = load('app/graphics/ttf-font.ts', {
    './bdffont': { allocateFontFingerprintId: () => calls.length + 1 },
    './image': { GrayImage: class {}, grayToNibble: value => Math.round(value / 17) },
    '../util/array-util': { toUint8Array: value => value },
  }, { global: { isAndroid: true }, Uint8Array, com: { faceclaw: { app: { FontFileRenderer: {
    getFontMetrics: () => '13 4 0', measureTextExact: (_path, value) => value.length * 7,
    renderGlyphCell: () => { calls.push('aa'); return packet([85, 255]); },
    renderGlyphCellCrisp: () => { calls.push('crisp'); return packet([0, 255]); },
  } } } } });
  const aa = TtfFont.load('/Roboto-Regular.ttf', 14); const crisp = TtfFont.load('/Roboto-Regular.ttf', 14, 1, 'crisp');
  assert.notEqual(aa, crisp); assert.notEqual(aa.atlasKey, crisp.atlasKey);
  assert.equal(crisp, TtfFont.load('/Roboto-Regular.ttf', 14, 1, 'crisp'));
  assert.equal(aa.measureText('AA'), crisp.measureText('AA')); assert.equal(aa.lineHeight, crisp.lineHeight);
  assert.deepEqual(Array.from(aa.getGlyph(65).coverage), [5, 15]);
  assert.deepEqual(Array.from(crisp.getGlyph(65).coverage), [0, 15]);
  assert.deepEqual(calls, ['aa', 'crisp']);
});

test('speech display reflows provider line chunks while preserving blank paragraphs and code structure', () => {
  const raw = 'A spoken sentence\ncontinued on a short provider line.\n\n- A list item\n- A second item\n\n```ts\nconst value = 1;\n  use(value);\n```\n\nLast paragraph\ncontinues here.';
  assert.equal(hub.reflowDictationText(raw), 'A spoken sentence continued on a short provider line.\n\n- A list item\n- A second item\n\n```ts\nconst value = 1;\n  use(value);\n```\n\nLast paragraph continues here.');
});

for (const file of ['roboto-regular-16-native.json', 'inter-regular-16-native.json']) test(`actual Android ${file} glyphs fill the right edge for continuous and reflowed speech`, () => {
  const native = require('./fixtures/' + file);
  const graphics = load('app/graphics/image.ts', { './textwrap': wrap });
  const { TtfFont } = load('app/graphics/ttf-font.ts', {
    './bdffont': { allocateFontFingerprintId: () => 1 }, './image': graphics, '../util/array-util': { toUint8Array: x => x },
  }, { global: { isAndroid: true }, com: { faceclaw: { app: { FontFileRenderer: {
    getFontMetrics: () => native.metrics,
    renderGlyphCellCrisp: (_path, _size, cp) => Uint8Array.from(native.cells[cp] || []),
    measureTextExact: (_path, text) => native.pairs[Array.from(text).map(ch => ch.codePointAt(0)).join(',')],
  } } } } });
  const actualFont = TtfFont.load('/' + file, native.size, 1, 'crisp');
  assert.equal(actualFont.lineHeight, 19);
  const box = { font: actualFont, width: 603, height: 350, lineHeight: 23 };
  const narrow = hub.paginateText(native.samples.lineChunks, box)[0].split('\n');
  assert.ok(narrow.every(line => actualFont.measureText(line) < 300), 'fixture reproduces unused width from provider line breaks');
  for (const source of Object.values(native.samples)) {
    const page = hub.paginateText(hub.reflowDictationText(source).trimEnd(), box)[0];
    const lines = page.split('\n');
    const image = new graphics.GrayImage(640, 480);
    lines.forEach((line, index) => actualFont.drawText(image, 16, 65 + index * 23, line, 235));
    const pixels = image.withDrawsBaked().pixels;
    let right = 0;
    for (let y = 65; y < 450; y++) for (let x = 0; x < 640; x++) if (pixels[y * 640 + x]) right = Math.max(right, x);
    assert.ok(right >= 600 && right <= 619, `actual native ink reaches full available width: ${right}`);
    for (let index = 0; index < lines.length - 1; index++) {
      const nextWord = lines[index + 1].trimStart().split(/\s/)[0];
      assert.ok(actualFont.measureText(lines[index] + ' ' + nextWord) > box.width, 'each full line fits every whole word it can');
    }
  }
});

test('Whisper server segment newlines and leading segment spaces become display word spacing', () => {
  const whisper = ' This is the first decoded segment.\n This is the next decoded segment\n with a continuation.\n';
  assert.equal(hub.reflowDictationText(whisper.trim()), 'This is the first decoded segment. This is the next decoded segment with a continuation.');
});

test('Inter migration preserves a smaller Roboto size deliberately reselected after the earlier migration', () => {
  const chosen = { kind: 'ttf', file: 'Roboto-Regular.ttf', size: 14 };
  const h = fontSettings({ 'display.uiFont2': JSON.stringify(chosen), 'display.uiFont.regular16Default1': '1' });
  assert.deepEqual(JSON.parse(JSON.stringify(h.selection.getUiFontSelection())), chosen);
});
