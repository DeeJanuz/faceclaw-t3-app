/** APK-local layer stack. The Faceclaw host receives final pixels through its SDK. */
import { GrayImage } from '../../graphics/image';
import { LayerStack, noopLayerActions, type Layer, type LayerActions, type LayerContext } from '../layers';
import type { InputEvent } from '../gestures';
export type InProcessAppOptions=Record<string,any> & {actions?:LayerActions;onClosed?:()=>void};
export interface InProcessWindow {stack:LayerStack;requestRender():void;setHeightMode(mode:string):void;resize(width:number,height:number):void;handleInput(event:InputEvent):Promise<void>;receiveTextInput(text:string):void;menuItems():any[];close():void;}
export function createInProcessWindow(options:InProcessAppOptions):InProcessWindow {
 let width=576,height=452;const actions={...noopLayerActions,...options.actions};
 const stack=new LayerStack(options.baseLayer,actions,{width,height});
 const app:InProcessWindow={stack,setHeightMode(){},resize(w,h){width=w;height=h;stack.setBaseSize({width,height});},
  requestRender(){const image=new GrayImage(width,height,1);for(const plane of stack.paint())image.drawImage(plane.image,plane.x??0,plane.y??0);image.bakeDeferredDrawsInPlace();options.submitFrame?.(image);},
  async handleInput(event){await stack.handleInput(event);app.requestRender();},
  receiveTextInput(text){options.receiveTextInput?.(text);app.requestRender();},menuItems:()=>options.menuItems?.()??[],close:()=>options.onClosed?.()};
 actions.requestRender=app.requestRender;return app;
}
