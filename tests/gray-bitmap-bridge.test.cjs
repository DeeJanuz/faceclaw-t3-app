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

test('retained translation copies only overlap from the last accepted geometry', () => {
 const source=fs.readFileSync('app/runtime.ts','utf8'),module={exports:{}};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,require:()=>({}),com:{}});
 const prior={key:7,offsetX:-64,width:576,height:452};
 assert.deepEqual({...module.exports.retainedCopyForTranslation(prior,{key:7,offsetX:-128},576,452)},
  {sourceX:64,sourceY:0,width:512,height:452,destinationX:0,destinationY:0});
 assert.deepEqual({...module.exports.retainedCopyForTranslation(prior,{key:7,offsetX:0},576,452)},
  {sourceX:0,sourceY:0,width:512,height:452,destinationX:64,destinationY:0});
 assert.equal(module.exports.retainedCopyForTranslation(prior,{key:8,offsetX:-128},576,452),null);
 assert.equal(module.exports.retainedCopyForTranslation(prior,{key:7,offsetX:-128},640,452),null);
});

test('slides warm the off-screen destination and retry a rejected prefetch without dropping raster',()=>{
 const source=fs.readFileSync('app/runtime.ts','utf8')+'\nexport const testSubmitGray=submitGray;';
 const module={exports:{}},encoded=[],warm=[],submitted=[];let allow=false;
 const visible=[{name:'source'}],complete=[...visible,{name:'destination'}];
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,require:name=>name==='./graphics/sdk-draw-batch'?{
   encodeSdkDrawBatch:(_service,_image,draws)=>{encoded.push(draws);return new Uint8Array(draws.length*9);}
  }:{},com:{}});
 const service={prefetchGrayResources:(_buffer,_offset,length)=>{warm.push(length);return allow;},
  submitGrayBufferWithDraws:(...args)=>{submitted.push(args);return true;}};
 const image={width:2,height:2,pixels:new Uint8Array(4),draws:visible,bakeDeferredDrawsInPlace(){}};
 const hint={key:1,offsetX:0,prefetchDraws:complete};
 assert.equal(module.exports.testSubmitGray(service,image,'',true,visible,hint),true);
 assert.equal(encoded[1],complete);assert.deepEqual(warm,[18]);
 allow=true;module.exports.testSubmitGray(service,image,'',true,visible,hint);
 module.exports.testSubmitGray(service,image,'',false,visible,hint);
 assert.deepEqual(warm,[18,18]);assert.equal(submitted.length,3);
});

test('returning to an unchanged dashboard restores its scene after raster animation',()=>{
 const source=fs.readFileSync('app/runtime.ts','utf8')+'\nexport const testSubmitGray=submitGray; export const testSubmitRetained=submitRetained;';
 const module={exports:{}},calls=[];let acceptScene=true;
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText,
  {module,exports:module.exports,require:name=>name==='./graphics/sdk-draw-batch'?{
   encodeSdkDrawBatch:()=>null,
   encodeSdkRetainedScene:()=>({patch:new Uint8Array(4),patchX:0,patchY:0,patchWidth:2,patchHeight:2,draws:null})
  }:{},com:{}});
 const api=module.exports;
 const service={isRetainedSceneCurrent:()=>true,
  submitUnchangedRetainedScene:()=>{calls.push('unchanged');return true;},
  submitRetainedScene:()=>{calls.push('restore');return acceptScene;},
  submitGrayBuffer:()=>{calls.push('raster');return true;}};
 const image={width:2,height:2,pixels:new Uint8Array(4),draws:[],fingerprint:()=> 'same-homepage',bakeDeferredDrawsInPlace(){}};
 assert.equal(api.testSubmitRetained(service,image),true);
 assert.equal(api.testSubmitGray(service,image,'',true),true);
 // Other surfaces retain their independent scene state.
 api.testSubmitRetained(service,image,'ui.notifications');
 acceptScene=false;assert.equal(api.testSubmitRetained(service,image),false);
 acceptScene=true;assert.equal(api.testSubmitRetained(service,image),true);
 api.testSubmitRetained(service,image);
 assert.deepEqual(calls,['unchanged','raster','unchanged','restore','restore','unchanged']);
});
