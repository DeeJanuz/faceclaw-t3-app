import type {AndroidNotification} from '../native/notification-types';
/** Applies only complete, bounded snapshots. Partial data never replaces a current review target. */
export class NotificationSnapshotAssembler {
 notificationApps:{packageName:string;name:string}[]=[];
 private id='';private fragments:string[]=[];private total=0;private length=0;private revision=-1;
 reset():void{this.notificationApps=[];this.id='';this.fragments=[];this.total=0;this.length=0;this.revision=-1;}
 accept(frame:any):AndroidNotification[]|null {
  if(!frame||typeof frame.snapshotId!=='string'||frame.snapshotId.length>128||!Number.isInteger(frame.index)||!Number.isInteger(frame.total)||frame.total<1||frame.total>128||frame.index<0||frame.index>=frame.total||typeof frame.json!=='string'||frame.json.length>16000)return null;
  if(frame.snapshotId!==this.id){if(frame.index!==0)return null;this.id=frame.snapshotId;this.fragments=[];this.total=frame.total;this.length=0;}
  if(frame.total!==this.total||frame.index!==this.fragments.length){this.id='';this.fragments=[];return null;}
  this.length+=frame.json.length;if(this.length>2097152){this.id='';this.fragments=[];return null;}
  this.fragments.push(frame.json);if(this.fragments.length!==this.total)return null;
  const text=this.fragments.join('');this.id='';this.fragments=[];
  try{
   const value=JSON.parse(text);if(!Number.isSafeInteger(value.revision)||value.revision<=this.revision||!Array.isArray(value.notifications)||value.notifications.length>50)return null;
   if(!value.notifications.every(validNotification))return null;
   if(value.notificationApps!==undefined&&(!Array.isArray(value.notificationApps)||value.notificationApps.length>512||!value.notificationApps.every((item:any)=>item&&typeof item.packageName==='string'&&item.packageName.length<=255&&typeof item.name==='string'&&item.name.length<=512)))return null;
   this.notificationApps=value.notificationApps??[];this.revision=value.revision;return value.notifications;
  }catch{return null;}
 }
}
function validNotification(value:any):value is AndroidNotification {
 const textFields=['key','packageName','appName','title','text','bigText','subText','infoText','summaryText','category'];
 return value&&typeof value==='object'&&textFields.every(key=>typeof value[key]==='string'&&value[key].length<=20000)&&value.key.length>0&&value.key.length<=512&&Number.isSafeInteger(value.postTime)&&value.postTime>=0&&Array.isArray(value.lines)&&value.lines.length<=50&&value.lines.every((line:any)=>typeof line==='string'&&line.length<=20000)&&Array.isArray(value.actions)&&value.actions.length<=32&&value.actions.every((action:any)=>action&&Number.isSafeInteger(action.index)&&action.index>=0&&typeof action.title==='string'&&action.title.length<=512&&typeof action.enabled==='boolean'&&typeof action.acceptsText==='boolean')&&(!value.messages||(Array.isArray(value.messages)&&value.messages.length<=50&&value.messages.every((message:any)=>message&&typeof message.text==='string'&&message.text.length<=20000&&typeof message.sender==='string'&&message.sender.length<=512&&Number.isSafeInteger(message.timestamp))));
}
