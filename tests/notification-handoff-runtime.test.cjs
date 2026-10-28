const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { transpileSource } = require('./helpers/transpile.cjs');
test('popup handoff retires extension rendering and admits the next arrival', async () => {
  const source = fs.readFileSync('app/runtime.ts', 'utf8'),
    imports = {};
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  const localShellEvents = new Set(),
    timers = [],
    invalidated = [];
  let event,
    stateChange,
    options,
    openPreview,
    resolveOpen,
    arrivals = 0,
    completed = 0;
  const local = (type, data) => {
    for (const fn of localShellEvents) fn(type, data);
  };
  const app = { resize() {}, requestRender() {}, stack: {} };
  imports['./apps/t3/t3-app'] = {
    createT3AppWindow: (value) => {
      options = value;
      return app;
    },
    setT3NotificationOrigin() {},
  };
  imports['./apps/t3/notifications-ui'] = {
    initializeT3Notifications() {},
    handlePhoneNotification() {
      arrivals++;
    },
  };
  imports['./extensions/host'] = {
    onHostEvent: (fn) => {
      event = fn;
    },
    onHostState: (fn) => {
      stateChange = fn;
    },
    nativeService: () => ({ hasRenderCredit: () => false, invalidateSurface: (feature) => invalidated.push(feature) }),
  };
  imports['./ui/shell/geometry'] = { setAppViewport() {} };
  imports['./ui/shell/shell'] = {
    localShellEvents,
    setNotificationWakeOrigin() {},
    shell: {
      setNotificationPreviewDuration() {},
      bindNotificationPreviewHostPresentation() {},
      completeNotificationHandoff() {
        completed++;
        local('preview-handoff', { presentationId: 'local' });
      },
    },
  };
  imports['./ui/shell/timed-notification'] = {
    TimedNotificationLayer: class {
      constructor(_title, _text, open) {
        openPreview = open;
      }
      currentRect() {
        return undefined;
      }
      isOpening() {
        return true;
      }
      onRemoved() {}
      reopenAfterOpenFailure() {
        throw Error('unexpected failure');
      }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(transpileSource(source), {
    module,
    exports: module.exports,
    require: (name) => imports[name],
    setTimeout: (fn) => timers.push(fn),
  });
  module.exports.initializeAppRuntime();
  event('visibility', { visible: true, screenOn: true });
  event('extension-surface', { feature: 'ui.notifications', type: 'open', width: 576, height: 288, generation: 1 });
  local('preview', {
    id: 'alert',
    presentationId: 'local',
    hostPresentationId: 'host',
    open: () =>
      new Promise((done) => {
        resolveOpen = done;
      }),
  });
  openPreview();
  event('extension-surface', { feature: 'ui.notifications', type: 'close', presentationId: 'host' });
  resolveOpen(true);
  await new Promise(setImmediate);
  assert.equal(completed, 1);
  // A delayed snapshot of the old surface must not steal regular window frames.
  event('host-snapshot', {
    windowOpen: true,
    windowVisible: true,
    screenOn: true,
    surfaces: [{ id: 'extension:ui.notifications', width: 576, height: 288, generation: 1, visible: true }],
  });
  stateChange();
  options.requestPaintPermission();
  assert.equal(invalidated.at(-1), '');
  event('extension-event', {
    feature: 'ui.notifications',
    type: 'event',
    data: { event: 'notification-arrived', key: 'next', presentationId: 'next' },
  });
  assert.equal(arrivals, 1, 'completed reader must not leave the arrival gate closed');
});

function notificationsHarness({ reply = false, hostOpens = true } = {}) {
  const source = fs.readFileSync('app/apps/t3/notifications-ui.ts', 'utf8'),
    imports = {},
    calls = [];
  for (const match of source.matchAll(/from\s*['"]([^'"]+)['"]/g)) imports[match[1]] = {};
  const notification = (postTime) => ({
    key: 'apk:com.faceclaw.grok:bot-scarlet',
    packageName: 'com.faceclaw.grok',
    appName: 'Grok',
    component: 'com.faceclaw.grok/.GrokService',
    target: 'thread:11111111-1111-4111-8111-111111111111',
    title: 'Scarlet',
    text: 'Morning',
    lines: [],
    postTime,
    actions: [{ index: 0, title: 'Open conversation', enabled: true, acceptsText: false }, ...(reply ? [{ index: 1, title: 'Reply', enabled: true, acceptsText: true }] : [])],
  });
  let active = [notification(100)];
  const state = { demo: false, alerts: [], fail: (error) => calls.push(['fail', error.message]), onChange() {}, onArrival() {} };
  imports['./resource'] = { resourceKey: (a) => a };
  imports['../../extensions/host'] = { ownsFeature: () => true };
  imports['../../native/external-notifications'] = {
    invokeExternalNotification: () => calls.push(['unacknowledged-open']),
    hasExternalNotification: () => true,
    invalidateExternalNotificationReplies() {},
  };
  imports['../../t3/config'] = { getT3Config: () => ({ notificationOverride: true, bridgeUrl: 'b', pairingFingerprint: 'f' }), onT3ConfigChanged() {} };
  imports['../../t3/notification-preferences'] = { allowsT3PhoneNotification: () => true, onT3NotificationAppsChanged() {}, readT3NotificationPreviewSeconds: () => 5 };
  imports['../../native/notification-icons'] = {
    readActiveNotifications: () => active,
    // The host answers asynchronously and refuses a version that is no longer current.
    openNotification: async (key, version, presentationId) => {
      calls.push(['app-open', key, version, presentationId]);
      return hostOpens && active.some((item) => item.key === key && item.postTime === version);
    },
    onAndroidNotificationRemoved() {},
    onAndroidNotificationsChanged() {},
  };
  imports['../../ui/notification-routing'] = { setNotificationOpenRoute() {} };
  imports['../../t3/notifications'] = {};
  imports['./runtime'] = { t3Workspace: state, connectT3: async () => {} };
  imports['./t3-app'] = { openT3Notification: (id) => calls.push(['reader', id]), isT3FlowProtected: () => false };
  imports['../../ui/shell/shell'] = {
    shell: {
      foregroundWindow: () => undefined,
      handoffNotificationPreview: async (id, presentationId) => {
        calls.push(['handoff', id, presentationId]);
        return true;
      },
      ensureWindowOpen: async () => true,
      isNotificationPreviewCurrent: () => true,
      closeNotificationPreview: (id, restore, presentationId) => calls.push(['close', id, restore, presentationId]),
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(transpileSource(source), { module, exports: module.exports, require: (name) => imports[name] });
  return { ui: module.exports, calls, repost: (postTime) => (active = [notification(postTime)]), notification };
}

test('an app alert the reader cannot reply to opens that app and lets the host close its preview', async () => {
  const { ui, calls } = notificationsHarness();
  const [alert] = ui.visibleT3Alerts();
  assert.equal(await ui.openT3Alert(alert, false, 'local-1', 'host-1'), true);
  // The host closes the named preview keep-awake before the alert leaves its list.
  // A second close from T3 would find no surface, and a default one would sleep the display.
  assert.deepEqual(calls, [['app-open', 'apk:com.faceclaw.grok:bot-scarlet', 100, 'host-1']]);
});

test('an app alert with an in-reader reply still opens the reader', async () => {
  const { ui, calls } = notificationsHarness({ reply: true });
  const [alert] = ui.visibleT3Alerts();
  assert.equal(await ui.openT3Alert(alert, false, 'local-1', 'host-1'), true);
  assert.equal(calls.some(([kind]) => kind === 'app-open'), false);
  assert.deepEqual(calls.at(-1), ['reader', alert.id]);
});

test('a refused app open leaves the preview in place', async () => {
  const refused = notificationsHarness({ hostOpens: false });
  assert.equal(await refused.ui.openT3Alert(refused.ui.visibleT3Alerts()[0], false, 'local-1', 'host-1'), false);
  assert.deepEqual(refused.calls.map(([kind]) => kind), ['app-open']);
});

test('an inbox tap with no preview just opens the app', async () => {
  const { ui, calls } = notificationsHarness();
  assert.equal(await ui.openT3Alert(ui.visibleT3Alerts()[0]), true);
  assert.deepEqual(calls.map(([kind]) => kind), ['app-open']);
});

test('a tap on an alert whose notification was reposted opens nothing', async () => {
  const { ui, calls, repost } = notificationsHarness();
  const [alert] = ui.visibleT3Alerts();
  repost(200);
  assert.equal(await ui.openT3Alert(alert, false, 'local-1', 'host-1'), false);
  assert.deepEqual(calls, []);
});

test('the open carries the alert version, so the host refuses a superseded one', async () => {
  const { ui, calls, repost } = notificationsHarness();
  const [stale] = ui.visibleT3Alerts();
  repost(200);
  const [fresh] = ui.visibleT3Alerts();
  // The inbox lists the newer post; an open built from the old one must not reach it.
  assert.equal(await ui.openT3Alert({ ...stale, id: fresh.id }, false, 'local-1', 'host-1'), false);
  assert.deepEqual(calls, [['app-open', stale.threadId, 100, 'host-1']]);
});
