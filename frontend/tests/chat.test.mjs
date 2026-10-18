import assert from 'node:assert/strict';
import test from 'node:test';
import { ChatRequest } from '../src/chat.ts';
const result = id => ({provider:'gemini', circuit_id:id, answer:'Connected.', evidence:[]});
const response = (data, status=200) => new Response(JSON.stringify(data), {status});

test('switching circuits discards late answers and cancels requests', async t => {
  const pending = [];
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => pending.push({url, options, resolve})));
  const request = new ChatRequest(), states = [];
  const old = request.run('old','question',[],s=>states.push(s));
  const fresh = request.run('new','question',[],s=>states.push(s));
  assert.equal(pending[0].options.signal.aborted,true);
  pending[1].resolve(response(result('new'))); await fresh;
  pending[0].resolve(response(result('old'))); await old;
  assert.deepEqual(states.map(s=>s.status),['loading','loading','success']);
  assert.equal(states.at(-1).result.circuit_id,'new');
});

test('quota errors and wrong-circuit evidence never appear as answers', async t => {
  const bad = {...result('current'), evidence:[{result:{source:'falkordb', circuit_id:'other'}}]};
  const replies = [response({detail:'Quota reached'},429), response(bad), response(result('current'))];
  t.mock.method(globalThis,'fetch',async()=>replies.shift());
  const request = new ChatRequest(), states = [];
  for (let i=0;i<3;i++) await request.run('current','hi',[],s=>states.push(s));
  assert.deepEqual(states.map(s=>s.status),['loading','error','loading','error','loading','success']);
  assert.equal(states[1].message,'Quota reached');
});

test('history is bounded and clear-chat ignores even an uncancellable completion', async t => {
  let finish, options;
  t.mock.method(globalThis,'fetch',(_url,opts)=>{options=opts; return new Promise(resolve=>finish=resolve);});
  const request = new ChatRequest(), states = [];
  const running = request.run('current','hi',Array.from({length:12},()=>({role:'user',content:'x'})),s=>states.push(s));
  assert.equal(JSON.parse(options.body).history.length,8);
  request.cancel(); finish(response(result('current'))); await running;
  assert.deepEqual(states.map(s=>s.status),['loading']);
});

test('comparison sends only selected IDs and rejects a mismatched revision pair',async t=>{
 const pair={original_id:'earlier',corrected_id:'updated'};
 let sent;
 const replies=[{...result('earlier'),comparison:pair},{...result('earlier'),comparison:{...pair,corrected_id:'other'}}];
 t.mock.method(globalThis,'fetch',async (_url,opts)=>{sent=JSON.parse(opts.body);return response(replies.shift());});
 const states=[];const request=new ChatRequest();
 await request.run('earlier','What changed?',[],s=>states.push(s),pair);
 assert.deepEqual(sent.comparison,pair);
 assert.equal(states.at(-1).status,'success');
 await request.run('earlier','What changed?',[],s=>states.push(s),pair);
 assert.equal(states.at(-1).status,'error');
});
