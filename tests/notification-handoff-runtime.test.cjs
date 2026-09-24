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
