import assert from 'node:assert/strict';
import test from 'node:test';
import { basedOn, evidencePinIds, linkPins, pinLabels } from '../src/chat-pins.ts';
import { formatChatAnswer } from '../src/chat-format.ts';

const circuit = {
  components: [{ ref: 'A7', value: 'Arduino_UNO_R3', libsource: { lib: 'MCU_Module', part: 'Arduino_UNO_R3' } }, { ref: 'R12', value: '1k', libsource: { lib: 'Device', part: 'R' } }],
  libparts: [{ lib: 'MCU_Module', part: 'Arduino_UNO_R3', pins: [{ num: '5', name: '+5V' }, { num: '29', name: 'GND' }, { num: '6', name: 'GND' }, { num: '16', name: 'D13' }] },
    { lib: 'Device', part: 'R', pins: [{ num: '1', name: '~' }] }],
  nets: [],
};
const pin = (ref, p) => ({ id: `p:${JSON.stringify([ref, p])}`, kind: 'pin' });
const item = (tool, nodes) => ({ id: 'E1', tool, arguments: {}, result: { source: 'falkordb', circuit_id: 'c', evidence: { nodes, edges: [], paths: [] } } });

test('chips come only from pins in the answer evidence', () => {
  const items = [item('check_rules', [pin('A7', '5'), pin('A7', '29'), pin('A7', '6'), pin('R12', '1')])];
  const labels = pinLabels(circuit, evidencePinIds(items));
  assert.deepEqual([...labels.keys()], ['5V', 'GND']);
  const html = linkPins(formatChatAnswer('Your +5V pin and two GND pins share a wire. D13 is fine.'), labels);
  assert.match(html, /<button type="button" class="pc"[^>]*data-chip="5V">\+5V<\/button>/);
  assert.equal((html.match(/data-chip="GND"/g) || []).length, 1);
  assert.match(html, /&quot;p:\[\\&quot;A7\\&quot;,\\&quot;29\\&quot;\]&quot;/);
  assert.doesNotMatch(html, /data-chip="D13"/, 'D13 is not in the evidence');
  assert.equal(basedOn(items), 'wiring check');
});

test('names inside other words, tags or escaped text are left alone', () => {
  const labels = new Map([['GND', ['p:x']], ['5V', ['p:y']]]);
  assert.equal(linkPins('<p>GNDA 15V <code>x</code></p>', labels), '<p>GNDA 15V <code>x</code></p>');
  assert.equal(linkPins('<p>a&lt;b</p>', new Map([['lt', ['p:z']]])), '<p>a&lt;b</p>');
  assert.equal(basedOn([item('find_path', []), item('check_rules', []), item('find_path', [])]), 'path trace · wiring check');
});
