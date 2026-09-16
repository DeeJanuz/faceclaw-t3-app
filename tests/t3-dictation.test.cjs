const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function setup({ stop, start, refine, origin, raster = false, firstPaint = true, paintDashboard, replay = '', paginate, viewport = { x: 32, y: 96, width: 576, height: 288 } } = {}) {
  const module = { exports: {} };
  const listeners = { transcript: null, status: null };
  const timers = new Map(); let nextTimer = 0; let now = 0;
  const result = { drafts: [], cancellations: 0, closed: 0, stops: 0, starts: 0, renders: 0, pageBoxes: [] };
  const bridge = {
    onTranscript(callback) { listeners.transcript = callback; return () => { listeners.transcript = null; }; },
    onStatus(callback) { listeners.status = callback; callback({ status: replay }); return () => { listeners.status = null; }; },
  };
  class GrayImage {
    constructor(width, height, fill) { this.width = width; this.height = height; this.fill = fill; this.pixels = new Uint8Array(width * height); this.labels = []; this.placements = []; this.rects = []; }
    bakeDeferredDrawsInPlace() {}
    dimmed() { return this; }
    drawRoundedRect(...args) { this.rects.push(args); } fillRoundedRect() {} drawLine() {}
    drawText(_font, x, y, value) { this.labels.push(value); this.placements.push({ x, y, value }); }
  }
  const face = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/ui/card-presentation.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText, { module: face, exports: face.exports, require });
  const motion = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/apps/t3/card-motion.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: motion, exports: motion.exports, require: name => name === '@faceclaw/motion' ? require(name) : face.exports });
  const hubModule = { exports: {} };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/apps/t3/hub-view-model.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, { module: hubModule, exports: hubModule.exports, require: () => ({}) });
  function load(path, imports) {
    const loaded = { exports: {} };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
      { module: loaded, exports: loaded.exports, require: name => { assert.ok(name in imports, name); return imports[name]; } });
    return loaded.exports;
  }
  const Image = raster ? load('app/graphics/image.ts', { './textwrap': {} }).GrayImage : GrayImage;
  const font = raster ? load('app/graphics/bdffont.ts', { '@nativescript/core': {} }).BdfFont.parse(fs.readFileSync('app/fonts/terminus/ter-u18n.bdf', 'utf8')) : { lineHeight: 16 };
  const imports = {
    '../card-presentation': face.exports,
    '../../graphics/image': { G2_LENS_WIDTH: 640, G2_LENS_HEIGHT: 480, GrayImage: Image },
    '../../graphics/ui-fonts': { getDefaultSmallFont: () => font },
    '../../graphics/textwrap': { truncateText: (_font, value) => value, wrapText: (_font, value) => value.split('\n') },
    '../../apps/t3/card-motion': motion.exports,
    '../../apps/t3/hub-view-model': { reflowDictationText: hubModule.exports.reflowDictationText, paginateMessageText: (value, box) => { result.pageBoxes.push(box); return paginate ? paginate(value, box) : [value]; } },
    '../../native/voice-control': { voiceControlBridge: bridge },
    './geometry': { appViewportRect: () => viewport },
    '../presentation-clock': { presentationNow: () => now },
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
    origin, paintDashboard: paintDashboard ? (w, h) => paintDashboard(w, h, Image) : undefined,
    actions: {
      requestRender: () => result.renders++,
      startVoiceCapture: (endpointing, transcription) => { result.starts++; result.transcription = transcription; return start?.(listeners); },
      stopVoiceCapture: () => { result.stops++; return stop?.(listeners); },
    },
    refine,
    dismiss: () => layer.onRemoved(), onClosed: () => result.closed++,
    onDraft: text => result.drafts.push(text), onCancelled: () => result.cancellations++,
  });
  layer.startCapture();
  if (firstPaint) { layer.paint({}, () => assert.fail('capture cannot request the lower plane')); result.pageBoxes.length = 0; }
  return { layer, result, listeners, timers, Image, font, cardRect: motion.exports.cardRect, advance: value => { now = value; } };
}

