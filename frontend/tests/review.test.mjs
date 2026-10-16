import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewRequest } from '../src/review.ts';
const data = id => ({ source: 'falkordb', circuit_id: id, scope: 'connectivity_only', findings: [] });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });

test('rerun and circuit-close ignore outdated reviews, including requests that ignore cancellation', async t => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => pending.push({url,options,resolve})));
  const request = new ReviewRequest();
  const states = [];
  const old = request.run('old', state => states.push(state));
  const next = request.run('new', state => states.push(state));
  assert.equal(pending[0].options.signal.aborted, true);
  assert.equal(pending[1].options.method, 'POST');
  pending[1].resolve(response(data('new')));
  await next;
  pending[0].resolve(response(data('old')));
  await old;
  assert.deepEqual(states.map(s => s.status), ['loading', 'loading', 'success']);
  assert.equal(states.at(-1).result.circuit_id, 'new');
  const closing = request.run('new', state => states.push(state));
  request.cancel();
  pending[2].resolve(response(data('new')));
  await closing;
  assert.equal(states.at(-1).status, 'loading');
});

test('failed review and wrong-circuit response cannot appear as a clean result; retry succeeds', async t => {
  const replies = [response({detail:'Database unavailable'},503), response(data('wrong')), response(data('current'))];
  t.mock.method(globalThis, 'fetch', async () => replies.shift());
  const request = new ReviewRequest();
  const states = [];
  for(let i=0;i<3;i++) await request.run('current', state => states.push(state));
  assert.deepEqual(states.map(s => s.status), ['loading','error','loading','error','loading','success']);
  assert.equal(states[1].message, 'Database unavailable');
});
