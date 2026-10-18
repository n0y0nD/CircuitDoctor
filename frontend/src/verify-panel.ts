import { CompareRequest, comparisonHtml, type Comparison, type CompareState } from './verify-fix.ts';
import { escapeHtml as esc, type Circuit } from './types.ts';
import type { Explanation } from './explanation.ts';
export class VerifyPanel {
  private request = new CompareRequest();
  private circuit: Circuit | null = null;
  private result: Comparison | null = null;
  private correctedName = '';
  constructor(private root: HTMLElement, private inspect: (id: string, evidence: Explanation['evidence'] | null) => Promise<void>, private trigger: HTMLButtonElement, private onComparison: (comparison: Comparison | null) => void) {
    trigger.addEventListener('click', () => this.setOpen(Boolean(this.root.hidden)));
    root.addEventListener('click', event => {
      const target = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (!target) return;
      if (target.hasAttribute('data-close-verify')) { this.setOpen(false); this.trigger.focus(); return; }
      if (target.hasAttribute('data-corrected-upload')) root.querySelector<HTMLInputElement>('input')?.click();
      if (!this.result) return;
      const side = target.dataset.side;
      if (!side) return;
      const result = this.result;
      const id = side === 'before' ? result.original_id : result.corrected_id;
      const wi = target.dataset.compareWarning, ci = target.dataset.compareConnection;
      const evidence = wi !== undefined ? result.warnings[Number(wi)]?.[side === 'before' ? 'before' : 'after']
        : ci !== undefined ? result.connections[Number(ci)]?.evidence : null;
      void this.inspect(id, evidence || null);
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
  private setOpen(open: boolean) {
    this.root.hidden = !open || !this.circuit;
    this.trigger.setAttribute('aria-expanded', String(!this.root.hidden));
    if (!this.root.hidden) this.root.querySelector<HTMLButtonElement>('[data-corrected-upload]')?.focus();
  }
  restore(circuit: Circuit, correctedId: string) {
    this.setCircuit(circuit);
    return this.request.run(circuit.storage.circuit_id, correctedId, state => {
      this.renderState(state);
      if (state.status === 'error') this.setOpen(true);
    });
  }
  cancel() { this.request.cancel(); }
  setCircuit(circuit: Circuit | null) {
    this.cancel(); this.circuit = circuit; this.result = null; this.onComparison(null);
    this.setOpen(false);
    this.trigger.disabled = !circuit;
    this.root.innerHTML = circuit ? `<div class="verify-heading"><h2>Check an updated file</h2><button type="button" class="text-button" data-close-verify>Close comparison</button></div>
      <p>Compare with: <strong>${esc(circuit.storage.filename)}</strong></p><p>Upload the file after your wiring changes to see what got fixed and what still needs attention.</p>
      <input type="file" accept=".net" hidden aria-label="Corrected netlist"/>
      <button type="button" class="button primary" data-corrected-upload>Choose updated .net file</button>
      <div class="verify-result" aria-live="polite"></div>` : '';
  }
  private renderState(state: CompareState) {
    const output = this.root.querySelector<HTMLElement>('.verify-result');
    if (!output) return;
    this.root.querySelector<HTMLButtonElement>('[data-corrected-upload]')!.disabled = state.status === 'loading';
    if (state.status === 'loading') output.textContent = 'Checking what changed…';
    else if (state.status === 'error') output.textContent = state.message;
    else {
      this.result = state.result; this.onComparison(state.result); this.correctedName = state.filename;
      output.innerHTML = `<p>Updated file: <strong>${esc(this.correctedName)}</strong></p><div class="verify-actions"><button class="button secondary" data-side="before">Open earlier circuit</button><button class="button secondary" data-side="after">Open updated circuit</button></div>${comparisonHtml(state.result)}`;
    }
  }
}
