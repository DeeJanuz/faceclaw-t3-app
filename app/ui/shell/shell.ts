import {openNotification} from '../../native/notification-icons';
/** Retained T3 UI's host facade. Every privileged operation crosses SDK IPC. */
import { hostState,nativeService,sdkControls,onHostEvent,requestHostAction,sendHostAction,ownsFeature } from '../../extensions/host';
import { t3Workspace } from '../../apps/t3/runtime';
type NotificationPreview = { id:string; title:string; text:string; open:(woke:boolean,presentationId?:string)=>Promise<boolean>; dismiss:()=>Promise<boolean>|boolean; woke:boolean; started:number; presentationId:string; hostPresentationId?:string; durationMs:number };
let visible=true,notificationSurface=false,preview:NotificationPreview|null=null;let previewSequence=0;let pendingHandoffHostPresentationId:string|undefined;let nextWakeOrigin:boolean|undefined;let nextPreviewDurationMs=5000;
export function setNotificationWakeOrigin(woke:boolean):void{nextWakeOrigin=woke;}let capture:{id:string;done:(text:string)=>void;cancel:()=>void;current:()=>boolean}|null=null;
export function setNotificationPreviewDuration(durationMs:number):void{if([3000,5000,7000,10000].includes(durationMs))nextPreviewDurationMs=durationMs;else nextPreviewDurationMs=5000;}
export const localShellEvents=new Set<(type:string,data:any)=>void>();
function local(type:string,data:any={}){for(const listener of localShellEvents)listener(type,data);}
function action(name:string,data:Record<string,unknown>={}):boolean{
 const service=nativeService();
 if(name==='sleep'&&sdkControls().supports('control.result')){void sdkControls().request('window.sleep');return true;}
 if(service?.requestSleep && name==='sleep')return Boolean(service.requestSleep());
 if(name==='open-self')return Boolean(service?.requestOpenWindow());
 return sendHostAction('ui.launcher',name,data);
}
onHostEvent((type,data)=>{
 if(type==='visibility')visible=Boolean(data.visible&&data.screenOn!==false);
 if(type==='extension-surface'&&data.feature==='ui.notifications'){
  if(data.type==='open')notificationSurface=true;
 if(data.type==='close'){
   // N1 may attach the host presentation identity. An old close must not
   // erase a replacement that was admitted while the old surface unwound.
   if(!data.presentationId || !preview || data.presentationId===preview.presentationId || data.presentationId===preview.hostPresentationId){
    const handoffClose = Boolean(pendingHandoffHostPresentationId &&
      (!data.presentationId || data.presentationId===pendingHandoffHostPresentationId));
    if(!handoffClose) notificationSurface=false;
    if(!handoffClose) clearPreview();
   }
  }
 }
 if(type==='disconnected'||type==='destroyed'){pendingHandoffHostPresentationId=undefined;notificationSurface=false;clearPreview();}
 if(type==='disconnected'||type==='destroyed'){const previous=capture;capture=null;previous?.cancel();}
 if(type==='dictation-result' && capture && data.requestId===capture.id){const pending=capture;capture=null;if(data.confirmed===true&&typeof data.text==='string'&&pending.current())pending.done(data.text);else pending.cancel();}
});
export const shell={
 getBatteryLevels:()=>hostState.battery,
 setNotificationPreviewDuration:(durationMs:number)=>setNotificationPreviewDuration(durationMs),
 isWindowVisible:(_id:string)=>visible,
 isWindowFocused:(id:string)=>{
  if(!visible)return false;
  if(id!=='t3')return true;
  const focused=hostState.focusedWindowId;
  return !focused||focused==='t3'||focused.startsWith('apk:com.faceclaw.t3/');
 },
 foregroundWindow:()=>hostState.focusedWindowId?{windowId:hostState.focusedWindowId}:null,
 closeNotificationReader(){if(notificationSurface)sendHostAction('ui.notifications','close-surface');},
 hasOverlay:()=>Boolean(capture||(notificationSurface&&preview)),getNotificationPreviewId:()=>notificationSurface?preview?.id??null:null,
 focusWindow(id:string){if(notificationSurface){if(id!=='t3')sendHostAction('ui.notifications','close-surface');local('open');}else if(id==='t3'){action('open-self');local('open');}else sendHostAction('ui.launcher','focus-app',{windowId:id});},
 respondToBack(atRoot:boolean){if(sdkControls().supports('window.policy'))void sdkControls().request('window.back',{response:atRoot?'at-root':'handled'},500);else if(atRoot){action('sleep');local('sleep');}},
 sleepAtAppRoot(){if(notificationSurface)sendHostAction('ui.notifications','close-surface');action('sleep');local('sleep');},wake(_target?:string){action('open-self');local('wake');},
 wakeWindowForNotification(_id:string):boolean{if(!visible)return false;local('wake');return true;},
 startT3Dictation(done:(text:string)=>void,cancel:()=>void,current:()=>boolean,_rect?:any){
  if(capture)return;
  const id=`capture-${Date.now()}`;capture={id,done,cancel,current};
  if(t3Workspace.demo){capture=null;done('Please summarize the latest project changes.');return;}
  local('capture',{origin:_rect,onDraft:(text:string)=>{const pending=capture;capture=null;if(pending?.current())pending.done(text);},onCancelled:()=>{const pending=capture;capture=null;pending?.cancel();}});
 },
 showNotificationPreview(id:string,title:string,text:string,open:(woke:boolean,presentationId?:string)=>Promise<boolean>,dismiss:()=>Promise<boolean>|boolean,protectedFlow=false,hostPresentationId?:string,durationMs=nextPreviewDurationMs){
  if(protectedFlow)return;
  const presentationId=`t3-preview-${Date.now()}-${++previewSequence}`;
  const allowed=[3000,5000,7000,10000];
  const effective=allowed.includes(durationMs)?durationMs:5000;
  preview={id,title,text,open,dismiss,woke:preview?.woke??nextWakeOrigin??!hostState.screenOn,started:Date.now(),presentationId,hostPresentationId,durationMs:effective};nextWakeOrigin=undefined;nextPreviewDurationMs=5000;local('preview',preview);
 },
 bindNotificationPreviewHostPresentation(hostPresentationId:string){
  if(preview && typeof hostPresentationId==='string' && hostPresentationId.length>0){preview.hostPresentationId=hostPresentationId;local('preview-update',preview);}
 },
 updateNotificationPreview(oldId:string,id:string,title:string,text:string,open:any,dismiss:any,hostPresentationId?:string,durationMs?:number){if(preview?.id===oldId){const allowed=[3000,5000,7000,10000];Object.assign(preview,{id,title,text,open,dismiss,...(hostPresentationId?{hostPresentationId}:{}),...(durationMs!==undefined&&allowed.includes(durationMs)?{durationMs}:{})});local('preview-update',preview);}},
 async handoffNotificationPreview(id:string,presentationId?:string):Promise<boolean>{
  const selected=preview;
  if(!selected||selected.id!==id||!presentationId||!(selected.presentationId===presentationId||selected.hostPresentationId===presentationId))return false;
  const hostPresentationId=selected.hostPresentationId;
  // T3-owned completions may arrive before the host publishes the Android
  // notification lease. They still need to leave the medium preview locally;
  // there is no host lease that can be safely echoed in an action.
  if(!hostPresentationId){notificationSurface=false;preview=null;local('preview-handoff',{...selected});return true;}
  pendingHandoffHostPresentationId=hostPresentationId;
  try {
   await requestHostAction('ui.notifications','close-surface',{presentationId:hostPresentationId,restoreSleep:false});
  } catch { pendingHandoffHostPresentationId=undefined; return false; }
  pendingHandoffHostPresentationId=undefined;
  if(!preview||preview.presentationId!==selected.presentationId)return true;
  notificationSurface=false;preview=null;local('preview-handoff',{...selected});return true;
 },
 closeNotificationPreview(id:string,_restore=true,presentationId?:string,releaseHostSurface=true){
  if(preview?.id===id && (!presentationId || preview.presentationId===presentationId || preview.hostPresentationId===presentationId)){
   const closed=preview;preview=null;local('preview-close',closed);
   // Closing a successful T3-owned dismissal/expiry must release the matching
   // host surface. N1 treats this as idempotent and binds it to its identity.
   if(releaseHostSurface)sendHostAction('ui.notifications','close-surface',closed.hostPresentationId?{presentationId:closed.hostPresentationId}:{});
  }
 },
 openNotificationModal(key:string,returnToSleep=false){void openNotification(key);},
};
function clearPreview():void{if(!preview)return;const closed=preview;preview=null;local('preview-close',closed);}
