const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function setup(page) {
 const module = { exports: {} }, handlers = new Map(), navigations = [];
 class Frame { currentEntry = { moduleName: page }; navigate(entry) { navigations.push(entry); this.currentEntry = entry; } }
 const frame = new Frame(), Application = { resumeEvent: 'resume', getRootView: () => frame, on: (name, callback) => handlers.set(name, callback) };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/phone-ui/settings-entry.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require: () => ({ Application, Frame }), android: { content: { Intent: { ACTION_MAIN: 'android.intent.action.MAIN' } } } });
 const intent = { action: 'com.faceclaw.action.APP_SETTINGS', getAction() { return this.action; }, setAction(value) { this.action = value; }, getExtras() { throw Error('Untrusted extras must not be read'); } };
 const activity = { getIntent: () => intent };
 module.exports.initializeSettingsEntry();
 return { api: module.exports, frame, intent, navigations, resume: () => handlers.get('resume')({ activity }) };
}
test('cold settings entry consumes navigation request without duplicating the default settings page', () => {
 const state = setup('phone-ui/t3-settings-page'); state.resume();
 assert.equal(state.navigations.length, 0); assert.equal(state.intent.action, 'android.intent.action.MAIN');
});
test('warm/newIntent settings entry exits preview once and ordinary background return preserves subsequent preview', () => {
 const state = setup('main-page'); state.resume();
 assert.deepEqual({ ...state.navigations[0] }, { moduleName: 'phone-ui/t3-settings-page', clearHistory: true, animated: false });
 state.frame.currentEntry = { moduleName: 'main-page' }; state.resume();
 assert.equal(state.navigations.length, 1);
 state.intent.action = 'com.faceclaw.action.APP_SETTINGS'; state.resume();
 assert.equal(state.navigations.length, 2);
});
test('other public actions do nothing and an unavailable Frame leaves settings request pending', () => {
 const state = setup('main-page');
 state.api.openRequestedSettings({ getIntent: () => state.intent }, undefined);
 assert.equal(state.intent.action, 'com.faceclaw.action.APP_SETTINGS');
 state.intent.action = 'arbitrary.action'; state.resume(); assert.equal(state.navigations.length, 0);
});
