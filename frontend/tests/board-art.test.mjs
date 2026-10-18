import assert from 'node:assert/strict';
import test from 'node:test';
import { boardDrawing } from '../src/board-art.ts';

function fixture(part = 'Arduino_UNO_R3') {
  const component = { ref: 'CUSTOM1', value: part, libsource: { lib: 'MCU_Module', part } };
  const circuit = {
    components: [component],
    libparts: [{ ...component.libsource, pins: [
      { num: '007', name: 'D13' }, { num: '6', name: 'GND' }, { num: '7', name: 'GND' }, { num: '9', name: 'A0' },
    ] }],
    nets: [
      { code: '1', name: 'drive', nodes: [{ ref: component.ref, pin: '007', pinfunction: 'D13', pintype: 'output' }, { ref: 'LOAD', pin: '1', pinfunction: 'IN', pintype: 'input' }] },
      { code: '2', name: 'return', nodes: ['6','7'].map(pin => ({ ref: component.ref, pin, pinfunction: 'GND', pintype: 'power_in' })) },
      { code: '3', name: 'unused', nodes: [{ ref: component.ref, pin: '9', pinfunction: 'A0', pintype: 'input+no_connect' }] },
    ],
  };
  return { component, circuit };
}

test('compact view keeps requested exported pins and full view keeps every pin', () => {
  for (const part of ['Arduino_UNO_R3', 'Arduino_Nano_v3.x']) {
    const {component,circuit} = fixture(part);
    const compact=boardDrawing(circuit,component,new Set(['007','6']));
    assert.deepEqual([...compact.ports.keys()].sort(),['007','6']);
    assert.equal(compact.ports.get('007').label,'D13');
    assert.equal(compact.ports.get('6').label,'GND');
    assert.equal(compact.ports.get('007').side,'top');
    assert.equal(boardDrawing(circuit,component).ports.size,4);
    assert.equal(boardDrawing(circuit,component,new Set()).ports.size,0);
  }
});

test('uses exported pin IDs instead of assuming D13 is pin 13 or 28', () => {
  const { component, circuit } = fixture();
  const board = boardDrawing(circuit, component);
  assert.equal(board.ports.get('007').label, 'D13');
  assert.equal(board.ports.get('007').connected, true);
  assert.equal(board.ports.has('13'), false);
  assert.equal(board.ports.has('28'), false);
  const socket = board.ports.get('007');
  const svg = decodeURIComponent(board.image.split(',')[1]);
  assert.ok(svg.includes(`cx="${socket.x}" cy="${socket.y}"`));
});

test('separate ground terminals have distinct socket positions; unused pins are not highlighted', () => {
  for (const part of ['Arduino_UNO_R3', 'Arduino_Nano_v3.x']) {
    const { component, circuit } = fixture(part);
    const board = boardDrawing(circuit, component);
    assert.notDeepEqual([board.ports.get('6').x,board.ports.get('6').y], [board.ports.get('7').x,board.ports.get('7').y]);
    assert.equal(board.ports.get('9').connected, false);
    assert.equal(board.ports.size, 4);
  }
});

test('missing library metadata retains actual exported pins without inventing Arduino ports', () => {
  const { component, circuit } = fixture();
  circuit.libparts = [];
  circuit.nets[0].nodes[0].pinfunction = 'unknown';
  const board = boardDrawing(circuit, component);
  assert.equal(board.ports.get('007').label, 'Pin 007');
  assert.equal(board.ports.size, 4);
});

 test('a lone Arduino pin is not colored as a connected socket', () => {
  const { component, circuit } = fixture();
  circuit.nets[0].nodes.pop();
  assert.equal(boardDrawing(circuit, component).ports.get('007').connected, false);
});

 test('unspecified Nano uses imported labels without asserting Classic Nano specifications', async () => {
  const { componentKind, boardLabel } = await import('../src/types.ts');
  const { component, circuit } = fixture('Arduino_Nano');
  circuit.libparts = [];
  circuit.nets[0].nodes[0].pin = '16';
  const board = boardDrawing(circuit, component);
  const svg = decodeURIComponent(board.image.split(',')[1]);
  assert.equal(componentKind(component), 'board');
  assert.equal(boardLabel(component), 'Arduino Nano (version unspecified)');
  assert.equal(board.ports.get('16').label, 'D13');
  assert.equal(board.ports.size, 4);
  assert.ok(svg.includes('>NANO<'));
  assert.ok(!svg.includes('CLASSIC NANO'));
  assert.ok(!svg.includes('ATmega328P'));
  assert.equal(componentKind({ ...component, libsource: { lib: 'Custom', part: 'Arduino_Nano' } }), 'component');
  assert.equal(componentKind({ ...component, libsource: { lib: 'MCU_Module', part: 'Arduino_Nano_Every' } }), 'component');
});

 test('visible pin filtering preserves socket positions and Uno power exits below', () => {
  const {component,circuit}=fixture();
  const full=boardDrawing(circuit,component);
  const compact=boardDrawing(circuit,component,new Set(['007','7','9']));
  for(const [pin,port] of compact.ports) assert.deepEqual(port,full.ports.get(pin));
  assert.equal(full.ports.get('007').side,'top');
  assert.equal(full.ports.get('9').side,'bottom');
});
 test('unrecognized names get separate exported terminals, not guessed digital pins', () => {
  const {component,circuit}=fixture();
  circuit.libparts[0].pins[0].name='SPECIAL';
  const board=boardDrawing(circuit,component);
  assert.equal(board.ports.get('007').label,'SPECIAL');
  assert.equal(board.ports.get('007').side,'right');
});
