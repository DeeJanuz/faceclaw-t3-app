import { hostState,onHostState,requestHostAction,sendHostAction,ownsFeature,requestOwnNotificationAction } from '../extensions/host';
import type { AndroidNotification } from './notification-types';
export type { AndroidNotification } from './notification-types';
export function readActiveNotifications(limit=50,_allowStale=false):AndroidNotification[]{return hostState.notifications.filter(notification=>notification.packageName!=='com.faceclaw.t3').slice(0,Math.min(50,limit));}
export async function dismissNotifications(items:{key:string;postTime:number}[]):Promise<boolean>{
 if(!items.length||items.length>50)return false;
 try{const result=ownsFeature('ui.notifications')?await requestHostAction('ui.notifications','notification-dismiss-group',{items}):await requestOwnNotificationAction('dismiss-group','',0,items);return result?.ok!==false;}catch{return false;}
}
export async function dismissNotification(key:string,version?:number):Promise<boolean>{const item=readActiveNotifications().find(n=>n.key===key);if(!item)return false;return dismissNotifications([{key,postTime:version??item.postTime}]);}
export async function openNotification(key:string,version?:number):Promise<boolean>{const item=readActiveNotifications().find(n=>n.key===key);if(!item)return false;try{const result=ownsFeature('ui.notifications')?await requestHostAction('ui.notifications','notification-open',{id:key,version:version??item.postTime}):await requestOwnNotificationAction('open',key,version??item.postTime);return result?.ok!==false;}catch{return false;}}
export function requestNotificationReply(key:string,version:number,actionIndex:number,current:()=>boolean=()=>true):Promise<any>{
 if(!current())return Promise.reject(new Error('NOTIFICATION_REVIEW_STALE'));
 const callId=`review-${Date.now()}-${++reviewSequence}`;
 let cancelled=false;
 // Cancellation is its own one-way action. Keep its transport callId distinct
 // from the review it targets so a cancellation acknowledgement cannot settle
 // the pending reviewed-send request before its `sent` result arrives.
 const cancel=()=>{if(!cancelled){cancelled=true;sendHostAction('ui.notifications','notification-cancel-review',{reviewCallId:callId});}};
 const check=()=>{if(!current())cancel();};
 activeReviews.add(cancel);
 const timer=setInterval(check,100);const off=onHostState(check);
 return requestHostAction('ui.notifications','notification-review-reply',{id:key,version,actionIndex,callId},180000).catch(error=>{cancel();if(error?.code==='HOST_ACTION_REJECTED')return {status:'rejected'};throw error;}).finally(()=>{activeReviews.delete(cancel);clearInterval(timer);off();});
}
let reviewSequence=0;
const activeReviews=new Set<()=>void>();
export function invalidateNotificationReplies():void{for(const cancel of activeReviews)cancel();}
export function onAndroidNotificationsChanged(listener:()=>void):()=>void{return onHostState(listener);}
export function onAndroidNotificationRemoved(listener:(key:string)=>void):()=>void{let keys=new Set(readActiveNotifications().map(n=>n.key));return onHostState(()=>{const next=new Set(readActiveNotifications().map(n=>n.key));for(const key of keys)if(!next.has(key))listener(key);keys=next;});}
