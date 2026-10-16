import assert from 'node:assert/strict';
import test from 'node:test';
import { ExplanationRequest, explanationSelector, evidenceMemberships } from '../src/explanation.ts';

const result = (id) => ({ source: 'falkordb', circuit_id: id, summary: 'Connections from graph', evidence: { nodes: [], edges: [], paths: [] } });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('pin selectors preserve exported IDs, including leading zeros, independently of board labels', () => {
  assert.deepEqual(explanationSelector({ kind: 'pin', ref: 'CUSTOM7', pin: '007', id: 'p:custom' }), { ref: 'CUSTOM7', pin: '007' });
  assert.deepEqual(explanationSelector({ kind: 'net', id: '001' }), { net_code: '001' });
  assert.equal(explanationSelector({ kind: 'component', id: 'A1' }), null);
});

test('switching selection and closing a circuit discard late responses even when fetch ignores abort', async t => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => pending.push({ url, options, resolve })));
  const request = new ExplanationRequest();
  const states = [];
  const first = request.run('old', { kind: 'net', id: '1' }, state => states.push(state));
  const second = request.run('new', { kind: 'pin', id: 'p:x', ref: 'X', pin: '01' }, state => states.push(state));
  assert.equal(pending[0].options.signal.aborted, true);
  assert.deepEqual(JSON.parse(pending[1].options.body), { ref: 'X', pin: '01' });
  pending[1].resolve(response(result('new')));
  await second;
  pending[0].resolve(response(result('old')));
  await first;
  assert.deepEqual(states.map(s => s.status), ['loading', 'loading', 'success']);
  assert.equal(states[2].result.circuit_id, 'new');
  const closing = request.run('new', { kind: 'net', id: '2' }, state => states.push(state));
  request.cancel();
  pending[2].resolve(response(result('new')));
  await closing;
  assert.equal(states.at(-1).status, 'loading');
});

test('unavailable services allow retry; another circuit’s evidence is never accepted', async t => {
  const replies = [response({ detail: 'FalkorDB unavailable' }, 503), response(result('other')), response(result('current'))];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  const request = new ExplanationRequest();
  const states = [];
  for (let i = 0; i < 3; i++) await request.run('current', { kind: 'net', id: '1' }, state => states.push(state));
  assert.deepEqual(states.map(s => s.status), ['loading', 'error', 'loading', 'error', 'loading', 'success']);
  assert.equal(states[1].message, 'FalkorDB unavailable');
  assert.match(states[3].message, /this circuit/);
});

test('highlight memberships distinguish different pins on the same component and different nets', () => {
  const pin = 'p:["CTRL7","01"]';
  const data = result('current');
  data.evidence.edges = [
    { type: 'HAS_PIN', source: 'c:CTRL7', target: pin },
    { type: 'ON_NET', source: pin, target: 'n:007' },
  ];
  const memberships = evidenceMemberships(data);
  assert.equal(memberships.size, 1);
  assert.ok(memberships.has(JSON.stringify([pin, 'n:007'])));
  assert.ok(!memberships.has(JSON.stringify(['p:["CTRL7","02"]', 'n:007'])));
  assert.ok(!memberships.has(JSON.stringify([pin, 'n:008'])));
});

test('power traces use the dedicated endpoint and cannot be replaced by a stale explanation', async t => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => pending.push({ url, options, resolve })));
  const request = new ExplanationRequest();
  const states = [];
  const first = request.run('current', { kind: 'net', id: '007' }, s => states.push(s));
  const next = request.run('current', { kind: 'net', id: '007' }, s => states.push(s), 'power-trace');
  assert.equal(pending[1].url, '/api/circuits/current/power-trace');
  pending[1].resolve(response({ ...result('current'), tool: 'trace_power', scope: 'direct_board_rail' }));
  await next;
  pending[0].resolve(response(result('current')));
  await first;
  assert.equal(states.at(-1).result.tool, 'trace_power');
  assert.equal(states.filter(s => s.status === 'success').length, 1);
});

test('power trace handles unsupported pins, outages, and wrong tool responses', async t => {
  const replies = [response({ detail: 'Select a known power pin' }, 422), response({ detail: 'Database offline' }, 503), response(result('current'))];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  const request = new ExplanationRequest();
  const states = [];
  for (let i = 0; i < 3; i++) await request.run('current', { kind: 'net', id: '007' }, s => states.push(s), 'power-trace');
  assert.deepEqual(states.map(s => s.status), ['loading', 'error', 'loading', 'error', 'loading', 'error']);
  assert.equal(states[1].message, 'Select a known power pin');
});
