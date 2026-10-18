import assert from 'node:assert/strict';
import test from 'node:test';
import { placeParts } from '../src/graph-layout.ts';

test('mixed-size components reserve real bounds and label space in every column', () => {
  const parts = [
    { ref:'MCU',level:0,width:660,height:365 },
    { ref:'Connector',level:1,width:180,height:140 },
    { ref:'Resistor',level:1,width:200,height:120 },
    { ref:'Display',level:2,width:480,height:250 },
  ];
  const placed = placeParts(parts);
  const a=placed.get('Connector'), b=placed.get('Resistor');
  assert.ok(b.y-b.height/2-(a.y+a.height/2)>=120);
  for (const p of parts) for (const q of parts) {
    if (p.level>=q.level) continue;
    const x=placed.get(p.ref), y=placed.get(q.ref);
    assert.ok(y.x-y.width/2-(x.x+x.width/2)>=160);
  }
  assert.equal(placed.get('MCU').y,365/2);
});
test('empty and disconnected layouts remain finite', () => {
  assert.equal(placeParts([]).size,0);
  const result=placeParts([{ref:'A',level:3,width:900,height:600},{ref:'B',level:3,width:60,height:50}]);
  assert.ok([...result.values()].every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
});
