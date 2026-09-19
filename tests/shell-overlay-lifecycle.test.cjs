const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function setup({rejectHandoff=false,requestOpenWindow=false}={}){
 const exports={};let event,actions=[],openRequests=0;
 const imports={
  '../../native/notification-icons':{openNotification:()=>{}},
  '../../apps/t3/runtime':{t3Workspace:{demo:false}},
  '../../extensions/host':{hostState:{screenOn:true},nativeService:()=>requestOpenWindow?{requestOpenWindow:()=>{openRequests++;return true;}}:null,onHostEvent:fn=>{event=fn;},requestHostAction:(...args)=>{actions.push(args);return rejectHandoff&&args[1]==='close-surface'?Promise.reject(rejectHandoff instanceof Error?rejectHandoff:new Error('stale')):Promise.resolve({ok:true});},sendHostAction:(...args)=>{actions.push(args);return true;},ownsFeature:()=>true}
 };
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/ui/shell/shell.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:name=>imports[name]});
 return {...exports,event,actions,get openRequests(){return openRequests;}};
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
test('a stale host close cannot clear a newer replacement preview',()=>{
 const h=setup();h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('old','','',async()=>true,()=>true,false,'host-old');
 h.shell.showNotificationPreview('new','','',async()=>true,()=>true,false,'host-new');
 h.event('extension-surface',{feature:'ui.notifications',type:'close',presentationId:'host-old'});
 assert.equal(h.shell.getNotificationPreviewId(),'new');
 h.event('extension-surface',{feature:'ui.notifications',type:'close',presentationId:'host-new'});
 assert.equal(h.shell.getNotificationPreviewId(),null);
});
test('a returned host lease binds to a local T3 completion preview',()=>{
 const h=setup();h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('completion','','',async()=>true,()=>true);
 h.shell.bindNotificationPreviewHostPresentation('host-lease');
 h.event('extension-surface',{feature:'ui.notifications',type:'close',presentationId:'wrong'});
 assert.equal(h.shell.getNotificationPreviewId(),'completion');
 h.event('extension-surface',{feature:'ui.notifications',type:'close',presentationId:'host-lease'});
 assert.equal(h.shell.getNotificationPreviewId(),null);
});

test('matching preview handoff releases the host lease without restoring sleep',async()=>{
 const h=setup();let events=[];
 h.localShellEvents?.add?.((type,data)=>events.push([type,data]));
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true,false,'host-lease');
 assert.equal(await h.shell.handoffNotificationPreview('fixture','host-lease'),true);
 assert.equal(h.shell.hasOverlay(),false);
 assert.equal(events.some(event=>event[0]==='preview-handoff'),false);
 assert.equal(JSON.stringify(h.actions.at(-1)),JSON.stringify(['ui.notifications','close-surface',{presentationId:'host-lease',restoreSleep:false},5000]));
 assert.equal(h.shell.completeNotificationHandoff('fixture','host-lease'),true);
 assert.equal(h.shell.getNotificationPreviewId(),null);
 assert.equal(events.at(-1)?.[0],'preview-handoff');
});

test('rejected preview handoff retains the card for timeout recovery',async()=>{
 const h=setup({rejectHandoff:true});h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true,false,'host-lease');
 assert.equal(await h.shell.handoffNotificationPreview('fixture','host-lease'),false);
 assert.equal(h.shell.getNotificationPreviewId(),'fixture');
});

test('a lost handoff acknowledgement requests the exact host lease again',async()=>{
 const h=setup({rejectHandoff:new Error('HOST_ACTION_OUTCOME_UNKNOWN')});let preview;
 h.localShellEvents?.add?.((type,data)=>{if(type==='preview')preview=data;});
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true,false,'host-lease');
 assert.equal(await h.shell.handoffNotificationPreview('fixture',preview.presentationId),false);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.shell.getNotificationPreviewId(),'fixture');
 assert.deepEqual(JSON.parse(JSON.stringify(h.actions.at(-1))),['ui.notifications','notification-reopen',{presentationId:'host-lease'},5000]);
});

test('a local T3 preview can leave the medium surface without inventing a host lease',async()=>{
 const h=setup();let preview;
 h.localShellEvents?.add?.((type,data)=>{if(type==='preview')preview=data;});
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true);
 assert.equal(await h.shell.handoffNotificationPreview('fixture',preview.presentationId),true);
 assert.equal(h.shell.isNotificationPreviewCurrent(preview.presentationId),true);
 assert.equal(h.shell.completeNotificationHandoff('fixture',preview.presentationId),true);
 assert.equal(h.actions.some(args=>args[0]==='ui.notifications'),false);
});

test('an acknowledged handoff closes local surface state before a later host close event',async()=>{
 const h=setup({requestOpenWindow:true});let preview;
 h.localShellEvents?.add?.((type,data)=>{if(type==='preview')preview=data;});
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true,false,'host-lease');
 assert.equal(await h.shell.handoffNotificationPreview('fixture',preview.presentationId),true);
 h.event('extension-surface',{feature:'ui.notifications',type:'close'});
 h.shell.focusWindow('t3');
 assert.equal(h.openRequests,1);
});

test('preview recovery translates the local identity to the host lease',async()=>{
 const h=setup();let preview;
 h.localShellEvents?.add?.((type,data)=>{if(type==='preview')preview=data;});
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true,false,'host-lease');
 assert.equal(await h.shell.handoffNotificationPreview('fixture',preview.presentationId),true);
 assert.equal(await h.shell.reopenNotificationPreview(preview.presentationId),true);
 assert.equal(await h.shell.abandonNotificationVisit(preview.presentationId),true);
 const recovery=h.actions.filter(args=>args[1]==='notification-reopen'||args[1]==='notification-abandon');
 assert.deepEqual(JSON.parse(JSON.stringify(recovery)),[
  ['ui.notifications','notification-reopen',{presentationId:'host-lease'},5000],
  ['ui.notifications','notification-abandon',{presentationId:'host-lease'},5000],
 ]);
});

test('late host close preserves the opening card until the destination is ready', async () => {
 const h=setup();let preview;
 h.localShellEvents.add((type,data)=>{if(type==='preview')preview=data;});
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true,false,'host-lease');
 await h.shell.handoffNotificationPreview('fixture',preview.presentationId);
 h.event('extension-surface',{feature:'ui.notifications',type:'close',presentationId:'host-lease'});
 assert.equal(h.shell.isNotificationPreviewCurrent(preview.presentationId),true);
 assert.equal(h.shell.completeNotificationHandoff('fixture',preview.presentationId),true);
});

test('notification window readiness follows the SDK result, not transport acceptance',async()=>{
 const source=fs.readFileSync('app/ui/shell/shell.ts','utf8');
 for(const state of ['applied','rejected','unknown']) {
  let resolve;const calls=[],exports={};
  const imports={
   '../../native/notification-icons':{},'../../apps/t3/runtime':{},
   '../../extensions/host':{hostState:{screenOn:true},onHostEvent(){},sdkControls:()=>({supports:()=>true,request:(...args)=>{calls.push(args);return new Promise(done=>{resolve=done;});}})},
  };
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{exports,require:name=>imports[name]});
  let completed=false;const pending=exports.shell.ensureWindowOpen('t3').then(value=>{completed=true;return value;});
  await Promise.resolve();assert.equal(completed,false);assert.equal(calls[0][0],'window.open');assert.equal(calls[0][1].target,'');
  resolve({state});assert.equal(await pending,state==='applied');
 }
});
