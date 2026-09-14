const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: (name) => { if (name === './resource') return load('app/apps/t3/resource.ts'); if (!(name in imports)) throw new Error(name); return imports[name]; }, URL, setTimeout, clearTimeout, ...globals });
  return module.exports;
}
const security = load('app/t3/security.ts');
test('T3 URL rejects credential/query injection and insecure remote hosts', () => {
  for (const url of ['ws://example.org', 'https://example.org', 'wss://user:password@example.org', 'wss://example.org/?token=x', 'wss://example.org/#x', 'ws://192.168.1.2']) assert.throws(() => security.bridgeEndpoint(url));
  assert.equal(security.bridgeEndpoint('wss://bridge.example/test'), 'wss://bridge.example/v1/faceclaw/events');
  assert.equal(security.bridgeEndpoint('ws://10.0.2.2:8787'), 'ws://10.0.2.2:8787/v1/faceclaw/events');
  assert.doesNotThrow(() => security.bridgeEndpoint('ws://192.168.1.2', true));
  assert.throws(() => security.bridgeEndpoint('ws://example.org', true));
  assert.throws(() => security.bridgeEndpoint('ws://10.evil.example', true));
  assert.throws(() => security.bridgeEndpoint('ws://192.168.evil.example', true));
  assert.throws(() => security.validateToken('ok\r\nAuthorization: stolen'));
});
test('T3 tool relay rejects wrong project, expiry and duplicate delivery', () => {
  const guard = new security.ToolReplayGuard();
  const call = { callId: 'c1', projectId: 'p1', threadId: 't1', name: 'glasses.state', arguments: {}, issuedAt: 1000, expiresAt: 10000 };
  assert.equal(guard.admit(call, 'p2', 2000), false);
  assert.equal(guard.admit(call, 'p1', 11000), false);
  assert.equal(guard.admit(call, 'p1', 2000), true);
  assert.equal(guard.admit(call, 'p1', 2001), false);
});
function transport() {
  const sockets = [];
  const config = { enabled: true, bridgeUrl: 'wss://bridge.example', token: 'a'.repeat(32), allowInsecureLocal: false };
  const api = load('app/t3/client.ts', { './security': security, './config': { getT3Config: () => config }, '../native/cloud-stt': { toJavaBytes: (x) => x } }, { com: { faceclaw: { app: {
    FaceclawWebSocketListener: function(listener) { return listener; },
    FaceclawWebSocket: function(url, listener, header, value) { this.listener = listener; this.frames = []; this.sendText = (text) => { this.frames.push(JSON.parse(text)); return true; }; this.close = () => {}; this.sendBinary = () => true; this.header = header; this.value = value; sockets.push(this); },
  } } } });
  return { client: new api.T3Client(), sockets, config };
}
test('dropped T3 requests fail without replay and stale socket callbacks cannot revive connection', async () => {
  const { client, sockets, config } = transport(); client.configure(config);
  const connecting = client.connect(); sockets[0].listener.onOpen(); await connecting;
  assert.equal(sockets[0].header, 'Sec-WebSocket-Protocol');
  const response = client.rpc('assistant.start', { text: 'hello' });
  sockets[0].listener.onFailure('secret raw error must not leak');
  await assert.rejects(response, (error) => error.code === 'T3_CONNECTION_DROPPED' && error.dispatched);
  const next = client.connect(); sockets[1].listener.onOpen(); await next;
  sockets[0].listener.onClosed();
  assert.equal(client.connected, true);
  assert.equal(sockets[1].frames.length, 0);
  client.close();
});
test('unsolicited and stale response ids cannot settle a current request', async () => {
  const { client, sockets, config } = transport(); client.configure(config);
  const connecting = client.connect(); sockets[0].listener.onOpen(); await connecting;
  const response = client.rpc('projects.list'); const id = sockets[0].frames[0].id;
  sockets[0].listener.onTextMessage(JSON.stringify({ v: 1, type: 'response', id: 'wrong', ok: true, result: 'wrong' }));
  sockets[0].listener.onTextMessage(JSON.stringify({ v: 1, type: 'response', id, ok: true, result: 'correct' }));
  assert.equal(await response, 'correct'); client.close();
});
const flush = () => new Promise((resolve) => setImmediate(resolve));
test('assistant uses configured fallback only before dispatch', async () => {
  const config = { enabled: true, preferAssistant: true, assistantProjectId: 'p', assistantProvider: 'codex', assistantModel: 'model' };
  let fallbackCount = 0; const errors = []; const calls = [];
  const client = { configure() {}, connect: async () => { throw new Error('offline'); }, rpc: async (method) => { calls.push(method); throw new Error('T3_CONNECTION_DROPPED'); } };
  const assistant = load('app/t3/assistant.ts', { './config': { getT3Config: () => config }, './client': { t3Client: client } });
  const callbacks = { onTextDelta() {}, onToolActivity() {}, onTurnDone() {}, onError: (error) => errors.push(error) };
  assistant.sendT3Assistant('first', callbacks, () => { fallbackCount++; return { cancel() {} }; }); await flush();
  assert.equal(fallbackCount, 1); assert.equal(calls.length, 0);
  client.connect = async () => {};
  assistant.sendT3Assistant('second', callbacks, () => { fallbackCount++; return { cancel() {} }; }); await flush();
  assert.equal(fallbackCount, 1); assert.deepEqual(calls, ['assistant.start']); assert.deepEqual(errors, ['T3_CONNECTION_DROPPED']);
});
test('cancelling T3 assistant during connect prevents dispatch and fallback', async () => {
  let connected; let dispatched = false; let fallback = false;
  const client = { configure() {}, connect: () => new Promise((resolve) => { connected = resolve; }), rpc: async () => { dispatched = true; } };
  const assistant = load('app/t3/assistant.ts', { './config': { getT3Config: () => ({}) }, './client': { t3Client: client } });
  const handle = assistant.sendT3Assistant('cancel me', {}, () => { fallback = true; return { cancel() {} }; });
  handle.cancel(); connected(); await flush();
  assert.equal(dispatched, false); assert.equal(fallback, false);
});
test('provider-scoped tool calls require explicit provenance and bounded lifetime', () => {
  const guard = new security.ToolReplayGuard();
  const call = { callId: 'provider1', projectId: 'p1', providerSessionId: 's1', bindingKind: 'provider-session', name: 'glasses.state', arguments: {}, issuedAt: 1000, expiresAt: 10000 };
  assert.equal(guard.admit({ ...call, bindingKind: 'claimed' }, 'p1', 2000), false);
  assert.equal(guard.admit({ ...call, expiresAt: 200000 }, 'p1', 2000), false);
  assert.equal(guard.admit(call, 'p1', 2000), true);
});
const { T3Workspace } = load('app/apps/t3/workspace.ts', { '../../t3/security': security });
const planRequest = { requestId: 'r1', revision: 'v1', questions: [{ id: 'q1', options: [{ label: 'Yes' }] }] };
const plan = () => ({ request: planRequest, answers: [{ questionId: 'q1', text: '', optionIndexes: [0] }], locked: false, notice: '' });
test('federated session actions, drafts and subscriptions stay bound to their owning environment', async () => {
  const calls = [], saved = new Map();
  const session = environmentId => ({ id: 'same', environmentId, projectId: 'same-project', projectTitle: 'Project',
    title: environmentId, status: 'ready', settled: false, interactionMode: 'plan', modelSelection: { instanceId: 'provider', model: 'model' } });
  const sessions = ['a', 'b'].map(session);
  const api = { rpc: async (method, params = {}) => {
    calls.push({ method, params });
    if (method === 'transcript.get') return { session: session(params.environmentId), turns: [], pendingPlanInput: planRequest };
    if (method === 'sessions.list') return { unsettled: sessions, settled: [] };
    if (method === 'projects.list') return { projects: [] };
    if (method === 'models.list') return { models: [] };
    return { threadId: 'same', environmentId: params.environmentId, sequence: 1 };
  } };
  const workspace = new T3Workspace(api);
  workspace.setDraftStorage({ scope: () => 'host', save: (k, v) => saved.set(k, JSON.parse(JSON.stringify(v))), load: k => saved.get(k) ?? null, remove: k => saved.delete(k) });
  await workspace.openThread('same', 'a');
  workspace.setAnswer('same', { questionId: 'q1', text: 'Only A', optionIndexes: [] });
  await workspace.openThread('same', 'b');
  assert.equal(workspace.getPlan('same').answers.length, 0);
  workspace.setAnswer('same', { questionId: 'q1', text: 'Only B', optionIndexes: [] });
  assert.equal(await workspace.submitPlan('same'), true);
  assert.equal(calls.find(c => c.method === 'plan.submit').params.environmentId, 'b');
  assert.equal(calls.find(c => c.method === 'transcript.unsubscribe').params.environmentId, 'a');
  assert.equal(await workspace.setReasoning('same', 'high', { instanceId: 'provider', model: 'model' }), true);
  assert.equal(await workspace.setModel('same', { instanceId: 'provider', model: 'other' }, { instanceId: 'provider', model: 'model' }), true);
  assert.equal(await workspace.send('Only B'), true);
  assert.equal(calls.find(c => c.method === 'turn.send').params.environmentId, 'b');
  assert.equal(calls.find(c => c.method === 'thread.model.set').params.environmentId, 'b');
  assert.equal(calls.find(c => c.method === 'thread.reasoning.set').params.environmentId, 'b');
  await workspace.settle('same', 'a');
  assert.equal(calls.find(c => c.method === 'thread.settle').params.environmentId, 'a');
  await workspace.openThread('same', 'a');
  assert.equal(workspace.getPlan('same').answers[0].text, 'Only A');
  assert.notEqual([...saved.keys()][0], [...saved.keys()][1]);
});
test('federated creation filters models and rejects a response from the wrong environment', async () => {
  const f = controlWorkspace();
  f.workspace.environments = [{ environmentId: 'a', isPrimary: true }];
  f.workspace.models = [{ instanceId: 'same', model: 'same', environmentId: 'a' }, { instanceId: 'same', model: 'same', environmentId: 'b' }];
  assert.equal(f.workspace.modelsFor('b').length, 1);
  assert.equal(f.workspace.modelsFor('b')[0].environmentId, 'b');
  f.api.rpc = async (method, params) => { f.calls.push({ method, params }); return { threadId: 'new', environmentId: 'a' }; };
  assert.equal(await f.workspace.send('hello', { environmentId: 'b', projectId: 'same', modelSelection: { instanceId: 'same', model: 'same' } }), false);
  assert.equal(f.calls[0].params.environmentId, 'b');
  assert.equal(f.workspace.selectedThreadId, 'thread');
  assert.equal(f.workspace.canRetryLastSend, false);
});
test('host switching with a reused transport cannot queue an old unsubscribe onto the new host', async () => {
  const calls = [], api = { rpc: async (...args) => { calls.push(args); return {}; } };
  const workspace = new T3Workspace(api);
  workspace.selectedThreadId = 'old'; workspace.selectedEnvironmentId = 'old-computer';
  workspace.useApi(api, false);
  await Promise.resolve();
  assert.equal(calls.length, 0);
  assert.equal(workspace.selectedThreadId, '');
  assert.equal(workspace.selectedEnvironmentId, undefined);
});
test('plan lock must persist successfully before any dispatch', async () => {
  let dispatched = false;
  const workspace = new T3Workspace({ rpc: async () => { dispatched = true; } });
  workspace.plans.set('thread1', plan());
  workspace.setDraftStorage({ scope: () => 'endpoint', save() { throw new Error('disk failure'); }, load() { return null; }, remove() {} });
  assert.equal(await workspace.submitPlan('thread1'), false);
  assert.equal(dispatched, false);
  assert.equal(workspace.plans.get('thread1').locked, true);
});
test('demo draft edits never read or write live persistent storage', async () => {
  const workspace = new T3Workspace({ rpc: async () => ({}) });
  const unexpected = () => { throw new Error('live storage touched'); };
  workspace.setDraftStorage({ scope: unexpected, save: unexpected, load: unexpected, remove: unexpected });
  workspace.useApi({ rpc: async () => ({}) }, true);
  workspace.plans.set('thread1', plan());
  workspace.setAnswer('thread1', { questionId: 'q1', text: 'demo only', optionIndexes: [] });
  assert.equal(workspace.error, '');
  assert.equal(await workspace.submitPlan('thread1'), true);
});
test('late plan failure after mode switch cannot contaminate new workspace', async () => {
  let reject;
  const workspace = new T3Workspace({ rpc: () => new Promise((resolve, fail) => { reject = fail; }) });
  workspace.plans.set('thread1', plan());
  const submitted = workspace.submitPlan('thread1');
  workspace.useApi({ rpc: async () => { throw new Error('new mode must stay idle'); } }, true);
  reject(new Error('old connection dropped'));
  assert.equal(await submitted, false);
  assert.equal(workspace.error, '');
  assert.equal(workspace.plans.size, 0);
});
test('late settlement cannot refresh a newly selected live API', async () => {
  let resolve; let newCalls = 0;
  const workspace = new T3Workspace({ rpc: () => new Promise((done) => { resolve = done; }) });
  const settling = workspace.settle('old-thread');
  workspace.useApi({ rpc: async () => { newCalls++; } }, false);
  resolve({ settled: true });
  assert.equal(await settling, false); assert.equal(newCalls, 0);
});

