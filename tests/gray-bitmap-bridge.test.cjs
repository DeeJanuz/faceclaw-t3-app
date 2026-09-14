const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
test('display submission is Gray8 while the optional phone preview has the only Bitmap conversion', () => {
 const source=fs.readFileSync('app/runtime.ts','utf8');
 assert.match(source,/submitGrayBuffer\(pixels\.buffer,pixels\.byteOffset,pixels\.byteLength,image\.width,image\.height,feature,requestNextFrame,traceId\)/);
 assert.doesNotMatch(source,/submitBitmap|submitExtensionBitmap|T3Pixels/);
 const module = { exports: {} }, calls = [], bitmap = {};
 vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText,
  { module, exports: module.exports, require: () => ({}), com: { faceclaw: { t3: { T3PreviewPixels: { bitmapBuffer: (...args) => { calls.push(args); return bitmap; } } } } } });
 const backing = new Uint8Array([99, 98, 0, 127, 128, 255, 97]), image = { width: 2, height: 2, pixels: backing.subarray(2, 6), bakeDeferredDrawsInPlace() { this.pixels[1] = 126; } };
 assert.equal(module.exports.previewBitmap(image), bitmap);
 assert.deepEqual(calls[0], [backing.buffer, 2, 4, 2, 2]);
 assert.equal(new Uint8Array(calls[0][0])[3], 126);
});
