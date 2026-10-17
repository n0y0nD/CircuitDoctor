import { escapeHtml as esc, type Circuit } from './types.ts';
import type { Explanation } from './explanation.ts';
import { PathRequest, pathPins, type PathState, type PathResult } from './path-request.ts';

export class PathPanel {
  private request = new PathRequest();
  private circuit: Circuit | null = null;
  private result: PathResult | null = null;
  private pins: ReturnType<typeof pathPins> = [];
  private loading = false;
  private root: HTMLElement;
  private onEvidence: (evidence: Explanation['evidence'] | null, reveal?: boolean) => void;
  constructor(root: HTMLElement, onEvidence: (evidence: Explanation['evidence'] | null, reveal?: boolean) => void) {
    this.root = root;
    this.onEvidence = onEvidence;
    root.addEventListener('change', () => {
      this.request.cancel();
      this.result = null;
      this.updateDestinations();
      this.renderState({ status: 'idle' });
      this.onEvidence(null);
    });
    root.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      const data = new FormData(form);
      if (!this.circuit || !data.get('from') || !data.get('to') || data.get('from') === data.get('to')) return;
      const [from_ref, from_pin] = JSON.parse(String(data.get('from')));
      const [to_ref, to_pin] = JSON.parse(String(data.get('to')));
      this.onEvidence(null);
      void this.request.run(this.circuit.storage.circuit_id, { from_ref, from_pin, to_ref, to_pin }, state => {
        this.renderState(state);
        if (state.status === 'success') {
          this.result = state.result;
          if (state.result.status === 'found') this.onEvidence(state.result.evidence);
        }
      });
    });
    root.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-show-route]') && this.result)
        this.onEvidence(this.result.evidence, true);
    });
  }
  setCircuit(circuit: Circuit | null) {
    this.request.cancel();
    this.circuit = circuit;
    this.result = null;
    this.loading = false;
    this.pins = circuit ? pathPins(circuit) : [];
    this.root.hidden = !circuit;
    if (!circuit) { this.root.innerHTML = ''; return; }
    const options = '<option value="">Choose a pin…</option>' + this.pins.map(p => `<option value="${esc(p.value)}">${esc(p.label)}</option>`).join('');
    this.root.innerHTML = `<details><summary>Trace a connection <span>Follow the route between two pins</span></summary>
      <form class="path-form"><label>From<select name="from" aria-label="Starting pin" required>${options}</select></label>
      <label>To<select name="to" aria-label="Destination pin" aria-describedby="path-destination-hint" required disabled><option value="">Choose a starting pin first</option></select></label>
      <button class="button primary" type="submit" disabled>Find route</button></form>
      <label class="path-same-component" hidden><input type="checkbox" name="same-component"/> Show same component pins</label>
      <p id="path-destination-hint" class="path-scope" hidden></p>
      <p class="path-scope">Follows wires and resistors. Other parts’ internal connections are not traced.</p>
      <div class="path-result" aria-live="polite"></div></details>`;
  }
  private updateDestinations() {
    const from = this.root.querySelector<HTMLSelectElement>('[name="from"]')!;
    const to = this.root.querySelector<HTMLSelectElement>('[name="to"]')!;
    const same = this.root.querySelector<HTMLInputElement>('[name="same-component"]')!;
    const selected = this.pins.find(pin => pin.value === from.value);
    const available = selected ? this.pins.filter(pin => pin.value !== selected.value && (same.checked || pin.ref !== selected.ref)) : [];
    const previous = to.value;
    const placeholder = !selected ? 'Choose a starting pin first' : available.length ? 'Choose a pin…' : 'No destination pins available';
    to.innerHTML = `<option value="">${placeholder}</option>` + available.map(pin => `<option value="${esc(pin.value)}">${esc(pin.label)}</option>`).join('');
    to.value = available.some(pin => pin.value === previous) ? previous : '';
    to.disabled = !available.length;
    this.root.querySelector<HTMLElement>('.path-same-component')!.hidden = !selected;
    const hint = this.root.querySelector<HTMLElement>('#path-destination-hint')!;
    hint.hidden = !selected || !!available.length;
    hint.textContent = same.checked ? 'This circuit has no other exported pins to select.' : 'No pins from other components. Enable “Show same component pins” to check another pin on this component.';
  }
  private renderState(state: PathState) {
    const output = this.root.querySelector<HTMLElement>('.path-result');
    if (!output) return;
    const button = this.root.querySelector<HTMLButtonElement>('[type="submit"]')!;
    this.loading = state.status === 'loading';
    button.disabled = this.loading || !this.root.querySelector<HTMLSelectElement>('[name="from"]')!.value || !this.root.querySelector<HTMLSelectElement>('[name="to"]')!.value;
    button.textContent = state.status === 'loading' ? 'Finding route…' : 'Find route';
    if (state.status === 'idle' || state.status === 'loading') { output.innerHTML = ''; return; }
    if (state.status === 'error') { output.innerHTML = `<p role="alert">${esc(state.message)}</p>`; return; }
    if (state.status !== 'success') return;
    const r = state.result;
    output.innerHTML = `<p><strong>${esc(r.summary)}</strong></p>
      ${r.status === 'found' ? `<ol class="path-steps">${r.steps.map((step, i) => `<li>${esc(step.kind === 'net' ? 'Wire: ' + step.label : step.label)}${i > 0 && step.kind === 'pin' && r.steps[i - 1].kind === 'pin' ? '<small>through resistor</small>' : ''}</li>`).join('')}</ol><button type="button" class="button secondary" data-show-route>Show route on circuit</button>` : ''}
      <details class="path-proof"><summary>How this route was checked</summary><p>${esc(r.limitations.join(' '))}</p><p>FalkorDB finds the shortest route in the supported connection model.</p>${r.queries.map(q => `<pre>${esc(q.cypher)}\n${esc(JSON.stringify(q.parameters, null, 2))}</pre>`).join('')}</details>`;
  }
}
