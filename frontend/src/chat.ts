import type { Explanation } from './explanation';

export type ChatComparison = { original_id: string; corrected_id: string };
export type ChatMessage = { role: 'user' | 'assistant'; content: string };
export interface ChatEvidence {
  id: string;
  tool: string;
  arguments: Record<string, string>;
  result: {
    source: 'falkordb'; circuit_id: string; evidence?: Explanation['evidence'];
    findings?: { title: string; rule?: string; evidence: Explanation['evidence'] }[];
    queries?: { cypher: string; parameters: Record<string, unknown> }[];
    [key: string]: unknown;
  };
}
export interface ChatResult {
  comparison?: ChatComparison | null;
  provider: 'gemini'; circuit_id: string; answer: string; model: string;
  evidence: ChatEvidence[]; tool_calls: number;
}
export type ChatState = { status: 'loading' } | { status: 'success'; result: ChatResult } | { status: 'error'; message: string };
export class ChatRequest {
  private controller: AbortController | null = null;
  private version = 0;
  cancel() { this.version++; this.controller?.abort(); this.controller = null; }
  async run(circuitId: string, message: string, history: ChatMessage[], update: (state: ChatState) => void, comparison: ChatComparison | null = null) {
    this.cancel();
    const version = this.version;
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), 165_000);
    update({ status: 'loading' });
    try {
      const response = await fetch(`/api/circuits/${encodeURIComponent(circuitId)}/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(-8), ...(comparison ? { comparison } : {}) }), signal: controller.signal,
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : 'Chat is unavailable. Check the local services and try again.');
      if (data?.provider !== 'gemini' || data.circuit_id !== circuitId || typeof data.answer !== 'string' || !Array.isArray(data.evidence)
        || data.evidence.some((e: ChatEvidence) => e?.result?.source !== 'falkordb' || e.result.circuit_id !== circuitId))
        throw new Error('The chat response does not match this circuit. Please retry.');
      if ((data.comparison?.original_id || null) !== (comparison?.original_id || null)
        || (data.comparison?.corrected_id || null) !== (comparison?.corrected_id || null))
        throw new Error('The answer does not match the selected file comparison. Please retry.');
      if (version === this.version) update({ status: 'success', result: data });
    } catch (error) {
      if (version !== this.version) return;
      update({ status: 'error', message: controller.signal.aborted ? 'Chat timed out. Try a shorter question.'
        : error instanceof TypeError ? 'The local API is unavailable. Start the services and retry.'
        : error instanceof Error ? error.message : 'Chat failed. Please retry.' });
    } finally { clearTimeout(timer); }
  }
}
