const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const moduleValue = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('app/t3/activity-indicator-mode.ts', 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(source, { module: moduleValue, exports: moduleValue.exports });
const activity = moduleValue.exports;

test('activity indicator modes preserve current default and bound decorative cadence', () => {
  assert.equal(activity.normalizeT3ActivityIndicatorMode('corrupt'), 'fluid');
  assert.equal(activity.t3ActivityIndicatorCadenceMs('fluid'), 140);
  assert.equal(activity.t3ActivityIndicatorCadenceMs('efficient'), 500);
  assert.equal(activity.t3ActivityIndicatorCadenceMs('static'), null);
});

test('static activity mode paints a fixed phase without time-driven changes', () => {
  assert.equal(activity.t3ActivityIndicatorFrame('static', 0), 0);
  assert.equal(activity.t3ActivityIndicatorFrame('static', 60_000), 0);
  assert.equal(activity.t3ActivityIndicatorFrame('efficient', 999), 1);
  assert.equal(activity.t3ActivityIndicatorFrame('efficient', 1000), 2);
});
