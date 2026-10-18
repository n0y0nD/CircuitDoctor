export type Point = {x:number;y:number};
export type Box = Point & {width:number;height:number};
export type Terminal = Point & {side:'left'|'right'|'top'|'bottom';box:Box};

function compact(points:Point[]):Point[] {
  const result:Point[]=[];
  for(const p of points) {
    if(result.length && result[result.length-1].x===p.x && result[result.length-1].y===p.y) continue;
    while(result.length>1) {
      const a=result[result.length-2], b=result[result.length-1];
      if((a.x===b.x && b.x===p.x && (b.y-a.y)*(p.y-b.y)>=0) ||
         (a.y===b.y && b.y===p.y && (b.x-a.x)*(p.x-b.x)>=0)) result.pop();
      else break;
    }
    result.push(p);
  }
  return result;
}

export function crossesBox(a:Point,b:Point,box:Box):boolean {
  const left=box.x-box.width/2, right=box.x+box.width/2;
  const top=box.y-box.height/2, bottom=box.y+box.height/2;
  if(a.x===b.x) return a.x>left && a.x<right && Math.max(a.y,b.y)>top && Math.min(a.y,b.y)<bottom;
  if(a.y===b.y) return a.y>top && a.y<bottom && Math.max(a.x,b.x)>left && Math.min(a.x,b.x)<right;
  return true;
}

/** A direct orthogonal wire, without a central net hub or duplicated return legs.
 * Uses geometry only: no part names, board models or electrical assumptions.
 * Return null for obstructed layouts so the caller can retain its branched router.
 */
export function simpleWireRoute(start:Terminal,end:Terminal,boxes:Box[],lane=0):Point[]|null {
  const gap=28+(lane%12)*14;
  const exit=(p:Terminal):Point=>p.side==='top'?{x:p.x,y:p.box.y-p.box.height/2-gap}:
    p.side==='bottom'?{x:p.x,y:p.box.y+p.box.height/2+gap}:
    p.side==='left'?{x:p.box.x-p.box.width/2-gap,y:p.y}:{x:p.box.x+p.box.width/2+gap,y:p.y};
  const a=exit(start),b=exit(end);
  if(boxes.some(box=>box!==start.box && crossesBox(start,a,box)) ||
     boxes.some(box=>box!==end.box && crossesBox(b,end,box))) return null;
  const candidates:Point[][]=[
    [a,{x:a.x,y:b.y},b], [a,{x:b.x,y:a.y},b],
  ];
  const xs=new Set([a.x,b.x,(a.x+b.x)/2,...boxes.flatMap(box=>[box.x-box.width/2-gap,box.x+box.width/2+gap])]);
  const ys=new Set([a.y,b.y,(a.y+b.y)/2,...boxes.flatMap(box=>[box.y-box.height/2-gap,box.y+box.height/2+gap])]);
  for(const x of xs) candidates.push([a,{x,y:a.y},{x,y:b.y},b]);
  for(const y of ys) candidates.push([a,{x:a.x,y},{x:b.x,y},b]);
  let best:Point[]|null=null, cost=Infinity;
  for(const candidate of candidates) {
    if(candidate.slice(1).some((p,i)=>boxes.some(box=>crossesBox(candidate[i],p,box)))) continue;
    const route=compact([start,...candidate,end]);
    // Do not retrace an existing segment of the same wire.
    if(route.slice(2).some((p,i)=>{
      const a=route[i],b=route[i+1];
      return (a.x===b.x && b.x===p.x && (b.y-a.y)*(p.y-b.y)<0) ||
        (a.y===b.y && b.y===p.y && (b.x-a.x)*(p.x-b.x)<0);
    })) continue;
    const distance=route.slice(1).reduce((sum,p,i)=>sum+Math.abs(p.x-route[i].x)+Math.abs(p.y-route[i].y),0);
    const score=distance+(route.length-2)*80;
    if(score<cost) {best=route;cost=score;}
  }
  return best;
}
