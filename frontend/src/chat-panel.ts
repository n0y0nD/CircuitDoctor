import { renderChatEvidence } from './chat-evidence';
import { formatChatAnswer } from './chat-format';
import { ChatRequest, type ChatMessage, type ChatResult } from './chat';
import { escapeHtml as esc } from './types';
import type { Explanation } from './explanation';

type Turn = { question: string; response: ChatResult };
export class ChatPanel {
  private request = new ChatRequest();
  private circuitId = '';
  private version = 0;
  private turns: Turn[] = [];
  private busy = false;
  private error = '';
  private draft = '';
  private configured = false;
  private checking = false;
  private statusError = '';
  private root: HTMLElement;
  private showEvidence: (evidence: Explanation['evidence']) => void;
  constructor(root: HTMLElement, showEvidence: (evidence: Explanation['evidence']) => void) {
    this.root = root; this.showEvidence = showEvidence;
    root.addEventListener('submit', event => { event.preventDefault(); void this.send(); });
    root.addEventListener('input', event => {
      if (event.target instanceof HTMLTextAreaElement) this.draft = event.target.value;
    });
    root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-chat-clear]')) { this.request.cancel(); this.turns = []; this.busy = false; this.error = ''; this.draft = ''; this.render(); }
      if (target.closest('[data-chat-recheck]')) void this.checkStatus();
      const button = target.closest<HTMLButtonElement>('[data-chat-evidence]');
      if (button) {
        const [turn, item, finding] = button.dataset.chatEvidence!.split(':').map(Number);
        const result = this.turns[turn]?.response.evidence[item]?.result;
        const evidence = Number.isFinite(finding) ? result?.findings?.[finding]?.evidence : result?.evidence;
        if (evidence) this.showEvidence(evidence);
      }
    });
    this.render();
  }
  setCircuit(id: string) {
    this.version++; this.request.cancel(); this.circuitId = id;
    this.turns = []; this.draft = ''; this.error = ''; this.busy = false;
    this.configured = false; this.statusError = ''; this.checking = false;
    this.render();
    if (id) void this.checkStatus();
  }
  private async checkStatus() {
    const version = this.version;
    this.checking = true; this.statusError = ''; this.render();
    try {
      const response = await fetch('/api/chat/status');
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Unable to check Gemini setup.');
      if (version !== this.version) return;
      this.configured = data.provider === 'gemini' && data.configured === true;
    } catch (error) {
      if (version !== this.version) return;
      this.configured = false;
      this.statusError = error instanceof Error ? error.message : 'Unable to check Gemini setup.';
    } finally {
      if (version === this.version) { this.checking = false; this.render(); }
    }
  }
  private async send() {
    const message = this.draft.trim();
    if (!message || this.busy || !this.circuitId || !this.configured) return;
    const history: ChatMessage[] = this.turns.slice(-4).flatMap(turn => [
      { role: 'user' as const, content: turn.question },
      { role: 'assistant' as const, content: turn.response.answer.slice(0, 12000) },
    ]);
    await this.request.run(this.circuitId, message, history, state => {
      this.busy = state.status === 'loading'; this.error = '';
      if (state.status === 'success') { this.turns.push({ question: message, response: state.result }); this.draft = ''; }
      if (state.status === 'error') this.error = state.message;
      this.render();
      if (state.status !== 'loading') this.root.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    });
  }
  private render() {
    this.root.hidden = !this.circuitId;
    const disabled = this.busy || !this.configured || this.checking;
    this.root.innerHTML = `<div class="chat-heading"><div><h2>Ask about your circuit</h2><p>Understand your circuit, one connection at a time.</p></div>${this.turns.length || this.busy ? '<button type="button" class="text-button" data-chat-clear>Clear chat</button>' : ''}</div>
      <p class="chat-intro">Ask how parts connect, explore a pin, or find out where to start checking.</p>
      ${!this.configured ? `<p class="chat-setup" role="status">${this.checking ? 'Checking Gemini setup…' : esc(this.statusError || 'Save your Gemini API key locally to enable chat.')} ${!this.checking ? '<button type="button" class="text-button" data-chat-recheck>Check again</button>' : ''}</p>` : ''}
      <div class="chat-turns" aria-live="polite" aria-relevant="additions text">${this.turns.map((turn, index) => `<article class="chat-turn"><p class="chat-question"><strong>You</strong><span>${esc(turn.question)}</span></p><div class="chat-answer"><strong>CircuitDoctor</strong><div class="chat-answer-body">${formatChatAnswer(turn.response.answer)}</div>
        ${renderChatEvidence(turn.response.evidence, index)}</div></article>`).join('')}</div>
      ${this.error ? `<p class="explanation-error" role="alert">${esc(this.error)}</p>` : ''}
      <form class="chat-form"><label for="chat-question">Your question</label><div class="chat-input-row"><textarea id="chat-question" rows="2" maxlength="2000" placeholder="Which parts connect to D13?" required ${disabled ? 'disabled' : ''}>${esc(this.draft)}</textarea><button class="button primary" type="submit" ${disabled ? 'disabled' : ''}>${this.busy ? 'Reading circuit…' : 'Send'}</button></div></form>`;
  }
}
