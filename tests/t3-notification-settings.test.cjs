const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function loadSettings(actionResult) {
  const module = { exports: {} };
  let storedSeconds = 5;
  let resolveAction;
  const actionPromise = new Promise(resolve => { resolveAction = resolve; });
  const saves = [];
  class Observable {
    constructor() { this.values = {}; }
    set(key, value) { this.values[key] = value; }
    get(key) { return this.values[key]; }
  }
  const imports = {
    '@nativescript/core': { Observable, Frame: {}, Application: { android: {} }, Utils: {}, action: () => actionResult === undefined ? actionPromise : Promise.resolve(actionResult), alert: async () => {} },
    '../extensions/settings': { customizationGroups: [], customizationsEnabled: () => true, customizationEnabled: () => true, setCustomizationsEnabled: () => {}, setCustomizationEnabled: () => {} },
    '../extensions/host': { onHostEvent: () => () => {}, effectiveFeature: () => undefined, ownsFeature: () => false },
    '../t3/config': { getT3Config: () => ({ bridgeUrl: '', notificationOverride: true, assistantProjectId: '', assistantEnvironmentId: '', assistantModel: '', assistantReasoning: '', refinementProvider: 't3' }), saveT3Config: () => {} },
    '../t3/pairing': {},
    '../t3/client': { t3Client: { state: () => ({ status: 'Disconnected' }), onStateChange: () => () => {} } },
    '../t3/notification-preferences': {
      readT3PhoneNotificationsEnabled: () => false,
      readT3NotificationPreviewSeconds: () => storedSeconds,
      saveT3NotificationPreviewSeconds: seconds => { storedSeconds = seconds; saves.push(seconds); },
      onT3NotificationPreviewSecondsChanged: () => () => {},
      T3_NOTIFICATION_PREVIEW_SECONDS: [3, 5, 7, 10],
    },
    '../g2/android-permissions': {},
    '../native/foreground-service': {},
    '../g2/dashboard-controller': {},
    '../apps/t3/runtime': { t3Workspace: { projects: [] } },
  };
  const source = fs.readFileSync('app/phone-ui/t3-settings-page.ts', 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
    { module, exports: module.exports, require: name => imports[name] });
  return { module, actionPromise, resolveAction, saves };
}

test('notification duration picker offers exact choices and persists selection', async () => {
  const { module, saves } = loadSettings('7 seconds');
  const page = {};
  module.exports.loaded({ object: page });
  assert.equal(page.bindingContext.get('notificationPreviewLabel'), 'Notification preview: 5 seconds');
  await page.bindingContext.chooseNotificationPreviewSeconds();
  assert.deepEqual(saves, [7]);
  module.exports.unloaded({ object: page });
});

test('notification duration picker cannot save after page disposal', async () => {
  const { module, actionPromise, resolveAction, saves } = loadSettings();
  const page = {};
  module.exports.loaded({ object: page });
  const pending = page.bindingContext.chooseNotificationPreviewSeconds();
  module.exports.unloaded({ object: page });
  resolveAction('10 seconds');
  await Promise.all([pending, actionPromise]);
  assert.deepEqual(saves, []);
});
