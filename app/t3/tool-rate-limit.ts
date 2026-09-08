/** Retains the fork's six proactive tool calls per minute; active assistant turns are exempt. */
export class ToolRateLimit {
 private calls:number[]=[];
 admit(activeTurn:boolean,now=Date.now()):boolean {
  if(activeTurn)return true;
  this.calls=this.calls.filter(time=>now-time<=60000);
  if(this.calls.length>=6)return false;
  this.calls.push(now);return true;
 }
}
