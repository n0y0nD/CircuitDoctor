import type { Explanation } from './explanation';

export interface Finding {
  rule: string;
  id: string;
  severity: 'warning' | 'info';
  title: string;
  message: string;
  suggestion: string;
  selection: { net_code: string } | { ref: string; pin: string } | { component_refs: string[] };
  evidence: Explanation['evidence'];
  sources?: { title: string; url: string }[];
  specifications?: { ref: string; pin: string; name: string; role?: string; nominal_voltage?: number }[];
}
export interface Review {
  source: 'falkordb';
  circuit_id: string;
  scope: 'connectivity_and_board_rails';
  status: 'incomplete' | 'warnings' | 'no_warnings';
  electrical: { recognized_parts: { ref: string; name: string; sources: { title: string; url: string }[] }[]; unknown_components: string[]; matched_power_pins: number; checked_nets: number; checks: string[]; conflicting_pin_metadata: { ref: string; pin: string }[] };
  requirements?: {
    recognized_parts: { ref: string; name: string; sources: { title: string; url: string }[] }[];
    checked_pins: number; connected_pins: number; missing_pins: number;
    unverified_pins: { ref: string; pin: string; name: string; reason: string }[];
    skipped_pins: { ref: string; pin: string; reason: string }[];
  };
  voltage?: { checked_parts: number; unverified_parts: number; unknown_components: string[]; checks: {
    ref: string; name: string; pin?: string; status: 'within_range' | 'outside_range' | 'unverified';
    nominal_voltage?: number; operating_range?: { min: number; max: number }; reason?: string;
    sources: { title: string; url: string }[];
  }[] };
  i2c?: { checked_pins: number; unverified_pins: number; scope: string; checks: {
    ref: string; pin: string; signal: 'SDA' | 'SCL';
    status: 'connected' | 'mismatch' | 'joined' | 'unconnected' | 'unverified';
    message: string; sources: { title: string; url: string }[];
  }[] };
  pullups?: { external_paths: number; scope: string; checks: {
    ref: string; pin: string; signal: 'SDA' | 'SCL'; status: 'external_path_found' | 'unverified';
    message: string; sources: { title: string; url: string }[];
  }[] };
  isolation?: { algorithm: string; group_count: number; separate_groups: number; board_refs: string[]; scope: string };
  summary: { components: number; nets: number; pins: number; warnings: number; information: number; marked_unused_pins: number; unknown_pin_names: number; unknown_pin_types: number };
  findings: Finding[];
  cannot_verify: { check: string; reason: string }[];
}
export type ReviewState = { status: 'idle' } | { status: 'loading' } | { status: 'success'; result: Review } | { status: 'error'; message: string };

export class ReviewRequest {
  private controller: AbortController | null = null;
  private version = 0;
  cancel() { this.version++; this.controller?.abort(); this.controller = null; }
  async run(circuitId: string, update: (state: ReviewState) => void) {
    this.cancel();
    const version = this.version;
    this.controller = new AbortController();
    update({ status: 'loading' });
    try {
      const response = await fetch(`/api/circuits/${encodeURIComponent(circuitId)}/review`, {
        method: 'POST', signal: this.controller.signal,
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.detail === 'string' ? result.detail : 'Could not run review. Check the local services and try again.');
      if (result?.source !== 'falkordb' || result.circuit_id !== circuitId || result.scope !== 'connectivity_and_board_rails' || !Array.isArray(result.findings))
        throw new Error('The server did not return a review for this circuit.');
      if (version === this.version) update({ status: 'success', result });
    } catch (error) {
      if (version !== this.version) return;
      update({ status: 'error', message: error instanceof TypeError ? 'The local API is unavailable. Start the services and try again.' : error instanceof Error ? error.message : 'Could not run review.' });
    }
  }
}
