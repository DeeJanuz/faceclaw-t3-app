const test = require('node:test');
const assert = require('node:assert/strict');

const vm = require('node:vm');

const { WindowMotion } = require('@faceclaw/motion');

const { transpile } = require('./helpers/transpile.cjs');
test('a motion started after idle does not inherit an expired credit timestamp', () => {
  let now = 1000;
  const exports = {};
  vm.runInNewContext(transpile('app/ui/presentation-clock.ts'), { exports, Date: { now: () => now } });
  exports.setPresentationTime(1016);
  assert.equal(exports.presentationNow(), 1016);
  now = 10000;
  const started = exports.presentationNow();
  assert.equal(started, 10000);
  const motion = new WindowMotion({ x: 0, y: 0, width: 20, height: 20 }, { x: 0, y: 0, width: 640, height: 452 });
  motion.sample(started);
  exports.setPresentationTime(10016);
  assert.equal(exports.presentationNow() - started, 16);
  assert.equal(motion.sample(exports.presentationNow()).done, false);
  now = 10080;
  assert.equal(exports.presentationNow() - started, 80);
  exports.setPresentationTime(undefined);
  assert.equal(exports.presentationNow(), now);
});

test('late credits and backward wall-clock adjustments cannot reverse animation', () => {
  let now = 2000;
  const exports = {};
  vm.runInNewContext(transpile('app/ui/presentation-clock.ts'), { exports, Date: { now: () => now } });
  exports.setPresentationTime(2033);
  assert.equal(exports.presentationNow(), 2033);
  now = 1900;
  exports.setPresentationTime(2016);
  assert.equal(exports.presentationNow(), 2033);
  exports.setPresentationTime(undefined);
  assert.equal(exports.presentationNow(), 2033);
  now = 2100;
  assert.equal(exports.presentationNow(), 2100);
});