test('reviewed draft can capture a follow-up and route it through Luna refinement before send', () => {
  let refinement;
  const { layer, result, listeners } = setup({ refine: options => { refinement = options; return { cancel() {} }; } });
  listeners.transcript({ text: 'Original draft', isFinal: false });
  layer.endCapture(); listeners.transcript({ text: 'Original draft', isFinal: true });
  layer.handleInput({ type: 'scroll-down' });
  listeners.transcript({ text: 'Make it concise', isFinal: false });
  layer.handleInput({ type: 'click' });
  listeners.transcript({ text: 'Make it concise', isFinal: true });
  assert.equal(refinement.original, 'Original draft');
  assert.equal(refinement.followup, 'Make it concise');
  refinement.onDone('Concise draft');
  layer.handleInput({ type: 'click' });
  assert.deepEqual(result.drafts, ['Concise draft']);
});

test('refinement waits for the authoritative edit final and ignores late transcripts', () => {
  let refinement;
  const { layer, listeners } = setup({ refine: options => { refinement = options; return { cancel() {} }; } });
  listeners.transcript({ text: 'Original draft', isFinal: false });
  layer.endCapture(); listeners.transcript({ text: 'Original draft', isFinal: true });
  layer.handleInput({ type: 'scroll-down' });
  listeners.transcript({ text: 'Make it concise', isFinal: false });
  layer.handleInput({ type: 'click' });
  assert.equal(layer.phase, 'finalizing-refinement');
  assert.equal(refinement, undefined, 'partial edit text must not start Luna');
  listeners.transcript({ text: 'Make it concise', isFinal: true });
  assert.ok(refinement);
  refinement.onDone('Concise draft');
  listeners.transcript({ text: 'late stale transcript', isFinal: true });
  assert.equal(layer.text, 'Concise draft');
});

test('refinement failures retain the last good draft and expose a recovery action', () => {
  let refinement;
  const { layer, listeners, advance } = setup({ refine: options => { refinement = options; return { cancel() {} }; } });
  listeners.transcript({ text: 'Original draft', isFinal: false });
  layer.endCapture(); listeners.transcript({ text: 'Original draft', isFinal: true });
  layer.handleInput({ type: 'scroll-down' }); listeners.transcript({ text: 'Fix it', isFinal: false }); layer.handleInput({ type: 'click' });
  listeners.transcript({ text: 'Fix it', isFinal: true });
  refinement.onError('refinement_unavailable');
  assert.equal(layer.phase, 'review');
  assert.equal(layer.text, 'Original draft');
  advance(400);
  const image = layer.paint({}, () => assert.fail('underlying content must stay hidden'));
  assert.ok(image.labels.some(label => /Luna: .*tap send.*swipe down to retry/.test(label)));
});

test('sole review surface pages long drafts and sends the authoritative full text', () => {
  const raw = 'First page\nSecond page';
  const { layer, result, listeners, advance } = setup({ paginate: value => value.includes('First page') ? ['First page', 'Second page'] : [value] });
  listeners.transcript({ text: raw, isFinal: false }); layer.endCapture(); listeners.transcript({ text: raw, isFinal: true });
  advance(400); let image = layer.paint({}, () => assert.fail());
  assert.ok(image.labels.includes('First page'));
  layer.handleInput({ type: 'scroll-up' });
  image = layer.paint({}, () => assert.fail());
  assert.ok(image.labels.includes('Second page'));
  layer.handleInput({ type: 'click' });
  assert.deepEqual(result.drafts, [raw]);
});

test('finish tap waits for the actual final and hands off a local draft once', () => {
  const { layer, result, listeners, timers } = setup();
  assert.equal(result.transcription, undefined);
  listeners.transcript({ text: 'partial', isFinal: false });
  layer.handleInput({ type: 'click' });
  assert.equal(result.stops, 1); assert.deepEqual(result.drafts, []);
  assert.equal([...timers.values()].some(timer => timer.delay >= 90000), true);
  listeners.transcript({ text: 'Final replacement', isFinal: true });
  layer.handleInput({ type: 'click' });
  assert.deepEqual(result.drafts, ['Final replacement']);
  assert.equal(result.cancellations, 0); assert.equal(result.closed, 1);
  assert.equal(listeners.transcript, null); assert.equal(timers.size, 0);
});

