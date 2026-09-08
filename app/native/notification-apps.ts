import {hostState} from '../extensions/host';
import { readActiveNotifications } from './notification-icons';

export type NotificationApp = { packageName: string; name: string };

/** Host-authorized app names plus apps in the current scoped notification snapshot. */
export function readNotificationApps(): NotificationApp[] {
 const apps=new Map<string,NotificationApp>((hostState.notificationApps??[]).map(app=>[app.packageName,app]));
 for(const item of readActiveNotifications())if(!apps.has(item.packageName))apps.set(item.packageName,{packageName:item.packageName,name:item.appName||item.packageName});
 return [...apps.values()].filter(app=>app.packageName!=='com.faceclaw.t3').sort((a,b)=>a.name.localeCompare(b.name));
}