test('running and starting sessions steer even without liveActivity decoration', async () => {
  for (const status of ['running', 'starting']) {
    const methods = [];
    const workspace = new T3Workspace({ rpc: async (method) => { methods.push(method); throw Object.assign(new Error('rejected'), { code: 'session_not_running' }); } });
    workspace.selectedThreadId = 'thread'; workspace.transcript = { session: { id: 'thread', status }, liveActivity: null };
    assert.equal(await workspace.send('steer'), false);
    assert.deepEqual(methods, ['turn.steer']);
    assert.equal(workspace.canRetryLastSend, true);
  }
});
test('uncertain send errors keep drafts locked, definite pre-dispatch failure permits retry', async () => {
  for (const [error, retry] of [
    [{ code: 'T3_NOT_CONNECTED', dispatched: false }, true],
    [{ code: 'T3_CONNECTION_DROPPED', dispatched: true }, false],
    [{ code: 'upstream_unavailable' }, false],
    [{ code: 'upstream_invalid_response' }, false],
    [{ code: 'session_busy' }, true],
  ]) {
    const workspace = new T3Workspace({ rpc: async () => { throw error; } });
    workspace.selectedThreadId = 'thread';
    assert.equal(await workspace.send('message'), false);
    assert.equal(workspace.canRetryLastSend, retry);
  }
});
function runtimeHarness() {
  const config = { bridgeUrl: 'wss://bridge.example', pairingFingerprint: 'identity-one', enabled: true, allowInsecureLocal: false };
  const pending = [];
  let rpcCalls = 0;
  const client = {
    configure() {}, onStateChange() {}, onEvent() {},
    connect: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
    rpc: async (method) => { rpcCalls++; return method === 'projects.list' ? { projects: [] } : method === 'models.list' ? { models: [] } : { unsettled: [], settled: [] }; },
  };
  const api = load('app/apps/t3/runtime.ts', {
    '../../t3/client': { t3Client: client }, '../../t3/config': { getT3Config: () => config, onT3ConfigChanged() {} },
    '../../t3/security': security, './workspace': { T3Workspace }, './demo': load('app/apps/t3/demo.ts'),
    '../../t3/tools': { startT3ToolRelay() {} }, '../../t3/drafts': {},
  });
  return { api, pending, config, rpcCalls: () => rpcCalls };
}
test('reconnect backoff escalates with bounded jitter and caps at thirty seconds', () => {
  const { api } = runtimeHarness();
  assert.equal(api.t3ReconnectDelayMs(0, 0), 800);
  assert.equal(api.t3ReconnectDelayMs(0, 1), 1000);
  assert.equal(api.t3ReconnectDelayMs(3, 0.5), 7200);
  assert.equal(api.t3ReconnectDelayMs(20, 1), 30000);
  assert.equal(api.t3ReconnectDelayMs(-5, 0), 800);
});
test('late live connect success/failure cannot refresh or change sample mode', async () => {
  for (const fail of [false, true]) {
    const { api, pending, rpcCalls } = runtimeHarness();
    const connecting = api.connectT3();
    await api.useT3SampleData();
    if (fail) pending[0].reject(new Error('obsolete live error')); else pending[0].resolve();
    await connecting;
    assert.equal(api.t3Workspace.demo, true);
    assert.equal(api.t3Workspace.error, '');
    assert.equal(rpcCalls(), 0);
  }
});
test('re-pairing the same endpoint clears selected thread, plans, and alerts before reconnect', async () => {
  const { api, pending, config } = runtimeHarness();
  const first = api.connectT3(); pending[0].resolve(); await first;
  api.t3Workspace.selectedThreadId = 'old-account-thread'; api.t3Workspace.plans.set('old-account-thread', plan());
  api.t3Workspace.alerts.push({ id: 'old', threadId: 'old-account-thread' });
  config.pairingFingerprint = 'identity-two';
  const second = api.connectT3();
  assert.equal(api.t3Workspace.selectedThreadId, '');
  assert.equal(api.t3Workspace.plans.size, 0);
  assert.equal(api.t3Workspace.alerts.length, 0);
  pending[1].resolve(); await second;
});
function notificationHarness(sources = [], requestReply = () => Promise.resolve({status: 'sent'})) {
  const config = { bridgeUrl: 'wss://bridge.example', pairingFingerprint: 'pair-one' };
  const state = { alerts: [], demo: false, onArrival() {}, onChange() {}, removeAlert() {}, fail() {} };
  const opened = []; const dismissed = []; let nativeClick;
  const api = load('app/apps/t3/notifications-ui.ts', {
    '../../extensions/host': { ownsFeature: () => true },
    '../../native/external-notifications': { invokeExternalNotification: () => false },
    '../../t3/config': { getT3Config: () => config, onT3ConfigChanged() {} },
    '../../t3/notification-preferences': load('app/t3/notification-preferences.ts', { '../native/settings-store': { onSettingsStoreChanged: () => () => {} } }),
    '../../ui/notification-routing': { setNotificationOpenRoute() {} },
    '../../ui/shell/shell': { shell: { foregroundWindow: () => undefined, closeNotificationPreview() {}, getWindows: () => [], isWindowFocused: () => false, focusWindow() {}, wake() {}, openNotificationModal() {} } },
    '../../native/notification-icons': { requestNotificationReply: requestReply, readActiveNotifications: () => sources, dismissNotification: (key) => { dismissed.push(key); return true; }, onAndroidNotificationRemoved() {}, onAndroidNotificationsChanged() {} },
    '../../t3/notifications': { initializeT3PhoneNotifications() {}, postT3Notification() {}, dismissT3Notification: (id) => dismissed.push(id), onT3NotificationRemoved() {}, onT3ThreadOpenRequested: (listener) => { nativeClick = listener; } },
    './runtime': { t3Workspace: state, connectT3: async () => { state.demo = false; } },
    './t3-app': { isT3FlowProtected: () => false, openT3Thread: (id) => opened.push(id) },
  });
  return { api, config, state, opened, dismissed, nativeClick: () => nativeClick };
}
test('stale notification overlay cannot open or dismiss after mode switch', async () => {
  const h = notificationHarness(); let resolve;
  h.api.initializeT3Notifications(() => new Promise((done) => { resolve = done; }));
  const alert = { id: 'old-alert', kind: 't3', threadId: 'old-thread' }; h.state.alerts = [alert];
  const opening = h.api.openT3Alert(alert);
  h.state.alerts = []; h.state.demo = true;
  resolve(); await opening;
  h.api.dismissT3Alert(alert);
  assert.deepEqual(h.opened, []); assert.deepEqual(h.dismissed, []);
});
test('native notification awaiting window cannot cross a new pairing', async () => {
  const h = notificationHarness(); let resolve;
  h.api.initializeT3Notifications(() => new Promise((done) => { resolve = done; }));
  h.nativeClick()('signed-old-thread');
  h.config.pairingFingerprint = 'pair-two'; resolve(); await flush();
  assert.deepEqual(h.opened, []);
});
test('disabling or re-pairing bridge dictation stops audio on the old transport', async () => {
  for (const change of [{ enabled: false }, { token: 'new-pairing' }]) {
    const config = { enabled: true, bridgeDictation: true, token: 'old-pairing', bridgeUrl: 'wss://bridge.example' };
    let configChanged; let audio = 0; let closed = false; let fallback = 0;
    class Client {
      configure() {} onStateChange() { return () => {}; } onEvent() { return () => {}; } connect() { return Promise.resolve(); }
      rpc() { return Promise.resolve({ maxBytes: 9600000, sampleRate: 16000, format: 'pcm_s16le' }); }
      sendAudio() { audio++; } close() { closed = true; }
    }
    const { T3SttClient } = load('app/t3/stt.ts', {
      './config': { getT3Config: () => ({ ...config }), onT3ConfigChanged: (listener) => { configChanged = listener; return () => {}; } },
      './client': { T3Client: Client },
    });
    const stt = new T3SttClient({ onStatus() {}, onTranscript() {} }, () => fallback++);
    stt.start(); await flush(); stt.acceptPcm(new Uint8Array(20));
    Object.assign(config, change); configChanged();
    stt.acceptPcm(new Uint8Array(20));
    assert.equal(audio, 1); assert.equal(closed, true); assert.equal(fallback, 1);
  }
});
test('temporary bridge preview failure preserves audio for final dictation', async () => {
  let event;
  let audio = 0;
  let closed = 0;
  let fallback = 0;
  const statuses = [];
  const transcripts = [];
  class Client {
    configure() {}
    onStateChange() { return () => {}; }
    onEvent(listener) { event = listener; return () => {}; }
    async connect() {}
    async rpc(method) {
      return method === 'voice.start'
        ? { maxBytes: 9600000, sampleRate: 16000, format: 'pcm_s16le' }
        : { text: 'final speech' };
    }
    sendAudio() { audio++; }
    close() { closed++; }
  }
  const { T3SttClient } = load('app/t3/stt.ts', {
    './config': { getT3Config: () => ({ enabled: true, bridgeDictation: true }), onT3ConfigChanged: () => () => {} },
    './client': { T3Client: Client },
  });
  const stt = new T3SttClient({
    onStatus: status => statuses.push(status),
    onTranscript: value => transcripts.push(value),
    onError() {},
  }, () => fallback++);
  stt.start();
  await flush();
  event({ event: 'voice.error', payload: { error: { code: 'partial_transcription_unavailable' } } });
  stt.acceptPcm(new Uint8Array(1600));
  stt.finish();
  await flush();
  assert.equal(audio, 1);
  assert.equal(fallback, 0);
  assert.equal(closed, 1);
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].text, 'final speech');
  assert.equal(transcripts[0].isFinal, true);
  assert.deepEqual(statuses, ['Live preview unavailable. Finish dictation to transcribe.']);
});
test('bridge disconnect fails an active T3 dictation without waiting for stop', async () => {
  let state;
  let audio = 0;
  let fallback = 0;
  class Client {
    configure() {}
    onStateChange(listener) { state = listener; return () => {}; }
    onEvent() { return () => {}; }
    async connect() {}
    async rpc() { return { maxBytes: 9600000, sampleRate: 16000, format: 'pcm_s16le' }; }
    sendAudio() { audio++; }
    close() {}
  }
  const { T3SttClient } = load('app/t3/stt.ts', {
    './config': { getT3Config: () => ({ enabled: true, bridgeDictation: true }), onT3ConfigChanged: () => () => {} },
    './client': { T3Client: Client },
  });
  const stt = new T3SttClient({ onStatus() {}, onTranscript() {}, onError() {} }, () => fallback++);
  stt.start();
  await flush();
  state({ phase: 'failed', status: 'T3_CONNECTION_DROPPED' });
  stt.acceptPcm(new Uint8Array(1600));
  assert.equal(audio, 0);
  assert.equal(fallback, 1);
});
function shellVoiceHarness(prepare) {
  const source = ts.createSourceFile('shell.ts', fs.readFileSync('app/ui/shell/shell.ts', 'utf8'), ts.ScriptTarget.Latest);
  const imports = {};
  for (const statement of source.statements) if (ts.isImportDeclaration(statement)) imports[statement.moduleSpecifier.text] = {};
  const layers = []; const activity = [];
  class Stack {
    push(layer) { layers.push(layer); }
    isAtBase() { return layers.length === 0; }
    removeLayer(layer) { const index = layers.indexOf(layer); if (index < 0) return false; layers.splice(index, 1); layer.options.onClosed(); return true; }
    popIfTop(predicate) { const top = layers[layers.length - 1]; if (predicate(top)) { layers.pop(); top.options.onClosed(); } }
    clearToBase() { while (layers.length) layers.pop().options.onClosed(); }
  }
  class Voice {
    constructor(options) { this.options = options; this.started = false; }
    startCapture() { this.started = true; }
  }
  imports['../layers'] = { noopLayerActions: {}, LayerStack: Stack };
  imports['./chrome-layer'] = { ShellChromeLayer: class {} };
  imports['../menu'] = { MenuLayer: class {} };
  imports['./voice-input'] = { VoiceInputLayer: Voice };
  imports['./voice-search'] = { VoiceSearchLayer: Voice };
  imports['./voice-activity'] = { voiceActivity: { setActive: (active) => activity.push(active) } };
  const { shell } = load('app/ui/shell/shell.ts', imports);
  shell.config = { actions: {}, prepareVoiceCapture: prepare, requestShellRender() {} };
  return { shell, layers, activity };
}
function scopedToolsHarness() {
  const base = load('app/assistant/tool-registry.ts');
  const config = { enabled: true, allowTools: true, assistantProjectId: 'assistant-project' };
  let calls = 0; let available = true;
  base.toolRegistry.register({ spec: { name: 'apps.launch', description: 'Launch test app', inputSchema: {}, availability: 'always', proactive: false }, isAvailable: () => available, handler: () => { calls++; return { ok: true, content: 'launched' }; } });
  const scoped = load('app/t3/notification-tools.ts', {
    '../assistant/tool-registry': base,
    './config': { getT3Config: () => config },
    '../native/notification-icons': {},
  });
  return { base, scoped, config, calls: () => calls, setAvailable: (value) => { available = value; } };
}

