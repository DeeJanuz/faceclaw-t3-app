const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function setup({rejectHandoff=false,requestOpenWindow=false}={}){
 const exports={};let event,actions=[],openRequests=0;
 const imports={
  '../../native/notification-icons':{openNotification:()=>{}},
  '../../apps/t3/runtime':{t3Workspace:{demo:false}},
  '../../extensions/host':{hostState:{screenOn:true},nativeService:()=>requestOpenWindow?{requestOpenWindow:()=>{openRequests++;return true;}}:null,onHostEvent:fn=>{event=fn;},requestHostAction:(...args)=>{actions.push(args);return rejectHandoff?Promise.reject(new Error('stale')):Promise.resolve({ok:true});},sendHostAction:(...args)=>{actions.push(args);return true;},ownsFeature:()=>true}
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
 assert.equal(h.shell.getNotificationPreviewId(),null);
 assert.equal(events.at(-1)?.[0],'preview-handoff');
 assert.equal(JSON.stringify(h.actions.at(-1)),JSON.stringify(['ui.notifications','close-surface',{presentationId:'host-lease',restoreSleep:false}]));
});

test('rejected preview handoff retains the card for timeout recovery',async()=>{
 const h=setup({rejectHandoff:true});h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true,false,'host-lease');
 assert.equal(await h.shell.handoffNotificationPreview('fixture','host-lease'),false);
 assert.equal(h.shell.getNotificationPreviewId(),'fixture');
});

test('a local T3 preview can leave the medium surface without inventing a host lease',async()=>{
 const h=setup();let preview;
 h.localShellEvents?.add?.((type,data)=>{if(type==='preview')preview=data;});
 h.event('extension-surface',{feature:'ui.notifications',type:'open'});
 h.shell.showNotificationPreview('fixture','','',async()=>true,()=>true);
 assert.equal(await h.shell.handoffNotificationPreview('fixture',preview.presentationId),true);
 assert.equal(h.shell.getNotificationPreviewId(),null);
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
