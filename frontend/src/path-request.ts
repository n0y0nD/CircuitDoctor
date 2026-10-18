import type { Circuit } from './types.ts';
import type { Explanation } from './explanation.ts';

export interface PathSelection { from_ref: string; from_pin: string; to_ref: string; to_pin: string }
export interface PathResult extends Explanation {
  tool: 'find_path';
  scope: 'wires_and_resistors';
  status: 'found' | 'not_found';
  steps: { kind: 'pin' | 'net'; label: string; ref?: string; pin?: string }[];
  through_components: string[];
  queries: { cypher: string; parameters: Record<string, unknown> }[];
}
export type PathState = { status: 'idle' | 'loading' } | { status: 'success'; result: PathResult } | { status: 'error'; message: string };

// Use the uploaded file's pin identities, never board-label-to-number guesses.
export function pathPins(circuit: Circuit) {
  return circuit.components.flatMap(component => {
    const pins = new Map<string, string>();
    const library = circuit.libparts.find(p => p.lib === component.libsource.lib && p.part === component.libsource.part);
    for (const pin of library?.pins || []) pins.set(pin.num, pin.name);
    for (const net of circuit.nets) for (const pin of net.nodes) {
      if (pin.ref === component.ref && (!pins.has(pin.pin) || ['unknown', '~', ''].includes(pins.get(pin.pin)!)))
        pins.set(pin.pin, pin.pinfunction);
    }
    return [...pins].map(([pin, name]) => ({
      value: JSON.stringify([component.ref, pin]), ref: component.ref, pin,
      name: name && !['unknown', '~'].includes(name) ? name : '',
      label: `${component.ref} · ${component.value.replaceAll('_', ' ')} · ${name && !['unknown', '~'].includes(name) ? name + ' · ' : ''}pin ${pin}`,
    }));
  });
}

export class PathRequest {
  private controller: AbortController | null = null;
  private version = 0;
  cancel() { this.version++; this.controller?.abort(); this.controller = null; }
  async run(circuitId: string, selection: PathSelection, update: (state: PathState) => void) {
    this.cancel();
    const version = this.version;
    this.controller = new AbortController();
    update({ status: 'loading' });
    try {
      const response = await fetch(`/api/circuits/${encodeURIComponent(circuitId)}/path`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selection), signal: this.controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Could not trace this connection. Try again.');
      if (data?.source !== 'falkordb' || data.circuit_id !== circuitId || data.tool !== 'find_path' || data.scope !== 'wires_and_resistors'
        || !['found', 'not_found'].includes(data.status) || !Array.isArray(data.steps) || !data.evidence || typeof data.summary !== 'string')
        throw new Error('The server did not return a route for this circuit.');
      if (version === this.version) update({ status: 'success', result: data });
    } catch (error) {
      if (version === this.version) update({ status: 'error', message: error instanceof TypeError ? 'The local API is unavailable. Start the services and try again.' : error instanceof Error ? error.message : 'Could not trace this connection.' });
    }
  }
}
