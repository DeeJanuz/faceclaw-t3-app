const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
test('frame conversion bakes draws and transfers a typed-array view in one bounded bulk call', () => {
 const module = { exports: {} }, calls = [], bitmap = {};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/runtime.ts', 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require: () => ({}), com: { faceclaw: { t3: { T3Pixels: { bitmapBuffer: (...args) => { calls.push(args); return bitmap; } } } } } });
 const backing = new Uint8Array([99, 98, 0, 127, 128, 255, 97]), image = { width: 2, height: 2, pixels: backing.subarray(2, 6), bakeDeferredDrawsInPlace() { this.pixels[1] = 126; } };
 assert.equal(module.exports.grayBitmap(image), bitmap);
 assert.deepEqual(calls[0], [backing.buffer, 2, 4, 2, 2, false]);
 assert.equal(new Uint8Array(calls[0][0])[3], 126);
 module.exports.grayBitmap(image, true); assert.equal(calls.length, 2); assert.equal(calls[1][5], true);
});
