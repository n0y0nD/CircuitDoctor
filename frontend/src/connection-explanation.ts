import { escapeHtml as esc } from './types.ts';
import type { Explanation } from './explanation.ts';

export interface ExplainedPin {
  ref: string;
  pin: string;
  name: string;
  pinfunction: string;
  component_value: string;
}
export interface ExplainedNet {
  code: string;
  name: string;
  status: string;
  pins: ExplainedPin[];
}
const known = (value: string) => value && value !== 'unknown';
const pinLabel = (pin: ExplainedPin) => {
  const name = known(pin.name) ? pin.name : known(pin.pinfunction) ? pin.pinfunction : `Pin ${pin.pin}`;
  return name === '3V3' || name === '+3V3' ? '3.3V' : name;
};
const componentLabel = (pin: ExplainedPin) => {
  if (pin.component_value === 'Arduino_UNO_R3') return `Arduino Uno R3 (${pin.ref})`;
  if (pin.component_value === 'Arduino_Nano_v3.x') return `Arduino Nano (${pin.ref})`;
  return pin.ref;
};
const endpoint = (pin: ExplainedPin) => `${componentLabel(pin)} · ${pinLabel(pin)}`;

// Render fresh graph facts, never infer voltage compatibility or power direction.
export function renderConnectionExplanation(result: Explanation): string {
  if (!result.nets) return `<p class="explanation-summary">${esc(result.summary)}</p>`;
  const group = (pins: ExplainedPin[], title: string, description: string) => `
    <section class="connection-answer">
      <h4>${esc(title)}</h4>
      <p class="connection-answer-text">${esc(description)}</p>
      <ul class="connection-endpoints">${pins.map(pin => `<li><strong>${esc(pinLabel(pin))}</strong><span>${esc(componentLabel(pin))}</span>${known(pin.component_value) && componentLabel(pin) === pin.ref ? `<small>${esc(pin.component_value.replaceAll('_', ' '))}</small>` : ''}</li>`).join('')}</ul>
    </section>`;
  const groups = result.nets.map(net => {
    // Put the pin the user asked about first, without suggesting current direction.
    const pins = [...net.pins].sort((a, b) => Number(b.ref === result.selected_pin?.ref && b.pin === result.selected_pin?.pin) - Number(a.ref === result.selected_pin?.ref && a.pin === result.selected_pin?.pin));
    if (!pins.length) return group([], 'No pins on this connection', 'This wire has no pins attached in the saved file.');
    if (net.status === 'marked_unused') return group(pins, 'Marked unused', 'These pins are marked unused in your file.');
    if (pins.length === 1) return group(pins, 'No other pin connected', `${endpoint(pins[0])} has no connection to another pin. Check whether your design needs it.`);
    return group(pins, 'Connected together', pins.length === 2
      ? `${endpoint(pins[0])} is connected to ${endpoint(pins[1])}.`
      : `These ${pins.length} pins are all joined by the same connection.`);
  }).join('');
  const unassigned = !result.nets.length && result.selected_pin
    ? group([result.selected_pin], 'No connection recorded', `${endpoint(result.selected_pin)} has no connection recorded in this file. Check whether your design needs it.`) : '';
  const detailPins = result.nets.length ? result.nets.flatMap(net => net.pins) : result.selected_pin ? [result.selected_pin] : [];
  const uniquePins = [...new Map(detailPins.map(pin => [JSON.stringify([pin.ref, pin.pin]), pin])).values()];
  return `${groups}${unassigned}<details class="connection-file-details"><summary>Pin numbers &amp; file details</summary>
    ${result.nets.map(net => `<p><b>Wire:</b> ${esc(net.name)} <small>(ID ${esc(net.code)})</small></p>`).join('')}
    ${uniquePins.map(pin => `<p>${esc(endpoint(pin))} — exported pin ${esc(pin.pin)}</p>`).join('')}
    <p>Shows connections from the file; component compatibility is not checked here.</p></details>`;
}
