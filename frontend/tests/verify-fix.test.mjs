import test from 'node:test';
import assert from 'node:assert/strict';
import { CompareRequest, comparisonHtml, comparisonHeadline, connectionRows, comparisonFromHash, circuitHash } from '../src/verify-fix.ts';
const CID='a'.repeat(32), NEXT='b'.repeat(32);
const file=()=>new File(['content'],'correction.net');
const result=()=>({source:'falkordb',tool:'verify_fix',original_id:CID,corrected_id:NEXT,message:'One warning cleared',summary:{resolved:1,persists:0,new:0,unverified:0,added_connections:1,removed_connections:0},matching:{notes:[],added_components:[],removed_components:[],changed_components:[]},warnings:[],connections:[]});
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});

test('uploads corrected file then compares the two exact IDs',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async (url,opts)=>{calls.push({url,opts});return response(calls.length===1?{circuit_id:NEXT}:result());});
 const states=[];await new CompareRequest().run(CID,file(),s=>states.push(s));
 assert.equal(states.at(-1).status,'success');
 assert.equal(JSON.parse(calls[1].opts.body).corrected_id,NEXT);
 assert.equal(calls[1].url,`/api/circuits/${CID}/compare`);
});
test('switching circuit cancels late upload without starting comparison',async t=>{
 let finish;let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(r=>finish=r);});
 const req=new CompareRequest(),states=[];const work=req.run(CID,file(),s=>states.push(s));
 req.cancel();finish(response({circuit_id:NEXT}));await work;
 assert.equal(calls,1);assert.deepEqual(states.map(s=>s.status),['loading']);
});
test('late compare result cannot overwrite a new selection',async t=>{
 let finish;t.mock.method(globalThis,'fetch',async url=>url.includes('?filename')?response({circuit_id:NEXT}):new Promise(r=>finish=r));
 const req=new CompareRequest(),states=[];const work=req.run(CID,file(),s=>states.push(s));
 while(!finish) await new Promise(r=>setImmediate(r));
 req.cancel();finish(response(result()));await work;
 assert.deepEqual(states.map(s=>s.status),['loading']);
});
test('wrong-circuit result and backend failures never report success',async t=>{
 for(const bad of [response({...result(),corrected_id:CID}),response({detail:'offline'},503)]){
 let count=0;t.mock.method(globalThis,'fetch',async()=>++count===1?response({circuit_id:NEXT}):bad);
 const states=[];await new CompareRequest().run(CID,file(),s=>states.push(s));assert.equal(states.at(-1).status,'error');t.mock.restoreAll();
 }
});
test('invalid files do not upload',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;});
 const states=[];await new CompareRequest().run(CID,new File(['x'],'bad.png'),s=>states.push(s));
 assert.equal(calls,0);assert.equal(states.at(-1).status,'error');
});
test('results escape uploaded labels and expose readable evidence controls only',()=>{
 const r=result();r.message='<img src=x onerror=alert(1)>';
 r.warnings=[{status:'unverified',title:'<script>bad</script>',reason:'Metadata changed',before:{nodes:[],edges:[],paths:[]},after:{nodes:[],edges:[],paths:[]}}];
 r.queries={cypher:'MATCH private data'};
 const html=comparisonHtml(r);
 assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('MATCH private'));
 assert.ok(html.includes('Needs a closer look'));assert.ok(html.includes('data-side="before"'));
});

test('plain result headline never calls unknown or remaining issues fixed',()=>{
 const r=result();
 assert.equal(comparisonHeadline(r),'1 wiring issue fixed in this file');
 r.summary.persists=1;
 assert.equal(comparisonHeadline(r),'1 wiring issue still needs attention');
 r.summary.unverified=1;
 assert.equal(comparisonHeadline(r),'Some changes need a closer look');
 r.summary={resolved:0,persists:0,new:0,unverified:0};
 assert.equal(comparisonHeadline(r),'No earlier warnings to compare');
});
test('readable updated wiring follows shared-wire evidence only',()=>{
 const r=result();
 r.warnings=[{status:'resolved',title:'Ground missing',reason:'',before:null,after:{
 nodes:[{id:'p1',kind:'pin',ref:'X',pin:'1',name:'GND'},{id:'p2',kind:'pin',ref:'Y',pin:'7',name:'GND_7'},{id:'p3',kind:'pin',ref:'Z',pin:'9',name:'VCC'}],
 edges:[{source:'p1',target:'n1',type:'ON_NET'},{source:'p2',target:'n1',type:'ON_NET'},{source:'p3',target:'n2',type:'ON_NET'}],paths:[]}}];
 const html=comparisonHtml(r);
 assert.ok(html.includes('X GND ↔ Y GND'));
 assert.ok(!html.includes('Z VCC'));
 assert.ok(!html.includes('0 unverified'));
 assert.ok(html.includes('Show updated wiring'));
});

