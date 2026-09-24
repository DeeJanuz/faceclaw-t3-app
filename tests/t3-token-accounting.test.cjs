const test = require('node:test');
const assert = require('node:assert/strict');

const vm = require('node:vm');

const { transpile } = require('./helpers/transpile.cjs');
const moduleValue = { exports: {} };
const code = transpile('app/apps/t3/token-accounting.ts');
vm.runInNewContext(code, { module: moduleValue, exports: moduleValue.exports, require });
const { parseTokenAccountingState, reconcileTokenTotal } = moduleValue.exports;
const reading = (latest, at, lifetime = latest) => ({
  contextTokens: 10,
  contextWindowTokens: 100,
  totalTokens: lifetime,
  latestTotalTokens: latest,
  updatedAt: at,
});

test('each observed model transition starts a fresh interval total', () => {
  let result = reconcileTokenTotal(null, 'codex/astra', reading(312000, '2026-09-15T12:00:00Z'));
  assert.equal(result.totalTokens, 312000);
  result = reconcileTokenTotal(result.state, 'codex/luna', reading(312000, '2026-09-15T12:00:00Z'));
  assert.equal(result.changedModel, true);
  assert.equal(result.totalTokens, 0);
  result = reconcileTokenTotal(result.state, 'codex/luna', reading(330000, '2026-09-15T12:01:00Z', 330000));
  assert.equal(result.totalTokens, 18000);
  result = reconcileTokenTotal(result.state, 'codex/astra', reading(330000, '2026-09-15T12:01:00Z'));
  assert.equal(result.totalTokens, 0);
  result = reconcileTokenTotal(result.state, 'codex/astra', reading(340000, '2026-09-15T12:02:00Z'));
  assert.equal(result.totalTokens, 10000);
});

test('same-model reasoning changes, duplicates and older readings do not reset or inflate the interval', () => {
  let result = reconcileTokenTotal(null, 'codex/astra', reading(100, '2026-09-15T12:00:00Z'));
  result = reconcileTokenTotal(result.state, 'codex/luna', reading(100, '2026-09-15T12:00:00Z'));
  result = reconcileTokenTotal(result.state, 'codex/luna', reading(120, '2026-09-15T12:01:00Z'));
  assert.equal(result.totalTokens, 20);
  const duplicate = reconcileTokenTotal(result.state, 'codex/luna', reading(120, '2026-09-15T12:01:00Z'));
  assert.equal(duplicate.totalTokens, 20);
  assert.deepEqual(duplicate.state, result.state);
  const older = reconcileTokenTotal(result.state, 'codex/luna', reading(110, '2026-09-15T11:59:00Z'));
  assert.equal(older.totalTokens, 20);
  assert.deepEqual(older.state, result.state);
});

test('missing telemetry and a provider counter reset never fabricate interval usage', () => {
  let result = reconcileTokenTotal(null, 'codex/astra', reading(100, '2026-09-15T12:00:00Z'));
  result = reconcileTokenTotal(result.state, 'codex/luna', { totalTokens: 100, updatedAt: '2026-09-15T12:00:00Z' });
  assert.equal(result.totalTokens, null);
  result = reconcileTokenTotal(result.state, 'codex/luna', reading(10, '2026-09-15T12:01:00Z', 100));
  assert.equal(result.totalTokens, 0, 'first trustworthy post-switch reading becomes the baseline');
  result = reconcileTokenTotal(result.state, 'codex/luna', reading(5, '2026-09-15T12:02:00Z', 100));
  assert.equal(result.totalTokens, null);
  result = reconcileTokenTotal(result.state, 'codex/luna', reading(15, '2026-09-15T12:03:00Z', 100));
  assert.equal(result.totalTokens, null, 'an ambiguous provider reset remains unknown');
});

test('persisted accounting state is strictly validated', () => {
  const state = {
    modelKey: 'codex/astra',
    resetInterval: true,
    baselineRaw: 100,
    lastRaw: 120,
    lastAt: '2026-09-15T12:01:00Z',
    displayedTotal: 20,
    invalid: false,
  };
  assert.deepEqual(JSON.parse(JSON.stringify(parseTokenAccountingState(state))), state);
  assert.equal(parseTokenAccountingState({ ...state, lastRaw: -1 }), null);
  assert.equal(parseTokenAccountingState({ ...state, modelKey: 'x'.repeat(601) }), null);
  assert.equal(parseTokenAccountingState({ ...state, lastAt: 'bad' }), null);
});
