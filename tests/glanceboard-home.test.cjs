const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const sdk=require('@faceclaw/motion');
function load(file,imports){const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:key=>imports[key]});return module.exports;}
const clock=load('app/apps/t3/dashboard-clock.ts',{});
const api=load('app/apps/t3/glanceboard.ts',{'@faceclaw/motion':sdk,'./dashboard-clock':clock,'../../graphics/battery':{drawBattery:()=>({width:24,height:12,pixels:new Uint8Array(288).fill(255)})}});
test('T3 owns its two-slot home layout and produces an SDK-valid scene with supplied context',()=>{
 const registry=sdk.validateWidgetRegistry(api.t3GlanceWidgets);assert.equal(registry.widgets.find(row=>row.id==='home').rows,2);
 const now=new Date('2026-09-21T12:34:20Z');
 const frame=api.t3HomeWidget({context:{battery:{headset:75,headsetCharging:false},timeFormat:'24h',weather:{phase:'ready',locationName:'Denver',current:{temperatureF:70,description:'Clear'}}}},now);
 assert.doesNotThrow(()=>sdk.validateWidgetContent(frame,registry,now.getTime()));
 assert.ok(frame.commands.some(row=>row.text==='75%'));assert.ok(frame.commands.some(row=>row.text==='70°F · Clear'));assert.equal(frame.commands.filter(row=>row.op==='bitmap').length,2);
 assert.equal(frame.expiresAt,new Date('2026-09-21T12:35:00Z').getTime());
});
test('missing ambient permissions/data produce a valid placeholder scene',()=>{
 const now=new Date();const frame=api.t3HomeWidget({context:{}},now);
 assert.doesNotThrow(()=>sdk.validateWidgetContent(frame,api.t3GlanceWidgets,now.getTime()));assert.ok(frame.commands.some(row=>row.text==='--%'));
});
