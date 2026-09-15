import { nativeService,onHostEvent,setOwnCaptureId,sdkControls } from '../extensions/host';
export type VoiceTranscriptEvent={text:string;isFinal:boolean};
const transcripts=new Set<(value:VoiceTranscriptEvent)=>void>();const statuses=new Set<(value:{status:string})=>void>();let captureId='';let typedCapture:ReturnType<ReturnType<typeof sdkControls>['capture']>|null=null;
export const voiceControlBridge={
 onTranscript(listener:(value:VoiceTranscriptEvent)=>void){transcripts.add(listener);return ()=>transcripts.delete(listener);},
 onStatus(listener:(value:{status:string})=>void){statuses.add(listener);return ()=>statuses.delete(listener);},
 startCapture(){if(captureId)throw new Error('CAPTURE_BUSY');
  const controls=sdkControls();if(controls.supports('capture.session')){
   let ended=false;const handle=controls.capture('message','Dictate T3 message',event=>{
    if(event.type==='capture-transcript'&&typeof event.text==='string'&&typeof event.isFinal==='boolean')for(const listener of transcripts)listener({text:event.text,isFinal:event.isFinal});
    if(event.type==='capture-status'){for(const listener of statuses)listener({status:String(event.status)});if(['complete','cancelled','rejected'].includes(String(event.status))){ended=true;captureId='';typedCapture=null;setOwnCaptureId('');}}
   });if(ended)throw new Error('CAPTURE_UNAVAILABLE');typedCapture=handle;captureId=handle.id;setOwnCaptureId(captureId);return;
  }captureId=`t3-capture-${Date.now()}`;setOwnCaptureId(captureId);const service=nativeService();if(!service?.requestCaptureDictation(captureId,'Dictate T3 message',false)){captureId='';setOwnCaptureId('');throw new Error('CAPTURE_UNAVAILABLE');}},
 finishCapture(){if(typedCapture){typedCapture.finish();return;}if(captureId)nativeService()?.finishCaptureDictation(captureId);},
 cancelCapture(){if(typedCapture){const previous=typedCapture;typedCapture=null;captureId='';setOwnCaptureId('');previous.cancel();return;}const id=captureId;captureId='';setOwnCaptureId('');if(id)nativeService()?.cancelCaptureDictation(id);},
};
onHostEvent((type,data)=>{
 if(type==='disconnected'||type==='destroyed'){captureId='';for(const listener of statuses)listener({status:'Could not start: host disconnected'});}
 if(!captureId||data.requestId!==captureId)return;
 if(type==='capture-dictation-transcript'&&data.purpose==='capture'&&typeof data.text==='string'&&typeof data.isFinal==='boolean'){for(const listener of transcripts)listener({text:data.text,isFinal:data.isFinal});}
 if(type==='capture-dictation-status')for(const listener of statuses)listener({status:String(data.status)});
 if(type==='capture-dictation-closed'){captureId='';setOwnCaptureId('');if(data.reason!=='complete'&&data.reason!=='completed')for(const listener of statuses)listener({status:'Could not start: capture closed'});}
});