const proposedPlan = { planId: 'plan-1', revision: 'a'.repeat(64), turnId: 'turn-1', planMarkdown: '# Plan\n\nMake the reviewed change.',
  createdAt: '2026-09-04T12:00:00.000Z', updatedAt: '2026-09-04T12:00:00.000Z' };
function controlWorkspace() {
  const calls = []; const records = new Map();
  const transcript = { session: { id: 'thread', projectId: 'project', status: 'ready', interactionMode: 'plan',
    modelSelection: { instanceId: 'codex', model: 'model', reasoningId: 'high' } }, pendingProposedPlan: { ...proposedPlan }, turns: [] };
  const api = { rpc: async (method, params) => {
    calls.push({ method, params });
    if (method === 'transcript.get') return transcript;
    if (method === 'sessions.list') return { unsettled: [transcript.session], settled: [] };
    if (method === 'projects.list') return { projects: [] };
    if (method === 'models.list') return { models: [] };
    return { threadId: 'thread', planId: 'plan-1', sequence: 2 };
  } };
  const storage = { scope: () => 'paired-endpoint', load: () => null, save() {}, remove() {},
    loadApproval: key => records.get(key) ?? null,
    saveApproval: key => records.set(key, { locked: true }), removeApproval: key => records.delete(key) };
  const workspace = new T3Workspace(api); workspace.setDraftStorage(storage);
  workspace.selectedThreadId = 'thread'; workspace.transcript = transcript;
  return { workspace, api, calls, records, storage, transcript };
}
test('completed plan parser bounds structured text, revision, timestamps and source turn', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(security.parseProposedPlan({ ...proposedPlan, private: 'removed' }))), proposedPlan);
  for (const value of [null, [], {}, { ...proposedPlan, revision: 'untrusted' }, { ...proposedPlan, planMarkdown: 'x'.repeat(64001) },
    { ...proposedPlan, planId: '\u0000bad' }, { ...proposedPlan, turnId: '../other' }, { ...proposedPlan, turnId: null },
    { ...proposedPlan, updatedAt: '2026' }, { ...proposedPlan, createdAt: 'invalid' }]) assert.equal(security.parseProposedPlan(value), null);
});
test('transcript load sanitizes optional controls and rejects a mismatched thread response', async () => {
  const f = controlWorkspace();
  f.transcript.session.modelSelection = { instanceId: 'codex', model: 'model', reasoningId: 'high', secret: 'removed' };
  await f.workspace.refreshTranscript();
  assert.equal(f.workspace.transcript.session.modelSelection.secret, undefined);
  f.transcript.session.interactionMode = 'arbitrary'; f.transcript.pendingProposedPlan = { ...proposedPlan, revision: 'bad' };
  await f.workspace.refreshTranscript();
  assert.equal(f.workspace.transcript.session.interactionMode, undefined); assert.equal(f.workspace.transcript.pendingProposedPlan, null);
  f.api.rpc = async () => ({ session: { id: 'other' } });
  await f.workspace.refreshTranscript(); assert.match(f.workspace.error, /T3_INVALID_RESPONSE/);
});
test('draft mode applies only to idle sends and never silently changes an active steer', async () => {
  const f = controlWorkspace();
  assert.equal(await f.workspace.send('Reviewed text', undefined, { interactionMode: 'default' }), true);
  assert.equal(f.calls[0].method, 'turn.send'); assert.equal(f.calls[0].params.interactionMode, 'default');
  f.calls.length = 0; f.transcript.session.status = 'running';
  assert.equal(await f.workspace.send('Retained draft', undefined, { interactionMode: 'default' }), false);
  assert.equal(f.calls.length, 0); assert.equal(f.workspace.canRetryLastSend, true);
  assert.equal(await f.workspace.send('Same-mode steer', undefined, { interactionMode: 'plan' }), true);
  assert.equal(f.calls[0].method, 'turn.steer'); assert.equal('interactionMode' in f.calls[0].params, false);
});
test('reasoning controls retain expected model identity and refuse stale or active sessions', async () => {
  const f = controlWorkspace();
  assert.equal(await f.workspace.setReasoning('thread', 'low', { instanceId: 'codex', model: 'changed' }), false);
  assert.equal(f.calls.length, 0);
  assert.equal(await f.workspace.setReasoning('thread', 'low', { instanceId: 'codex', model: 'model' }), true);
  assert.equal(f.calls[0].method, 'thread.reasoning.set');
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].params)), { threadId: 'thread', reasoningId: 'low', expectedModel: { instanceId: 'codex', model: 'model' } });
  f.calls.length = 0; f.transcript.session.status = 'running';
  assert.equal(await f.workspace.setReasoning('thread', 'high', { instanceId: 'codex', model: 'model' }), false); assert.equal(f.calls.length, 0);
});
test('plan approval persists intent before dispatch and blocks duplicate approvals across restart', async () => {
  const f = controlWorkspace(); const original = f.api.rpc;
  f.api.rpc = async (method, params) => { if (method === 'plan.approve') assert.equal(f.records.size, 1); return original(method, params); };
  assert.equal(await f.workspace.approvePlan('thread', proposedPlan), true);
  assert.equal(await f.workspace.approvePlan('thread', proposedPlan), false);
  const restarted = new T3Workspace(f.api); restarted.setDraftStorage(f.storage); restarted.selectedThreadId = 'thread'; restarted.transcript = f.transcript;
  assert.equal(restarted.isPlanApprovalLocked('thread', proposedPlan), true);
  assert.equal(await restarted.approvePlan('thread', proposedPlan), false);
  assert.equal(f.calls.filter(c => c.method === 'plan.approve').length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(c => c.method === 'plan.approve').params)), { threadId: 'thread', planId: 'plan-1', revision: proposedPlan.revision });
});
test('approval refuses stale text/revision, missing storage, and storage failure before dispatch', async () => {
  const f = controlWorkspace();
  for (const plan of [{ ...proposedPlan, revision: 'b'.repeat(64) }, { ...proposedPlan, planMarkdown: 'different' }]) assert.equal(await f.workspace.approvePlan('thread', plan), false);
  const unconfigured = new T3Workspace(f.api); unconfigured.transcript = f.transcript; unconfigured.selectedThreadId = 'thread';
  assert.equal(await unconfigured.approvePlan('thread', proposedPlan), false);
  f.storage.saveApproval = () => { throw new Error('storage unavailable'); };
  assert.equal(await f.workspace.approvePlan('thread', proposedPlan), false);
  assert.equal(f.calls.length, 0); assert.equal(f.workspace.isPlanApprovalLocked('thread', proposedPlan), true);
});
test('approval unlocks only definite predispatch rejections and retains uncertain intents', async () => {
  for (const code of ['plan_unavailable', 'plan_approval_uncertain', 'T3_CONNECTION_DROPPED']) {
    const f = controlWorkspace(); f.api.rpc = async () => { throw Object.assign(new Error(code), { code, dispatched: true }); };
    assert.equal(await f.workspace.approvePlan('thread', proposedPlan), false);
    assert.equal(f.workspace.isPlanApprovalLocked('thread', proposedPlan), code !== 'plan_unavailable');
  }
});
test('approval late responses cannot update a new pairing or replay into demo mode', async () => {
  const f = controlWorkspace(); let complete; let newCalls = 0;
  f.api.rpc = () => new Promise(resolve => { complete = resolve; });
  const pending = f.workspace.approvePlan('thread', proposedPlan);
  f.workspace.useApi({ rpc: async () => { newCalls++; } }, true);
  complete({ sequence: 2 }); assert.equal(await pending, false);
  assert.equal(newCalls, 0); assert.equal(f.workspace.error, ''); assert.equal(f.workspace.busy, false);
});
test('pairing changed during approval transcript refresh prevents refreshing the new API', async () => {
  const f = controlWorkspace(); let newCalls = 0;
  f.api.rpc = async method => {
    if (method === 'plan.approve') return { threadId: 'thread', sequence: 2 };
    f.workspace.useApi({ rpc: async () => { newCalls++; return {}; } }, true);
    return f.transcript;
  };
  assert.equal(await f.workspace.approvePlan('thread', proposedPlan), false);
  assert.equal(newCalls, 0);
});

