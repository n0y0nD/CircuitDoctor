import assert from 'node:assert/strict';
import test from 'node:test';
import { renderConnectionExplanation } from '../src/connection-explanation.ts';
const pin = (ref, id, name, value='Module') => ({ref, pin:id, name, pinfunction:'unknown', component_value:value});
const a = pin('A1','004','3V3','Arduino_UNO_R3'), b = pin('U1','02','VCC');
const net = (pins, status='connected', code='01') => ({code, name:'Net-(A1-3V3)', pins, status});
const result = nets => ({nets, selected_pin:a, summary:'technical fallback'});

test('plain explanation uses fresh named endpoints and preserves exact exported pin IDs in details', () => {
  const html = renderConnectionExplanation(result([net([b,a])]));
  assert.match(html, /Arduino Uno R3 \(A1\) · 3.3V is connected to U1 · VCC/);
  const details = html.slice(html.indexOf('<details'));
  assert.match(details, /exported pin 004/);
  assert.match(details, /exported pin 02/);
  assert.ok(!html.slice(0, html.indexOf('<details')).includes('Net-(A1-3V3)'));
  assert.ok(!html.includes('powers U1'));
});
test('shared connections list every endpoint; independent nets remain separate', () => {
  const html = renderConnectionExplanation(result([net([a,b,pin('U2','8','VDD')]),net([pin('U3','7','D0')],'single_pin_net','02')]));
  assert.match(html, /These 3 pins are all joined/);
  assert.match(html, /U2/);
  assert.match(html, /No other pin connected/);
  assert.equal((html.match(/class="connection-answer"/g)||[]).length, 2);
});
test('unused, unassigned and empty connections do not claim a working circuit', () => {
  assert.match(renderConnectionExplanation(result([net([a],'marked_unused')])), /Marked unused/);
  assert.match(renderConnectionExplanation(result([])), /No connection recorded/);
  assert.match(renderConnectionExplanation({...result([net([],'empty_net')]),selected_pin:null}), /No pins on this connection/);
  const unknown = pin('X','007','unknown');
  assert.match(renderConnectionExplanation(result([net([unknown])])), /Pin 007/);
});
test('all uploaded labels are escaped in both visible content and details', () => {
  const p = pin('<img onerror=x>','<007>','<script>alert(1)</script>','<svg onload=x>');
  const n = {...net([p]),name:'<img src=x onerror=x>'};
  const html = renderConnectionExplanation(result([n]));
  assert.ok(!html.includes('<script>') && !html.includes('<img') && !html.includes('<svg'));
  assert.match(html, /&lt;007&gt;/);
});
