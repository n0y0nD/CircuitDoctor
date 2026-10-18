import assert from 'node:assert/strict';
import test from 'node:test';
import { simpleWireRoute, crossesBox } from '../src/wire-routing.ts';

const a={x:0,y:200,width:540,height:365};
const b={x:700,y:200,width:340,height:230};
const top=(box,x)=>({x,y:box.y-box.height/2+26,side:'top',box});
function verify(route,start,end,boxes) {
  assert.ok(route);
  assert.deepEqual(route[0],start);
  assert.deepEqual(route.at(-1),end);
  for(let i=0;i<route.length-1;i++) {
    assert.ok(route[i].x===route[i+1].x || route[i].y===route[i+1].y);
    for(const box of boxes) {
      if((i===0 && box===start.box) || (i===route.length-2 && box===end.box)) continue;
      assert.equal(crossesBox(route[i],route[i+1],box),false);
    }
  }
}

test('two top sockets connect with two bends despite different board heights',()=>{
  const start=top(a,-130),end=top(b,690);
  const route=simpleWireRoute(start,end,[a,b]);
  verify(route,start,end,[a,b]);
  assert.equal(route.length,4);
});
test('bottom-to-top connection uses the gap between parts without crossing either',()=>{
  const start={x:-50,y:352,side:'bottom',box:a},end=top(b,650);
  const route=simpleWireRoute(start,end,[a,b]);
  verify(route,start,end,[a,b]);
  assert.equal(route.length,6);
});
test('separate lanes do not stack top connections on the same horizontal segment',()=>{
  const one=simpleWireRoute(top(a,-100),top(b,650),[a,b],0);
  const two=simpleWireRoute(top(a,-120),top(b,680),[a,b],1);
  assert.notEqual(one[1].y,two[1].y);
});
test('opposing side terminals on the same row need no bends',()=>{
  const start={x:270,y:200,side:'right',box:a},end={x:530,y:200,side:'left',box:b};
  const route=simpleWireRoute(start,end,[a,b]);
  verify(route,start,end,[a,b]);
  assert.equal(route.length,2);
});
test('another part in the gap is avoided',()=>{
  const obstruction={x:400,y:200,width:100,height:160};
  const start={x:270,y:200,side:'right',box:a},end={x:530,y:200,side:'left',box:b};
  verify(simpleWireRoute(start,end,[a,b,obstruction]),start,end,[a,b,obstruction]);
});
test('blocked socket exits use the existing fallback rather than crossing a part',()=>{
  const obstruction={x:-130,y:5,width:100,height:90};
  assert.equal(simpleWireRoute(top(a,-130),top(b,690),[a,b,obstruction]),null);
});
