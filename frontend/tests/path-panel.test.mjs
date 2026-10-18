import assert from 'node:assert/strict';
import test from 'node:test';
import { PathPanel } from '../src/path-panel.ts';

test('closing trace cancels a pending request and resets its result and callbacks', async t => {
  let resolve;
  t.mock.method(globalThis, 'fetch', () => new Promise(r => { resolve = r; }));
  const button = { disabled: false, innerHTML: '' };
  const output = { innerHTML: 'old route' };
  const root = { addEventListener() {}, querySelector(selector) {
    return selector === '.path-result' ? output : selector === '[type="submit"]' ? button : { value: 'chosen' };
  } };
  const routes = [], evidence = [], states = [];
  const panel = new PathPanel(root, value => evidence.push(value), value => routes.push(value));
  panel.result = { status: 'found' };
  const pending = panel.request.run('c', {}, state => states.push(state));
  panel.clearRoute();
  resolve(new Response(JSON.stringify({ source: 'falkordb', tool: 'find_path', scope: 'wires_and_resistors', circuit_id: 'c', status: 'found', steps: [] })));
  await pending;
  assert.equal(panel.result, null);
  assert.equal(output.innerHTML, '');
  assert.deepEqual(routes, [null]);
  assert.deepEqual(evidence, [null]);
  assert.deepEqual(states.map(s => s.status), ['loading']);
});
