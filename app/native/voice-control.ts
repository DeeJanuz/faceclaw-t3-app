import { nativeService,onHostEvent,setOwnCaptureId } from '../extensions/host';
export type VoiceTranscriptEvent={text:string;isFinal:boolean};
const transcripts=new Set<(value:VoiceTranscriptEvent)=>void>();const statuses=new Set<(value:{status:string})=>void>();let captureId='';
export const voiceControlBridge={
 onTranscript(listener:(value:VoiceTranscriptEvent)=>void){transcripts.add(listener);return ()=>transcripts.delete(listener);},
 onStatus(listener:(value:{status:string})=>void){statuses.add(listener);return ()=>statuses.delete(listener);},
 startCapture(){if(captureId)throw new Error('CAPTURE_BUSY');captureId=`t3-capture-${Date.now()}`;setOwnCaptureId(captureId);const service=nativeService();if(!service?.requestCaptureDictation(captureId,'Dictate T3 message',false)){captureId='';setOwnCaptureId('');throw new Error('CAPTURE_UNAVAILABLE');}},
 finishCapture(){if(captureId)nativeService()?.finishCaptureDictation(captureId);},
 cancelCapture(){const id=captureId;captureId='';setOwnCaptureId('');if(id)nativeService()?.cancelCaptureDictation(id);},
};
onHostEvent((type,data)=>{
 if(type==='disconnected'||type==='destroyed'){captureId='';for(const listener of statuses)listener({status:'Could not start: host disconnected'});}
 if(!captureId||data.requestId!==captureId)return;
 if(type==='capture-dictation-transcript'&&data.purpose==='capture'&&typeof data.text==='string'&&typeof data.isFinal==='boolean'){for(const listener of transcripts)listener({text:data.text,isFinal:data.isFinal});}
 if(type==='capture-dictation-status')for(const listener of statuses)listener({status:String(data.status)});
 if(type==='capture-dictation-closed'){captureId='';setOwnCaptureId('');if(data.reason!=='completed')for(const listener of statuses)listener({status:'Could not start: capture closed'});}
});
