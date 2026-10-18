import type { ChatEvidence } from './chat';
import { escapeHtml as esc } from './types.ts';

const labels: Record<string, string> = {
  verify_fix: 'Earlier and updated files',
  circuit_overview: 'Parts and connections',
  check_rules: 'Wiring checks',
  explain_net: 'Connected pins',
  trace_power: 'Power connections',
  find_path: 'Connection route',
};

// Present only information useful for exploring the circuit. Raw responses and
// database queries stay out of the rendered page, including for future tools.
export function renderChatEvidence(items: ChatEvidence[], turn: number, summary = 'Connections behind this answer'): string {
  if (!items.length) return '';
  return `<details class="chat-evidence"><summary>${summary}</summary>${items.map((item, index) => {
    const label = labels[item.tool] || 'Circuit connections';
    const allFindings = item.result.findings || [];
    const findings = allFindings.map((finding, index) => ({ finding, index }))
      .filter(({ finding }) => !['single_pin_net', 'unassigned_pin'].includes(finding.rule || ''));
    const note = item.tool === 'verify_fix'
      ? 'Both files were checked again. Use the comparison panel to see the old and updated wiring.'
      : item.tool === 'circuit_overview'
      ? 'Parts and pin connections from your uploaded file.'
      : item.tool === 'check_rules' && !findings.length
        ? allFindings.length ? 'Unconnected pins are listed under Check your connections.' : 'No findings were reported by the available wiring checks.'
        : !item.result.evidence && !findings.length ? 'No connection to highlight for this part of the answer.' : '';
    return `<div class="chat-evidence-item"><strong>[${esc(item.id)}] ${label}</strong>${note ? `<p>${note}</p>` : ''}${item.result.evidence ? `<button type="button" class="text-button" data-chat-evidence="${turn}:${index}">Show on circuit</button>` : ''}${findings.map(({ finding, index: findingIndex }) => `<button type="button" class="text-button" data-chat-evidence="${turn}:${index}:${findingIndex}">${esc(finding.title)} →</button>`).join('')}</div>`;
  }).join('')}</details>`;
}
