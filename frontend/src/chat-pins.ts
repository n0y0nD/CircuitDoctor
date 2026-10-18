import type { ChatEvidence } from './chat.ts';
import { escapeHtml as esc, pinName, type Circuit } from './types.ts';

const labels: Record<string, string> = {
  check_rules: 'wiring check', find_path: 'path trace', explain_net: 'connected pins', trace_power: 'power trace',
  circuit_overview: 'parts list', verify_fix: 'comparing both files',
};
/** "wiring check · path trace": which kinds of evidence an answer used. */
export function basedOn(items: ChatEvidence[]) {
  return [...new Set(items.map(item => labels[item.tool] || 'circuit connections'))].join(' · ');
}

/** Pins returned by the answer's own tool evidence. Chips are only made for these. */
export function evidencePinIds(items: ChatEvidence[]) {
  const ids = new Set<string>();
  for (const item of items) {
    const sets = [item.result.evidence, ...(item.result.findings || []).map(f => f.evidence)];
    for (const evidence of sets) for (const node of evidence?.nodes || []) if (node.kind === 'pin' && node.id.startsWith('p:')) ids.add(node.id);
  }
  return [...ids];
}

export function pinLabels(circuit: Circuit, ids: string[]) {
  const byLabel = new Map<string, string[]>();
  const componentRefs = new Set(circuit.components.map(c => c.ref.toLowerCase()));
  for (const id of ids) {
    try {
      const [ref, pin] = JSON.parse(id.slice(2)) as [string, string];
      const node = circuit.nets.flatMap(net => net.nodes).find(p => p.ref === ref && p.pin === pin)
        || { ref, pin, pinfunction: 'unknown', pintype: 'unknown' };
      const label = pinName(circuit, node).replace(/^\+/, '');
      // Skip names that would match ordinary words or numbers in a sentence.
      if (componentRefs.has(label.toLowerCase()) || label.length < 2 || /^\d+$/.test(label) || /^pin\b/i.test(label) || label === '~') continue;
      byLabel.set(label, [...(byLabel.get(label) || []), id]);
    } catch { /* not a pin id */ }
  }
  for (const [label, pins] of byLabel) {
    if (new Set(pins.map(id => JSON.parse(id.slice(2))[0])).size > 1) byLabel.delete(label);
  }
  return byLabel;
}

const pattern = (label: string) => new RegExp(`(?<![\\w+.·&])\\+?${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'g');

/**
 * Turn pin names in already-escaped answer HTML into chips that highlight those
 * exact pins on the drawing. Only text between tags is touched.
 */
export function linkPins(html: string, byLabel: Map<string, string[]>) {
  if (!byLabel.size) return html;
  const ordered = [...byLabel.keys()].sort((a, b) => b.length - a.length);
  return html.split(/(<[^>]+>)/).map(part => {
    if (part.startsWith('<')) return part;
    // Replace longest names first, without touching chips made in this pass.
    const tokens: string[] = [];
    let text = part;
    for (const label of ordered) {
      text = text.replace(pattern(esc(label)), match => {
        tokens.push(`<button type="button" class="pc" data-chat-pins="${esc(JSON.stringify(byLabel.get(label)))}" data-chip="${esc(label)}">${match}</button>`);
        return `\u0000${tokens.length - 1}\u0000`;
      });
    }
    return text.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
  }).join('');
}
