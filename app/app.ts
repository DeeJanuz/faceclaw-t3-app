import { Application } from '@nativescript/core';
import {receiveHostEvent} from './extensions/host';
import {initializeExtensionSettings} from './extensions/settings';
import {initializeProviders} from './extensions/providers';
import {initializeLauncherTools} from './extensions/launcher-tools';
import {initializeHostConfiguration} from './extensions/configuration';
import {initializeAppRuntime} from './runtime';
import {initializeSettingsEntry} from './phone-ui/settings-entry';
import {connectT3,initializeT3} from './apps/t3/runtime';
import {getT3Config} from './t3/config';
declare const com:any;
initializeExtensionSettings();initializeProviders();initializeAppRuntime();initializeHostConfiguration();initializeLauncherTools();
initializeSettingsEntry();
initializeT3();
com.faceclaw.t3.T3AppService.attachRuntimeListener(new com.faceclaw.t3.T3RuntimeListener({onEvent(service:any,type:string,json:string){try{receiveHostEvent(service,type,JSON.parse(json));}catch(error){console.error('T3 SDK callback failed',String(type).slice(0,64),error instanceof Error?error.name:'RuntimeError');}}}));
Application.run({moduleName:'app-root'});
Application.on(Application.resumeEvent, () => {
  // Screen/network resume is only a reconnect hint. T3Client coalesces an
  // in-flight attempt and the bridge handshake still decides reachability.
  if (getT3Config().enabled) void connectT3();
});
