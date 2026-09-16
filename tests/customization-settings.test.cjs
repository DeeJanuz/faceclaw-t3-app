const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
test('T3 owns the gesture declaration and publishes it only while its settings flag is enabled', () => {
 const values = new Map(), module = { exports: {} }; let timingSupported = false;
 const imports = {
  '../native/settings-store': { getBooleanSetting: (key, fallback) => values.get(key) ?? fallback, setBooleanSetting: (key, value) => values.set(key, value) },
  '../t3/config': { getT3Config: () => ({}) },
  '../t3/notification-preferences': { readT3NotificationPreviewSeconds: () => 7 },
  './host': { sdkControls: () => ({ supports: feature => timingSupported && feature === 'notifications.preview-timing' }) },
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/extensions/settings.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require: name => imports[name] });
 const api = module.exports, feature = name => api.extensionDeclarations().find(item => item.feature === name);
 assert.equal(feature('ui.navigation').enabled, false);
 api.setCustomizationsEnabled(true);
 assert.equal(feature('ui.navigation').enabled, true);
 // Back must reach the active menu/T3 screen. Only root Back requests sleep.
 assert.deepEqual({ ...feature('ui.navigation').configuration }, { doubleTap: 'back', rootBack: 'sleep', tapHold: 'switcher', hold: 'app-menu', wakeFocus: 'window' });
 assert.equal(feature('ui.window-layout').configuration.switcherHeight, 'display');
 api.setCustomizationEnabled('navigation', false);
 assert.equal(feature('ui.navigation').enabled, false);
 assert.equal(feature('ui.app-menu').enabled, true);
 api.setCustomizationsEnabled(false);
 assert.equal(feature('ui.app-menu').enabled, false);
 assert.equal(feature('ui.notifications').configuration.previewSeconds, undefined);
 timingSupported = true;
 assert.equal(feature('ui.notifications').configuration.previewSeconds, '7');
});

test('changing the preview duration republishes the negotiated notification declaration', () => {
 let previewChanged, published = [];
 const module = { exports: {} };
 const imports = {
  '../native/settings-store': { getBooleanSetting: (_key, fallback) => fallback, setBooleanSetting() {}, onSettingsStoreChanged: () => () => {} },
  '../t3/config': { getT3Config: () => ({ notificationOverride: true }), onT3ConfigChanged: () => () => {} },
  '../t3/notification-preferences': { readT3NotificationPreviewSeconds: () => 10, onT3NotificationPreviewSecondsChanged: listener => { previewChanged = listener; return () => {}; } },
  './host': { publishExtensions: declarations => published.push(declarations), onHostEvent: () => () => {}, sdkControls: () => ({ supports: feature => feature === 'notifications.preview-timing' }) },
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/extensions/settings.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require: name => imports[name] });
 module.exports.initializeExtensionSettings();
 assert.equal(typeof previewChanged, 'function');
 previewChanged();
 assert.equal(published.length, 1);
 assert.equal(published[0].find(item => item.feature === 'ui.notifications').configuration.previewSeconds, '10');
});
