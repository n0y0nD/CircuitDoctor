import assert from 'node:assert/strict';
import test from 'node:test';
import { formatChatAnswer } from '../src/chat-format.ts';

test('renders model emphasis, pin names and evidence without raw formatting markers', () => {
  assert.equal(formatChatAnswer('Check **D5** and `A1` [E1].\n\n- **GND** is connected.\n- Check *pin mode*.'),
    '<p>Check <strong>D5</strong> and <code>A1</code> [E1].</p><ul><li><strong>GND</strong> is connected.</li><li>Check <em>pin mode</em>.</li></ul>');
});
test('escapes HTML including within formatting and never creates model-provided links', () => {
  const rendered = formatChatAnswer('**<img src=x onerror=alert(1)>**\n\n`</code><script>x</script>`\n\n[x](javascript:alert(1)) & 3V3 < 5V');
  assert.doesNotMatch(rendered, /<(?:img|script|a)[\s>]/);
  assert.match(rendered, /&lt;img/);
  assert.match(rendered, /&amp; 3V3 &lt; 5V/);
});
test('preserves plain text and electrical notation, groups lists and handles CRLF', () => {
  assert.equal(formatChatAnswer('V = I * R + I * R\r\nCheck A_B.\r\n\r\n1. Check GND [E1].\r\n2. Check VCC.\r\n   Then retry.\r\n\r\nDone.'),
    '<p>V = I * R + I * R<br>Check A_B.</p><ol><li>Check GND [E1].</li><li>Check VCC. Then retry.</li></ol><p>Done.</p>');
});
