import {Observable,Frame,ImageSource,prompt,type EventData,type Page} from '@nativescript/core';
import {onFrame,previewBitmap,setPhonePreviewVisible,deliverInput,receiveTypedText,getApp} from './runtime';
import {useT3SampleData,connectT3} from './apps/t3/runtime';
import {shell} from './ui/shell/shell';
import {t3Client} from './t3/client';
class MainModel extends Observable{
 private offFrame:()=>void;private stateOff:()=>void;
 constructor(){super();this.set('status',t3Client.state().status);this.offFrame=onFrame(frame=>this.set('preview',new ImageSource(previewBitmap(frame))));this.stateOff=t3Client.onStateChange(state=>this.set('status',state.status));setPhonePreviewVisible(true);}
 settings=()=>{const frame=Frame.topmost();if(frame?.canGoBack())frame.goBack();else frame?.navigate('phone-ui/t3-settings-page');};
 sample=async()=>{await useT3SampleData();getApp().requestRender();};
 live=async()=>{await connectT3();shell.focusWindow('t3');getApp().requestRender();};
 up=()=>deliverInput('scroll-up');down=()=>deliverInput('scroll-down');tap=()=>deliverInput('click');back=()=>deliverInput('double-click');hold=()=>deliverInput('long-press');
 type=async()=>{const result=await prompt({title:'T3 message',message:'Text opens a draft for review. Nothing sends here.',okButtonText:'Review',cancelButtonText:'Cancel'});if(result.result&&result.text.trim())receiveTypedText(result.text);};
 dispose(){this.offFrame();this.stateOff();this.set('preview',null);setPhonePreviewVisible(false);}
}
export function loaded(args:EventData){const page=args.object as Page;if(!page.bindingContext)page.bindingContext=new MainModel();}
export function unloaded(args:EventData){const page=args.object as Page;(page.bindingContext as MainModel)?.dispose();page.bindingContext=null;}
