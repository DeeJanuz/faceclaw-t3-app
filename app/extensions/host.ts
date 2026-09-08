import {NotificationSnapshotAssembler} from './notification-snapshot';
/** Only the SDK's mutually approved, certificate-pinned host can reach this boundary. */
import type { WeatherState } from '../native/weather';
import type { AndroidNotification } from '../native/notification-types';
declare const com: any, org: any;
export type HostState = {battery:{headset:number|null;headsetCharging:boolean|null};weather?:WeatherState;windows:any[];focusedWindowId?:string;screenOn:boolean;notifications:AndroidNotification[];notificationApps?:{packageName:string;name:string}[];tools?:any[]};
export const hostState:HostState={battery:{headset:null,headsetCharging:null},windows:[],screenOn:true,notifications:[]};
export type FeatureState={feature:string;component:string;generation:number;available:boolean;configuration:Record<string,unknown>;contenders?:any[]};
let featureStates:FeatureState[]=[];
let service:any=null;
let ownCaptureId="";
let ownVisible=false,extensionGeneration=0;
const ownSnapshotAssembler=new NotificationSnapshotAssembler();
const ownPending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
function clearOwnNotifications():void{ownSnapshotAssembler.reset();if(!ownsFeature('ui.notifications')){hostState.notificationApps=[];hostState.notifications=[];}for(const item of ownPending.values()){clearTimeout(item.timer);item.reject(new Error('HOST_CAPABILITY_UNAVAILABLE'));}ownPending.clear();}
const ownRequests=new Map<string,number>();
export function setOwnCaptureId(value:string):void{ownCaptureId=value;if(!value){ownRequests.clear();for(const listener of events)listener("own-capture-closed",{});}}
function ownRequestKey(feature:string,id:string):string{return `${feature}:${id}`;}
let sequence=0;
const snapshotAssembler=new NotificationSnapshotAssembler();
const events=new Set<(type:string,data:any)=>void>();
const stateListeners=new Set<()=>void>();
const pending=new Map<string,{feature:string;generation:number;resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>();
export function onHostEvent(listener:(type:string,data:any)=>void):()=>void {events.add(listener);return ()=>events.delete(listener);}
export function onHostState(listener:()=>void):()=>void {stateListeners.add(listener);return ()=>stateListeners.delete(listener);}
export function nativeService():any{return service;}
export function effectiveFeature(feature:string):FeatureState|undefined{return featureStates.find(item=>item.feature===feature);}
export function ownsFeature(feature:string):boolean {const state=effectiveFeature(feature);return Boolean(service && state?.available && state.component.startsWith('com.faceclaw.t3/'));}
function clearPending():void {for(const item of pending.values()){clearTimeout(item.timer);item.reject(new Error('HOST_CONNECTION_LOST'));}pending.clear();}
export function receiveHostEvent(source:any,type:string,data:any):void {
 service=source;
 if(type==='visibility'){ownVisible=Boolean(data.visible&&data.screenOn!==false);if(!ownVisible){clearOwnNotifications();for(const listener of stateListeners)listener();}else service?.requestOwnNotifications();}
 if(type==='close'){ownVisible=false;clearOwnNotifications();for(const listener of stateListeners)listener();}
 if(type==='own-notification-snapshot-fragment'){
  if(!ownVisible||!service||data.generation!==extensionGeneration||ownsFeature('ui.notifications'))return;
  const notifications=ownSnapshotAssembler.accept(data);if(notifications){hostState.notifications=notifications;hostState.notificationApps=ownSnapshotAssembler.notificationApps;for(const listener of stateListeners)listener();}
 }
 if(type==='own-notification-action-result'){const item=ownPending.get(data.callId);if(item){ownPending.delete(data.callId);clearTimeout(item.timer);data.ok===true?item.resolve(data):item.reject(new Error('HOST_ACTION_FAILED'));}}

 if(type==='disconnected'||type==='destroyed') {ownVisible=false;clearOwnNotifications();clearPending();ownRequests.clear();ownCaptureId="";snapshotAssembler.reset();featureStates=[];hostState.notificationApps=[];hostState.notifications=[];hostState.tools=[];service=null;for(const listener of stateListeners)listener();}
 if(type==='host-state'){if(Array.isArray(data.notificationApps))hostState.notificationApps=data.notificationApps.slice(0,4096);hostState.battery=data.battery??hostState.battery;hostState.weather=data.weather??hostState.weather;for(const listener of stateListeners)listener();}
 if(type==='extensions') {
  snapshotAssembler.reset();clearOwnNotifications();extensionGeneration=Number.isSafeInteger(data.generation)?data.generation:0;
  featureStates=Array.isArray(data.features)?data.features:[];
  if(!ownsFeature('ui.notifications')){hostState.notificationApps=[];hostState.notifications=[];for(const listener of stateListeners)listener();}
  if(ownVisible)service?.requestOwnNotifications();
  for(const [id,item] of pending)if(!ownsFeature(item.feature)||effectiveFeature(item.feature)?.generation!==item.generation){clearTimeout(item.timer);pending.delete(id);item.reject(new Error('HOST_OVERRIDE_REVOKED'));}
 }
 if(type==='extension-event') {
  const state=effectiveFeature(data.feature);
  const ownKey=ownRequestKey(data.feature,data.data?.requestId??'');
  if(data.feature==='transcription'&&data.type==='request'&&data.data?.ownCapture===true&&ownCaptureId&&data.data.captureId===ownCaptureId&&typeof data.data.requestId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(data.data.requestId)&&ownRequests.size<8&&Number.isSafeInteger(data.generation))ownRequests.set(ownKey,data.generation);
  if((!state || state.generation!==data.generation || !ownsFeature(data.feature))&&ownRequests.get(ownKey)!==data.generation)return;
  if(data.feature==='ui.notifications' && data.type==='event' && data.data?.event==='notification-snapshot-fragment') {const notifications=snapshotAssembler.accept(data.data);if(notifications){hostState.notifications=notifications;hostState.notificationApps=snapshotAssembler.notificationApps;for(const listener of stateListeners)listener();}}
  if(data.feature==='device-tools' && data.type==='event' && data.data?.event==='tool-catalog') {hostState.tools=Array.isArray(data.data.tools)?data.data.tools:[];for(const listener of stateListeners)listener();}
  if(data.type==='event' && data.data?.event==='host-state') {const value=data.data;if(Array.isArray(value.notificationApps))hostState.notificationApps=value.notificationApps.slice(0,4096);hostState.battery=value.battery??hostState.battery;hostState.weather=value.weather??hostState.weather;if(typeof value.screenOn==='boolean')hostState.screenOn=value.screenOn;if(['ui.launcher','ui.app-menu','ui.notifications'].includes(data.feature)){if(Array.isArray(value.windows))hostState.windows=value.windows.slice(0,256);if(Array.isArray(value.apps))(hostState as any).apps=value.apps.slice(0,256);if(typeof value.focusedWindowId==='string')hostState.focusedWindowId=value.focusedWindowId;}for(const listener of stateListeners)listener();}
  if(data.type==='event' && ['action-result','tool-result'].includes(data.data?.event)) {
   const value=data.data;const item=pending.get(value.callId);
   if(item && item.feature===data.feature && item.generation===data.generation){pending.delete(value.callId);clearTimeout(item.timer);(value.event==='tool-result'||value.ok||['sent','draft-saved','unknown','rejected'].includes(value.status))?item.resolve(value.result??value):item.reject(Object.assign(new Error(typeof value.error==='string'?value.error:'HOST_ACTION_FAILED'),{code:'HOST_ACTION_REJECTED'}));}
  }
 }
 for(const listener of events)listener(type,data);
}
export function publishExtensions(descriptors:unknown[]):void {service?.publishExtensions(new org.json.JSONArray(JSON.stringify(descriptors)));}
export function sendHostAction(feature:string,action:string,data:Record<string,unknown>={}):boolean {
 const state=effectiveFeature(feature);if(!service||!state||!ownsFeature(feature))return false;
 return Boolean(service.invokeExtensionAction(feature,state.generation,action,new org.json.JSONObject(JSON.stringify({...data,callId:typeof data.callId==='string'?data.callId:`t3-${Date.now()}-${++sequence}`}))));
}
/** No action is queued across reconnection; timeout is unknown, never permission to retry. */
export function requestHostAction(feature:string,action:string,data:Record<string,unknown>={},timeoutMs=30000):Promise<any> {
 const state=effectiveFeature(feature);if(!state||!ownsFeature(feature))return Promise.reject(new Error('HOST_CAPABILITY_UNAVAILABLE'));
 const callId=typeof data.callId==='string'?data.callId:`t3-${Date.now()}-${++sequence}`;
 if(pending.has(callId))return Promise.reject(new Error('HOST_ACTION_DUPLICATE'));
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(callId);reject(new Error('HOST_ACTION_OUTCOME_UNKNOWN'));},Math.max(1000,Math.min(180000,timeoutMs)));
  pending.set(callId,{feature,generation:state.generation,resolve,reject,timer});
  if(!sendHostAction(feature,action,{...data,callId})){pending.delete(callId);clearTimeout(timer);reject(new Error('HOST_ACTION_UNAVAILABLE'));}
 });
}
export function respondHostRequest(feature:string,generation:number,requestId:string,data:Record<string,unknown>):boolean {
 const ownKey=ownRequestKey(feature,requestId);
 if((!ownsFeature(feature)||effectiveFeature(feature)?.generation!==generation)&&ownRequests.get(ownKey)!==generation)return false;
 const accepted=Boolean(service?.respondExtension(feature,generation,requestId,new org.json.JSONObject(JSON.stringify(data))));
 ownRequests.delete(ownKey);return accepted;
}

/** Own-window content is separately granted and never inherits global UI reply authority. */
export function requestOwnNotificationAction(action:'open'|'dismiss'|'dismiss-group',key:string,postTime:number,items?:{key:string;postTime:number}[]):Promise<any>{
 if(!service||!ownVisible)return Promise.reject(new Error('HOST_CAPABILITY_UNAVAILABLE'));
 const callId=`t3-inbox-${Date.now()}-${++sequence}`;
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ownPending.delete(callId);reject(new Error('HOST_ACTION_OUTCOME_UNKNOWN'));},30000);
  ownPending.set(callId,{resolve,reject,timer});
  const accepted=action==='dismiss-group'?service.dismissOwnNotificationGroup(new org.json.JSONArray(JSON.stringify(items)),callId):service.invokeOwnNotification(action,key,postTime,callId);
  if(!accepted){ownPending.delete(callId);clearTimeout(timer);reject(new Error('HOST_ACTION_UNAVAILABLE'));}
 });
}
