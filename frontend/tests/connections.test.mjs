import assert from 'node:assert/strict';
import test from 'node:test';
import { visibleNets, connectionLabel } from '../src/types.ts';

const pin = (ref, number, name, type = 'passive') => ({ref, pin: number, pinfunction: name, pintype: type});
const circuit = {components: [], libparts: [], nets: [
  {code:'01', name:'unconnected-misleading-name', nodes:[pin('BOARD','27','D12'), pin('DISPLAY','4','RS')]},
  {code:'02', name:'signal', nodes:[pin('DISPLAY','7','DB0')]},
  {code:'03', name:'unused', nodes:[pin('BOARD','3','RESET','input+no_connect')]},
  {code:'04', name:'empty', nodes:[]},
]};

test('default wiring view hides lone pins by connectivity, never by wire name; toggle restores all data', () => {
  assert.deepEqual(visibleNets(circuit, false).map(n => n.code), ['01']);
  assert.equal(visibleNets(circuit, true).length, 4);
  assert.equal(circuit.nets.length, 4);
  assert.equal(connectionLabel(circuit, circuit.nets[0]), 'BOARD · D12 ↔ DISPLAY · RS');
});
test('inspecting a hidden pin reveals its exact connection without bringing every loose wire back', () => {
  assert.deepEqual(visibleNets(circuit, false, {kind:'net',id:'02'}).map(n => n.code), ['01','02']);
  assert.deepEqual(visibleNets(circuit, false, {kind:'pin',ref:'DISPLAY',pin:'7'}).map(n => n.code), ['01','02']);
});

test('repeated pin names keep their distinct exported terminal IDs', () => {
  const duplicateGrounds = {...circuit, nets:[
    {code:'a', name:'ground-a', nodes:[pin('BOARD','06','GND')]},
    {code:'b', name:'ground-b', nodes:[pin('BOARD','07','GND')]},
  ]};
  assert.equal(connectionLabel(duplicateGrounds, duplicateGrounds.nets[0]), 'BOARD · GND (pin 06)');
  assert.equal(connectionLabel(duplicateGrounds, duplicateGrounds.nets[1]), 'BOARD · GND (pin 07)');
});
