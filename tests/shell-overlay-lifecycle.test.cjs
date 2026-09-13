const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function setup(){
 const exports={};let event;
 const imports={
  '../../native/notification-icons':{openNotification:()=>{}},
  '../../apps/t3/runtime':{t3Workspace:{demo:false}},
  '../../extensions/host':{hostState:{screenOn:true},nativeService:()=>null,onHostEvent:fn=>{event=fn;},requestHostAction:()=>{},sendHostAction:()=>false,ownsFeature:()=>true}
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/ui/shell/shell.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:name=>imports[name]});
 return {...exports,event};
}
test('a queued preview cannot block window animation without an active notification surface',()=>{
 const h=setup();h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true);
 assert.equal(h.shell.hasOverlay(),false);
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 assert.equal(h.shell.hasOverlay(),true);
 h.event('extension-surface',{feature:'ui.notifications',type:'close'});
 assert.equal(h.shell.hasOverlay(),false);assert.equal(h.shell.getNotificationPreviewId(),null);
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 assert.equal(h.shell.hasOverlay(),false,'a reopened surface must not resurrect an old preview');
});
test('disconnect drops preview state but active capture remains a real overlay until cancelled',()=>{
 const h=setup();h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true);
 h.event('disconnected',{});assert.equal(h.shell.hasOverlay(),false);
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});assert.equal(h.shell.hasOverlay(),false);
 h.shell.startT3Dictation(()=>{},()=>{},()=>true);
 assert.equal(h.shell.hasOverlay(),true);
 h.event('disconnected',{});assert.equal(h.shell.hasOverlay(),false);
});
