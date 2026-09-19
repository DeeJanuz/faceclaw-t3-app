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

function harness(canPaint) {
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
  const timers = new Map(); let next = 0, painted = 0, closed = 0, value = 0, paintPermissionRequests = 0;
  const frames = [];
  let onSubmit = () => {};
  const { createInProcessWindow } = load('app/ui/shell/in-process-window.ts', {
    '../../graphics/image': images, '../layers': layers,
    '../../graphics/plane': { flattenPlanesWithDraws: (planes, size) => {
      const image = new Image(size.width, size.height); image.value = planes.at(-1)?.image.value;
      return { image, draws: [] };
    } },
  }, {
    setTimeout: (fn, delay) => { assert.ok(delay >= 0); timers.set(++next, { fn, delay }); return next; },
    clearTimeout: id => timers.delete(id),
  });
  const base = {
    paint(ctx) { painted++; const size = ctx.stack.getBaseSize(); const frame = new Image(size.width, size.height); frame.value = value; return frame; },
    async handleInput() { value++; app.requestRender(); },
  };
  const app = createInProcessWindow({ baseLayer: base, canPaint, requestPaintPermission: () => paintPermissionRequests++, submitFrame: frame => { frames.push(frame); onSubmit(); }, onClosed: () => closed++ });
  return { app, base, frames, timers, setValue: n => { value = n; }, paints: () => painted, closes: () => closed,
    setOnSubmit: callback => { onSubmit = callback; }, paintPermissionRequests: () => paintPermissionRequests,
    delays: () => [...timers.values()].map(item => item.delay),
    flush() { const entry = timers.entries().next().value; assert.ok(entry, 'a frame should be scheduled'); timers.delete(entry[0]); entry[1].fn(); },
  };
}

test('hidden surfaces coalesce dirty state without painting until visible', () => {
  let visible = false;
  const h = harness(() => visible);
  h.app.requestRender(); h.setValue(7);
  assert.equal(h.paints(), 0); assert.equal(h.timers.size, 0);
  visible = true; h.app.requestRender(); assert.equal(h.timers.size, 1);
  h.flush(); assert.equal(h.paints(), 1); assert.equal(h.frames[0].value, 7);
});

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

test('a cleanup request during submission waits for the consumed render credit', () => {
  let visible = true;
  const h = harness(() => visible);
  h.app.stack.push({
    paint: ctx => h.base.paint(ctx),
    needsAnimation: () => { h.app.stack.pop(); h.app.requestRender(); return false; },
    handleInput() {},
  });
  h.setOnSubmit(() => { h.app.needsAnimation(); visible = false; });
  h.app.requestRender(); h.flush();
  assert.equal(h.frames.length, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.paintPermissionRequests(), 1);
});

test('a sparse animation deadline schedules one useful repaint instead of continuous frames', () => {
  const h = harness();
  h.base.nextAnimationDelayMs = () => 140;
  h.app.requestRender(); h.flush();
  assert.deepEqual(h.delays(), [140]);
  h.flush();
  assert.deepEqual(h.delays(), [0]);
  h.flush();
  assert.equal(h.frames.length, 2);
  assert.deepEqual(h.delays(), [140]);
  h.app.close();
  assert.equal(h.timers.size, 0);
});

test('the real T3 window factory forwards paint permission controls', () => {
  const imports = {};
  const source = fs.readFileSync('app/apps/t3/t3-app.ts', 'utf8');
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  let captured;
  imports['./runtime'] = { t3Workspace: { onChange: () => () => {}, demo: true }, initializeT3() {}, connectT3() {}, setT3ReaderVisible() {} };
  imports['../../native/weather'] = { weatherBridge: { onStateChange: () => () => {} } };
  imports['../../extensions/host'] = { onHostState: () => () => {}, onHostEvent: () => () => {} };
  imports['../../ui/shell/shell'] = { shell: { isWindowVisible: () => false } };
  imports['../../t3/config'] = { getT3Config: () => ({ enabled: false }) };
  imports['../../t3/activity-indicator-mode'] = load('app/t3/activity-indicator-mode.ts', {});
  imports['../../ui/shell/in-process-window'] = { createInProcessWindow: options => {
    captured = options;
    return { stack: { isAtBase: () => true } };
  } };
  const api = load('app/apps/t3/t3-app.ts', imports, { setInterval: () => 1, clearInterval() {} });
  const canPaint = () => false, requestPaintPermission = () => {};
  api.createT3AppWindow({ canPaint, requestPaintPermission, onClosed() {} });
  assert.equal(captured.canPaint, canPaint);
  assert.equal(captured.requestPaintPermission, requestPaintPermission);
});
