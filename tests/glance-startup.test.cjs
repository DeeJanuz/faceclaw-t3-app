const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { transpile } = require('./helpers/transpile.cjs');
test('attention publisher initializes before a service can replay its connection', () => {
  const calls = [];
  const Application = {
    run() {
      calls.push('run');
    },
    on() {},
  };
  const imports = {
    '@nativescript/core': { Application },
    './extensions/host': { receiveHostEvent() {} },
    './extensions/settings': { initializeExtensionSettings() {} },
    './extensions/providers': { initializeProviders() {} },
    './extensions/launcher-tools': { initializeLauncherTools() {} },
    './extensions/configuration': { initializeHostConfiguration() {} },
    './runtime': { initializeAppRuntime() {} },
    './phone-ui/settings-entry': { initializeSettingsEntry() {} },
    './apps/t3/runtime': {
      initializeT3() {
        calls.push('attention');
      },
      connectT3() {},
    },
    './t3/config': { getT3Config: () => ({ enabled: false }) },
  };
  const context = {
    exports: {},
    console,
    require: (name) => {
      assert.ok(name in imports, name);
      return imports[name];
    },
    com: {
      faceclaw: {
        t3: {
          T3RuntimeListener: function (listener) {
            return listener;
          },
          T3AppService: {
            attachRuntimeListener(listener) {
              assert.equal(typeof listener.onEvent, 'function');
              calls.push('attach');
            },
          },
        },
      },
    },
  };
  vm.runInNewContext(transpile('app/app.ts'), context);
  assert.deepEqual(calls, ['attention', 'attach', 'run']);
});
