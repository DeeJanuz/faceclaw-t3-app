export interface AppDefinition {appId:string;title:string;icon:string;boot():void;launch(ctx:{launchInProcessApp:(...args:any[])=>Promise<void>}):Promise<void>;}
