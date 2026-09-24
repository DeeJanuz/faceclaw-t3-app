const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const { transpileSource } = require('./helpers/transpile.cjs');
function loadPreferences(values = {}) {
  const listeners = new Set();
  const writes = [];
  const module = { exports: {} };
  const imports = {
    '../native/settings-store': {
      getStringSetting: (key, fallback) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback),
      setStringSetting: (key, value) => {
        values[key] = value;
        writes.push([key, value]);
        for (const listener of listeners) listener(key);
      },
      onSettingsStoreChanged: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  };
  const source = fs.readFileSync('app/t3/notification-preferences.ts', 'utf8');
  vm.runInNewContext(transpileSource(source), { module, exports: module.exports, require: (name) => imports[name] });
  return { preferences: module.exports, values, writes, listeners };
}

test('notification preview duration accepts exactly 3, 5, 7, and 10 seconds and defaults corrupt data to 5', () => {
  const { preferences, values, writes } = loadPreferences({ 't3.notification-preview-seconds': 'corrupt' });
  assert.equal(preferences.readT3NotificationPreviewSeconds(), 5);
  for (const seconds of [3, 5, 7, 10]) {
    preferences.saveT3NotificationPreviewSeconds(seconds);
    assert.equal(preferences.readT3NotificationPreviewSeconds(), seconds);
  }
  for (const invalid of [0, 4, 6, 8, 11, '5', null, undefined, {}, true]) {
    assert.throws(
      () => preferences.saveT3NotificationPreviewSeconds(invalid),
      /T3_NOTIFICATION_PREVIEW_SECONDS_INVALID/,
    );
  }
  for (const corrupt of ['', '05', '5x', '3.0', 'null', 'NaN']) {
    values['t3.notification-preview-seconds'] = corrupt;
    assert.equal(preferences.readT3NotificationPreviewSeconds(), 5);
  }
  assert.equal(writes.length, 4);
});

test('notification preview duration listener is scoped to its key and can be removed', () => {
  const { preferences, writes, listeners } = loadPreferences();
  let changed = 0;
  const off = preferences.onT3NotificationPreviewSecondsChanged(() => changed++);
  for (const seconds of [3, 7]) preferences.saveT3NotificationPreviewSeconds(seconds);
  assert.equal(changed, 2);
  assert.equal(writes.length, 2);
  off();
  preferences.saveT3NotificationPreviewSeconds(10);
  assert.equal(changed, 2);
  assert.equal(listeners.size, 0);
});
