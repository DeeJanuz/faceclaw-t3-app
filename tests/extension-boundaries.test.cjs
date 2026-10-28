const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { transpile } = require('./helpers/transpile.cjs');
function load(path, imports = {}, globals = {}) {
  const module = { exports: {} };
  vm.runInNewContext(transpile(path), {
    module,
    exports: module.exports,
    setInterval: () => 1,
    clearInterval: () => {},
    require: (name) => {
      if (name === '@faceclaw/motion') return require('@faceclaw/motion');
      assert.ok(name in imports, `unmocked ${name}`);
      return imports[name];
    },
    ...globals,
  });
  return module.exports;
}
const snapshots = load('app/extensions/notification-snapshot.ts');
test('host refreshes coalesce by value and remain distinct from private content invalidation', () => {
  const b = boundary();
  b.configure(b.feature('ui.notifications'));
  const changes = [];
  b.host.onHostState((change) => changes.push(change));
  const state = { battery: { headset: 72, headsetCharging: false } };
  b.host.receiveHostEvent(b.service, 'host-state', state);
  b.host.receiveHostEvent(b.service, 'host-state', JSON.parse(JSON.stringify(state)));
  b.event('ui.notifications', { event: 'host-state', ...state });
  assert.deepEqual(changes, ['ambient']);
  b.event('ui.notifications', { event: 'host-state', battery: { headset: 71, headsetCharging: false } });
  assert.deepEqual(changes, ['ambient', 'ambient']);
  for (const part of fragments()) b.event('ui.notifications', { event: 'notification-snapshot-fragment', ...part });
  assert.equal(changes.length, 3);
  assert.notEqual(changes.at(-1), 'ambient');
});
test('messaging heartbeat binds pairing identity and revokes on bridge loss without exposing the bearer', () => {
  let stateChanged,
    configChanged,
    heartbeat,
    connected = true,
    cleared = false;
  const messages = [];
  let config = {
    enabled: true,
    allowTools: true,
    assistantProjectId: 'project',
    pairingFingerprint: 'a'.repeat(64),
    token: 'PRIVATE-BEARER',
  };
  const api = load(
    'app/t3/tools.ts',
    {
      './tool-rate-limit': load('app/t3/tool-rate-limit.ts'),
      './assistant': { isT3AssistantTurnActive: () => false },
      './config': {
        getT3Config: () => config,
        onT3ConfigChanged: (fn) => {
          configChanged = fn;
          return () => {};
        },
      },
      './security': load('app/t3/security.ts'),
      './client': {
        t3Client: {
          get connected() {
            return connected;
          },
          onEvent: () => () => {},
          onStateChange: (fn) => {
            stateChanged = fn;
            return () => {};
          },
          rpc: async () => ({}),
        },
      },
      '../extensions/host': {
        hostState: { tools: [] },
        onHostState: () => () => {},
        onHostEvent: () => () => {},
        ownsFeature: () => true,
        requestHostAction: async () => ({}),
        sendHostAction: (feature, action, data) => {
          messages.push({ feature, action, data });
          return true;
        },
      },
    },
    {
      setInterval: (fn) => {
        heartbeat = fn;
        return 1;
      },
      clearInterval: () => (cleared = true),
    },
  );
  const stop = api.startT3ToolRelay();
  const first = messages.at(-1).data;
  assert.equal(first.pairingFingerprint, config.pairingFingerprint);
  assert.equal(first.active, true);
  assert.equal(JSON.stringify(messages).includes(config.token), false);
  connected = false;
  stateChanged({ connected: false });
  assert.equal(messages.at(-1).data.active, false);
  const count = messages.length;
  heartbeat();
  assert.equal(messages.length, count);
  connected = true;
  stateChanged({ connected: true });
  assert.notEqual(messages.at(-1).data.bridgeSession, first.bridgeSession);
  config = { ...config, pairingFingerprint: 'b'.repeat(64) };
  configChanged();
  assert.equal(messages.at(-1).data.pairingFingerprint, config.pairingFingerprint);
  stop();
  assert.equal(messages.at(-1).data.active, false);
  assert.equal(cleared, true);
});
const notification = () => ({
  key: 'apk:opaque-id',
  packageName: 'fixture.messages',
  appName: 'Fixture',
  title: 'Sender',
  text: 'Private fixture text',
  bigText: '',
  subText: '',
  infoText: '',
  summaryText: '',
  category: 'msg',
  lines: [],
  postTime: 7,
  when: 7,
  actions: [{ index: 0, title: 'Reply', enabled: true, acceptsText: true }],
});
function fragments(revision = 1, id = 's1') {
  const json = JSON.stringify({ revision, notifications: [notification()] });
  return [
    { snapshotId: id, index: 0, total: 2, json: json.slice(0, 80) },
    { snapshotId: id, index: 1, total: 2, json: json.slice(80) },
  ];
}
function boundary() {
  const timers = new Map(),
    actions = [],
    responses = [];
  let tick = 0;
  class Json {
    constructor(value) {
      this.value = JSON.parse(value);
    }
    toString() {
      return JSON.stringify(this.value);
    }
  }
  const host = load(
    'app/extensions/host.ts',
    { './notification-snapshot': snapshots },
    {
      org: { json: { JSONObject: Json, JSONArray: Json } },
      setTimeout: (fn) => {
        timers.set(++tick, fn);
        return tick;
      },
      clearTimeout: (id) => timers.delete(id),
    },
  );
  const service = {
    invokeExtensionAction(feature, generation, action, data) {
      actions.push({ feature, generation, action, data: data.value });
      return true;
    },
    respondExtension(feature, generation, requestId, data) {
      responses.push({ feature, generation, requestId, data: data.value });
      return true;
    },
  };
  const feature = (
    name,
    generation = 1,
    component = 'com.faceclaw.t3/com.faceclaw.t3.T3AppService',
    available = true,
  ) => ({ feature: name, generation, component, available, configuration: {} });
  const configure = (...features) => host.receiveHostEvent(service, 'extensions', { features });
  const event = (feature, data, generation = 1, type = 'event') =>
    host.receiveHostEvent(service, 'extension-event', { feature, generation, type, data });
  return { host, service, timers, actions, responses, feature, configure, event };
}
test('notification snapshots publish only a complete bounded revision and reject malformed/replayed snapshots', () => {
  const a = new snapshots.NotificationSnapshotAssembler(),
    parts = fragments();
  assert.equal(a.accept(parts[0]), null);
  assert.equal(a.accept({ ...parts[1], total: 129 }), null);
  assert.equal(a.accept(parts[1])[0].text, 'Private fixture text');
  for (const part of parts) assert.equal(a.accept(part), null);
  a.reset();
  assert.equal(a.accept(parts[1]), null);
  const bad = fragments(2, 's2');
  assert.equal(a.accept(bad[0]), null);
  assert.equal(a.accept({ ...bad[1], json: 'invalid' }), null);
});
test('out-of-order fragments and incomplete snapshots cannot remove the current notification list', () => {
  const b = boundary();
  b.configure(b.feature('ui.notifications'));
  for (const part of fragments()) b.event('ui.notifications', { event: 'notification-snapshot-fragment', ...part });
  assert.equal(b.host.hostState.notifications.length, 1);
  b.event('ui.notifications', { event: 'notification-snapshot-fragment', ...fragments(2, 'next')[0] });
  assert.equal(b.host.hostState.notifications[0].postTime, 7);
  b.configure(b.feature('ui.notifications', 2));
  b.event('ui.notifications', { event: 'notification-snapshot-fragment', ...fragments(2, 'next')[1] }, 1);
  assert.equal(b.host.hostState.notifications.length, 1);
});
test('only the selected notification feature receives private snapshots and losing the grant purges them', () => {
  const b = boundary();
  b.configure(b.feature('ui.launcher'), b.feature('ui.notifications'));
  for (const part of fragments()) b.event('ui.launcher', { event: 'notification-snapshot-fragment', ...part });
  assert.equal(b.host.hostState.notifications.length, 0);
  for (const part of fragments()) b.event('ui.notifications', { event: 'notification-snapshot-fragment', ...part });
  assert.equal(b.host.hostState.notifications.length, 1);
  b.configure(b.feature('ui.notifications', 2, 'other.app/Service'));
  assert.equal(b.host.hostState.notifications.length, 0);
});
test('host tool actions require current ownership and resolve only a matching response', async () => {
  const b = boundary();
  await assert.rejects(b.host.requestHostAction('device-tools', 'tool-call'), /UNAVAILABLE/);
  assert.equal(b.actions.length, 0);
  b.configure(b.feature('device-tools'));
  const pending = b.host.requestHostAction('device-tools', 'tool-call', { callId: 'call1' });
  let finished = false;
  pending.then(() => (finished = true));
  b.event('device-tools', { event: 'action-result', callId: 'wrong', ok: true });
  b.event('device-tools', { event: 'action-result', callId: 'call1', ok: true }, 2);
  await Promise.resolve();
  assert.equal(finished, false);
  b.event('device-tools', { event: 'tool-result', callId: 'call1', result: { ok: true, content: 'Done' } });
  assert.equal((await pending).content, 'Done');
  assert.equal(b.actions.length, 1);
});
test('disconnect and timeout reject in-flight actions without replaying on reconnection', async () => {
  const b = boundary();
  b.configure(b.feature('device-tools'));
  const failed = b.host.requestHostAction('device-tools', 'tool-call', { callId: 'lost' });
  b.host.receiveHostEvent(b.service, 'disconnected', {});
  await assert.rejects(failed, /CONNECTION_LOST/);
  b.configure(b.feature('device-tools', 2));
  assert.equal(b.actions.length, 1);
  const unknown = b.host.requestHostAction('device-tools', 'tool-call', { callId: 'timeout' });
  [...b.timers.values()][0]();
  await assert.rejects(unknown, /OUTCOME_UNKNOWN/);
  b.event('device-tools', { event: 'tool-result', callId: 'timeout', result: { ok: true } }, 2);
  assert.equal(b.actions.length, 2);
});
test('own transcription requests bind to an active capture and cannot respond after cancellation', () => {
  const b = boundary(),
    delivered = [];
  b.host.onHostEvent((type, data) => {
    if (type === 'extension-event') delivered.push(data);
  });
  b.configure(b.feature('transcription', 1, 'other.app/Service'));
  b.host.setOwnCaptureId('capture1');
  b.event('transcription', { requestId: 'request1', ownCapture: true, captureId: 'wrong' }, 1, 'request');
  assert.equal(delivered.length, 0);
  b.event('transcription', { requestId: 'request1', ownCapture: true, captureId: 'capture1' }, 1, 'request');
  assert.equal(delivered.length, 1);
  assert.equal(b.host.respondHostRequest('transcription', 1, 'request1', { text: 'draft' }), true);
  assert.equal(b.host.respondHostRequest('transcription', 1, 'request1', { text: 'duplicate' }), false);
  b.event('transcription', { requestId: 'request2', ownCapture: true, captureId: 'capture1' }, 1, 'request');
  b.host.setOwnCaptureId('');
  assert.equal(b.host.respondHostRequest('transcription', 1, 'request2', { text: 'late' }), false);
});
test('proactive device tools keep six-call sliding-window limit while active turns remain exempt', () => {
  const { ToolRateLimit } = load('app/t3/tool-rate-limit.ts');
  const gate = new ToolRateLimit();
  for (let i = 0; i < 6; i++) assert.equal(gate.admit(false, 1000 + i), true);
  assert.equal(gate.admit(false, 2000), false);
  assert.equal(gate.admit(true, 2000), true);
  assert.equal(gate.admit(false, 61000), false);
  assert.equal(gate.admit(false, 61001), true);
});
test('notification cancellation waits for host result instead of treating local IPC acceptance as success', async () => {
  let resolve;
  const api = load('app/native/notification-icons.ts', {
    '../extensions/host': {
      hostState: { notifications: [notification()] },
      ownsFeature: () => true,
      requestHostAction: () => new Promise((done) => (resolve = done)),
      onHostState: () => () => {},
      sendHostAction: () => true,
    },
  });
  let complete = false;
  const pending = api.dismissNotification('apk:opaque-id', 7).then((value) => {
    complete = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(complete, false);
  resolve({ ok: true });
  assert.equal(await pending, true);
});
test('a notification open names the host preview it closes only when there is one', async () => {
  const calls = [];
  const api = load('app/native/notification-icons.ts', {
    '../extensions/host': {
      hostState: { notifications: [notification()] },
      ownsFeature: () => true,
      requestHostAction: async (...args) => {
        calls.push(args);
        return { ok: true };
      },
      onHostState: () => () => {},
      sendHostAction: () => true,
    },
  });
  assert.equal(await api.openNotification('apk:opaque-id', 7, 'host-lease'), true);
  assert.equal(await api.openNotification('apk:opaque-id', 7), true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['ui.notifications', 'notification-open', { id: 'apk:opaque-id', version: 7, presentationId: 'host-lease' }],
    ['ui.notifications', 'notification-open', { id: 'apk:opaque-id', version: 7 }],
  ]);
});
test('review cancellation targets its bound request without reusing its transport id or exposing reply text', async () => {
  const calls = [],
    timers = [],
    observers = [];
  let resolve,
    current = true;
  const api = load(
    'app/native/notification-icons.ts',
    {
      '../extensions/host': {
        hostState: { notifications: [notification()] },
        ownsFeature: () => true,
        requestHostAction: (...args) => {
          calls.push(args);
          return new Promise((done) => (resolve = done));
        },
        sendHostAction: (...args) => {
          calls.push(args);
          return true;
        },
        onHostState: (listener) => {
          observers.push(listener);
          return () => {};
        },
      },
    },
    {
      setInterval: (callback) => {
        timers.push(callback);
        return 1;
      },
      clearInterval() {},
    },
  );
  const pending = api.requestNotificationReply('apk:opaque-id', 7, 0, () => current);
  assert.equal(calls[0][1], 'notification-review-reply');
  assert.deepEqual(Object.keys(calls[0][2]).sort(), ['actionIndex', 'callId', 'id', 'version']);
  current = false;
  observers[0]();
  timers[0]();
  assert.equal(calls.length, 2);
  assert.equal(calls[1][1], 'notification-cancel-review');
  assert.equal(JSON.stringify(calls[1][2]), JSON.stringify({ reviewCallId: calls[0][2].callId }));
  resolve({ ok: true, status: 'rejected' });
  assert.equal((await pending).status, 'rejected');
});
test('review timeout and explicit invalidation cancel once and reject stale initiation', async () => {
  const calls = [];
  let reject;
  const api = load(
    'app/native/notification-icons.ts',
    {
      '../extensions/host': {
        hostState: { notifications: [notification()] },
        ownsFeature: () => true,
        requestHostAction: () => new Promise((_, no) => (reject = no)),
        sendHostAction: (...args) => {
          calls.push(args);
          return true;
        },
        onHostState: () => () => {},
      },
    },
    { setInterval: () => 1, clearInterval() {} },
  );
  await assert.rejects(
    api.requestNotificationReply('apk:opaque-id', 7, 0, () => false),
    /STALE/,
  );
  const pending = api.requestNotificationReply('apk:opaque-id', 7, 0);
  api.invalidateNotificationReplies();
  api.invalidateNotificationReplies();
  reject(new Error('HOST_ACTION_OUTCOME_UNKNOWN'));
  await assert.rejects(pending, /OUTCOME_UNKNOWN/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1], 'notification-cancel-review');
});
test('host refinement rejects unsolicited responses, cancels once, and never retries on disconnect', () => {
  let callback;
  const requests = [],
    cancelled = [],
    results = [],
    errors = [];
  const api = load(
    'app/native/anthropic.ts',
    {
      '../extensions/host': {
        nativeService: () => ({
          requestHostRefinement: (...args) => {
            requests.push(args);
            return true;
          },
          cancelHostRefinement: (id) => cancelled.push(id),
        }),
        onHostEvent: (fn) => {
          callback = fn;
          return () => {};
        },
      },
    },
    { setTimeout: () => 1, clearTimeout() {} },
  );
  const options = {
    original: 'Draft',
    followup: 'Make it shorter',
    onDone: (text) => results.push(text),
    onError: (error) => errors.push(error),
  };
  const handle = api.refineDictation(options);
  callback('host-refinement-result', { requestId: 'another', text: 'Wrong' });
  assert.equal(results.length, 0);
  handle.cancel();
  handle.cancel();
  callback('host-refinement-result', { requestId: requests[0][0], text: 'Late' });
  assert.equal(results.length, 0);
  assert.equal(cancelled.length, 1);
  api.refineDictation(options);
  callback('disconnected', {});
  assert.equal(errors[0], 'HOST_CONNECTION_LOST');
  assert.equal(requests.length, 2);
});
test('host configuration requires bounded HTTPS pairing and serializes requests', async () => {
  let callback, finish;
  const requests = [],
    errors = [];
  load(
    'app/extensions/configuration.ts',
    {
      './host': { onHostEvent: (fn) => (callback = fn) },
      '../t3/pairing': {
        pairT3: (...args) => {
          requests.push(args);
          return new Promise((done) => (finish = done));
        },
      },
      '../apps/t3/runtime': { connectT3: async () => {}, t3Workspace: { fail: (error) => errors.push(error) } },
    },
    { URL },
  ).initializeHostConfiguration();
  callback('configure', { endpoint: 'http://unsafe.example', code: 'a'.repeat(16) });
  callback('configure', { endpoint: 'https://bridge.example', code: 'short' });
  assert.equal(requests.length, 0);
  callback('configure', { endpoint: 'https://bridge.example', code: 'a'.repeat(16) });
  callback('configure', { endpoint: 'https://bridge.example', code: 'b'.repeat(16) });
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0], 'wss://bridge.example/');
  finish();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(errors.length, 0);
});
test('own inbox receives only visible current-generation content and loses cached data when hidden', async () => {
  const b = boundary();
  let requested = 0;
  b.service.requestOwnNotifications = () => {
    requested++;
    return true;
  };
  b.service.invokeOwnNotification = (action, key, postTime, callId) => {
    b.actions.push({ action, key, postTime, callId });
    return true;
  };
  b.host.receiveHostEvent(b.service, 'extensions', { generation: 4, features: [] });
  for (const part of fragments())
    b.host.receiveHostEvent(b.service, 'own-notification-snapshot-fragment', { ...part, generation: 4 });
  assert.equal(b.host.hostState.notifications.length, 0);
  b.host.receiveHostEvent(b.service, 'visibility', { visible: true, screenOn: true });
  assert.equal(requested, 1);
  for (const part of fragments())
    b.host.receiveHostEvent(b.service, 'own-notification-snapshot-fragment', { ...part, generation: 3 });
  assert.equal(b.host.hostState.notifications.length, 0);
  for (const part of fragments())
    b.host.receiveHostEvent(b.service, 'own-notification-snapshot-fragment', { ...part, generation: 4 });
  assert.equal(b.host.hostState.notifications.length, 1);
  const action = b.host.requestOwnNotificationAction('open', 'apk:opaque-id', 7);
  b.host.receiveHostEvent(b.service, 'visibility', { visible: false, screenOn: true });
  await assert.rejects(action, /UNAVAILABLE/);
  assert.equal(b.host.hostState.notifications.length, 0);
  for (const part of fragments(2, 'late'))
    b.host.receiveHostEvent(b.service, 'own-notification-snapshot-fragment', { ...part, generation: 4 });
  assert.equal(b.host.hostState.notifications.length, 0);
});
test('own inbox group dismissal uses one separately scoped action and never claims success before acknowledgement', async () => {
  let resolve;
  const calls = [];
  const api = load('app/native/notification-icons.ts', {
    '../extensions/host': {
      hostState: { notifications: [notification()] },
      ownsFeature: () => false,
      requestOwnNotificationAction: (...args) => {
        calls.push(args);
        return new Promise((done) => (resolve = done));
      },
      onHostState: () => () => {},
      requestHostAction: () => {
        throw new Error('Wrong authority');
      },
    },
  });
  let finished = false;
  const pending = api
    .dismissNotifications([
      { key: 'one', postTime: 1 },
      { key: 'two', postTime: 2 },
    ])
    .then((value) => {
      finished = true;
      return value;
    });
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'dismiss-group');
  assert.equal(calls[0][3].length, 2);
  resolve({ ok: true });
  assert.equal(await pending, true);
});
test('launcher folder tools mutate APK folders only for known apps and reject malformed arguments', () => {
  const assignments = {},
    hostState = { apps: [{ appId: 'known', title: 'Known app' }] };
  const api = load('app/extensions/launcher-tools.ts', {
    './host': { hostState, onHostEvent() {}, respondHostRequest() {} },
    '../apps/launcher/launcher-folders': {
      getFolderAssignments: () => ({ ...assignments }),
      getFolders: () =>
        new Map(
          Object.values(assignments).map((name) => [
            name,
            Object.keys(assignments).filter((id) => assignments[id] === name),
          ]),
        ),
      setAppFolder: (id, folder) => {
        if (folder) assignments[id] = folder;
        else delete assignments[id];
      },
      disbandFolder: (name) => {
        let moved = 0;
        for (const id of Object.keys(assignments))
          if (assignments[id] === name) {
            delete assignments[id];
            moved++;
          }
        return moved;
      },
      resolveFolderName: (name) => name.trim(),
      FOLDER_NAME_MAX_LENGTH: 24,
    },
  });
  assert.equal(api.runLauncherFolderTool('apps.move_to_folder', { app_id: 'foreign', folder: 'Work' }).ok, false);
  assert.equal(
    api.runLauncherFolderTool('apps.move_to_folder', { app_id: 'known', folder: 'Work', extra: true }).ok,
    false,
  );
  assert.equal(api.runLauncherFolderTool('apps.move_to_folder', { app_id: 'known', folder: '\n' }).ok, false);
  assert.equal(api.runLauncherFolderTool('apps.move_to_folder', { app_id: 'known', folder: 'Work' }).ok, true);
  assert.equal(assignments.known, 'Work');
  assert.match(api.runLauncherFolderTool('apps.list_folders', {}).content, /Work: known/);
  assert.equal(api.runLauncherFolderTool('apps.disband_folder', { folder: 'Work' }).ok, true);
  assert.equal(Object.keys(assignments).length, 0);
});
test('host watch input preserves its source and timestamp in the extracted T3 window', async () => {
  const inputs = [];
  const source = fs.readFileSync('app/runtime.ts', 'utf8'),
    imports = {};
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  imports['./ui/layers'] = { noopLayerActions: {} };
  imports['./apps/t3/t3-app'] = { createT3AppWindow: () => ({ handleInput: async (event) => inputs.push(event) }) };
  imports['./apps/t3/notifications-ui'] = { initializeT3Notifications() {} };
  const api = load('app/runtime.ts', imports);
  await api.deliverInput({ type: 'scroll-down', source: 'watch', timestampMs: 12345 });
  assert.equal(inputs[0].source, 'watch');
  assert.equal(inputs[0].timestampMs, 12345);
  await api.deliverInput('click');
  assert.equal(inputs[1].source, 'ring');
});
test('surface snapshots preserve only same-generation stack state and resize that stack', () => {
  const source = fs.readFileSync('app/runtime.ts', 'utf8'),
    imports = {};
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  imports['./ui/layers'] = { noopLayerActions: {} };
  imports['./apps/t3/notifications-ui'] = { initializeT3Notifications() {} };
  const api = load('app/runtime.ts', imports),
    calls = [];
  const stack = { setBaseSize: (size) => calls.push(['resize', size]), clearToBase: () => calls.push(['clear']) };
  const current = new Map([
    ['ui.launcher', { width: 10, height: 10, visible: true, generation: 4, stack }],
    [
      'removed',
      { width: 1, height: 1, visible: true, generation: 1, stack: { clearToBase: () => calls.push(['removed']) } },
    ],
  ]);
  let next = api.reconcileRuntimeSurfaces(current, [
    { id: 'extension:ui.launcher', width: 20, height: 30, generation: 4, visible: true, screenOn: true },
  ]);
  assert.equal(next.get('ui.launcher').stack, stack);
  assert.equal(JSON.stringify(calls), JSON.stringify([['resize', { width: 20, height: 30 }], ['removed']]));
  next = api.reconcileRuntimeSurfaces(next, [
    { id: 'extension:ui.launcher', width: 20, height: 30, generation: 5, visible: true, screenOn: true },
  ]);
  assert.equal(next.get('ui.launcher').stack, undefined);
  assert.equal(calls.at(-1)[0], 'clear');
});
test('complete T3 capability relay rejects wrong project and replay, then caps proactive dispatch at six calls', async () => {
  let deliver;
  const dispatches = [],
    results = [],
    registrations = [];
  const config = { enabled: true, allowTools: true, assistantProjectId: 'allowed' };
  const api = load('app/t3/tools.ts', {
    './tool-rate-limit': load('app/t3/tool-rate-limit.ts'),
    './assistant': { isT3AssistantTurnActive: () => false },
    './config': { getT3Config: () => config, onT3ConfigChanged: () => () => {} },
    './security': load('app/t3/security.ts'),
    './client': {
      t3Client: {
        connected: true,
        onEvent: (fn) => {
          deliver = fn;
          return () => {};
        },
        onStateChange: () => () => {},
        rpc: async (name, data) => {
          if (name === 'faceclaw.capabilities.result') results.push(data);
          if (name === 'faceclaw.capabilities.register') registrations.push(data);
          return {};
        },
      },
    },
    '../extensions/host': {
      sendHostAction: () => true,
      hostState: { tools: [] },
      onHostState: () => () => {},
      onHostEvent: () => () => {},
      ownsFeature: () => true,
      requestHostAction: async (...args) => {
        dispatches.push(args);
        return { ok: true, content: 'Done' };
      },
    },
  });
  const stop = api.startT3ToolRelay(),
    now = Date.now();
  const call = (id, projectId = 'allowed') => ({
    event: 'faceclaw.capability.call',
    payload: {
      callId: id,
      projectId,
      threadId: 'thread',
      name: 'apps.move_to_folder',
      arguments: { app_id: 'known', folder: 'Work' },
      issuedAt: now,
      expiresAt: now + 10000,
    },
  });
  assert.equal(registrations[0].protocolVersion, 1);
  assert.equal(registrations[0].catalogRevision, 1);
  deliver(call('wrong', 'wrong-project'));
  deliver(call('1'));
  deliver(call('1'));
  for (let index = 2; index <= 7; index++) deliver(call(String(index)));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(dispatches.length, 6);
  assert.equal(dispatches[0][2].projectId, 'allowed');
  assert.equal(dispatches[0][2].issuedAt, now);
  assert.equal(
    results.filter((item) => item.result.isError && item.result.content[0].text.includes('rate limit')).length,
    1,
  );
  stop();
  deliver(call('after-stop'));
  await Promise.resolve();
  assert.equal(dispatches.length, 6);
});
test('own native and SDK notification copies cannot duplicate local T3 workspace inbox rows', () => {
  const own = { ...notification(), packageName: 'com.faceclaw.t3', key: 'apk:own' },
    foreign = notification();
  const api = load('app/native/notification-icons.ts', {
    '../extensions/host': { hostState: { notifications: [own, foreign] }, onHostState: () => () => {} },
  });
  assert.equal(api.readActiveNotifications().length, 1);
  assert.equal(api.readActiveNotifications()[0].packageName, 'fixture.messages');
  const manifest = fs.readFileSync('App_Resources/Android/src/main/AndroidManifest.xml', 'utf8');
  assert.match(manifest, /com\.faceclaw\.SUPPRESS_PACKAGE" android:value="com\.faceclaw\.t3"/);
});
test('an explicitly zero-dim overlay conceals the underlying app plane', () => {
  class Image {
    constructor(width, height) {
      this.width = width;
      this.height = height;
    }
  }
  const dims = [];
  const { LayerStack } = load('app/ui/layers.ts', {
    '../graphics/image': { GrayImage: Image, G2_LENS_WIDTH: 576, G2_LENS_HEIGHT: 288 },
    '../graphics/plane': {
      dimPlanes: (planes, dim) => {
        dims.push(dim);
        return planes;
      },
    },
    '../native/frame-timings': { spanCurrent: (_name, fn) => fn() },
    './gestures': { isDirectionalInput: () => false },
  });
  const stack = new LayerStack({ paint: () => new Image(10, 10), handleInput() {} }, {}, { width: 10, height: 10 });
  stack.push({ dimUnderneath: 0, paint: (_ctx, below) => below(), handleInput() {} });
  stack.paint();
  assert.equal(stack.baseDim(), 0);
  assert.ok(dims.includes(0));
});

test('own System actions delegates to the host system menu without substituting display sleep', async () => {
  const source = fs.readFileSync('app/runtime.ts', 'utf8'),
    imports = {};
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  let systemActions,
    requested = 0,
    slept = 0;
  const pushed = [];
  class WindowMenuLayer {}
  imports['./ui/layers'] = { noopLayerActions: {} };
  imports['./apps/t3/t3-app'] = {
    createT3AppWindow: () => ({
      stack: { push: (layer) => pushed.push(layer), topMatches: (match) => pushed.length > 0 && match(pushed.at(-1)) },
      claimsNotificationDismissGesture: () => false,
      menuItems: () => [],
      requestRender() {},
    }),
  };
  imports['./apps/t3/notifications-ui'] = { initializeT3Notifications() {} };
  imports['./ui/window-menu'] = {
    WindowMenuLayer,
    appActionItems: (_items, _sleep, system) => {
      systemActions = system;
      return [];
    },
  };
  imports['./ui/shell/shell'] = { shell: { sleepAtAppRoot: () => slept++ } };
  imports['./extensions/host'] = { nativeService: () => ({ requestSystemMenu: () => requested++ }) };
  const api = load('app/runtime.ts', imports);
  await api.deliverInput('long-press');
  systemActions();
  assert.equal(requested, 1);
  assert.equal(slept, 0);
  assert.equal(pushed.length, 1);
  await api.deliverInput('long-press');
  assert.equal(pushed.length, 1, 'a repeated hold keeps the open menu instead of stacking another');
});

function runtimeHarness() {
  const source = fs.readFileSync('app/runtime.ts', 'utf8'),
    imports = {};
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  const h = { responses: [], handled: [], actions: [], overlays: 1, hostListener: null };
  imports['./ui/layers'] = { noopLayerActions: {} };
  imports['./apps/t3/t3-app'] = {
    createT3AppWindow: () => ({
      stack: { isAtBase: () => h.overlays === 0, topMatches: () => false, push() {} },
      claimsNotificationDismissGesture: () => false,
      menuItems: () => [],
      async handleInput(input) {
        h.handled.push(input.type);
        if (input.type === 'double-click' && h.overlays) h.overlays--;
      },
      requestRender() {},
    }),
  };
  imports['./apps/t3/notifications-ui'] = { initializeT3Notifications() {} };
  imports['./ui/shell/shell'] = { shell: { respondToBack: (atRoot) => h.responses.push(atRoot) }, localShellEvents: new Set() };
  imports['./extensions/host'] = {
    nativeService: () => null,
    onHostEvent: (listener) => {
      h.hostListener = listener;
    },
    onHostState: () => () => {},
    sendHostAction: (feature, action) => {
      h.actions.push(`${feature}:${action}`);
      return true;
    },
  };
  h.api = load('app/runtime.ts', imports);
  return h;
}

test('back over a stacked T3 layer is acknowledged so the host does not treat it as root back', async () => {
  const h = runtimeHarness();
  await h.api.deliverInput({ type: 'double-click', source: 'ring', timestampMs: 0 });
  assert.deepEqual(h.responses, [false], 'the menu or card consumed back; the host must not sleep the display');
  assert.deepEqual(h.handled, ['double-click']);
  await h.api.deliverInput({ type: 'double-click', source: 'ring', timestampMs: 0 });
  assert.deepEqual(h.responses, [false], 'at the base layer the T3 screen answers back itself');
  assert.deepEqual(h.handled, ['double-click', 'double-click']);
});

test('back closes the provider-drawn App actions surface whose menu cannot pop locally', () => {
  const h = runtimeHarness();
  h.api.initializeAppRuntime();
  h.hostListener('extension-event', { feature: 'ui.app-menu', type: 'input', data: { input: { type: 'double-click' } } });
  assert.deepEqual(h.actions, ['ui.app-menu:close-surface']);
  h.hostListener('extension-event', { feature: 'ui.app-menu', type: 'input', data: { input: { type: 'scroll-down' } } });
  assert.deepEqual(h.actions, ['ui.app-menu:close-surface'], 'other input stays with the menu');
});

test('reply pre-dispatch rejection differs from a send with an unknown outcome', async () => {
  const b = boundary();
  b.configure(b.feature('ui.notifications'));
  const rejected = b.host.requestHostAction('ui.notifications', 'notification-review-reply', { callId: 'reject' });
  b.event('ui.notifications', {
    event: 'action-result',
    callId: 'reject',
    ok: false,
    error: 'A fresh feature gesture is required',
  });
  await assert.rejects(rejected, (error) => error.code === 'HOST_ACTION_REJECTED');
  const unknown = b.host.requestHostAction('ui.notifications', 'notification-review-reply', { callId: 'unknown' });
  b.event('ui.notifications', { event: 'action-result', callId: 'unknown', ok: false, status: 'unknown' });
  assert.equal((await unknown).status, 'unknown');
});

test('large fragmented catalogs retain apps beyond the old 512 entry limit', () => {
  const a = new snapshots.NotificationSnapshotAssembler();
  const apps = Array.from({ length: 900 }, (_, i) => ({ packageName: `app.${i}`, name: `Application ${i}` }));
  apps.push({ packageName: 'org.thoughtcrime.securesms', name: 'Signal' });
  const json = JSON.stringify({ revision: 1, notifications: [], notificationApps: apps });
  let result;
  for (let i = 0; i < Math.ceil(json.length / 16000); i++)
    result = a.accept({
      snapshotId: 'large',
      index: i,
      total: Math.ceil(json.length / 16000),
      json: json.slice(i * 16000, (i + 1) * 16000),
    });
  assert.equal(result.length, 0);
  assert.equal(a.notificationApps.length, 901);
  assert.equal(a.notificationApps.at(-1).name, 'Signal');
});
test('notification settings refresh an active search when the host catalog arrives and unsubscribe on close', () => {
  class Observable {
    constructor() {
      this.data = {};
    }
    set(k, v) {
      this.data[k] = v;
    }
    get(k) {
      return this.data[k];
    }
  }
  let apps = [],
    listener,
    disposed = false;
  const pageModule = load('app/phone-ui/t3-notification-apps-page.ts', {
    '@nativescript/core': {
      Observable,
      ObservableArray: class extends Array {
        constructor(items) {
          super(...items);
        }
      },
    },
    '../native/notification-apps': { readNotificationApps: () => apps },
    '../extensions/host': {
      onHostState: (fn) => {
        listener = fn;
        return () => {
          disposed = true;
        };
      },
    },
    '../t3/config': { getT3Config: () => ({ notificationOverride: true }), onT3ConfigChanged: () => () => {} },
    '../t3/notification-preferences': {
      allowsT3PhoneNotification: () => true,
      onT3NotificationAppsChanged: () => () => {},
    },
  });
  const page = {};
  pageModule.navigatingTo({ object: page });
  page.bindingContext.search({ object: { text: 'signal' } });
  assert.equal(page.bindingContext.get('apps').length, 0);
  apps = [
    { packageName: 'org.thoughtcrime.securesms', name: 'Signal' },
    { packageName: 'other', name: 'Other' },
  ];
  listener();
  assert.equal(page.bindingContext.get('apps').length, 1);
  assert.equal(page.bindingContext.get('apps')[0].get('name'), 'Signal');
  pageModule.unloaded({ object: page });
  assert.equal(disposed, true);
});

test('notification long press reaches dismissal without opening a second menu', async () => {
  const source = fs.readFileSync('app/runtime.ts', 'utf8'),
    imports = {};
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  let systemActions,
    requested = 0,
    slept = 0,
    dismissed = 0;
  const pushed = [];
  imports['./ui/layers'] = { noopLayerActions: {} };
  imports['./apps/t3/t3-app'] = {
    createT3AppWindow: () => ({
      stack: { push: (layer) => pushed.push(layer) },
      claimsNotificationDismissGesture: () => true,
      handleInput: async (event) => {
        assert.equal(event.type, 'long-press');
        dismissed++;
      },
      menuItems: () => [],
      requestRender() {},
    }),
  };
  imports['./apps/t3/notifications-ui'] = { initializeT3Notifications() {} };
  imports['./ui/window-menu'] = {
    WindowMenuLayer: class {},
    appActionItems: (_items, _sleep, system) => {
      systemActions = system;
      return [];
    },
  };
  imports['./ui/shell/shell'] = { shell: { sleepAtAppRoot: () => slept++ } };
  imports['./extensions/host'] = { nativeService: () => ({ requestSystemMenu: () => requested++ }) };
  const api = load('app/runtime.ts', imports);
  await api.deliverInput('long-press');
  assert.equal(requested, 0);
  assert.equal(slept, 0);
  assert.equal(pushed.length, 0);
  assert.equal(dismissed, 1);
});

test('an unrelated snapshot update preserves a partially received winning notification snapshot', () => {
  const b = boundary();
  b.configure(b.feature('ui.notifications', 7));
  const parts = fragments();
  b.event('ui.notifications', { event: 'notification-snapshot-fragment', ...parts[0] }, 7);
  b.configure(b.feature('ui.notifications', 7), b.feature('ui.typography', 8, 'other.app/Service'));
  b.event('ui.notifications', { event: 'notification-snapshot-fragment', ...parts[1] }, 7);
  assert.equal(b.host.hostState.notifications.length, 1);
});
test('remote assistant cannot register host device tools or use a colliding local project grant', async () => {
  let deliver;
  const calls = [],
    actions = [];
  const config = { enabled: true, allowTools: true, assistantProjectId: 'same', assistantEnvironmentId: 'mac' };
  const api = load('app/t3/tools.ts', {
    './tool-rate-limit': load('app/t3/tool-rate-limit.ts'),
    './assistant': { isT3AssistantTurnActive: () => false },
    './config': { getT3Config: () => config, onT3ConfigChanged: () => () => {} },
    './security': load('app/t3/security.ts'),
    './client': {
      t3Client: {
        connected: true,
        onEvent: (fn) => {
          deliver = fn;
          return () => {};
        },
        onStateChange: () => () => {},
        rpc: async (...args) => {
          calls.push(args);
          return {};
        },
      },
    },
    '../extensions/host': {
      hostState: { tools: [] },
      onHostState: () => () => {},
      onHostEvent: () => () => {},
      ownsFeature: () => true,
      sendHostAction: (...args) => actions.push(args),
      requestHostAction: async () => {
        throw Error('wrong owner');
      },
    },
  });
  const stop = api.startT3ToolRelay();
  deliver({ event: 'bridge.status', payload: { environments: [{ isPrimary: true, environmentId: 'local' }] } });
  deliver({
    event: 'faceclaw.capability.call',
    payload: {
      callId: 'c',
      projectId: 'same',
      threadId: 't',
      name: 'apps.list',
      arguments: {},
      issuedAt: Date.now(),
      expiresAt: Date.now() + 10000,
    },
  });
  await Promise.resolve();
  assert.equal(calls.length, 0);
  assert.equal(actions.length, 0);
  config.assistantEnvironmentId = 'local';
  deliver({ event: 'bridge.status', payload: { environments: [{ isPrimary: true, environmentId: 'local' }] } });
  assert.equal(calls[0][0], 'faceclaw.capabilities.register');
  stop();
});
