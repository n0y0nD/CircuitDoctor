import type { Selection } from './types';

export interface Explanation {
  source: 'falkordb';
  tool?: string;
  warnings?: string[];
  sources?: { title: string; url: string }[];
  circuit_id: string;
  summary: string;
  evidence: {
    nodes: { id: string; kind: string }[];
    edges: { source: string; target: string; type: string }[];
    paths: string[][];
  };
  limitations: string[];
}
export type ExplanationState =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; result: Explanation }
  | { status: 'error'; message: string };

export function explanationSelector(selection: Selection) {
  if (selection.kind === 'net') return { net_code: selection.id };
  if (selection.kind === 'pin') return { ref: selection.ref, pin: selection.pin };
  return null;
}

// Ignore old responses even if a server finishes after cancellation.
export class ExplanationRequest {
  private controller: AbortController | null = null;
  private version = 0;
  cancel() {
    this.version++;
    this.controller?.abort();
    this.controller = null;
  }
  async run(circuitId: string, selection: Selection, update: (state: ExplanationState) => void, mode: 'explain' | 'power-trace' = 'explain') {
    this.cancel();
    const selector = explanationSelector(selection);
    if (!selector) return;
    const version = this.version;
    this.controller = new AbortController();
    update({ status: 'loading' });
    try {
      const response = await fetch(`/api/circuits/${encodeURIComponent(circuitId)}/${mode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selector), signal: this.controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Could not explain this connection. Check the local services and try again.');
      if (data?.source !== 'falkordb' || data.circuit_id !== circuitId || !data.evidence || typeof data.summary !== 'string' || (mode === 'power-trace' && (data.tool !== 'trace_power' || data.scope !== 'direct_board_rail')))
        throw new Error('The server did not return connection evidence for this circuit.');
      if (version === this.version) update({ status: 'success', result: data });
    } catch (error) {
      if (version !== this.version) return;
      update({ status: 'error', message: error instanceof TypeError
        ? 'The local API is unavailable. Start the services and try again.'
        : error instanceof Error ? error.message : 'Could not explain this connection.' });
    }
  }
}

// Every rendered wire segment represents one specific Pin → Net membership.
export function evidenceMemberships(result: Pick<Explanation, 'evidence'>) {
  return new Set(result.evidence.edges.filter(edge => edge.type === 'ON_NET')
    .map(edge => JSON.stringify([edge.source, edge.target])));
}