test('wire comparison aligns splits and merges by exact pins, not array order',()=>{
 const group=(status,pins)=>({status,pins:pins.map(([ref,pin])=>({ref,pin,name:'GND',pinfunction:'GND'})),evidence:{nodes:[],edges:[],paths:[]}});
 const r=result();
 r.connections=[group('removed',[['A','1'],['B','1'],['C','1']]),group('removed',[['X','1'],['Y','1']]),group('added',[['A','1'],['B','1']]),group('added',[['C','1'],['D','1']]),group('added',[['Q','1'],['Z','1']])];
 assert.deepEqual(connectionRows(r.connections),[[0,2,3],[1],[4]]);
 const html=comparisonHtml(r);
 assert.ok(html.includes('<th scope="col">Earlier file</th><th scope="col">Updated file</th>'));
 assert.ok(html.includes('data-compare-connection="3" data-side="after"'));
 assert.ok(html.includes('data-compare-connection="1" data-side="before"'));
 assert.ok(html.includes('This connection was not present.'));
});


test('comparison URL restores either viewed version and ignores unrelated or invalid IDs', () => {
 const pair={original_id:CID,corrected_id:NEXT};
 for (const current of [CID,NEXT]) assert.deepEqual(comparisonFromHash(circuitHash(current,pair)),pair);
 assert.equal(comparisonFromHash(circuitHash('c'.repeat(32),pair)),null);
 assert.equal(comparisonFromHash(`#circuit=${CID}&earlier=${CID}&updated=${CID}`),null);
 assert.equal(comparisonFromHash(`#circuit=${CID}&earlier=${CID}&updated=bad`),null);
 assert.equal(comparisonFromHash(circuitHash(CID,null)),null);
});
test('reload fetches saved updated file and reruns comparison without uploading', async t => {
 const calls=[];
 t.mock.method(globalThis,'fetch',async (url,opts)=>{
  calls.push({url,opts}); return response(calls.length===1?{storage:{source:'falkordb',circuit_id:NEXT,filename:'saved.net'}}:result());
 });
 const states=[]; await new CompareRequest().run(CID,NEXT,s=>states.push(s));
 assert.equal(states.at(-1).status,'success');
 assert.equal(states.at(-1).filename,'saved.net');
 assert.equal(calls[0].url,`/api/circuits/${NEXT}`);
 assert.equal(calls[0].opts.method,undefined);
 assert.equal(calls[1].url,`/api/circuits/${CID}/compare`);
 assert.equal(JSON.parse(calls[1].opts.body).corrected_id,NEXT);
});
test('missing or mismatched saved file cannot restore a stale comparison', async t => {
 for (const bad of [response({detail:'Stored circuit not found.'},404),response({storage:{source:'falkordb',circuit_id:CID}})]) {
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return bad;});
  const states=[];await new CompareRequest().run(CID,NEXT,s=>states.push(s));
  assert.equal(states.at(-1).status,'error');assert.equal(calls,1);t.mock.restoreAll();
 }
});
test('new upload cancels a pending saved comparison restoration', async t => {
 let finish;let calls=0;t.mock.method(globalThis,'fetch',()=>{calls++;return new Promise(r=>finish=r);});
 const req=new CompareRequest(),states=[];const work=req.run(CID,NEXT,s=>states.push(s));
 req.cancel();finish(response({storage:{source:'falkordb',circuit_id:NEXT,filename:'saved.net'}}));await work;
 assert.equal(calls,1);assert.deepEqual(states.map(s=>s.status),['loading']);
});
