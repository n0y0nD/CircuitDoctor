import { escapeHtml as esc } from './types.ts';
import type { Explanation } from './explanation.ts';
type Evidence = Omit<Explanation['evidence'], 'nodes'> & { nodes: (Explanation['evidence']['nodes'][number] & { ref?: string; pin?: string; name?: string; pinfunction?: string })[] };
export interface Comparison {
  source: 'falkordb'; tool: 'verify_fix'; original_id: string; corrected_id: string;
  message: string; summary: Record<string, number>;
  matching: { comparable: boolean; notes: string[]; added_components: string[]; removed_components: string[]; changed_components: string[] };
  warnings: { status: 'resolved' | 'persists' | 'unverified' | 'new'; title: string; reason: string; before: Evidence | null; after: Evidence }[];
  connections: { status: 'added' | 'removed'; pins: {ref: string; pin: string; name: string; pinfunction: string}[]; evidence: Evidence }[];
  truncated: boolean;
}
export type CompareState = { status: 'loading' } | { status: 'success'; result: Comparison; filename: string } | { status: 'error'; message: string };

export class CompareRequest {
  private controller: AbortController | null = null;
  private version = 0;
  cancel() { this.version++; this.controller?.abort(); this.controller = null; }
  async run(original: string, file: File | string, update: (state: CompareState) => void) {
    this.cancel();
    const version = this.version;
    this.controller = new AbortController();
    const signal = this.controller.signal;
    update({ status: 'loading' });
    try {
      if (typeof file === 'string' ? !/^[0-9a-f]{32}$/.test(file) : (!file.name.toLowerCase().endsWith('.net') || file.size > 10 * 1024 * 1024))
        throw new Error('Choose a KiCad .net file up to 10 MiB.');
      const read = async (response: Response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Could not compare these uploads. Try again.');
        return data;
      };
      let receipt: { circuit_id: string }, filename: string;
      if (typeof file === 'string') {
        const saved = await read(await fetch(`/api/circuits/${file}`, { signal }));
        if (saved?.storage?.source !== 'falkordb' || saved.storage.circuit_id !== file)
          throw new Error('The updated file could not be verified.');
        receipt = { circuit_id: file }; filename = saved.storage.filename;
      } else {
        receipt = await read(await fetch(`/api/circuits?filename=${encodeURIComponent(file.name)}`, {
          method: 'POST', headers: {'Content-Type':'application/octet-stream'}, body: file, signal,
        }));
        filename = file.name;
      }
      if (version !== this.version) return;
      if (!/^[0-9a-f]{32}$/.test(receipt?.circuit_id || '')) throw new Error('The corrected upload was not saved correctly.');
      const result = await read(await fetch(`/api/circuits/${encodeURIComponent(original)}/compare`, {
        method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ corrected_id: receipt.circuit_id }), signal,
      }));
      if (result?.source !== 'falkordb' || result.tool !== 'verify_fix' || result.original_id !== original || result.corrected_id !== receipt.circuit_id || !Array.isArray(result.warnings) || !Array.isArray(result.connections))
        throw new Error('The comparison does not match these two uploads.');
      if (version === this.version) update({ status: 'success', result, filename });
    } catch (error) {
      if (version === this.version) update({ status: 'error', message: error instanceof TypeError ? 'The local API is unavailable. Try again when it is running.' : error instanceof Error ? error.message : 'Could not verify the fix.' });
    }
  }
}

export function comparisonHeadline(r: Comparison): string {
  const s = r.summary;
  if (s.unverified) return 'Some changes need a closer look';
  if (s.persists || s.new) return `${s.persists + s.new} wiring issue${s.persists + s.new === 1 ? '' : 's'} still need${s.persists + s.new === 1 ? 's' : ''} attention`;
  if (s.resolved) return `${s.resolved} wiring issue${s.resolved === 1 ? '' : 's'} fixed in this file`;
  return 'No earlier warnings to compare';
}

// Describe only explicit shared wires from the returned evidence, never inferred current flow.
function wiringText(evidence: Evidence): string {
  const pins = new Map(evidence.nodes.filter(n => n.kind === 'pin').map(n => [n.id, n]));
  const nets = new Map<string, string[]>();
  for (const edge of evidence.edges) {
    if (edge.type !== 'ON_NET') continue;
    const pin = pins.get(edge.source);
    if (!pin?.ref || !pin.pin) continue;
    const label = [pin.name, pin.pinfunction].find(n => n && n !== 'unknown' && n !== '~') || `pin ${pin.pin}`;
    const suffix = `_${pin.pin}`;
    const text = `${pin.ref} ${label.endsWith(suffix) ? label.slice(0, -suffix.length) : label}`;
    nets.set(edge.target, [...(nets.get(edge.target) || []), text]);
  }
  const joined = [...nets.values()].filter(p => p.length > 1).slice(0, 3);
  return joined.length ? `<p class="verify-wiring"><strong>Now connected:</strong> ${joined.map(p => p.map(esc).join(' ↔ ')).join('<br>')}</p>` : '';
}

