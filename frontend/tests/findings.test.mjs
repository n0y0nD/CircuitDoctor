import assert from 'node:assert/strict';
import test from 'node:test';
import { checkLines, faultEnds, faultLabel, friendlyFinding, groupFindings, boardRecognized, evidencePinCount } from '../src/findings.ts';
import { meterHtml, reviewReading, traceReading } from '../src/meter.ts';

const pin = (ref, pin) => ({ id: `p:${JSON.stringify([ref, pin])}`, kind: 'pin' });
// Trimmed from a real review of tests/fixtures/kicad/uno_short.net.
const short = {
  id: 'finding-1', rule: 'power_ground_short', severity: 'warning',
  title: 'Power rail directly connected to ground',
  message: 'A known board power rail and ground share the same net.',
  suggestion: 'Separate the power rail from ground in the schematic before powering the circuit.',
  selection: { net_code: '2' },
  evidence: { nodes: [{ id: 'n:2', kind: 'net' }, pin('A7', '29'), pin('A7', '5'), pin('A7', '6'), pin('A7', '7'), pin('J9', '2'), pin('R12', '1')], edges: [], paths: [] },
  specifications: [
    { ref: 'A7', pin: '5', name: '+5V', nominal_voltage: 5, role: 'rail' },
    { ref: 'A7', pin: '29', name: 'GND', nominal_voltage: 0, role: 'ground' },
    { ref: 'A7', pin: '6', name: 'GND', nominal_voltage: 0, role: 'ground' },
  ],
};
const review = (findings, extra = {}) => ({
  source: 'falkordb', circuit_id: 'x', scope: 'connectivity_and_board_rails', status: findings.some(f => f.severity === 'warning') ? 'warnings' : 'no_warnings',
  electrical: { recognized_parts: [{ ref: 'A7', name: 'Arduino Uno R3', sources: [] }], unknown_components: [], matched_power_pins: 4, checked_nets: 1, checks: [], conflicting_pin_metadata: [] },
  requirements: { recognized_parts: [], checked_pins: 0, connected_pins: 0, missing_pins: 0, unverified_pins: [], skipped_pins: [] },
  voltage: { checked_parts: 0, unverified_parts: 0, unknown_components: [], checks: [] },
  i2c: { checked_pins: 0, unverified_pins: 0, scope: '', checks: [] },
  isolation: { algorithm: 'algo.WCC', group_count: 1, separate_groups: 0, board_refs: ['A7'], scope: '' },
  summary: {}, findings, cannot_verify: [], ...extra,
});

test('the red probe takes the first rail pin and the black probe the first ground pin', () => {
  const [red, black] = faultEnds(short);
  assert.deepEqual([red.pin, black.pin], ['5', '29']);
  assert.equal(faultLabel(short), '5V ↔ GND');
});

test('short copy is friendlier but never names a pin to move', () => {
  const copy = friendlyFinding(short);
  assert.equal(copy.title, 'Your 5V pin is connected to GND.');
  assert.match(copy.todo, /separate the 5V wire from GND/);
  assert.doesNotMatch(Object.values(copy).join(' '), /\bmove\b/i);
  const other = { ...short, rule: 'i2c_signal_mismatch', title: 'SDA and SCL are swapped', specifications: [] };
  assert.deepEqual(friendlyFinding(other), { title: other.title, consequence: other.message, todo: other.suggestion });
});

test('only checks that ran are counted, and the failing one is not counted as passed', () => {
  const lines = checkLines(review([short]));
  assert.deepEqual(lines.map(l => [l.label, l.status]), [
    ['Power shorted to ground', 'problem'], ['Two different voltages joined', 'passed'], ['Parts cut off in separate groups', 'passed'],
  ]);
  const noBoard = review([], { electrical: { ...review([]).electrical, recognized_parts: [] } });
  assert.equal(boardRecognized(noBoard), false);
  assert.deepEqual(checkLines(noBoard).map(l => l.label), ['Parts cut off in separate groups']);
});

test('findings are grouped into problems, notes and unconnected pins', () => {
  const note = { ...short, id: 'n', rule: 'isolated_group', severity: 'info' };
  const loose = { ...short, id: 'u', rule: 'single_pin_net', severity: 'info' };
  const groups = groupFindings(review([short, note, loose]));
  assert.deepEqual([groups.problems, groups.notes, groups.unconnected].map(g => g.map(f => f.id)), [['finding-1'], ['n'], ['u']]);
  assert.equal(evidencePinCount(short), 6);
});

test('the meter shows words, never a measured value', () => {
  const states = [
    { status: 'loading' },
    { status: 'success', result: review([short]) },
    { status: 'success', result: review([short, { ...short, id: '2' }, { ...short, id: '3', rule: 'i2c_signal_mismatch', specifications: [] }]) },
    { status: 'success', result: review([]) },
    { status: 'success', result: review([], { electrical: { ...review([]).electrical, recognized_parts: [] } }) },
  ];
  const readings = states.map(reviewReading);
  assert.deepEqual(readings.map(r => r.flag), ['AUTO', 'SHORT', '3 PROBLEMS', 'PASS', 'INFO']);
  assert.equal(readings[0].text, '----');
  assert.equal(readings[3].text, 'no wiring problems');
  assert.equal(readings[4].text, 'board not recognized');
  const html = [...readings, traceReading(2, '5V', 'R12·1')].map(meterHtml).join('');
  assert.doesNotMatch(html, /Ω|\bOL\b|\d+\.\d/);
  assert.equal(reviewReading({ status: 'idle' }), null);
  assert.match(meterHtml(traceReading(2, '5V', 'R12·1')), /TRACE.*2 steps.*5V → R12·1/);
});