test('optional on-device backup warning does not terminate paired bridge dictation', () => {
  const { layer, result, listeners } = setup();
  listeners.status({ status: 'Using cloud transcription without on-device backup.' });
  assert.equal(layer.phase, 'capturing'); assert.equal(result.stops, 0);
  layer.endCapture(); listeners.transcript({ text: 'Bridge Whisper result', isFinal: true }); layer.handleInput({ type: 'click' });
  assert.deepEqual(result.drafts, ['Bridge Whisper result']);
});

test('stop may synchronously emit final without losing it or stopping twice', () => {
  const { layer, result } = setup({ stop: listeners => listeners.transcript?.({ text: 'Synchronous final', isFinal: true }) });
  layer.endCapture(); layer.handleInput({ type: 'click' }); layer.endCapture();
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
  layer.needsAnimation();
  assert.equal(result.cancellations, 1); assert.equal(result.closed, 1);
});

test('cancellation ignores both queued transcript callbacks and late provider failures', async () => {
  let rejectStart;
  const { layer, result, listeners, timers, advance } = setup({ start: () => new Promise((_resolve, reject) => { rejectStart = reject; }) });
  const staleTranscript = listeners.transcript;
  layer.handleInput({ type: 'double-click' });
  staleTranscript({ text: 'Do not deliver', isFinal: true });
  advance(400); layer.needsAnimation();
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
  const methods = ['record', 'submitDictatedText', 'submitDraft'].map(name => declaration.members.find(node => node.name?.getText(source) === name).getText(source)).join('\n');
  const module = { exports: {} }; const calls = []; const drafts = []; const sent = []; let cancelled = 0;
  const state = { busy: false, demo: false, selectedThreadId: 'thread-one', selectedEnvironmentId: undefined, transcript: undefined, canRetryLastSend: false, sendResult: true, fail: error => { state.error = String(error?.code || error); }, send: async text => { sent.push(text); return state.sendResult; } };
  const config = { enabled: true, bridgeUrl: 'wss://bridge.example', pairingFingerprint: 'original' };
  const globals = { module, exports: module.exports, state, getT3Config: () => config,
    shell: { startT3Dictation: (...args) => calls.push(args) }, activeLayer: null };
  vm.runInNewContext(ts.transpileModule(`export class Destination { ${methods} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText, globals);
  const layer = new module.exports.Destination(); globals.activeLayer = layer;
  Object.assign(layer, { screen: 'compose', draftLocked: false, history: [{}], creation: {}, questionIndex: 0, dictatingAnswer: false,
    fullRect: () => ({ x: 0, y: 0, width: 635, height: 447 }), receiveText: text => drafts.push(text), cancelCompose: () => cancelled++, go: screen => { layer.screen = screen; }, repaint: () => {} });
  layer.record();
  return { state, config, layer, globals, drafts, sent, calls, cancelled: () => cancelled };
}

test('T3 capture destination rejects changed pairing, session, mode, owner, or compose invocation', () => {
  for (const mutate of [
    x => { x.config.pairingFingerprint = 'new'; },
    x => { x.config.bridgeUrl = 'wss://other.example'; },
    x => { x.state.selectedThreadId = 'thread-two'; },
    x => { x.state.selectedEnvironmentId = 'other-computer'; },
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

test('unchanged T3 destination accepts the cancellation callback', () => {
  const destination = draftDestination(); const [, onCancelled, canStart] = destination.calls[0];
  assert.equal(canStart(), true); onCancelled();
  assert.deepEqual(destination.sent, []); assert.equal(destination.cancelled(), 1);
});

test('unchanged T3 destination submits a dictated draft from the capture review tap', async () => {
  const destination = draftDestination(); const [onDraft, , canStart] = destination.calls[0];
  assert.equal(canStart(), true); onDraft('Review this');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(destination.sent, ['Review this']);
  assert.equal(destination.layer.screen, 'reader');
  assert.equal(destination.layer.draft, '');
});

test('a definite reviewed-send rejection remains retryable, but pairing changes block the retry', async () => {
  const destination = draftDestination(); const [onDraft, , canStart] = destination.calls[0];
  assert.equal(canStart(), true);
  destination.state.sendResult = false; destination.state.canRetryLastSend = true;
  onDraft('Retain this draft');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(destination.sent, ['Retain this draft']);
  assert.equal(destination.layer.draftLocked, false);
  destination.config.pairingFingerprint = 'changed-after-capture';
  await destination.layer.submitDraft();
  assert.deepEqual(destination.sent, ['Retain this draft']);
  assert.equal(destination.layer.draftLocked, true);
  assert.match(destination.state.error, /destination_changed/);
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
  layer.endCapture(); listeners.transcript({ text: raw, isFinal: true }); layer.handleInput({ type: 'click' });
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
  advance(350); assert.equal(layer.needsAnimation(), true); assert.deepEqual(events, []);
  advance(400); layer.needsAnimation();
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


test('direct capture requests animation through render credits and only times its seconds label', () => {
  const h = setup(); assert.equal(h.layer.needsAnimation(), true); assert.equal([...h.timers.values()].find(timer => timer.interval).delay, 1000); h.layer.onRemoved();
});

const captureViewport = { x: 0, y: 0, width: 576, height: 452 };
const captureOrigin = { x: 259, y: 95, width: 288, height: 44 };
const noPrivateBackdrop = () => assert.fail('capture must not request the private lower plane');

function inkIn(image, x, y, width, height, value) {
  let ink = 0;
  for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) {
    if (image.pixels[row * image.width + col] === value) ink++;
  }
  return ink;
}

test('dictation has real heading pixels on first and intermediate expansion frames and reveals body before completion', () => {
  const h = setup({ raster: true, origin: captureOrigin, viewport: captureViewport });
  for (const time of [0, 80, 180, 320]) {
    h.advance(time);
    const image = h.layer.paint({}, noPrivateBackdrop);
    const rect = h.cardRect(captureOrigin, { x: 0, y: 0, width: 571, height: 447 }, time / 360);
    assert.ok(inkIn(image, rect.x + 8, rect.y + 8, rect.width - 16, Math.min(26, rect.height - 16), 190) > 10,
      `LISTENING heading must be visible at ${time}ms`);
  }
  const moving = h.layer.paint({}, noPrivateBackdrop);
  h.advance(400); const settled = h.layer.paint({}, noPrivateBackdrop); settled.bakeDeferredDrawsInPlace();
  assert.ok(inkIn(moving, 16, 65, 250, 24, 190) > 0, 'body ink is already visible before motion ends');
  for (let y = 65; y < 89; y++) assert.deepEqual(moving.pixels.slice(y * 576 + 16, y * 576 + 250), settled.pixels.slice(y * 576 + 16, y * 576 + 250), 'body stays in final coordinates');
  assert.equal(h.layer.motionContent, null); h.layer.onRemoved();
});

test('cancel replaces every cached transcript pixel with safe content throughout collapse', () => {
  const secret = setup({ raster: true, origin: captureOrigin, viewport: captureViewport });
  const clean = setup({ raster: true, origin: captureOrigin, viewport: captureViewport });
  secret.listeners.transcript({ text: 'PRIVATE TRANSCRIPT MUST DISAPPEAR', isFinal: false });
  secret.advance(180); secret.layer.paint({}, noPrivateBackdrop);
  const secretRaster = secret.layer.motionContent;
  assert.ok(secretRaster); assert.match(secret.layer.cachedLayout.source, /PRIVATE/);
  for (const h of [secret, clean]) {
    h.advance(200); h.layer.handleInput({ type: 'double-click' });
    assert.equal(h.layer.text, ''); assert.equal(h.layer.cachedLayout, null); assert.equal(h.layer.motionContent, null);
  }
  secret.listeners.transcript({ text: 'LATE PRIVATE FINAL', isFinal: true });
  for (const time of [200, 280, 380, 559]) {
    secret.advance(time); clean.advance(time);
    const actual = secret.layer.paint({}, noPrivateBackdrop);
    const expected = clean.layer.paint({}, noPrivateBackdrop);
    assert.deepEqual(Buffer.from(actual.pixels), Buffer.from(expected.pixels), `cancel frame at ${time}ms contains only safe UI`);
    assert.notEqual(secret.layer.motionContent, secretRaster);
    assert.equal(secret.layer.cachedLayout.source, 'Nothing sent.');
  }
  assert.deepEqual(secret.result.drafts, []);
  secret.layer.onRemoved(); clean.layer.onRemoved();
  assert.equal(secret.layer.motionContent, null); assert.equal(secret.layer.cachedLayout, null);
});

test('explicit dashboard backdrop stays opaque, refreshes on invalidation and resize, and is discarded on removal', () => {
  let calls = 0, marker = 180;
  const viewport = { ...captureViewport };
  const h = setup({ raster: true, origin: captureOrigin, viewport,
    paintDashboard: (w, height, Image) => { calls++; const image = new Image(w, height, 0); image.pixels[0] = marker; return image; } });
  const first = h.layer.paint({}, noPrivateBackdrop);
  assert.ok(first.pixels.every(value => value > 0), 'transparent dashboard cannot punch through the privacy shield');
  assert.ok(first.pixels[0] > 1);
  h.advance(80); h.layer.paint({}, noPrivateBackdrop); assert.equal(calls, 1, 'reuse backdrop while moving');
  marker = 230; h.layer.invalidateBackdrop();
  const refreshed = h.layer.paint({}, noPrivateBackdrop); assert.equal(calls, 2); assert.notEqual(refreshed.pixels[0], first.pixels[0]);
  viewport.width = 640; h.layer.paint({}, noPrivateBackdrop); assert.equal(calls, 3); assert.equal(h.layer.motionContent.width, 640);
  h.layer.handleInput({ type: 'double-click' }); assert.equal(h.layer.backdrop, null);
  h.advance(440); h.layer.paint({}, noPrivateBackdrop); assert.equal(calls, 4, 'closing uses fresh undimmed destination');
  assert.equal(h.layer.backdrop.pixels[0], marker);
  h.layer.onRemoved(); assert.equal(h.layer.backdrop, null); assert.equal(h.layer.motionContent, null);
});

test('speaker rejection during expansion invalidates the partial raster before painting failure', () => {
  const h = setup({ raster: true, origin: captureOrigin, viewport: captureViewport });
  h.listeners.transcript({ text: 'UNVERIFIED PRIVATE PARTIAL', isFinal: false }); h.advance(180);
  h.layer.paint({}, noPrivateBackdrop); const partial = h.layer.motionContent;
  h.listeners.status({ status: 'Ignored: speaker verification failed' });
  assert.equal(h.layer.text, ''); assert.equal(h.layer.cachedLayout, null); assert.equal(h.layer.motionContent, null);
  h.layer.paint({}, noPrivateBackdrop);
  assert.notEqual(h.layer.motionContent, partial); assert.doesNotMatch(h.layer.cachedLayout.source, /PRIVATE/);
  assert.match(h.layer.cachedLayout.source, /Nothing sent/); assert.deepEqual(h.result.drafts, []); h.layer.onRemoved();
});

test('640x452 capture begins motion after delayed first snapshot while microphone time remains accurate', () => {
  const origin = { x: 291, y: 95, width: 288, height: 44 };
  const h = setup({ firstPaint: false, origin, viewport: { x: 0, y: 0, width: 640, height: 452 },
    paintDashboard: (w, height, Image) => { h.advance(1300); return new Image(w, height, 1); } });
  h.advance(600); assert.equal(h.layer.isAnimatingCard(), true);
  const renders = h.result.renders;
  [...h.timers.values()].find(timer => timer.interval).callback(); assert.equal(h.result.renders, renders); assert.equal(h.layer.needsAnimation(), true);
  const first = h.layer.paint({}, noPrivateBackdrop);
  assert.deepEqual(first.rects[0].slice(0, 4), [291, 95, 288, 44]);
  assert.equal(h.layer.expansionStartedAt, 1300);
  assert.ok(h.layer.motionContent.labels.includes('LISTENING | 1s'), 'microphone elapsed time includes pre-render work');
  h.advance(1480);
  const half = h.layer.paint({}, noPrivateBackdrop);
  const rect = h.cardRect(origin, { x: 0, y: 0, width: 635, height: 447 }, .5);
  assert.deepEqual(half.rects[0].slice(0, 4), [rect.x, rect.y, rect.width, rect.height]);
  h.advance(1660); assert.equal(h.layer.isAnimatingCard(), false); h.layer.onRemoved();
});
