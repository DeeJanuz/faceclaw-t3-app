import {createT3AppWindow,openT3Thread,openT3Inbox,openT3Notification,isT3FlowProtected} from './apps/t3/t3-app';
import {initializeT3Notifications,handlePhoneNotification} from './apps/t3/notifications-ui';
import {t3Workspace} from './apps/t3/runtime';
import {GrayImage} from './graphics/image';
import {LayerStack,noopLayerActions} from './ui/layers';
import {TimedNotificationLayer} from './ui/shell/timed-notification';
import {WindowMenuLayer,appActionItems} from './ui/window-menu';
import {MenuLayer} from './ui/menu';
import {T3DictationLayer} from './ui/shell/t3-dictation';
import {voiceControlBridge} from './native/voice-control';
import {setAppViewport} from './ui/shell/geometry';
import {shell,localShellEvents,setNotificationWakeOrigin} from './ui/shell/shell';
import {hostState,nativeService,onHostEvent,onHostState,sendHostAction,requestHostAction} from './extensions/host';
import {LauncherListLayer} from './apps/launcher/launcher-app';
import {paintNotificationCard,notificationCardRect} from './ui/shell/notification-card';
import {getDefaultSmallFont} from './graphics/ui-fonts';
import {type InputEvent} from './ui/gestures';
declare const com:any;
let app:ReturnType<typeof createT3AppWindow>|null=null;
let phoneVisible=false,hostVisible=false,width=576,height=452,notificationSurface=false;
let lastFrame:GrayImage|null=null;
const frames=new Set<(frame:GrayImage)=>void>();
const surfaces=new Map<string,{width:number;height:number;visible:boolean;generation:number;stack?:LayerStack}>();
let preview:any=null;let previewLayer:TimedNotificationLayer|null=null;let notificationMode:'preview'|'reader'|'inbox'|undefined;
export function grayBitmap(image:GrayImage,extension=false):any {
 image.bakeDeferredDrawsInPlace();
 const pixels=image.pixels;
 return com.faceclaw.t3.T3Pixels.bitmapBuffer(pixels.buffer,pixels.byteOffset,pixels.byteLength,image.width,image.height,extension);
}
export function onFrame(listener:(frame:GrayImage)=>void):()=>void{frames.add(listener);if(lastFrame)listener(lastFrame);return ()=>frames.delete(listener);}
export function setPhonePreviewVisible(visible:boolean):void{phoneVisible=visible;if(visible)getApp().requestRender();}
export function getApp(){
 if(app)return app;
 app=createT3AppWindow({actions:{...noopLayerActions,requestRender:()=>app?.requestRender(),startVoiceCapture:()=>voiceControlBridge.startCapture(),stopVoiceCapture:()=>voiceControlBridge.finishCapture()},
  submitFrame:(frame:GrayImage)=>{
   lastFrame=frame;if(phoneVisible)for(const listener of frames)listener(frame);
   const service=nativeService();if(!service)return;
   service.setWindowProtected(isT3FlowProtected());
   if(notificationSurface){const surface=surfaces.get('ui.notifications');if(surface?.visible&&!preview&&notificationMode)service.submitExtensionBitmap('ui.notifications',grayBitmap(frame,true));}
   else if(hostVisible)service.submitBitmap(grayBitmap(frame));
  },onClosed(){app=null;}});
 initializeT3Notifications(async()=>{getApp();});
 return app;
}
export async function deliverInput(event:string|InputEvent):Promise<void>{
 const current=getApp();const input=typeof event==='string'?{type:event,source:'ring',timestampMs:Date.now()} as InputEvent:event;const type=input.type;
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
function paintStack(stack:LayerStack,w:number,h:number):GrayImage{const frame=new GrayImage(w,h,1);for(const plane of stack.paint())frame.drawImage(plane.image,plane.x,plane.y);frame.bakeDeferredDrawsInPlace();return frame;}
function renderSurface(feature:string):void{
 const surface=surfaces.get(feature);if(!surface?.visible||!nativeService())return;
 if(feature==='ui.notifications'){
  if(preview&&previewLayer){
   const stack=new LayerStack(previewLayer,noopLayerActions,{width:surface.width,height:surface.height});
   setAppViewport(surface.width,surface.height);
   const image=previewLayer.paint({stack,actions:noopLayerActions},()=>new GrayImage(surface.width,surface.height,0));
   nativeService().submitExtensionBitmap(feature,grayBitmap(image,true));
  }
  else if(notificationMode){notificationSurface=true;getApp().resize(surface.width,surface.height);setAppViewport(surface.width,surface.height);getApp().requestRender();}return;
 }
 if(surface.stack)nativeService().submitExtensionBitmap(feature,grayBitmap(paintStack(surface.stack,surface.width,surface.height),true));
}
export function initializeAppRuntime():void{
 getApp();
 localShellEvents.add((type,data)=>{
  if(type==='open'){getApp().requestRender();}
  if(type==='capture'){
   const current=getApp();let layer:T3DictationLayer;
   layer=new T3DictationLayer({origin:data.origin,actions:{...noopLayerActions,requestRender:()=>current.requestRender(),startVoiceCapture:()=>voiceControlBridge.startCapture(),stopVoiceCapture:()=>voiceControlBridge.finishCapture()},dismiss:()=>{current.stack.pop();current.requestRender();},onClosed:()=>{voiceControlBridge.cancelCapture();current.requestRender();},onDraft:data.onDraft,onCancelled:data.onCancelled});
   current.stack.push(layer);layer.startCapture();current.requestRender();
  }
  if(type==='preview'||type==='preview-update'){
   preview=data;notificationMode='preview';
   if(previewLayer)previewLayer.update(data.title,data.text,type==='preview');
   else previewLayer=new TimedNotificationLayer(data.title,data.text,()=>{const selected=preview;if(!selected)return;void selected.open(selected.woke).then((opened:boolean)=>{if(opened){preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode='reader';renderSurface('ui.notifications');}});},()=>{const selected=preview;if(selected)void Promise.resolve(selected.dismiss()).then((dismissed:boolean)=>{if(dismissed)shell.closeNotificationPreview(selected.id);});},()=>{const selected=preview;if(selected){shell.closeNotificationPreview(selected.id);sendHostAction('ui.notifications','close-surface');}},()=>renderSurface('ui.notifications'),!data.woke);
   renderSurface('ui.notifications');
  }
  if(type==='preview-close'){preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode=undefined;renderSurface('ui.notifications');}
 });
 onHostState(()=>{getApp().requestRender();for(const feature of surfaces.keys())renderSurface(feature);});
 onHostEvent((type,data)=>{
  if(type==='open'||type==='resize'){if(type==='open')nativeService()?.setWindowMenuAvailable(true);width=data.width;height=data.height;setAppViewport(width,height);getApp().resize(width,height);if(type==='open'&&typeof data.target==='string'&&data.target)openT3Thread(data.target);getApp().requestRender();}
  if(type==='visibility'){hostVisible=data.visible&&data.screenOn!==false;if(hostVisible)getApp().requestRender();else voiceControlBridge.cancelCapture();}
  if(type==='close'||type==='disconnected'){hostVisible=false;voiceControlBridge.cancelCapture();if(type==='disconnected'){surfaces.clear();preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode=undefined;notificationSurface=false;}}
  if(type==='render'||type==='shared-style')getApp().requestRender();
  if(type==='input'){if(data.type==='pointer-click'&&Number.isInteger(data.x)&&Number.isInteger(data.y)&&data.x>=0&&data.y>=0&&data.x<width&&data.y<height)void getApp().stack.hitTest(data.x,data.y).then(()=>getApp().requestRender());else void deliverInput(data);}
  if(type==='app-menu')void deliverInput('long-press');
  if(type==='extension-surface'){
   const feature=data.feature;
   if(data.type==='close'){surfaces.delete(feature);if(feature==='ui.notifications'){notificationSurface=false;notificationMode=undefined;preview=null;previewLayer?.onRemoved();previewLayer=null;getApp().resize(width,height);setAppViewport(width,height);}return;}
   if(data.type==='open'||data.type==='resize'){
    const surface={width:data.width,height:data.height,generation:data.generation,visible:true,stack:undefined as LayerStack|undefined};
    if(feature==='ui.launcher'){
     const actions={...noopLayerActions,requestRender:()=>renderSurface(feature)};
     const layer=new LauncherListLayer({actions,apps:()=>((hostState as any).apps??hostState.windows).map((item:any)=>({appId:item.appId,label:item.title??item.label??item.appId,icon:item.icon??'package',uninstallable:item.uninstallable===true})),launchApp:async appId=>{await requestHostAction(feature,'open-app',{appId});},uninstallApp:async appId=>{await requestHostAction(feature,'uninstall-app',{appId});},submitFrame:async()=>{},setSurfaceVisible:()=>{}});
     surface.stack=new LayerStack(layer,actions,{width:data.width,height:data.height});
    }
    surfaces.set(feature,surface);
   }
   const surface=surfaces.get(feature);if(surface && data.type==='visibility')surface.visible=Boolean(data.visible&&data.screenOn!==false);
   renderSurface(feature);
  }
  if(type==='extension-event'){
   const feature=data.feature,content=data.data??{};
   if(data.type==='input'){
    const input=content.input??content;
    if(feature==='ui.notifications'){if(preview&&previewLayer){previewLayer.handleInput(input);}else void deliverInput(input);}
    else{const surface=surfaces.get(feature);if(surface?.stack){if(input.type==='pointer-click'&&Number.isInteger(input.x)&&Number.isInteger(input.y)&&input.x>=0&&input.y>=0&&input.x<surface.width&&input.y<surface.height)void surface.stack.hitTest(input.x,input.y).then(()=>renderSurface(feature));else void surface.stack.handleInput(input).then(()=>renderSurface(feature));}}
   }
   if(content.event==='notification-arrived'){if(notificationMode!=='reader'&&notificationMode!=='inbox'){setNotificationWakeOrigin(Boolean(content.wokeScreen));handlePhoneNotification(content.key??content.id);}renderSurface('ui.notifications');}
   if(content.event==='notification-open'){preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode='reader';notificationSurface=true;const n=hostState.notifications.find(n=>n.key===content.key);openT3Notification(n?`phone:${n.key}:${n.postTime}`:undefined,content.previousWindowId??hostState.focusedWindowId,Boolean(content.returnToSleep));renderSurface('ui.notifications');}
   if(feature==='ui.app-menu' && content.event==='menu'){
    const surface=surfaces.get(feature);
    if(surface&&Array.isArray(content.items)){
     const actions={...noopLayerActions,requestRender:()=>renderSurface(feature)};
     surface.stack=new LayerStack(new MenuLayer(content.title??'App actions',content.items.filter((item:any)=>typeof item.token==='string'&&typeof item.label==='string').map((item:any)=>({label:item.label,disabled:item.enabled===false,onSelect:()=>requestHostAction(feature,'menu-select',{token:item.token}).catch(()=>{})}))),actions,{width:surface.width,height:surface.height});renderSurface(feature);
    }
   }
   if(content.event==='notification-inbox'){preview=null;previewLayer?.onRemoved();previewLayer=null;notificationMode='inbox';notificationSurface=true;openT3Inbox();renderSurface('ui.notifications');}
  }
 });
}
