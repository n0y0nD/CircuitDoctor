import { CompareRequest, comparisonWarningIsFault, comparisonHeadline, comparisonHtml, type Comparison, type CompareState } from './verify-fix.ts';
import { escapeHtml as esc, type Circuit } from './types.ts';
import type { Explanation } from './explanation.ts';

const upload = '<svg aria-hidden="true"><use href="#i-upload"/></svg>';
const check = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
const compareIcon = '<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 5h10M9 2l3 3-3 3M14 11H4M7 8l-3 3 3 3"/></svg>';

/** Whether every earlier warning cleared and nothing new appeared. */
export const isFixed = (r: Comparison) => r.summary.resolved > 0 && !r.summary.persists && !r.summary.new && !r.summary.unverified;

export class VerifyPanel {
  private request = new CompareRequest();
  private circuit: Circuit | null = null;
  private result: Comparison | null = null;
  private correctedName = '';
  private comparedAt = 0;
  private viewingId = '';
  constructor(private root: HTMLElement, private inspect: (id: string, evidence: Explanation['evidence'] | null, isFault: boolean) => Promise<void>, private trigger: HTMLButtonElement, private onComparison: (comparison: Comparison | null) => void, private onToggle: () => void = () => {}) {
    trigger.addEventListener('click', () => this.setOpen(Boolean(this.root.hidden)));
    root.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!target) return;
      if (target.hasAttribute('data-close-verify')) { this.close(); this.trigger.focus(); return; }
      if (target.hasAttribute('data-corrected-upload')) root.querySelector<HTMLInputElement>('input')?.click();
      if (!this.result) return;
      const side = target.dataset.side;
      if (!side) return;
      const result = this.result;
      const id = side === 'before' ? result.original_id : result.corrected_id;
      const wi = target.dataset.compareWarning, ci = target.dataset.compareConnection;
      const evidence = wi !== undefined ? result.warnings[Number(wi)]?.[side === 'before' ? 'before' : 'after']
        : ci !== undefined ? result.connections[Number(ci)]?.evidence : null;
      void this.inspect(id, evidence || null, wi !== undefined && comparisonWarningIsFault(result.warnings[Number(wi)], side));
    });
    root.addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      if (!file || !this.circuit) return;
      this.result = null; this.onComparison(null);
      void this.request.run(this.circuit.storage.circuit_id, file, state => this.renderState(state));
    });
  }
  get comparison() { return this.result; }
  get isOpen() { return !this.root.hidden; }
  get names() { return { before: this.circuit?.storage.filename || '', after: this.correctedName }; }
  /** Which side of the comparison the workspace is showing, for the "open" button. */
  setViewing(id: string) {
    if (id === this.viewingId) return;
    this.viewingId = id;
    if (this.result) this.renderResult();
  }
  private setOpen(open: boolean) {
    this.root.hidden = !open || !this.circuit;
    this.trigger.setAttribute('aria-expanded', String(!this.root.hidden));
    if (!this.root.hidden) this.root.querySelector<HTMLButtonElement>('[data-corrected-upload]')?.focus();
    this.onToggle();
  }
  restore(circuit: Circuit, correctedId: string) {
    this.setCircuit(circuit);
    this.setOpen(true);
    return this.request.run(circuit.storage.circuit_id, correctedId, state => {
      this.renderState(state);
      if (state.status === 'error') this.setOpen(true);
    });
  }
  close() {
    this.cancel();
    if (!this.result && this.circuit) this.root.innerHTML = this.startHtml();
    this.setOpen(false);
  }
  cancel() { this.request.cancel(); }
  setCircuit(circuit: Circuit | null) {
    this.cancel(); this.circuit = circuit; this.result = null; this.onComparison(null);
    this.viewingId = circuit?.storage.circuit_id || '';
    this.setOpen(false);
    this.trigger.disabled = !circuit;
    this.root.innerHTML = circuit ? this.startHtml() : '';
  }
  private startHtml(message = '') {
    return `<div class="mode">
      <div class="found"><span class="dial">${compareIcon}</span><h2>Check an updated file</h2><button type="button" class="x" data-close-verify aria-label="Close comparison">×</button></div>
      <p class="lead">Compare with <span class="mono">${esc(this.circuit?.storage.filename || '')}</span>. Upload the file after your wiring changes to see what got fixed and what still needs attention.</p>
      <input type="file" accept=".net" hidden aria-label="Corrected netlist"/>
      <button type="button" class="btn pri lg verify-go" data-corrected-upload>${upload}Choose updated .net file</button>
      <div class="verify-result" aria-live="polite">${message}</div></div>`;
  }
  private renderState(state: CompareState) {
    if (state.status === 'success') {
      this.result = state.result; this.correctedName = state.filename; this.comparedAt = Date.now();
      this.renderResult();
      this.onComparison(state.result);
      return;
    }
    this.root.innerHTML = this.startHtml(state.status === 'loading'
      ? '<p class="path-scope" role="status">Checking what changed…</p>'
      : `<p class="explanation-error" role="alert">${esc(state.message)}</p>`);
    this.root.querySelector<HTMLButtonElement>('[data-corrected-upload]')!.disabled = state.status === 'loading';
  }
  private renderResult() {
    const r = this.result!;
    const fixed = isFixed(r);
    const remaining = r.summary.persists + r.summary.new;
    const viewingUpdated = this.viewingId === r.corrected_id;
    const minutes = Math.floor((Date.now() - this.comparedAt) / 60000);
    this.root.innerHTML = `<div class="prob compare">
      <div class="found">${fixed ? `<span class="ok-dot lg">${check}</span>` : remaining ? '<span class="cnt">!</span>' : '<span class="dial info-dial">i</span>'}<h2>${fixed ? 'Fixed' : remaining ? 'Not fixed yet' : 'Compared'}</h2><span class="meta">compared ${minutes < 1 ? 'just now' : `${minutes} min ago`}</span><button type="button" class="x" data-close-verify aria-label="Close comparison">×</button></div>
      <h3>${r.summary.resolved && !remaining ? `${r.summary.resolved} problem${r.summary.resolved === 1 ? '' : 's'} cleared.` : esc(comparisonHeadline(r))}</h3>
      <p class="cons"><span class="mono">${esc(this.names.before)}</span> → <span class="mono">${esc(this.correctedName)}</span></p>
      ${comparisonHtml(r)}
      <div class="acts-row">${viewingUpdated
        ? '<button type="button" class="btn" data-side="before">← Open the earlier circuit</button>'
        : `<button type="button" class="btn pri lg" data-side="after">${fixed ? 'Open the fixed circuit' : 'Open the updated circuit'} <span aria-hidden="true">→</span></button>`}
        <button type="button" class="link-button" data-corrected-upload>Compare another file</button><input type="file" accept=".net" hidden aria-label="Corrected netlist"/></div>
      <p class="tiny">Based on: comparing both files · wiring check. These are wiring checks, not a test of the physical circuit.</p></div>`;
  }
}
