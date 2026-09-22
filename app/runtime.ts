import {openT3Assistant,createT3AppWindow,openT3Thread,openT3Inbox,openT3Notification,setT3NotificationOrigin,isT3FlowProtected} from './apps/t3/t3-app';
import {initializeT3Notifications,handlePhoneNotification,visibleT3Alerts} from './apps/t3/notifications-ui';
import {t3Workspace,setT3HostVisible,setT3PhonePreviewVisible} from './apps/t3/runtime';
import {GrayImage,type DeferredDraw} from './graphics/image';
import {flattenPlanesWithDraws} from './graphics/plane';
import {LayerStack,noopLayerActions} from './ui/layers';
import {TimedNotificationLayer} from './ui/shell/timed-notification';
import {WindowMenuLayer,appActionItems} from './ui/window-menu';
import {MenuLayer} from './ui/menu';
import {paintT3Dashboard,dashboardTargets} from './apps/t3/dashboard';
import {weatherBridge} from './native/weather';
import {timeFormatSetting} from './ui/dashboard-settings';
import {T3DictationLayer} from './ui/shell/t3-dictation';
import {voiceControlBridge} from './native/voice-control';
import {refineT3Dictation} from './t3/refinement';
import {setAppViewport} from './ui/shell/geometry';
import {shell,localShellEvents,setNotificationWakeOrigin} from './ui/shell/shell';
import {hostState,nativeService,onHostEvent,onHostState,sendHostAction,requestHostAction} from './extensions/host';
import {LauncherListLayer} from './apps/launcher/launcher-app';
import {paintNotificationCard,notificationCardRect} from './ui/shell/notification-card';
import {getDefaultSmallFont} from './graphics/ui-fonts';
import {type InputEvent} from './ui/gestures';
import {setPresentationTime} from './ui/presentation-clock';
import {encodeSdkDrawBatch,encodeSdkRetainedScene} from './graphics/sdk-draw-batch';
import type {SlideTransportHint} from './apps/t3/t3-app';
declare const com:any;
let app:ReturnType<typeof createT3AppWindow>|null=null;
let runtimeInitialized=false;
let phoneVisible=false,hostVisible=false,width=576,height=452,notificationSurface=false;
let lastFrame:GrayImage|null=null;
const frames=new Set<(frame:GrayImage)=>void>();
type RuntimeSurface={width:number;height:number;visible:boolean;generation:number;stack?:LayerStack};
const surfaces=new Map<string,RuntimeSurface>();
type SharedComposerRuntime={sessionId:string;purpose:'generic'|'message';label:string;initialText:string;maxText:number;revision:number;layer?:T3DictationLayer;transcripts:Set<(event:{text:string;isFinal:boolean})=>void>;statuses:Set<(event:{status:string})=>void>};
let sharedComposer:SharedComposerRuntime|null=null;
let preview:any=null;let previewLayer:TimedNotificationLayer|null=null;let notificationHostPresentationId:string|undefined;let notificationMode:'preview'|'reader'|'inbox'|undefined;
let lastProtected:boolean|undefined,previewTimer:ReturnType<typeof setTimeout>|null=null,previewPending:GrayImage|null=null,lastPreviewAt=0;
const rejectedSceneSurfaces=new Set<string>();
const renderTraceIds=new Map<string,string>();
function settle(task:Promise<unknown>):void{void task.catch(()=>{try{console.warn('T3 runtime async action failed');}catch{/* Logging is best effort. */}});}
function baseSurfaceFeature():string{return notificationSurface&&surfaces.get('ui.notifications')?.visible&&!preview&&Boolean(notificationMode)?'ui.notifications':'';}
function baseConsumerVisible():boolean{return phoneVisible||hostVisible||Boolean(baseSurfaceFeature());}
function baseCanPaint():boolean{if(phoneVisible)return true;const service=nativeService();const feature=baseSurfaceFeature();return baseConsumerVisible()&&Boolean(service?.hasRenderCredit?.(feature));}
function requestBasePaintPermission():void{const service=nativeService();if(!service)return;const feature=baseSurfaceFeature();if((feature&&surfaces.get(feature)?.visible)||(!feature&&hostVisible))service.invalidateSurface(feature,0);}
function requestWindowPaintAfterNotificationHandoff():void{
 // Closing the provider surface can leave one request for the old window
 // pixels in flight. Paint now, then once more after that credit/outcome has
 // settled so the reader state cannot be stranded behind the cached frame.
 getApp().requestRender();
 setTimeout(()=>{if(!notificationSurface&&hostVisible)getApp().requestRender();},100);
}
function takeRenderTrace(feature:string):string{const key=feature||'window',trace=renderTraceIds.get(key)??'';renderTraceIds.delete(key);return trace;}
export function reconcileRuntimeSurfaces(current:Map<string,RuntimeSurface>,wire:readonly any[]):Map<string,RuntimeSurface>{
 const next=new Map<string,RuntimeSurface>();
 for(const item of wire){
  if(typeof item?.id!=='string'||!item.id.startsWith('extension:'))continue;
  const feature=item.id.slice(10),w=Number(item.width),h=Number(item.height),generation=Number(item.generation);
  if(!feature||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||!Number.isSafeInteger(generation)||generation<0)continue;
  const prior=current.get(feature);
  if(prior&&prior.generation===generation){prior.width=w;prior.height=h;prior.visible=Boolean(item.visible&&item.screenOn!==false);prior.stack?.setBaseSize({width:w,height:h});next.set(feature,prior);}
  else{prior?.stack?.clearToBase();next.set(feature,{width:w,height:h,visible:Boolean(item.visible&&item.screenOn!==false),generation});}
 }
 for(const [feature,prior] of current)if(!next.has(feature))prior.stack?.clearToBase();
 return next;
}
function updateT3HostVisible(visible:boolean):void{if(typeof setT3HostVisible==='function')setT3HostVisible(visible);}
function updateT3PhonePreviewVisible(visible:boolean):void{if(typeof setT3PhonePreviewVisible==='function')setT3PhonePreviewVisible(visible);}
export function previewBitmap(image:GrayImage):any {
 image.bakeDeferredDrawsInPlace();
 const pixels=image.pixels;
 return com.faceclaw.t3.T3PreviewPixels.bitmapBuffer(pixels.buffer,pixels.byteOffset,pixels.byteLength,image.width,image.height);
}
function publishPreview(image:GrayImage):void{
 if(!phoneVisible)return;previewPending=image;const wait=Math.max(0,33-(Date.now()-lastPreviewAt));if(previewTimer!==null)return;
 previewTimer=setTimeout(()=>{previewTimer=null;const next=previewPending;previewPending=null;if(!next||!phoneVisible)return;lastPreviewAt=Date.now();lastFrame=next;for(const listener of frames)listener(next);},wait);
}
type AcceptedTranslation={key:number;offsetX:number;width:number;height:number};
export function retainedCopyForTranslation(prior:AcceptedTranslation|undefined,current:SlideTransportHint|undefined,width:number,height:number):{sourceX:number;sourceY:number;width:number;height:number;destinationX:number;destinationY:number}|null{
 if(!prior||!current||current.key!==prior.key||prior.width!==width||prior.height!==height)return null;
 const delta=current.offsetX-prior.offsetX;if(delta===0||Math.abs(delta)>=width)return null;
 return {sourceX:delta<0?-delta:0,sourceY:0,width:width-Math.abs(delta),height,destinationX:delta<0?0:delta,destinationY:0};
}
const acceptedTranslations=new Map<string,AcceptedTranslation>();
// A cached scene fingerprint cannot describe intervening raster animation pixels.
const rasterSinceScene=new Set<string>();
const prefetchedTranslations=new Map<string,number>();
let windowGeneration: number | undefined;
function submitGray(service:any,image:GrayImage,feature='',requestNextFrame=false,retainedDraws:readonly DeferredDraw[]=image.draws,translation?:SlideTransportHint):boolean{
 const draws=encodeSdkDrawBatch(service,image,retainedDraws);image.bakeDeferredDrawsInPlace();const pixels=image.pixels;
 const traceId=takeRenderTrace(feature);
 const key=feature||'window',prior=acceptedTranslations.get(key);
 if(translation&&(draws||translation.prefetchDraws?.length)&&prefetchedTranslations.get(key)!==translation.key){
  const warm=translation.prefetchDraws?.length ? encodeSdkDrawBatch(service,image,translation.prefetchDraws) : draws;
  if(warm&&service.prefetchGrayResources?.(warm.buffer,warm.byteOffset,warm.byteLength)===true)prefetchedTranslations.set(key,translation.key);
 }
 const copy=retainedCopyForTranslation(prior,translation,image.width,image.height);
 let accepted:boolean;
 if(copy&&typeof service.submitGrayBufferWithDrawsAndCopy==='function'){
  accepted=Boolean(service.submitGrayBufferWithDrawsAndCopy(pixels.buffer,pixels.byteOffset,pixels.byteLength,image.width,image.height,feature,requestNextFrame,traceId,draws?.buffer??null,draws?.byteOffset??0,draws?.byteLength??0,copy.sourceX,copy.sourceY,copy.width,copy.height,copy.destinationX,copy.destinationY));
 }else if(draws)accepted=Boolean(service.submitGrayBufferWithDraws(pixels.buffer,pixels.byteOffset,pixels.byteLength,image.width,image.height,feature,requestNextFrame,traceId,draws.buffer,draws.byteOffset,draws.byteLength));
 else accepted=Boolean(service.submitGrayBuffer(pixels.buffer,pixels.byteOffset,pixels.byteLength,image.width,image.height,feature,requestNextFrame,traceId));
 if(accepted)rasterSinceScene.add(key);
 if(accepted&&translation)acceptedTranslations.set(key,{key:translation.key,offsetX:translation.offsetX,width:image.width,height:image.height});
 else acceptedTranslations.delete(key);
 return accepted;
}
function submitRetained(service:any,source:GrayImage,feature=''):boolean{
 if(rejectedSceneSurfaces.has(feature||'window'))return false;
 const key=feature||'window';
 const fingerprint=source.fingerprint();if(!rasterSinceScene.has(key)&&service.isRetainedSceneCurrent?.(feature,fingerprint)===true)return Boolean(service.submitUnchangedRetainedScene?.(feature,fingerprint));
 const scene=encodeSdkRetainedScene(service,source);if(!scene)return false;const draws=scene.draws;
 const accepted=Boolean(service.submitRetainedScene(scene.patch.buffer,scene.patch.byteOffset,scene.patch.byteLength,scene.patchX,scene.patchY,scene.patchWidth,scene.patchHeight,source.width,source.height,feature,draws?.buffer??null,draws?.byteOffset??0,draws?.byteLength??0,fingerprint));
 if(accepted)rasterSinceScene.delete(key);
 return accepted;
}
export function onFrame(listener:(frame:GrayImage)=>void):()=>void{frames.add(listener);if(lastFrame)listener(lastFrame);return ()=>frames.delete(listener);}
export function setPhonePreviewVisible(visible:boolean):void{phoneVisible=visible;updateT3PhonePreviewVisible(visible);if(!visible){lastFrame=null;previewPending=null;if(previewTimer!==null){clearTimeout(previewTimer);previewTimer=null;}try{com.faceclaw.t3.T3PreviewPixels.release();}catch{/* Preview helper unavailable in tests. */}}else getApp().requestRender();}
export function getApp(){
 if(app)return app;
 app=createT3AppWindow({actions:{...noopLayerActions,requestRender:()=>app?.requestRender(),startVoiceCapture:()=>voiceControlBridge.startCapture(),stopVoiceCapture:()=>voiceControlBridge.finishCapture()},
  canPaint:baseCanPaint,
  requestPaintPermission:requestBasePaintPermission,
  submitFrame:(frame:GrayImage,retainedDraws:readonly DeferredDraw[],retainedSource?:GrayImage,translation?:SlideTransportHint)=>{
   publishPreview(frame);
   const service=nativeService();if(!service)return;
   const protectedState=isT3FlowProtected();if(lastProtected!==protectedState){lastProtected=protectedState;service.setWindowProtected(protectedState);}
   if(notificationSurface){const surface=surfaces.get('ui.notifications');if(surface?.visible&&!preview&&notificationMode)submitGray(service,frame,'ui.notifications',getApp().needsAnimation(),retainedDraws);}
   else if(hostVisible&&!(retainedSource&&submitRetained(service,retainedSource)))submitGray(service,frame,'',getApp().needsAnimation(),retainedDraws,translation);
  },onClosed(){app=null;}});
 initializeT3Notifications(async()=>{getApp();});
 return app;
}
export async function deliverInput(event:string|InputEvent):Promise<void>{
 const current=getApp();const input=typeof event==='string'?{type:event,source:'ring',timestampMs:Date.now()} as InputEvent:event;const type=input.type;
 if(type==='long-press' && current.claimsNotificationDismissGesture()){await current.handleInput(input);return;}
 if(type==='long-press'){
  current.stack.push(new WindowMenuLayer('App actions',appActionItems(current.menuItems(),()=>shell.sleepAtAppRoot(),()=>{
   nativeService()?.requestSystemMenu();
  })));
  current.requestRender();return;
 }
 if(type==='short-then-long-press'){voiceControlBridge.cancelCapture();while(!current.stack.isAtBase())current.stack.pop();sendHostAction('ui.launcher','close-surface');current.requestRender();return;}
 await current.handleInput(input);
}
export function receiveTypedText(text:string):void{getApp().receiveTextInput(text);}
function paintStack(stack:LayerStack,w:number,h:number){return flattenPlanesWithDraws(stack.paint(),{width:w,height:h});}
function renderSurface(feature:string):void{
 const surface=surfaces.get(feature);if(!surface?.visible||!nativeService())return;
 if(feature!=='ui.notifications'||preview||!notificationMode){
  if(nativeService()?.hasRenderCredit?.(feature)!==true){nativeService()?.invalidateSurface(feature,0);return;}
 }
 if(feature==='ui.notifications'){
  if(preview&&previewLayer){
   const stack=new LayerStack(previewLayer,noopLayerActions,{width:surface.width,height:surface.height});
   setAppViewport(surface.width,surface.height);
   const image=previewLayer.paint({stack,actions:noopLayerActions},()=>new GrayImage(surface.width,surface.height,0));
   submitGray(nativeService(),image,feature,previewLayer.needsAnimation());
  }
  else if(notificationMode){notificationSurface=true;getApp().resize(surface.width,surface.height);setAppViewport(surface.width,surface.height);getApp().requestRender();}return;
 }
 if(surface.stack){if(feature==='ui.composer')setAppViewport(surface.width,surface.height);const frame=paintStack(surface.stack,surface.width,surface.height);submitGray(nativeService(),frame.image,feature,surface.stack.needsAnimation(),frame.draws);}
}
function clearSharedComposer():void{
 const current=sharedComposer;sharedComposer=null;
 if(!current)return;
 const surface=surfaces.get('ui.composer');
 if(surface?.stack)surface.stack.clearToBase();else current.layer?.onRemoved?.();
 current.transcripts.clear();current.statuses.clear();
}
function installSharedComposer():void{
 const current=sharedComposer,surface=surfaces.get('ui.composer');
 if(!current||!surface||current.layer)return;
 const actions={...noopLayerActions,requestRender:()=>renderSurface('ui.composer')};
 const base={paint:()=>new GrayImage(surface.width,surface.height,1),handleInput:()=>{}};
 const capture={
  onTranscript:(listener:(event:{text:string;isFinal:boolean})=>void)=>{current.transcripts.add(listener);return()=>current.transcripts.delete(listener);},
  onStatus:(listener:(event:{status:string})=>void)=>{current.statuses.add(listener);return()=>current.statuses.delete(listener);},
  start:(mode:'message'|'edit')=>requestHostAction('ui.composer','composer-start-capture',{sessionId:current.sessionId,mode}),
  finish:()=>requestHostAction('ui.composer','composer-finish-capture',{sessionId:current.sessionId}),
  cancel:()=>requestHostAction('ui.composer','composer-cancel',{sessionId:current.sessionId}),
 };
 let layer:T3DictationLayer;
 const stack=new LayerStack(base,actions,{width:surface.width,height:surface.height});
 layer=new T3DictationLayer({actions,capture,initialText:current.initialText,destinationLabel:current.label,
  confirmLabel:current.purpose==='message'?'send':'use text',dismiss:()=>{stack.removeLayer(layer);renderSurface('ui.composer');},onClosed:()=>{},
  onDraft:text=>{void requestHostAction('ui.composer','composer-confirm',{sessionId:current.sessionId,text,revision:current.revision}).catch(()=>{});},
  // capture.cancel owns shared-composer cancellation. onRemoved must not send
  // a second action with the already-consumed physical gesture.
  onCancelled:()=>{},
  refine:options=>{let cancelled=false;void requestHostAction('ui.composer','composer-refine',{sessionId:current.sessionId,original:options.original,followup:options.followup,revision:current.revision},120000).then(value=>{if(cancelled)return;if(typeof value?.revision==='number')current.revision=value.revision;if(typeof value?.text==='string')options.onDone(value.text);else options.onError('refinement_invalid');},()=>{if(!cancelled)options.onError('refinement_unavailable');});return{cancel(){cancelled=true;}};},
 });
 current.layer=layer;stack.push(layer);surface.stack=stack;layer.startCapture();renderSurface('ui.composer');
}
export function initializeAppRuntime():void{
 if(runtimeInitialized)return;runtimeInitialized=true;
 getApp();
 localShellEvents.add((type,data)=>{
  if(type==='open'){getApp().requestRender();}
  if(type==='capture'){
   const current=getApp();let layer:T3DictationLayer;
   // The home control is the sole allowed backdrop origin. Reply captures keep
   // their opaque shield over the private reader until the destination restores.
   const home=dashboardTargets(width,height).find(target=>target.id==='assistant')!;
   const fromDashboard=data.origin&&['x','y','width','height'].every(key=>data.origin[key]===home[key as keyof typeof home]);
   const offBackdrop=onHostState(()=>layer.invalidateBackdrop());
   layer=new T3DictationLayer({origin:data.origin,paintDashboard:fromDashboard?(w,h)=>paintT3Dashboard(w,h,'assistant',visibleT3Alerts().length,'',weatherBridge.snapshot(),timeFormatSetting.get(),new Date(),shell.getBatteryLevels()):undefined,actions:{...noopLayerActions,requestRender:()=>current.requestRender(),startVoiceCapture:()=>voiceControlBridge.startCapture(),stopVoiceCapture:()=>voiceControlBridge.finishCapture()},refine:refineT3Dictation,dismiss:()=>{current.stack.pop();current.requestRender();},onClosed:()=>{offBackdrop();voiceControlBridge.cancelCapture();current.requestRender();},onDraft:data.onDraft,onCancelled:data.onCancelled});
   current.stack.push(layer);layer.startCapture();current.requestRender();
  }
  if(type==='preview'||type==='preview-update'){
   // Keep the opaque presentation identity through async open/dismiss work.
   // Host replacement can close an old surface after the newer preview exists.
   preview=data;notificationHostPresentationId=typeof data.hostPresentationId==='string'?data.hostPresentationId:undefined;notificationMode='preview';
   if(previewLayer)previewLayer.update(data.title,data.text,type==='preview',Number(data.durationMs),Boolean(data.hostPresentationId));
   else previewLayer=new TimedNotificationLayer(data.title,data.text,()=>{
    const selected=preview, presentationId=selected?.presentationId;
    if(!selected)return;
    const origin=previewLayer?.currentRect();if(origin)setT3NotificationOrigin(origin);
    const layer=previewLayer;
    let opening: Promise<boolean>;
    try { opening=Promise.resolve(selected.open(selected.woke,presentationId,selected.hostPresentationId)); }
    catch { opening=Promise.reject(new Error('T3_NOTIFICATION_OPEN_FAILED')); }
    opening.then((opened:boolean)=>{
      // A replacement may have arrived while the old open was pending. Only
      // the same preview/layer may consume this result.
      if(preview?.presentationId!==presentationId || previewLayer!==layer)return;
      if(opened){
        // A successful open has already handed the host surface back to the
        // regular T3 window. Keep this identity guard for stale completions.
        if (typeof shell.completeNotificationHandoff === 'function') shell.completeNotificationHandoff(selected.id,presentationId);
        else shell.closeNotificationPreview(selected.id,false,presentationId,false);
        requestWindowPaintAfterNotificationHandoff();
      } else layer.reopenAfterOpenFailure();
    },()=>{
      if(preview?.presentationId===presentationId && previewLayer===layer) layer.reopenAfterOpenFailure();
    });
   },()=>{
    const selected=preview, presentationId=selected?.presentationId;
    if(!selected)return Promise.resolve(false);
    return Promise.resolve(selected.dismiss()).then((dismissed:boolean)=>{
     if(preview?.presentationId!==presentationId)return false;
     if(dismissed)shell.closeNotificationPreview(selected.id,true,presentationId);
     return dismissed;
    },()=>false);
   },()=>{
    const selected=preview, presentationId=selected?.presentationId;
    if(selected&&preview?.presentationId===presentationId){
     // If a tap canceled the host lease but its destination never opened,
     // retire the host visit as well as the local card. This request is best
     // effort because local cleanup must remain bounded across disconnects.
     if(previewLayer?.didOpeningTimeout()&&selected.hostPresentationId)void shell.abandonNotificationVisit(selected.hostPresentationId);
     shell.closeNotificationPreview(selected.id,true,presentationId);
    }
    },()=>renderSurface('ui.notifications'),!data.woke,Number(data.durationMs),Boolean(data.woke),Boolean(data.hostPresentationId));
   renderSurface('ui.notifications');
  }
  if(type==='preview-handoff'){
   if(preview&&data?.presentationId&&data.presentationId!==preview.presentationId&&data.presentationId!==preview.hostPresentationId)return;
   surfaces.delete('ui.notifications');
   preview=null;previewLayer?.onRemoved();previewLayer=null;notificationHostPresentationId=undefined;notificationMode=undefined;notificationSurface=false;
   getApp().resize(width,height);setAppViewport(width,height);getApp().requestRender();
  }
  if(type==='preview-close'){
   if(preview && data?.presentationId && data.presentationId!==preview.presentationId && data.presentationId!==preview.hostPresentationId)return;
   if(data?.hostPresentationId)notificationHostPresentationId=data.hostPresentationId;
   else notificationHostPresentationId=undefined;
   preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode=undefined;renderSurface('ui.notifications');
  }
 });
 onHostState(()=>{if(hostVisible)getApp().requestRender();for(const feature of surfaces.keys())renderSurface(feature);});
 onHostEvent((type,data)=>{
  if(type==='invocation-event' || (type==='extension-event' && data.feature==='assistant' && data.type==='event' && data.data?.event==='invoke')) { getApp(); openT3Assistant(); }
  if(type==='connected')rejectedSceneSurfaces.clear();
  if(type==='scene-result'&&data.accepted===false){
   const feature=String(data.surfaceId??'window').replace(/^extension:/,'');rejectedSceneSurfaces.add(feature);
   if(feature==='window')getApp().requestRender();else renderSurface(feature);
  }
  if(type==='host-snapshot'){
   if(windowGeneration!==data.windowGeneration){acceptedTranslations.delete('window');prefetchedTranslations.delete('window');windowGeneration=data.windowGeneration;}
   width=Number(data.windowWidth)||width;height=Number(data.windowHeight)||height;hostVisible=Boolean(data.windowOpen&&data.windowVisible&&data.screenOn!==false);
   for(const item of Array.isArray(data.surfaces)?data.surfaces:[]){const feature=String(item.id??'').replace(/^extension:/,'');if(surfaces.get(feature)?.generation!==item.generation){acceptedTranslations.delete(feature);prefetchedTranslations.delete(feature);}}
   const reconciled=reconcileRuntimeSurfaces(surfaces,Array.isArray(data.surfaces)?data.surfaces:[]);surfaces.clear();for(const [feature,surface] of reconciled)surfaces.set(feature,surface);
   updateT3HostVisible(hostVisible);if(data.windowOpen){setAppViewport(width,height);getApp().resize(width,height);}if(hostVisible)getApp().requestRender();for(const feature of surfaces.keys())renderSurface(feature);
  }
  if(type==='open'||type==='resize'){acceptedTranslations.delete('window');prefetchedTranslations.delete('window');if(type==='open')nativeService()?.setWindowMenuAvailable(true);width=data.width;height=data.height;setAppViewport(width,height);getApp().resize(width,height);if(type==='open'&&typeof data.target==='string'&&data.target)openT3Thread(data.target);getApp().requestRender();}
  if(type==='visibility'){if(!data.visible||data.screenOn===false){acceptedTranslations.delete('window');prefetchedTranslations.delete('window');}hostVisible=data.visible&&data.screenOn!==false;updateT3HostVisible(hostVisible);if(hostVisible)getApp().requestRender();else voiceControlBridge.cancelCapture();}
  if(type==='close'||type==='disconnected'||type==='destroyed'){hostVisible=false;acceptedTranslations.clear();prefetchedTranslations.clear();rasterSinceScene.clear();updateT3HostVisible(false);voiceControlBridge.cancelCapture();if(type!=='close'){lastProtected=undefined;renderTraceIds.clear();clearSharedComposer();surfaces.clear();preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode=undefined;notificationSurface=false;previewPending=null;if(previewTimer!==null){clearTimeout(previewTimer);previewTimer=null;}if(type==='destroyed'){lastFrame=null;try{com.faceclaw.t3.T3PreviewPixels.release();}catch{/* Service teardown may already have removed the helper. */}}}}
  if(type==='render'){
   setPresentationTime(data.targetPresentationTimeMs);
   const feature=typeof data.surfaceId==='string'&&data.surfaceId.startsWith('extension:')?data.surfaceId.slice(10):'';
   if(typeof data.traceId==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(data.traceId))renderTraceIds.set(feature||'window',data.traceId);
   if(feature)renderSurface(feature);
   else if(hostVisible)getApp().requestRender();
  }
  if(type==='shared-style'&&hostVisible)getApp().requestRender();
  if(type==='input'){if(data.type==='pointer-click'&&Number.isInteger(data.x)&&Number.isInteger(data.y)&&data.x>=0&&data.y>=0&&data.x<width&&data.y<height)settle(getApp().stack.hitTest(data.x,data.y).then(()=>getApp().requestRender()));else settle(deliverInput(data));}
  if(type==='app-menu')settle(deliverInput('long-press'));
  if(type==='extension-surface'){
   const feature=data.feature;
   if(data.type==='close'){acceptedTranslations.delete(feature);prefetchedTranslations.delete(feature);
    if(feature==='ui.notifications'&&data.presentationId&&notificationHostPresentationId&&data.presentationId!==notificationHostPresentationId)return;
    // The host emits its close before the async handoff action is acknowledged.
    // Keep the local card alive until that result decides whether to settle or
    // reopen it after an unknown/rejected action.
    if(feature==='ui.notifications'&&previewLayer?.isOpening()&&
       (!data.presentationId||data.presentationId===notificationHostPresentationId)){
     surfaces.delete(feature);notificationSurface=false;return;
    }
    if(feature==='ui.composer')clearSharedComposer();
    surfaces.delete(feature);if(feature==='ui.notifications'){notificationSurface=false;notificationHostPresentationId=undefined;notificationMode=undefined;preview=null;previewLayer?.onRemoved();previewLayer=null;getApp().resize(width,height);setAppViewport(width,height);}return;
   }
   if(data.type==='open'||data.type==='resize'){
    const prior=surfaces.get(feature),sameGeneration=prior?.generation===data.generation;
    if(prior&&!sameGeneration){if(feature==='ui.composer')clearSharedComposer();else prior.stack?.clearToBase();}
    const surface={width:data.width,height:data.height,generation:data.generation,visible:true,stack:sameGeneration?prior?.stack:undefined as LayerStack|undefined};
    surface.stack?.setBaseSize({width:data.width,height:data.height});
    if(feature==='ui.launcher'&&!surface.stack){
     const actions={...noopLayerActions,requestRender:()=>renderSurface(feature)};
     const layer=new LauncherListLayer({actions,apps:()=>((hostState as any).apps??hostState.windows).map((item:any)=>({appId:item.appId,label:item.title??item.label??item.appId,icon:item.icon??'package',uninstallable:item.uninstallable===true})),launchApp:async appId=>{await requestHostAction(feature,'open-app',{appId});},uninstallApp:async appId=>{await requestHostAction(feature,'uninstall-app',{appId});},submitFrame:async()=>{},setSurfaceVisible:()=>{}});
     surface.stack=new LayerStack(layer,actions,{width:data.width,height:data.height});
    }
    surfaces.set(feature,surface);
    if(feature==='ui.composer')installSharedComposer();
   }
   const surface=surfaces.get(feature);if(surface && data.type==='visibility'){
    surface.visible=Boolean(data.visible&&data.screenOn!==false);
    // The host hides the extension surface before acknowledging a reader
    // handoff. Preserve the exact opening presentation until its promise
    // completes; that completion clears notification-surface routing and
    // requests the first frame on the regular T3 window.
    if(feature==='ui.notifications'&&!surface.visible&&!previewLayer?.isOpening()){
     previewLayer?.onRemoved();previewLayer=null;preview=null;notificationMode=undefined;
    }
   }
   renderSurface(feature);
  }
  if(type==='extension-event'){
   const feature=data.feature,content=data.data??{};
   if(data.type==='input'){
   const input=content.input??content;
    if(feature==='ui.notifications'){
     console.info(`[NotificationInput] runtime-received trace=${typeof input.traceId==='string'?input.traceId.slice(0,128):'none'} type=${String(input.type).slice(0,32)} mode=${notificationMode??'none'} preview=${Boolean(preview&&previewLayer)}`);
     if(preview&&previewLayer){
      // Return through the native input callback before a popup tap requests
      // its host-surface handoff. Starting that action in the same callback
      // can remove the overlay while starving the action result and the first
      // reader frame. Bind the deferred tap to this exact local presentation.
      const selected=preview, layer=previewLayer;
      setTimeout(()=>{
       if(preview!==selected||previewLayer!==layer)return;
       layer.handleInput(input);
      },0);
     }else settle(deliverInput(input));
    }
    else{const surface=surfaces.get(feature);if(surface?.stack){if(input.type==='pointer-click'&&Number.isInteger(input.x)&&Number.isInteger(input.y)&&input.x>=0&&input.y>=0&&input.x<surface.width&&input.y<surface.height)settle(surface.stack.hitTest(input.x,input.y).then(()=>renderSurface(feature)));else settle(surface.stack.handleInput(input).then(()=>renderSurface(feature)));}}
   }
   if(content.event==='notification-arrived'){if(notificationMode!=='reader'&&notificationMode!=='inbox'){setNotificationWakeOrigin(Boolean(content.wokeScreen));shell.setNotificationPreviewDuration(Number(content.durationMs));handlePhoneNotification(content.key??content.id,typeof content.presentationId==='string'?content.presentationId:undefined);if(typeof content.presentationId==='string'){notificationHostPresentationId=content.presentationId;shell.bindNotificationPreviewHostPresentation(content.presentationId);}}renderSurface('ui.notifications');}
   if(content.event==='notification-deadline'&&previewLayer&&typeof content.presentationId==='string'&&content.presentationId===notificationHostPresentationId)previewLayer.setHostDeadline(Number(content.expiresAtMs));
   if(content.event==='notification-open'){preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode='reader';notificationSurface=true;const n=hostState.notifications.find(n=>n.key===content.key);openT3Notification(n?`phone:${n.key}:${n.postTime}`:undefined,content.previousWindowId??hostState.focusedWindowId,Boolean(content.returnToSleep));renderSurface('ui.notifications');}
   if(feature==='ui.app-menu' && content.event==='menu'){
    const surface=surfaces.get(feature);
    if(surface&&Array.isArray(content.items)){
     const actions={...noopLayerActions,requestRender:()=>renderSurface(feature)};
     const items=content.items.filter((item:any)=>typeof item.token==='string'&&typeof item.label==='string').map((item:any)=>({label:item.label,disabled:item.enabled===false,onSelect:()=>requestHostAction(feature,'menu-select',{token:item.token}).catch(()=>{})}));
     const menu=new MenuLayer(content.title??'App actions',items);
     // Keep a leading Display off row visible for explicit selection while
     // avoiding an accidental power action from the hold's release/click.
     const safeIndex=items.findIndex((item:any)=>item.label!=='Display off'&&item.disabled!==true);
     if(safeIndex>=0)menu.selectItem(safeIndex);
     surface.stack=new LayerStack(menu,actions,{width:surface.width,height:surface.height});renderSurface(feature);
    }
   }
   if(feature==='ui.composer'&&content.event==='composer-open'&&typeof content.sessionId==='string'){
    clearSharedComposer();sharedComposer={sessionId:content.sessionId,purpose:content.purpose==='generic'?'generic':'message',label:typeof content.label==='string'?content.label:'Message',initialText:typeof content.initialText==='string'?content.initialText:'',maxText:Number(content.maxText)||8000,revision:Number(content.revision)||0,transcripts:new Set(),statuses:new Set()};installSharedComposer();
   }
   if(feature==='ui.composer'&&sharedComposer&&content.sessionId===sharedComposer.sessionId&&content.event==='composer-transcript'&&typeof content.text==='string'){
    if(content.isFinal===true&&typeof content.revision==='number')sharedComposer.revision=content.revision;
    for(const listener of sharedComposer.transcripts)listener({text:content.text,isFinal:content.isFinal===true});renderSurface('ui.composer');
   }
   if(feature==='ui.composer'&&sharedComposer&&content.sessionId===sharedComposer.sessionId&&content.event==='composer-capture-status'){
    for(const listener of sharedComposer.statuses)listener({status:String(content.status??'')});renderSurface('ui.composer');
   }
   if(content.event==='notification-inbox'){preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode='inbox';notificationSurface=true;openT3Inbox();renderSurface('ui.notifications');}
  }
 });
}
