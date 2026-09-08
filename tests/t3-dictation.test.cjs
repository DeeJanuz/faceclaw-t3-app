const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup({ stop, start, origin, replay = '', viewport = { x: 32, y: 96, width: 576, height: 288 } } = {}) {
  const module = { exports: {} };
  const listeners = { transcript: null, status: null };
  const timers = new Map(); let nextTimer = 0; let now = 0;
  const result = { drafts: [], cancellations: 0, closed: 0, stops: 0, starts: 0, renders: 0, pageBoxes: [] };
  const bridge = {
    onTranscript(callback) { listeners.transcript = callback; return () => { listeners.transcript = null; }; },
    onStatus(callback) { listeners.status = callback; callback({ status: replay }); return () => { listeners.status = null; }; },
  };
  class GrayImage {
    constructor(width, height, fill) { this.width = width; this.height = height; this.fill = fill; this.labels = []; this.placements = []; this.rects = []; }
    bakeDeferredDrawsInPlace() {}
    drawRoundedRect(...args) { this.rects.push(args); } fillRoundedRect() {} drawLine() {}
    drawText(_font, x, y, value) { this.labels.push(value); this.placements.push({ x, y, value }); }
  }
  const face = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/ui/card-presentation.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { module: face, exports: face.exports });
  const motion = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/apps/t3/card-motion.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: motion, exports: motion.exports, require: () => face.exports });
  const hubModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/apps/t3/hub-view-model.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: hubModule, exports: hubModule.exports, require: () => ({}) });
  const font = { lineHeight: 16 };
  const imports = {
    '../card-presentation': face.exports,
    '../../graphics/image': { G2_LENS_WIDTH: 640, G2_LENS_HEIGHT: 480, GrayImage },
    '../../graphics/ui-fonts': { getDefaultSmallFont: () => font },
    '../../graphics/textwrap': { truncateText: (_font, value) => value, wrapText: (_font, value) => value.split('\n') },
    '../../apps/t3/card-motion': motion.exports,
    '../../apps/t3/hub-view-model': { reflowDictationText: hubModule.exports.reflowDictationText, paginateMessageText: (value, box) => { result.pageBoxes.push(box); return [value]; } },
    '../../native/voice-control': { voiceControlBridge: bridge },
    './geometry': { appViewportRect: () => viewport },
  };
  const code = ts.transpileModule(fs.readFileSync('app/ui/shell/t3-dictation.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, require: name => { assert.ok(name in imports, name); return imports[name]; },
    Date: { now: () => now },
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay, interval: true }); return id; },
    clearInterval: id => timers.delete(id),
  });
  const layer = new module.exports.T3DictationLayer({
    origin,
    actions: {
      requestRender: () => result.renders++,
      startVoiceCapture: (endpointing, transcription) => { result.starts++; result.transcription = transcription; return start?.(listeners); },
      stopVoiceCapture: () => { result.stops++; return stop?.(listeners); },
    },
    dismiss: () => layer.onRemoved(), onClosed: () => result.closed++,
    onDraft: text => result.drafts.push(text), onCancelled: () => result.cancellations++,
  });
  layer.startCapture();
  return { layer, result, listeners, timers, cardRect: motion.exports.cardRect, advance: value => { now = value; } };
}

test('finish tap waits for the actual final and hands off a local draft once', () => {
  const { layer, result, listeners, timers } = setup();
  assert.equal(result.transcription, 't3');
  listeners.transcript({ text: 'partial', isFinal: false });
  layer.handleInput({ type: 'click' });
  assert.equal(result.stops, 1); assert.deepEqual(result.drafts, []);
  assert.equal([...timers.values()].some(timer => timer.delay >= 90000), true);
  listeners.transcript({ text: 'Final replacement', isFinal: true });
  assert.deepEqual(result.drafts, ['Final replacement']);
  assert.equal(result.cancellations, 0); assert.equal(result.closed, 1);
  assert.equal(listeners.transcript, null); assert.equal(timers.size, 0);
});

test('optional on-device backup warning does not terminate paired bridge dictation', () => {
  const { layer, result, listeners } = setup();
  listeners.status({ status: 'Using cloud transcription without on-device backup.' });
  assert.equal(layer.phase, 'capturing'); assert.equal(result.stops, 0);
  layer.endCapture(); listeners.transcript({ text: 'Bridge Whisper result', isFinal: true });
  assert.deepEqual(result.drafts, ['Bridge Whisper result']);
});

test('stop may synchronously emit final without losing it or stopping twice', () => {
  const { layer, result } = setup({ stop: listeners => listeners.transcript?.({ text: 'Synchronous final', isFinal: true }) });
  layer.endCapture(); layer.endCapture();
  assert.deepEqual(result.drafts, ['Synchronous final']); assert.equal(result.stops, 1);
});

