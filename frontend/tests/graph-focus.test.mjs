import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionFocus, graphPinId } from '../src/graph-focus.ts';

const circuit = { nets: [
  { code: 'a', nodes: [{ref:'MCU',pin:'3'}, {ref:'Display',pin:'SDA'}, {ref:'R4',pin:'1'}] },
  { code: 'b', nodes: [{ref:'MCU',pin:'4'}, {ref:'Sensor',pin:'IN'}] },
  { code: 'c', nodes: [{ref:'R4',pin:'2'}, {ref:'Supply',pin:'+'}] },
] };
test('component focus highlights all remote terminals on its nets, without crossing other parts', () => {
  const focus = connectionFocus(circuit, {kind:'component',id:'Display'});
  assert.deepEqual([...focus.nets],['a']);
  assert.deepEqual([...focus.refs],['MCU','Display','R4']);
  assert.equal(focus.pins.has(graphPinId('R4','2')),false);
  assert.equal(focus.refs.has('Sensor'),false);
});
test('pin and net focus preserve exact memberships including opaque identifiers', () => {
  const focus = connectionFocus(circuit,{kind:'pin',id:graphPinId('MCU','4'),ref:'MCU',pin:'4'});
  assert.deepEqual([...focus.nets],['b']);
  assert.deepEqual([...connectionFocus(circuit,{kind:'net',id:'c'}).refs],['R4','Supply']);
});
test('unconnected terminal remains focusable without inventing wires', () => {
  const focus=connectionFocus(circuit,{kind:'pin',id:graphPinId('Display','GND'),ref:'Display',pin:'GND'});
  assert.equal(focus.nets.size,0);
  assert.deepEqual([...focus.refs],['Display']);
  assert.deepEqual([...focus.pins],[graphPinId('Display','GND')]);
});
