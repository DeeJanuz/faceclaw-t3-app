let width=576,height=452;
export function setAppViewport(w:number,h:number):void{width=w;height=h;}
export function appViewportRect(_mode?:string){return {x:0,y:0,width,height};}