// Align rewired groups by exact shared pins, including a wire split or merge.
// Unrelated additions/removals stay in separate rows rather than implying a match.
export function connectionRows(connections: Comparison['connections']): number[][] {
  const parent = connections.map((_, i) => i);
  const find = (i: number): number => parent[i] === i ? i : (parent[i] = find(parent[i]));
  const owners = new Map<string, number>();
  connections.forEach((connection, i) => connection.pins.forEach(pin => {
    const key = JSON.stringify([pin.ref, pin.pin]);
    const previous = owners.get(key);
    if (previous !== undefined) parent[find(i)] = find(previous);
    owners.set(key, i);
  }));
  const rows = new Map<number, number[]>();
  connections.forEach((_, i) => {
    const key = find(i);
    rows.set(key, [...(rows.get(key) || []), i]);
  });
  return [...rows.values()];
}

export function comparisonHtml(r: Comparison): string {
  const names = { resolved: 'Fixed in file', persists: 'Still needs fixing', unverified: 'Needs a closer look', new: 'New issue' };
  const button = (index: number, side: string, text: string, type='warning') => `<button class="button secondary" data-compare-${type}="${index}" data-side="${side}">${text}</button>`;
  return `<h3 class="verify-message">${esc(comparisonHeadline(r))}</h3>
    ${!r.summary.resolved && !r.summary.persists && !r.summary.new && !r.summary.unverified ? '<p>The earlier file had no warnings from the checks we support. You can still see which wires changed below.</p>' : ''}
    <div class="verify-warnings">${r.warnings.map((w,i) => `<article class="verify-item"><span class="verify-badge ${w.status}">${names[w.status]}</span><h3>${w.status === 'resolved' ? 'Earlier: ' : ''}${esc(w.title)}</h3>
      <p>${w.status === 'resolved' ? 'This warning cleared when we checked your updated file.' : w.status === 'persists' ? 'This connection still needs attention in the updated file.' : w.status === 'unverified' ? 'The warning disappeared, but we could not confirm the repair. Check whether parts or pin labels changed.' : esc(w.reason)}</p>
      ${w.status === 'resolved' ? wiringText(w.after) : ''}
      <div class="verify-actions">${w.before ? button(i,'before','Show old wiring') : ''}${w.after.nodes.length ? button(i,'after','Show updated wiring') : ''}</div></article>`).join('')}</div>
    ${r.matching.notes.length ? `<details class="verify-changes"><summary>Why some changes need checking</summary>${r.matching.notes.map(n => `<p>${esc(n)}</p>`).join('')}</details>` : ''}
    <details class="verify-changes"><summary>See which wires changed</summary>
    ${r.connections.length ? `<div class="verify-table-wrap"><table class="verify-table" aria-label="Wiring changes between files"><thead><tr><th scope="col">Earlier file</th><th scope="col">Updated file</th></tr></thead><tbody>
    ${connectionRows(r.connections).map(row => `<tr>${(['removed', 'added'] as const).map(status => {
      const indexes = row.filter(i => r.connections[i].status === status);
      return `<td>${indexes.length ? indexes.map(i => {
        const c = r.connections[i];
        return `<div class="verify-wire-group"><p>${c.pins.map(p => {
          const label = [p.name,p.pinfunction].find(n => n && n !== 'unknown' && n !== '~');
          return esc(`${p.ref} · ${label || `pin ${p.pin}`}`);
        }).join(' ↔ ')}</p>${button(i,status === 'added' ? 'after' : 'before','Show wires','connection')}</div>`;
      }).join('') : '<p class="verify-empty">This connection was not present.</p>'}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table></div>` : '<p>The wire connections are unchanged.</p>'}</details>
    ${r.truncated ? '<p>Showing the first 100 warnings and connection changes.</p>' : ''}
    <p class="path-scope">These are wiring checks, not a test of the physical circuit.</p>`;
}

// Keep only the saved upload IDs in the URL; always recompute comparison facts.
export function comparisonFromHash(hash: string): { original_id: string; corrected_id: string } | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const current = params.get('circuit'), original = params.get('earlier'), corrected = params.get('updated');
  if (!original || !corrected || !/^[0-9a-f]{32}$/.test(original) || !/^[0-9a-f]{32}$/.test(corrected)
      || original === corrected || (current !== original && current !== corrected)) return null;
  return { original_id: original, corrected_id: corrected };
}
export function circuitHash(id: string, comparison: { original_id: string; corrected_id: string } | null): string {
  const params = new URLSearchParams({ circuit: id });
  if (comparison && [comparison.original_id, comparison.corrected_id].includes(id)) {
    params.set('earlier', comparison.original_id); params.set('updated', comparison.corrected_id);
  }
  return `#${params}`;
}
