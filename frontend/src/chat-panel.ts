import { renderChatEvidence } from './chat-evidence';
import { formatChatAnswer } from './chat-format';
import { basedOn, evidencePinIds, linkPins, pinLabels } from './chat-pins';
import { ChatRequest, type ChatComparison, type ChatMessage, type ChatResult } from './chat';
import { escapeHtml as esc, type Circuit } from './types';
import { sym } from './icons';
import type { Explanation } from './explanation';

type Turn = { question: string; response: ChatResult };
type ShowEvidence = (evidence: Explanation['evidence'], label?: string) => void;
export const CONFIGURE_COMMAND = 'docker compose exec app \\\n  python -m circuitdoctor.configure_gemini';
const infoIcon = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="6" cy="6" r="5"/><path d="M6 5.5v3M6 3.4v.2"/></svg>';
const keyIcon = '<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="12" r="3"/><path d="m8.2 9.8 6-6M12 6l2 2M13.5 4.5l1.5 1.5"/></svg>';

export class ChatPanel {
  private request = new ChatRequest();
  private circuitId = '';
  private circuit: Circuit | null = null;
  private comparison: ChatComparison | null = null;
  private version = 0;
  private turns: Turn[] = [];
  private busy = false;
  private pending = '';
  private error = '';
  private draft = '';
  private configured = false;
  private checking = false;
  private statusError = '';
  private suggestions: string[] = [];
  private root: HTMLElement;
  private showEvidence: ShowEvidence;
  private onFocus: (focused: boolean) => void;
  constructor(root: HTMLElement, showEvidence: ShowEvidence, onFocus: (focused: boolean) => void = () => {}) {
    this.root = root; this.showEvidence = showEvidence; this.onFocus = onFocus;
    root.addEventListener('submit', event => { event.preventDefault(); void this.send(); });
    root.addEventListener('input', event => {
      if (event.target instanceof HTMLTextAreaElement) this.draft = event.target.value;
    });
    root.addEventListener('keydown', event => {
      // Enter sends; Shift+Enter adds a line.
      if (event.target instanceof HTMLTextAreaElement && event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault(); void this.send();
      }
    });
    root.addEventListener('click', event => {
      const target = event.target as HTMLElement;
      if (target.closest('[data-chat-clear]')) { this.request.cancel(); this.turns = []; this.busy = false; this.error = ''; this.draft = ''; this.render(); this.onFocus(false); }
      if (target.closest('[data-chat-recheck]')) void this.checkStatus();
      if (target.closest('[data-chat-back]')) this.onFocus(false);
      const copy = target.closest<HTMLButtonElement>('[data-copy-command]');
      if (copy) void navigator.clipboard?.writeText(CONFIGURE_COMMAND.replace('\\\n  ', '')).then(() => { copy.title = 'Copied'; copy.classList.add('done'); });
      const pill = target.closest<HTMLButtonElement>('[data-ask]');
      if (pill && !pill.disabled) { this.draft = pill.dataset.ask!; void this.send(); }
      const chip = target.closest<HTMLButtonElement>('[data-chat-pins]');
      if (chip) {
        this.root.querySelectorAll('.pc.on').forEach(on => on.classList.remove('on'));
        chip.classList.add('on');
        const ids: string[] = JSON.parse(chip.dataset.chatPins!);
        this.showEvidence({ nodes: ids.map(id => ({ id, kind: 'pin' })), edges: [], paths: [] }, `${chip.dataset.chip} from chat`);
      }
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
  get hasConversation() { return this.turns.length > 0 || this.busy; }
  setSuggestions(questions: string[]) {
    if (JSON.stringify(questions) === JSON.stringify(this.suggestions)) return;
    this.suggestions = questions; this.render();
  }
  setComparison(comparison: ChatComparison | null) {
    const next = comparison && [comparison.original_id, comparison.corrected_id].includes(this.circuitId) ? comparison : null;
    if (JSON.stringify(next) === JSON.stringify(this.comparison)) return;
    this.request.cancel(); this.comparison = next;
    this.turns = []; this.busy = false; this.error = '';
    this.render();
  }
  setCircuit(id: string, circuit: Circuit | null = null) {
    this.comparison = null;
    this.version++; this.request.cancel(); this.circuitId = id; this.circuit = circuit;
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
    this.pending = message;
    this.onFocus(true);
    await this.request.run(this.circuitId, message, history, state => {
      this.busy = state.status === 'loading'; this.error = '';
      if (state.status === 'success') { this.turns.push({ question: message, response: state.result }); this.draft = ''; }
      if (state.status === 'error') this.error = state.message;
      this.render();
      if (state.status !== 'loading') this.root.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }, this.comparison);
  }
  private answerHtml(turn: Turn, index: number) {
    const items = turn.response.evidence;
    const labels = this.circuit ? pinLabels(this.circuit, evidencePinIds(items)) : new Map<string, string[]>();
    const firstShow = items.findIndex(item => item.result.evidence);
    const based = items.length ? `${infoIcon}Based on: ${esc(basedOn(items))}` : '';
    return `<div class="q">${esc(turn.question)}</div>
      <div class="a chat-answer-body">${linkPins(formatChatAnswer(turn.response.answer), labels)}</div>
      ${items.length ? `<div class="foot">${renderChatEvidence(items, index, based)}${firstShow >= 0 ? `<button type="button" class="showme" data-chat-evidence="${index}:${firstShow}">${sym('i-target')}Show me</button>` : ''}</div>` : ''}`;
  }
  private render() {
    this.root.hidden = !this.circuitId;
    const disabled = this.busy || !this.configured || this.checking;
    const conversation = this.turns.length || this.busy;
    const needsKey = !this.configured && !this.checking;
    const intro = this.comparison
      ? 'Ask what changed between the two files, or what to check next. Answers come from the wiring in your files.'
      : 'Ask how your circuit is wired, or what a part does. Answers come from the wiring in your file.';
    const body = needsKey ? `<div class="nokey">
        <div class="nokey-head"><span class="dial">${keyIcon}</span><div><b>${this.statusError ? 'Chat isn’t available right now' : 'Chat needs a Gemini API key'}</b><p>${this.statusError ? esc(this.statusError) : 'Everything else — checks, trace, compare — works without it.'}</p></div></div>
        ${this.statusError ? '' : `<div class="cmd"><code>${esc(CONFIGURE_COMMAND)}</code><button type="button" class="copy" data-copy-command aria-label="Copy command" title="Copy command">${'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>'}</button></div>`}
        <div class="nokey-acts"><button type="button" class="btn" data-chat-recheck>${this.statusError ? 'Try again' : 'I’ve added my key'}</button><a class="u" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a free key from Google AI Studio ↗</a></div>
      </div>`
      : this.checking && !conversation ? '<p class="chat-status" role="status">Checking Gemini setup…</p>'
      : conversation ? `${this.turns.map((turn, index) => this.answerHtml(turn, index)).join('')}
        ${this.busy ? `<div class="q">${esc(this.pending)}</div><p class="a typing" role="status"><span></span><span></span><span></span> Reading your circuit…</p>` : ''}`
      : `<div class="empty"><span class="dial">?</span><b>Ask anything about this circuit</b><p>${intro}</p></div>`;
    this.root.innerHTML = `<div class="ph"><h2>Ask about your circuit</h2>${conversation ? `<span class="ph-acts"><button type="button" class="link-button" data-chat-back>Back to summary <kbd>Esc</kbd></button><button type="button" class="link-button" data-chat-clear>Clear</button></span>` : ''}</div>
      <div class="thread${conversation ? '' : ' idle'}" aria-live="polite" aria-relevant="additions text">${body}
        ${this.error ? `<p class="explanation-error" role="alert">${esc(this.error)}</p>` : ''}</div>
      <div class="composer">
        ${!needsKey && this.suggestions.length ? `<div class="sugg">${this.suggestions.map(q => `<button type="button" class="pill" data-ask="${esc(q)}" ${disabled ? 'disabled' : ''}>${esc(q)}</button>`).join('')}</div>` : ''}
        <form class="chat-form"><label class="sr-only" for="chat-question">Your question</label><div class="inp${needsKey ? ' off' : ''}"><textarea id="chat-question" rows="1" maxlength="2000" placeholder="${needsKey ? 'Add a key to ask questions' : 'Ask anything about this circuit…'}" required ${disabled ? 'disabled' : ''}>${esc(this.draft)}</textarea><button class="send" type="submit" aria-label="${this.busy ? 'Reading circuit…' : 'Send'}" ${disabled ? 'disabled' : ''}>${sym('i-send')}</button></div></form>
      </div>`;
    const thread = this.root.querySelector<HTMLElement>('.thread');
    if (thread && conversation) thread.scrollTop = thread.scrollHeight;
  }
}