test('own T3 workspace alerts remain visible when native snapshot is separately filtered',()=>{const h=notificationHarness();const alert={id:'own',kind:'t3',threadId:'thread',createdAt:1};h.state.alerts=[alert];assert.equal(h.api.visibleT3Alerts()[0],alert);});

test('notification review remains current after admission while duplicate review is rejected', async () => {
 const sources=[{key:'fixture',postTime:7,packageName:'fixture.messages',appName:'Messages',title:'Sender',text:'Fixture',lines:[],actions:[{index:0,enabled:true,acceptsText:true}]}];
 let checks,finish,calls=0;
 const h=notificationHarness(sources,(_key,_version,_index,current)=>{calls++;checks=current;if(!current())throw Error('NOTIFICATION_REVIEW_STALE');return new Promise(resolve=>finish=resolve);});
 h.config.notificationOverride=true;
 const reply=h.api.getT3NotificationReply('phone:fixture:7');assert.ok(reply);
 const pending=reply.review(()=>reply.isCurrent());
 assert.equal(calls,1);assert.equal(checks(),true);assert.equal(await reply.review(),'rejected');assert.equal(calls,1);
 h.config.pairingFingerprint='changed';assert.equal(checks(),false);h.config.pairingFingerprint='pair-one';
 sources.length=0;assert.equal(checks(),false);
 finish({status:'sent'});assert.equal(await pending,'sent');
});
test('assistant pins remote creation, transcript and unsubscribe to the selected environment', async () => {
  const config={assistantProjectId:'same-project',assistantEnvironmentId:'mac',assistantProvider:'codex',assistantModel:'model'};
  const calls=[],errors=[];let done=false;
  const client={configure(){},connect:async()=>{},rpc:async(method,params)=>{
    calls.push({method,params});
    if(method==='assistant.start') return {threadId:'same-thread',environmentId:'mac'};
    if(method==='transcript.get') return {environmentId:'mac',session:{id:'same-thread',status:'ready'},turns:[{endedAt:'now',messages:[{role:'assistant',text:'OK'}]}]};
    return {};
  }};
  const api=load('app/t3/assistant.ts',{'./config':{getT3Config:()=>config},'./client':{t3Client:client}});
  api.sendT3Assistant('hello',{onTextDelta(){},onTurnDone(){done=true},onError:e=>errors.push(e)},()=>{throw Error('fallback')});
  await flush();assert.equal(done,true);assert.deepEqual(errors,[]);
  assert.deepEqual(calls.map(c=>[c.method,c.params.environmentId]),[['assistant.start','mac'],['transcript.get','mac'],['transcript.unsubscribe','mac']]);
});
test('assistant rejects an owner mismatch without retrying or reading the wrong transcript', async () => {
  const calls=[],errors=[];
  const client={configure(){},connect:async()=>{},rpc:async(method)=>{calls.push(method);return {threadId:'same-thread',environmentId:'local'}}};
  const api=load('app/t3/assistant.ts',{'./config':{getT3Config:()=>({assistantEnvironmentId:'mac',assistantProjectId:'p',assistantProvider:'codex',assistantModel:'model'})},'./client':{t3Client:client}});
  api.sendT3Assistant('hello',{onError:e=>errors.push(e)},()=>{throw Error('fallback')});await flush();
  assert.deepEqual(calls,['assistant.start']);assert.deepEqual(errors,['T3_OPERATION_UNCERTAIN']);
});
