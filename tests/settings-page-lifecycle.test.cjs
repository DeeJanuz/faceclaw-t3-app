const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { transpile } = require('./helpers/transpile.cjs');
test('settings reconnects its model after Activity stop/start without navigation, clears secrets, and keeps toggles working', () => {
  const module = { exports: {} },
    hostListeners = new Set(),
    stateListeners = new Set(),
    changes = [];
  let active = false;
  class Observable {
    constructor() {
      this.values = {};
    }
    set(key, value) {
      this.values[key] = value;
    }
    get(key) {
      return this.values[key];
    }
  }
  const imports = {
    '@nativescript/core': { Observable, Application: { android: {} } },
    '../extensions/settings': {
      customizationGroups: [{ id: 'navigation', label: 'T3 gestures' }],
      customizationsEnabled: () => true,
      customizationEnabled: () => true,
      setCustomizationEnabled: (...args) => changes.push(args),
    },
    '../extensions/host': {
      onHostEvent: (listener) => {
        hostListeners.add(listener);
        return () => hostListeners.delete(listener);
      },
      effectiveFeature: () => undefined,
      ownsFeature: () => active,
    },
    '../t3/config': { getT3Config: () => ({ bridgeUrl: '' }) },
    '../t3/activity-indicator-mode': {
      normalizeT3ActivityIndicatorMode: (value) => (value === 'efficient' || value === 'static' ? value : 'fluid'),
      T3_ACTIVITY_INDICATOR_MODES: ['fluid', 'efficient', 'static'],
      t3ActivityIndicatorLabel: (value) =>
        value === 'efficient'
          ? 'Battery saver (2 updates/sec)'
          : value === 'static'
            ? 'Static'
            : 'Smooth (about 7 updates/sec)',
    },
    '../t3/client': {
      t3Client: {
        state: () => ({ status: 'Connected' }),
        onStateChange: (listener) => {
          stateListeners.add(listener);
          return () => stateListeners.delete(listener);
        },
      },
    },
    '../t3/notification-preferences': {
      readT3PhoneNotificationsEnabled: () => false,
      readT3NotificationPreviewSeconds: () => 5,
      onT3NotificationPreviewSecondsChanged: () => () => {},
      saveT3NotificationPreviewSeconds: () => {},
      T3_NOTIFICATION_PREVIEW_SECONDS: [3, 5, 7, 10],
    },
    '../apps/t3/runtime': { t3Workspace: { projects: [] } },
  };
  vm.runInNewContext(transpile('app/phone-ui/t3-settings-page.ts'), {
    module,
    exports: module.exports,
    require: (name) => imports[name] ?? {},
  });
  const page = { bindingContext: null },
    args = { object: page };
  module.exports.loaded(args);
  const before = page.bindingContext;
  assert.match(before.get('overrideStatus'), /T3 gestures: Disabled or awaiting host approval/);
  before.set('passphrase', 'synthetic-sensitive-text');
  module.exports.loaded(args);
  assert.equal(page.bindingContext, before);
  assert.equal(hostListeners.size, 1);
  assert.equal(stateListeners.size, 1);
  module.exports.unloaded(args);
  assert.equal(page.bindingContext, null);
  assert.equal(before.get('passphrase'), '');
  assert.equal(hostListeners.size, 0);
  assert.equal(stateListeners.size, 0);
  active = true; // Host grants changed while its permission Activity covered T3.
  module.exports.loaded(args);
  const resumed = page.bindingContext;
  assert.notEqual(resumed, before);
  assert.match(resumed.get('overrideStatus'), /T3 gestures: Active/);
  assert.equal(hostListeners.size, 1);
  assert.equal(stateListeners.size, 1);
  resumed.toggleNavigation({ object: { checked: false } });
  assert.deepEqual(changes, [['navigation', false]]);
  active = false;
  for (const listener of hostListeners) listener('disconnected');
  assert.match(resumed.get('overrideStatus'), /T3 gestures: Disabled or awaiting host approval/);
  module.exports.unloaded(args);
  module.exports.unloaded(args);
  assert.equal(hostListeners.size, 0);
  assert.equal(stateListeners.size, 0);
  const pageXml = fs.readFileSync('app/phone-ui/t3-settings-page.xml', 'utf8');
  assert.match(pageXml, /<Page[^>]+\sloaded="loaded"/);
  assert.doesNotMatch(pageXml, /navigatingTo=/);
});
