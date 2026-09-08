import { readActiveNotifications,invalidateNotificationReplies,openNotification } from './notification-icons';
export type NotificationReplyStatus='sent'|'draft-saved'|'rejected'|'unknown';
export function hasExternalNotification(key:string):boolean{return readActiveNotifications().some(item=>item.key===key);}
export const invalidateExternalNotificationReplies=invalidateNotificationReplies;
export function invokeExternalNotification(key:string,_action=0,version?:number):boolean{const n=readActiveNotifications().find(item=>item.key===key&&(!version||item.postTime===version));if(!n)return false;void openNotification(key,version);return true;}
