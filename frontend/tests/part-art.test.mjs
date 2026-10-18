import assert from 'node:assert/strict';
import test from 'node:test';
import { partDrawing, isGroundNet } from '../src/part-art.ts';
import { componentKind } from '../src/types.ts';
function fixture(lib,part,pins) {
 const component={ref:'U1',value:part,libsource:{lib,part}};
 const circuit={components:[component],libparts:[{lib,part,pins:pins.map(([num,name])=>({num,name}))}],nets:[{code:'1',name:'auto-net',nodes:[{ref:'U1',pin:pins[0][0],pinfunction:pins[0][1]},{ref:'A1',pin:'4',pinfunction:'3V3'}]}]};
 return {component,circuit};
}
test('recognizes the uploaded OLED and character LCD symbols without guessing from free text',()=>{
 for(const [lib,part,kind] of [['Display_Graphic','ER_OLEDM0.91_1x-I2C','oled'],['Display_Character','LCD-016N002L','lcd']]) {
 const {component,circuit}=fixture(lib,part,[['007','GND'],['2','VCC'],['3','SCL'],['4','SDA']]);
 assert.equal(componentKind(component),kind);
 const drawing=partDrawing(circuit,component);
 assert.equal(drawing.ports.size,4);
 assert.equal(drawing.ports.get('007').label,'GND');
 assert.equal(drawing.ports.get('007').connected,true);
 assert.equal(drawing.ports.get('3').connected,false);
 assert.equal(new Set([...drawing.ports.values()].map(p=>`${p.x},${p.y}`)).size,4);
 }
 const {component,circuit}=fixture('Custom','Connector',[['1','IN']]);
 component.value='OLED display';
 assert.equal(partDrawing(circuit,component),null);
});
test('display retains only exported pins when library metadata is missing',()=>{
 const {component,circuit}=fixture('Display_Graphic','ER_OLEDM0.91_1x-I2C',[['05','SDA']]);
 circuit.libparts=[];
 const drawing=partDrawing(circuit,component);
 assert.deepEqual([...drawing.ports.keys()],['05']);
});
test('diode and battery polarity follows names, not pin numbers',()=>{
 for(const [part,pins] of [['D',[['1','K'],['2','A']]],['Battery',[['1','-'],['2','+']]]]) {
 const {component,circuit}=fixture('Device',part,pins);
 const drawing=partDrawing(circuit,component);
 assert.ok(drawing.ports.get('2').x<drawing.ports.get('1').x);
 }
 const {component,circuit}=fixture('Device','D',[['1','A'],['2','K'],['3','K']]);
 assert.equal(partDrawing(circuit,component),null);
});
test('passive drawings preserve terminals and escape supplied labels',()=>{
 for(const part of ['R','LED','C','C_Polarized','D_Schottky','Battery_Cell']) {
 const {component,circuit}=fixture('Device',part,[['1','<unsafe>'],['2','~']]);
 const drawing=partDrawing(circuit,component);
 assert.equal(drawing.ports.size,2);
 const svg=decodeURIComponent(drawing.image.split(',')[1]);
 assert.ok(svg.includes('&lt;unsafe&gt;'));
 assert.ok(!svg.includes('<unsafe>'));
 }
});
test('ground appearance uses explicit ground names or exported ground pins, without merging nets',()=>{
 const {circuit}=fixture('Device','R',[['1','~'],['2','~']]);
 assert.equal(isGroundNet(circuit,circuit.nets[0]),false);
 assert.equal(isGroundNet(circuit,{...circuit.nets[0],name:'GND'}),true);
 assert.equal(isGroundNet(circuit,{...circuit.nets[0],nodes:[{ref:'A1',pin:'7',pinfunction:'GND'}]}),true);
});

test('display header terminals retain exported IDs and stay inside the drawing',()=>{
 const {component,circuit}=fixture('Display_Character','LCD-016N002L',Array.from({length:16},(_,i)=>[String(i+1),`P${i+1}`]));
 const drawing=partDrawing(circuit,component);
 assert.equal(drawing.ports.size,16);
 for(const port of drawing.ports.values()) {
   assert.equal(port.side,'top');
   assert.ok(port.x>0 && port.x<drawing.width && port.y>0 && port.y<drawing.height);
 }
 assert.equal(new Set([...drawing.ports.values()].map(p=>p.x)).size,16);
});

test('unknown diode polarity does not invent a cathode stripe',()=>{
 const {component,circuit}=fixture('Device','D',[['01','unknown'],['02','unknown']]);
 const svg=decodeURIComponent(partDrawing(circuit,component).image.split(',')[1]);
 assert.ok(!svg.includes('M128 42V75'));
 assert.ok(svg.includes('Pin 01'));
 assert.ok(svg.includes('Pin 02'));
});
