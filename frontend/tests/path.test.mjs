import assert from 'node:assert/strict';
import test from 'node:test';
import { PathRequest, pathPins } from '../src/path-request.ts';
import { evidenceMemberships } from '../src/explanation.ts';

const selection = { from_ref: 'BOARDΩ', from_pin: '007', to_ref: 'MODULE9', to_pin: 'VCC' };
const result = id => ({ tool: 'find_path', scope: 'wires_and_resistors', source: 'falkordb', circuit_id: id, status: 'found', summary: 'A route links these pins.', steps: [], evidence: { nodes: [], edges: [], paths: [] } });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('pin choices come from arbitrary uploaded components, including library-only pins and exact IDs', () => {
  const circuit = {
    components: [{ ref: 'BOARDΩ', value: 'Custom_board', libsource: { lib: 'Custom', part: 'Control' } }, { ref: 'MODULE9', value: 'Unknown', libsource: { lib: '', part: '' } }],
    libparts: [{ lib: 'Custom', part: 'Control', pins: [{ num: '007', name: 'D5' }, { num: '008', name: 'D6' }] }],
    nets: [{ nodes: [{ ref: 'BOARDΩ', pin: '007', pinfunction: 'unknown' }, { ref: 'MODULE9', pin: 'VCC', pinfunction: 'Supply' }] }],
  };
  const pins = pathPins(circuit);
  assert.equal(pins.length, 3);
  assert.deepEqual(JSON.parse(pins[0].value), ['BOARDΩ', '007']);
  assert.match(pins[0].label, /D5.*pin 007/);
  assert.match(pins[1].label, /D6/);
  assert.deepEqual(JSON.parse(pins[2].value), ['MODULE9', 'VCC']);
});

test('changing pins or circuit cancels stale route responses even if fetch ignores abort', async t => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => pending.push({ url, options, resolve })));
  const request = new PathRequest();
  const states = [];
  const first = request.run('old', selection, s => states.push(s));
  const next = request.run('new', selection, s => states.push(s));
  assert.equal(pending[0].options.signal.aborted, true);
  assert.equal(pending[1].url, '/api/circuits/new/path');
  assert.deepEqual(JSON.parse(pending[1].options.body), selection);
  pending[1].resolve(response(result('new'))); await next;
  pending[0].resolve(response(result('old'))); await first;
  assert.deepEqual(states.map(s => s.status), ['loading', 'loading', 'success']);
  assert.equal(states.at(-1).result.circuit_id, 'new');
  const closing = request.run('new', selection, s => states.push(s));
  request.cancel(); pending[2].resolve(response(result('new'))); await closing;
  assert.equal(states.at(-1).status, 'loading');
});

test('errors, wrong circuit and wrong tool fail safely, and no-route is a normal result', async t => {
  const replies = [response({ detail: 'Database unavailable' }, 503), response(result('other')), response({ ...result('current'), tool: 'explain_net' }), response({ ...result('current'), status: 'not_found' })];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  const request = new PathRequest(), states = [];
  for (let i = 0; i < 4; i++) await request.run('current', selection, s => states.push(s));
  assert.deepEqual(states.map(s => s.status), ['loading', 'error', 'loading', 'error', 'loading', 'error', 'loading', 'success']);
  assert.equal(states[1].message, 'Database unavailable');
  assert.equal(states.at(-1).result.status, 'not_found');
});

test('route highlighting uses individual pin memberships, not every pin on the route nets', () => {
  const r = result('current');
  r.evidence.edges = [
    { type: 'ON_NET', source: 'p:["BOARDΩ","007"]', target: 'n:01' },
    { type: 'ON_NET', source: 'p:["Z17","LEFT"]', target: 'n:01' },
    { type: 'THROUGH', source: 'p:["Z17","LEFT"]', target: 'p:["Z17","RIGHT"]' },
    { type: 'HAS_PIN', source: 'c:Z17', target: 'p:["Z17","LEFT"]' },
  ];
  const members = evidenceMemberships(r);
  assert.equal(members.size, 2);
  assert.ok(!members.has(JSON.stringify(['p:["BOARDΩ","008"]', 'n:01'])));
});