test('authoritative empty final cannot resurrect an unverified partial', () => {
  const { layer, result, listeners } = setup();
  listeners.transcript({ text: 'Other speaker private text', isFinal: false });
  layer.endCapture(); listeners.transcript({ text: '', isFinal: true });
  assert.deepEqual(result.drafts, []); assert.equal(layer.text, '');
  assert.equal(layer.phase, 'error');
  listeners.transcript({ text: 'Stale final', isFinal: true });
  assert.deepEqual(result.drafts, []);
});

test('timeout never promotes an unverified partial and preserves a back path', () => {
  const { layer, result, listeners, timers, advance } = setup();
  listeners.transcript({ text: 'Not finalized', isFinal: false }); layer.endCapture();
  [...timers.values()].find(timer => timer.delay >= 90000).callback();
  assert.equal(layer.phase, 'error'); assert.deepEqual(result.drafts, []);
  layer.handleInput({ type: 'click' }); advance(400);
  [...timers.values()].find(timer => timer.interval).callback();
  assert.equal(result.cancellations, 1); assert.equal(result.closed, 1);
});

test('cancellation ignores both queued transcript callbacks and late provider failures', async () => {
  let rejectStart;
  const { layer, result, listeners, timers, advance } = setup({ start: () => new Promise((_resolve, reject) => { rejectStart = reject; }) });
  const staleTranscript = listeners.transcript;
  layer.handleInput({ type: 'double-click' });
  staleTranscript({ text: 'Do not deliver', isFinal: true });
  advance(400); [...timers.values()].find(timer => timer.interval).callback();
  staleTranscript({ text: 'Still stale', isFinal: true }); rejectStart(new Error('private provider error'));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(result.drafts, []); assert.equal(result.cancellations, 1);
  assert.equal(result.stops, 1); assert.equal(timers.size, 0);
});

test('old status replay is ignored but current speaker rejection clears captured text', () => {
  const { layer, result, listeners } = setup({ replay: 'T3_STT_UNAVAILABLE: previous capture' });
  assert.equal(layer.phase, 'capturing');
  listeners.transcript({ text: 'Private partial', isFinal: false });
  listeners.status({ status: 'Ignored — not your enrolled voice (match 20%).' });
  assert.equal(layer.phase, 'error'); assert.equal(layer.text, '');
  assert.equal(result.stops, 1); assert.deepEqual(result.drafts, []);
});

test('capture paints an opaque surface without exposing the screen underneath', () => {
  const { layer, advance } = setup(); advance(400);
  const image = layer.paint({}, () => { throw Error('underlying UI must stay hidden'); });
  assert.equal(image.fill, 1); assert.ok(image.labels.some(label => label.startsWith('LISTENING')));
  assert.equal(image.labels.some(label => /Send to Assistant|Continue|Type Into App/.test(label)), false);
  layer.onRemoved();
});

