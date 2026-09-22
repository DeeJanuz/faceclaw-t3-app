const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
test('attention publisher initializes before a service can replay its connection',()=>{
 const calls=[];
 const Application={run(){calls.push('run');},on(){}};
 const imports={
  '@nativescript/core':{Application},'./extensions/host':{receiveHostEvent(){}},
  './extensions/settings':{initializeExtensionSettings(){}},'./extensions/providers':{initializeProviders(){}},
  './extensions/launcher-tools':{initializeLauncherTools(){}},'./extensions/configuration':{initializeHostConfiguration(){}},
  './runtime':{initializeAppRuntime(){}},'./phone-ui/settings-entry':{initializeSettingsEntry(){}},
  './apps/t3/runtime':{initializeT3(){calls.push('attention');},connectT3(){}},'./t3/config':{getT3Config:()=>({enabled:false})}
 };
 const context={exports:{},console,require:name=>{assert.ok(name in imports,name);return imports[name];},com:{faceclaw:{t3:{T3RuntimeListener:function(listener){return listener;},T3AppService:{attachRuntimeListener(listener){assert.equal(typeof listener.onEvent,'function');calls.push('attach');}}}}}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/app.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,context);
 assert.deepEqual(calls,['attention','attach','run']);
});
