let route:((key?:string,sleep?:boolean)=>boolean)|null=null;
export function setNotificationOpenRoute(next:typeof route):void{route=next;}
export function openRoutedNotification(key?:string,sleep=false):boolean{return route?.(key,sleep)??false;}
