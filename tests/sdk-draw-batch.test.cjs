const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');

function load(){const module={exports:{}};const code=ts.transpileModule(fs.readFileSync('app/graphics/sdk-draw-batch.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;vm.runInNewContext(code,{module,exports:module.exports,require:name=>{assert.equal(name,'./image');return {grayToNibble:value=>value<=0?0:Math.min(15,(value+8)>>4)};},Uint8Array,DataView,Map,WeakMap});return module.exports;}

test('SDK draw metadata registers stable firmware glyph identity once and preserves baked placement',()=>{
 const {encodeSdkDrawBatch}=load();const calls=[];const service={getResourceEpoch:()=>1,registerGrayGlyphResource:(key,fontKey,encoding,buffer,offset,length,width,height)=>{calls.push({key,fontKey,encoding,pixels:[...new Uint8Array(buffer,offset,length)],width,height,glyph:true});return 41;}};
 const font={fingerprintId:1,atlasKey:'sample',ascent:9,lineHeight:12};const glyph={encoding:65,dwidthX:5,bbxWidth:2,bbxHeight:2,bbxX:1,bbxY:-1,bitmapRows:[0xc0,0x80]};const draw={kind:'glyph',font,glyph,x:10,y:20,value:190};const image={draws:[draw]};
 const first=encodeSdkDrawBatch(service,image),second=encodeSdkDrawBatch(service,image);assert.equal(calls.length,1);assert.deepEqual(calls[0].pixels,[190,190,190,0]);assert.equal(calls[0].glyph,true);assert.equal(calls[0].fontKey,'sample');assert.equal(calls[0].encoding,65);
 const view=new DataView(first.buffer,first.byteOffset,first.byteLength);assert.equal(view.getUint32(0,true),41);assert.equal(view.getInt16(4,true),11);assert.equal(view.getInt16(6,true),28);assert.equal(view.getUint8(8),255);assert.deepEqual([...second],[...first]);
});

test('retained scene crops direct raster pixels and rejects unsupported firmware text',()=>{
 const {encodeSdkRetainedScene}=load();const service={getResourceEpoch:()=>2,registerGrayResource:()=>7};const pixels=new Uint8Array(20);pixels[7]=40;pixels[8]=80;const source={width:5,height:4,pixels,draws:[]};
 const scene=encodeSdkRetainedScene(service,source);assert.deepEqual({x:scene.patchX,y:scene.patchY,w:scene.patchWidth,h:scene.patchHeight,p:[...scene.patch]},{x:2,y:1,w:2,h:1,p:[40,80]});
 assert.equal(encodeSdkRetainedScene(service,{...source,draws:[{kind:'fwtext'}]}),null);
});
