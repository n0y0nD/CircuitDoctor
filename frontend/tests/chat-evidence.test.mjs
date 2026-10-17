import assert from 'node:assert/strict';
import test from 'node:test';
import { renderChatEvidence } from '../src/chat-evidence.ts';

const evidence = { nodes: [], edges: [] };
const item = (tool, result = {}) => ({ id: 'E1', tool, arguments: {}, result: {
  source: 'falkordb', circuit_id: 'private-id', queries: [{ cypher: 'MATCH (n) RETURN n' }], ...result,
} });

test('keeps actionable highlights and source references without exposing backend data', () => {
  const html = renderChatEvidence([
    item('circuit_overview'), item('explain_net', { evidence }),
    item('check_rules', { findings: [{ title: 'U1 ground is disconnected', evidence }] }),
    item('future_internal_tool', { private_payload: 'hidden-data' }),
  ], 2);
  assert.match(html, /Parts and connections/);
  assert.match(html, /\[E1\]/);
  assert.match(html, /data-chat-evidence="2:1"/);
  assert.match(html, /data-chat-evidence="2:2:0"/);
  assert.match(html, /U1 ground is disconnected/);
  assert.doesNotMatch(html, /falkordb|private-id|MATCH|cypher|circuit_overview|explain_net|check_rules|future_internal_tool|hidden-data|<pre>/i);
});
test('escapes uploaded finding titles and handles empty results', () => {
  const html = renderChatEvidence([item('check_rules', { findings: [{ title: '<img src=x onerror=alert(1)>', evidence }] })], 0);
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
  assert.equal(renderChatEvidence([], 0), '');
  assert.match(renderChatEvidence([item('check_rules', { findings: [] })], 0), /available wiring checks/);
});

test('does not flood the answer with unused pins and preserves finding highlight indices', () => {
  const html = renderChatEvidence([item('check_rules', { findings: [
    { title: 'Pin has no connection', rule: 'unassigned_pin', evidence },
    { title: 'Supply conflict', rule: 'power_conflict', evidence },
  ] })], 0);
  assert.doesNotMatch(html, /Pin has no connection/);
  assert.match(html, /Supply conflict/);
  assert.match(html, /data-chat-evidence="0:0:1"/);
});