function draftDestination() {
  const source = ts.createSourceFile('t3-app.ts', fs.readFileSync('app/apps/t3/t3-app.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'T3Layer');
  const record = declaration.members.find(node => node.name?.getText(source) === 'record').getText(source);
  const module = { exports: {} }; const calls = []; const drafts = []; let cancelled = 0;
  const state = { busy: false, demo: false, selectedThreadId: 'thread-one' };
  const config = { enabled: true, bridgeUrl: 'wss://bridge.example', pairingFingerprint: 'original' };
  const globals = { module, exports: module.exports, state, getT3Config: () => config,
    shell: { startT3Dictation: (...args) => calls.push(args) }, activeLayer: null };
  vm.runInNewContext(ts.transpileModule(`export class Destination { ${record} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, globals);
  const layer = new module.exports.Destination(); globals.activeLayer = layer;
  Object.assign(layer, { screen: 'compose', draftLocked: false, history: [{}], creation: {}, questionIndex: 0, dictatingAnswer: false,
    fullRect: () => ({ x: 0, y: 0, width: 635, height: 447 }), receiveText: text => drafts.push(text), cancelCompose: () => cancelled++ });
  layer.record();
  return { state, config, layer, globals, drafts, calls, cancelled: () => cancelled };
}

test('T3 capture destination rejects changed pairing, session, mode, owner, or compose invocation', () => {
  for (const mutate of [
    x => { x.config.pairingFingerprint = 'new'; },
    x => { x.config.bridgeUrl = 'wss://other.example'; },
    x => { x.state.selectedThreadId = 'thread-two'; },
    x => { x.state.demo = true; },
    x => { x.config.enabled = false; },
    x => { x.globals.activeLayer = null; },
    x => { x.layer.creation = {}; },
    x => { x.layer.history.push({}); },
  ]) {
    const destination = draftDestination(); const [onDraft, onCancelled, canStart] = destination.calls[0];
    assert.equal(canStart(), true); mutate(destination); assert.equal(canStart(), false);
    onDraft('Stale transcript'); onCancelled();
    assert.deepEqual(destination.drafts, []); assert.equal(destination.cancelled(), 0);
  }
});

test('unchanged T3 destination accepts local review text and cancellation callback', () => {
  const destination = draftDestination(); const [onDraft, onCancelled, canStart] = destination.calls[0];
  assert.equal(canStart(), true); onDraft('Review this'); onCancelled();
  assert.deepEqual(destination.drafts, ['Review this']); assert.equal(destination.cancelled(), 1);
});

test('dictation expands to the configured full viewport and renders the measured page without a second wrap', () => {
  const { layer, result, advance, listeners } = setup({ viewport: { x: 0, y: 28, width: 640, height: 452 } });
  advance(400); listeners.transcript({ text: 'First hard line\n\nSecond hard line', isFinal: false });
  const image = layer.paint({}, () => assert.fail('private underlying content must remain occluded'));
  assert.ok(image.rects.some(rect => rect[0] === 0 && rect[1] === 28 && rect[2] === 635 && rect[3] === 447));
  const box = result.pageBoxes[0]; assert.equal(box.width, 603); assert.ok(box.height > 300); assert.equal(box.lineHeight, 21);
  const body = image.placements.filter(row => row.value.includes('hard line'));
  assert.equal(body.length, 2); assert.equal(body[1].y - body[0].y, 42); assert.equal(body[0].x, 16);
  assert.deepEqual(result.drafts, []); layer.onRemoved(); assert.equal(layer.text, '');
});

test('dictation reflows display-only line breaks and retains its exact authoritative final draft', () => {
  const { layer, result, advance, listeners } = setup(); advance(400);
  const raw = 'This is a provider line\nfollowed by another provider line.';
  listeners.transcript({ text: raw, isFinal: false });
  const painted = layer.paint({}, () => assert.fail('underlying private content stays hidden'));
  assert.ok(painted.labels.includes('This is a provider line followed by another provider line.'));
  layer.paint({}, () => assert.fail()); assert.equal(result.pageBoxes.length, 1, 'unchanged timer repaint reuses layout');
  layer.endCapture(); listeners.transcript({ text: raw, isFinal: true });
  assert.deepEqual(result.drafts, [raw]); assert.equal(layer.cachedLayout, null); assert.equal(layer.text, '');
});

test('Ask Assistant capture uses the same card motion and source control as session navigation', () => {
  const origin = { x: 291, y: 95, width: 288, height: 44 };
  const h = setup({ origin, viewport: { x: 0, y: 28, width: 640, height: 452 } }); h.advance(180);
  assert.equal(h.layer.isAnimatingCard(), true);
  const outlines = h.layer.paint({}, () => assert.fail()).rects;
  assert.equal(outlines.length, 1);
  const actual = outlines[0];
  const expected = h.cardRect(origin, { x: 0, y: 0, width: 635, height: 447 }, .5);
  assert.deepEqual(actual.slice(0, 4), [expected.x, expected.y + 28, expected.width, expected.height]);
  assert.equal(actual[6], 2);
  h.advance(400); assert.equal(h.layer.isAnimatingCard(), false);
  h.layer.handleInput({ type: 'double-click' }); assert.equal(h.layer.isAnimatingCard(), true);
  h.advance(800); assert.equal(h.layer.isAnimatingCard(), false); h.layer.onRemoved();
});

test('completed cancel shrink restores app content before removing its opaque shell shield', () => {
  const { layer, result, listeners, timers, advance } = setup(); const events = [];
  listeners.transcript({ text: 'Private partial', isFinal: false });
  const cancelled = layer.options.onCancelled; const closed = layer.options.onClosed;
  layer.options.onCancelled = () => { assert.equal(layer.text, ''); assert.equal(listeners.transcript, null); events.push('restore-app'); cancelled(); };
  layer.options.onClosed = () => { events.push('clear-shell'); closed(); };
  layer.handleInput({ type: 'double-click' });
  advance(350); [...timers.values()].find(timer => timer.interval).callback(); assert.deepEqual(events, []);
  advance(400); [...timers.values()].find(timer => timer.interval).callback();
  assert.deepEqual(events, ['restore-app', 'clear-shell']);
  assert.equal(result.stops, 1); assert.equal(result.cancellations, 1); assert.equal(result.closed, 1);
  assert.deepEqual(result.drafts, []); assert.equal(timers.size, 0);
});

test('app cancellation callback failure cannot skip voice-owner and shell cleanup', () => {
  const { layer, result, timers } = setup();
  layer.options.onCancelled = () => { throw new Error('destination failed'); };
  assert.throws(() => layer.onRemoved(), /destination failed/);
  assert.equal(result.closed, 1); assert.equal(result.stops, 1); assert.equal(timers.size, 0);
  layer.onRemoved(); assert.equal(result.closed, 1);
});


test('direct capture uses the shared 40ms card frame cadence', () => {
  const h = setup(); assert.equal([...h.timers.values()].find(timer => timer.interval).delay, 40); h.layer.onRemoved();
});
