import assert from 'node:assert/strict';
import test from 'node:test';
import { resistorBands, resistorBody } from '../src/resistor-art.ts';

test('resistance notation produces exact value bands',()=>{
  for(const value of ['4.7k','4K7','4700','4.7 kΩ'])
    assert.deepEqual(resistorBands(value),['#edc73d','#82539c','#c43128']);
  assert.deepEqual(resistorBands('220'),['#c43128','#c43128','#78442d']);
  assert.deepEqual(resistorBands('1M'),['#78442d','#252426','#347a49']);
  assert.deepEqual(resistorBands('2R2'),['#c43128','#c43128','#bf9b44']);
  assert.deepEqual(resistorBands('0R'),['#252426']);
  assert.deepEqual(resistorBands('1.01k'),['#78442d','#252426','#78442d','#78442d']);
});

test('ambiguous and unsupported values never get rounded or invented bands',()=>{
  for(const value of ['R','unknown','10m','-10','1k / 2k','1234','0.001','<script>'])
    assert.deepEqual(resistorBands(value),[]);
});

test('tolerance is explicit and imported text stays escaped',()=>{
  assert.ok(!resistorBody('4.7k').includes('x="134"'));
  assert.ok(resistorBody('4.7k','±5%').includes('x="134"'));
  assert.ok(!resistorBody('4.7k','unknown').includes('x="134"'));
  const image=resistorBody('<img src=x>');
  assert.ok(image.includes('&lt;img src=x&gt;'));
  assert.ok(!image.includes('<img'));
});
