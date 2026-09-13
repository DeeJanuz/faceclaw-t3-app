const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function setup(available = true) {
  let event;
  const requests = [], finishes = [], cancels = [], ids = [];
  const service = {
    requestCaptureDictation(...args) { requests.push(args); return available; },
    finishCaptureDictation(id) { finishes.push(id); },
    cancelCaptureDictation(id) { cancels.push(id); },
  };
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync('app/native/voice-control.ts', 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require(name) {
    assert.equal(name, '../extensions/host');
    return { nativeService: () => service, onHostEvent: listener => { event = listener; }, setOwnCaptureId: id => ids.push(id) };
  } });
  return { bridge: module.exports.voiceControlBridge, requests, finishes, cancels, ids, event: (...args) => event(...args) };
}
test('T3 requests host dictation and receives only its own host transcript', () => {
  const s = setup(), text = [], statuses = [];
  s.bridge.onTranscript(value => text.push(value.text));
  s.bridge.onStatus(value => statuses.push(value.status));
  s.bridge.startCapture();
  const [id, label, ownTranscription] = s.requests[0];
  assert.equal(label, 'Dictate T3 message');
  assert.equal(ownTranscription, false);
  assert.throws(() => s.bridge.startCapture(), /CAPTURE_BUSY/);
  s.event('capture-dictation-transcript', { requestId: 'stale', purpose: 'capture', text: 'ignored', isFinal: true });
  s.event('capture-dictation-transcript', { requestId: id, purpose: 'capture', text: 'Offline draft', isFinal: true });
  assert.deepEqual(text, ['Offline draft']);
  s.bridge.finishCapture();
  assert.deepEqual(s.finishes, [id]);
  s.event('capture-dictation-closed', { requestId: id, reason: 'complete' });
  assert.deepEqual(statuses, []);
  s.bridge.cancelCapture();
  assert.deepEqual(s.cancels, []);
  assert.equal(s.ids.at(-1), '');
});
test('legacy successful close spelling remains compatible', () => {
  const s = setup(), statuses = [];
  s.bridge.onStatus(value => statuses.push(value.status));
  s.bridge.startCapture();
  const id = s.requests[0][0];
  s.event('capture-dictation-closed', { requestId: id, reason: 'completed' });
  assert.deepEqual(statuses, []);
  assert.equal(s.ids.at(-1), '');
});
test('failed capture close reports unavailable and releases ownership', () => {
  const s = setup(), statuses = [];
  s.bridge.onStatus(value => statuses.push(value.status));
  s.bridge.startCapture();
  const id = s.requests[0][0];
  s.event('capture-dictation-closed', { requestId: id, reason: 'transcript-timeout' });
  assert.deepEqual(statuses, ['Could not start: capture closed']);
  assert.equal(s.ids.at(-1), '');
  s.bridge.startCapture();
  assert.equal(s.requests.length, 2);
});
test('host rejection clears capture ownership and permits a later attempt', () => {
  const s = setup(false);
  assert.throws(() => s.bridge.startCapture(), /CAPTURE_UNAVAILABLE/);
  assert.equal(s.ids.at(-1), '');
  assert.throws(() => s.bridge.startCapture(), /CAPTURE_UNAVAILABLE/);
  assert.equal(s.requests.length, 2);
});
