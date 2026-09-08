const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => {
    if (name === '@faceclaw/motion') return require(name); assert.ok(name in imports, name); return imports[name];
  }, ...globals });
  return module.exports;
}

function harness() {
  class Image {
    constructor(width, height) { this.width = width; this.height = height; }
    drawImage(source) { this.value = source.value; }
    bakeDeferredDrawsInPlace() {}
  }
  const images = { GrayImage: Image, G2_LENS_WIDTH: 576, G2_LENS_HEIGHT: 452 };
  const layers = load('app/ui/layers.ts', {
    '../graphics/image': images, '../graphics/plane': {},
    '../native/frame-timings': { spanCurrent: (_name, body) => body() },
    './gestures': load('app/ui/gestures.ts', {}),
  });
  const timers = new Map(); let next = 0, painted = 0, closed = 0, value = 0;
  const frames = [];
  const { createInProcessWindow } = load('app/ui/shell/in-process-window.ts', {
    '../../graphics/image': images, '../layers': layers,
  }, {
    setTimeout: (fn, delay) => { assert.equal(delay, 0); timers.set(++next, fn); return next; },
    clearTimeout: id => timers.delete(id),
  });
  const base = {
    paint(ctx) { painted++; const size = ctx.stack.getBaseSize(); const frame = new Image(size.width, size.height); frame.value = value; return frame; },
    async handleInput() { value++; app.requestRender(); },
  };
  const app = createInProcessWindow({ baseLayer: base, submitFrame: frame => frames.push(frame), onClosed: () => closed++ });
  return { app, base, frames, timers, setValue: n => { value = n; }, paints: () => painted, closes: () => closed,
    flush() { const entry = timers.entries().next().value; assert.ok(entry, 'a frame should be scheduled'); timers.delete(entry[0]); entry[1](); },
  };
}

test('a burst of render requests publishes one frame containing the latest state and viewport', () => {
  const h = harness();
  h.app.requestRender(); h.setValue(1); h.app.requestRender(); h.app.resize(640, 288); h.setValue(2); h.app.requestRender();
  assert.equal(h.paints(), 0, 'drawing must not block each state update');
  assert.equal(h.timers.size, 1);
  h.flush();
  assert.equal(h.frames.length, 1); assert.equal(h.frames[0].value, 2);
  assert.equal(h.frames[0].width, 640); assert.equal(h.frames[0].height, 288);
});

test('an input-triggered repaint and input completion do not send duplicate frames', async () => {
  const h = harness();
  await h.app.handleInput({ type: 'scroll-down', source: 'ring' });
  assert.equal(h.timers.size, 1);
  h.flush(); assert.equal(h.frames.length, 1); assert.equal(h.frames[0].value, 1);
  await h.app.handleInput({ type: 'scroll-down', source: 'ring' });
  h.flush(); assert.equal(h.frames.length, 2); assert.equal(h.frames[1].value, 2);
});

test('pending asynchronous input still paints progress before completion', async () => {
  const h = harness(); let finish;
  h.base.handleInput = async () => {
    h.setValue(1); h.app.requestRender();
    await new Promise(resolve => { finish = resolve; }); h.setValue(2);
  };
  const input = h.app.handleInput({ type: 'click' });
  h.flush(); assert.equal(h.frames[0].value, 1);
  finish(); await input; h.flush(); assert.equal(h.frames[1].value, 2);
});

test('closing cancels queued frames and ignores delayed input completion', async () => {
  const h = harness(); let finish;
  h.base.handleInput = () => new Promise(resolve => { finish = resolve; });
  const input = h.app.handleInput({ type: 'click' });
  h.app.requestRender(); h.app.close(); h.app.close();
  finish(); await input; h.app.requestRender();
  assert.equal(h.timers.size, 0); assert.equal(h.frames.length, 0); assert.equal(h.closes(), 1);
});

test('a state update during painting schedules the next frame without recursive painting', () => {
  const h = harness(); const paint = h.base.paint;
  h.base.paint = ctx => { const result = paint(ctx); if (h.paints() === 1) { h.setValue(2); h.app.requestRender(); } return result; };
  h.app.requestRender(); h.flush();
  assert.equal(h.frames.length, 1); assert.equal(h.timers.size, 1);
  h.flush(); assert.equal(h.frames.length, 2); assert.equal(h.frames[1].value, 2);
});
