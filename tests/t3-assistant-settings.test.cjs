const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
test('phone assistant picker lists both computers, persists the owner, and scopes model selection',async()=>{
 let config={assistantProjectId:'same',assistantEnvironmentId:'local',assistantProvider:'old',assistantModel:'old',assistantReasoning:'high'};
 const projects=[{id:'same',title:'Even Realities',environmentId:'local',environmentLabel:'Deej-7i'},{id:'same',title:'Even Realities',environmentId:'mac',environmentLabel:"Daenon's Pro14"}];
 const dialogs=[],calls=[];
 class Observable{set(k,v){this[k]=v}get(k){return this[k]}}
 const imports={
 '@nativescript/core':{Observable,Application:{android:{}},action:async args=>{dialogs.push(args);return args.actions[args.title==='Assistant project'?1:0]}},
 '../extensions/settings':{customizationGroups:[],customizationsEnabled:()=>true},
 '../extensions/host':{onHostEvent:()=>()=>{},effectiveFeature:()=>null,ownsFeature:()=>false},
 '../t3/config':{getT3Config:()=>config,saveT3Config:update=>{config={...config,...update}}},
 '../t3/pairing':{},'../t3/notification-preferences':{
  readT3PhoneNotificationsEnabled:()=>false,
  readT3NotificationPreviewSeconds:()=>5,
  onT3NotificationPreviewSecondsChanged:()=>()=>{},
  saveT3NotificationPreviewSeconds:()=>{},
  T3_NOTIFICATION_PREVIEW_SECONDS:[3,5,7,10],
 },
 '../g2/android-permissions':{},'../native/foreground-service':{},'../g2/dashboard-controller':{},
 '../apps/t3/runtime':{t3Workspace:{projects,environments:[{environmentId:'local',isPrimary:true}]}},
 '../t3/client':{t3Client:{state:()=>({status:'connected'}),onStateChange:()=>()=>{},connect:async()=>{},rpc:async(method,params)=>{
 calls.push({method,params});if(method==='projects.list')return{projects};
 assert.equal(method,'models.list');assert.equal(params.environmentId,'mac');return{models:[{instanceId:'codex',model:'mac-model',providerName:'Codex',name:'Mac model',reasoningChoices:[{id:'low',isDefault:true}]}]};
 }}},
 };
 const module={exports:{}};vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/phone-ui/t3-settings-page.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,{module,exports:module.exports,require:name=>{assert.ok(name in imports,name);return imports[name]}});
 const page={};module.exports.loaded({object:page});await page.bindingContext.chooseProject();
 assert.deepEqual(Array.from(dialogs[0].actions),['Even Realities · Deej-7i',"Even Realities · Daenon's Pro14"]);
 assert.equal(config.assistantProjectId,'same');assert.equal(config.assistantEnvironmentId,'mac');assert.equal(config.assistantModel,'');
 assert.equal(page.bindingContext.projectLabel,"Project: Even Realities · Daenon's Pro14");
 await page.bindingContext.chooseModel();assert.equal(config.assistantModel,'mac-model');assert.equal(config.assistantEnvironmentId,'mac');
 module.exports.unloaded({object:page});
});
