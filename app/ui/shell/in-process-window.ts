/** APK-local layer stack. The Faceclaw host receives final pixels through its SDK. */
import { FrameRequest } from '@faceclaw/motion';
import { GrayImage } from '../../graphics/image';
import { LayerStack, noopLayerActions, type LayerActions } from '../layers';
import type { InputEvent } from '../gestures';
export type InProcessAppOptions=Record<string,any> & {actions?:LayerActions;onClosed?:()=>void};
export interface InProcessWindow {stack:LayerStack;requestRender():void;setHeightMode(mode:string):void;resize(width:number,height:number):void;handleInput(event:InputEvent):Promise<void>;receiveTextInput(text:string):void;menuItems():any[];claimsNotificationDismissGesture():boolean;close():void;}
export function createInProcessWindow(options:InProcessAppOptions):InProcessWindow {
 let width=576,height=452;const actions={...noopLayerActions,...options.actions};
 let closed=false;
 const stack=new LayerStack(options.baseLayer,actions,{width,height});
 const render=()=>{
  if(closed)return;
  const image=new GrayImage(width,height,1);
  for(const plane of stack.paint())image.drawImage(plane.image,plane.x??0,plane.y??0);
  image.bakeDeferredDrawsInPlace();options.submitFrame?.(image);
 };
 const frames=new FrameRequest(render, callback => setTimeout(callback, 0), handle => clearTimeout(handle));
 const app:InProcessWindow={stack,setHeightMode(){},resize(w,h){width=w;height=h;stack.setBaseSize({width,height});},
  // One event can request a frame from both the layer and its input completion.
  // Draw their latest state on the next turn without adding a frame-rate delay.
  requestRender(){if(!closed)frames.request();},
  async handleInput(event){if(closed)return;await stack.handleInput(event);app.requestRender();},
  receiveTextInput(text){if(closed)return;options.receiveTextInput?.(text);app.requestRender();},menuItems:()=>options.menuItems?.()??[],
  claimsNotificationDismissGesture:()=>stack.isAtBase()&&Boolean(options.claimsNotificationDismissGesture?.()),
  close(){if(closed)return;closed=true;frames.cancel();options.onClosed?.();}};
 actions.requestRender=app.requestRender;return app;
}
