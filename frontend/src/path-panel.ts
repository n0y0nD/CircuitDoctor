import { displayValue, escapeHtml as esc, type Circuit } from './types.ts';
import type { Explanation } from './explanation.ts';
import { PathRequest, pathPins, type PathState, type PathResult } from './path-request.ts';

export interface TracedRoute { from: { ref: string; pin: string; name: string }; to: { ref: string; pin: string; name: string }; steps: number; wires: string[] }
const glyph = (color: 'red' | 'black') => `<svg class="g" viewBox="0 0 24 20" aria-hidden="true"><g transform="translate(19 10) scale(.16)"><use href="#probe-${color}"/></g></svg>`;
const traceIcon = '<svg aria-hidden="true"><use href="#i-trace"/></svg>';
const info = '<svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><circle cx="6" cy="6" r="5"/><path d="M6 5.5v3M6 3.4v.2"/></svg>';

export class PathPanel {
  private request = new PathRequest();
  private circuit: Circuit | null = null;
  private result: PathResult | null = null;
  private pins: ReturnType<typeof pathPins> = [];
  private loading = false;
  private root: HTMLElement;
  private onEvidence: (evidence: Explanation['evidence'] | null, reveal?: boolean) => void;
  private onRoute: (route: TracedRoute | null) => void;
  constructor(root: HTMLElement, onEvidence: (evidence: Explanation['evidence'] | null, reveal?: boolean) => void, onRoute: (route: TracedRoute | null) => void = () => {}) {
    this.root = root;
    this.onEvidence = onEvidence;
    this.onRoute = onRoute;
    root.addEventListener('change', () => {
      this.request.cancel();
      this.result = null;
      this.updateDestinations();
      this.renderState({ status: 'idle' });
      this.onRoute(null);
      this.onEvidence(null);
    });
    root.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      const data = new FormData(form);
      if (!this.circuit || !data.get('from') || !data.get('to') || data.get('from') === data.get('to')) return;
      const [from_ref, from_pin] = JSON.parse(String(data.get('from')));
      const [to_ref, to_pin] = JSON.parse(String(data.get('to')));
      this.onRoute(null);
      this.onEvidence(null);
      void this.request.run(this.circuit.storage.circuit_id, { from_ref, from_pin, to_ref, to_pin }, state => {
        this.renderState(state);
        if (state.status === 'success') {
          this.result = state.result;
          if (state.result.status === 'found') {
            this.onRoute({ from: this.pinInfo(from_ref, from_pin), to: this.pinInfo(to_ref, to_pin), steps: state.result.steps.length - 1,
              wires: state.result.steps.filter(s => s.kind === 'net').map(s => s.label.replace(/^\//, '')) });
            this.onEvidence(state.result.evidence);
          }
        }
      });
    });
    root.addEventListener('click', event => {
      if ((event.target as HTMLElement).closest('[data-show-route]') && this.result)
        this.onEvidence(this.result.evidence, true);
    });
  }
  clearRoute() {
    this.request.cancel();
    this.result = null;
    this.renderState({ status: 'idle' });
    this.onRoute(null);
    this.onEvidence(null);
  }
  /** Pre-select pins, e.g. the two ends of a fault, without running the trace. */
  preset(from?: { ref: string; pin: string }, to?: { ref: string; pin: string }) {
    const select = (name: string, value?: { ref: string; pin: string }) => {
      const element = this.root.querySelector<HTMLSelectElement>(`[name="${name}"]`);
      if (element && value) element.value = JSON.stringify([value.ref, value.pin]);
    };
    if (!this.result) { select('from', from); this.updateDestinations(); select('to', to); this.updateDestinations(); }
  }
  private pinInfo(ref: string, pin: string) {
    const found = this.pins.find(p => p.ref === ref && p.pin === pin);
    return { ref, pin, name: found?.name ? found.name.replace(/^\+/, '') : `Pin ${pin}` };
  }
  private partName(ref: string) {
    const part = this.circuit?.components.find(c => c.ref === ref);
    return part ? displayValue(part) : '';
  }
  setCircuit(circuit: Circuit | null) {
    this.request.cancel();
    this.circuit = circuit;
    this.result = null;
    this.loading = false;
    this.pins = circuit ? pathPins(circuit) : [];
    this.root.hidden = !circuit;
    this.onRoute(null);
    if (!circuit) { this.root.innerHTML = ''; return; }
    const options = '<option value="">Choose a pin…</option>' + this.pins.map(p => `<option value="${esc(p.value)}">${esc(p.label)}</option>`).join('');
    this.root.innerHTML = `<div class="mode">
      <div class="found"><span class="dial">${traceIcon}</span><h2>Trace a connection</h2><button type="button" class="x" data-close-trace aria-label="Close trace">×</button></div>
      <p class="lead">Pick two pins to see how they’re joined.</p>
      <form class="path-form">
        <div class="picks">
          <label class="pick"><span class="lbl">From</span>${glyph('red')}<select name="from" aria-label="Starting pin" required>${options}</select></label>
          <label class="pick"><span class="lbl">To</span>${glyph('black')}<select name="to" aria-label="Destination pin" aria-describedby="path-destination-hint" required disabled><option value="">Choose a starting pin first</option></select></label>
        </div>
        <label class="path-same-component" hidden><input type="checkbox" name="same-component"/> Show pins on the same part</label>
        <p id="path-destination-hint" class="path-scope" hidden></p>
        <button class="btn pri lg trace-go" type="submit" disabled>${traceIcon}Trace</button>
      </form>
      <div class="path-result" aria-live="polite"></div>
      <p class="path-scope">Follows wires and resistors. Other parts’ internal connections are not traced.</p></div>`;
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
    hint.textContent = same.checked ? 'This circuit has no other exported pins to select.' : 'No pins from other parts. Turn on “Show pins on the same part” to pick another pin on this part.';
    const button = this.root.querySelector<HTMLButtonElement>('[type="submit"]')!;
    button.disabled = this.loading || !from.value || !to.value;
  }
  private renderState(state: PathState) {
    const output = this.root.querySelector<HTMLElement>('.path-result');
    if (!output) return;
    const button = this.root.querySelector<HTMLButtonElement>('[type="submit"]')!;
    this.loading = state.status === 'loading';
    button.disabled = this.loading || !this.root.querySelector<HTMLSelectElement>('[name="from"]')!.value || !this.root.querySelector<HTMLSelectElement>('[name="to"]')!.value;
    button.innerHTML = `${traceIcon}${state.status === 'loading' ? 'Tracing…' : 'Trace'}`;
    if (state.status === 'idle' || state.status === 'loading') { output.innerHTML = ''; return; }
    if (state.status === 'error') { output.innerHTML = `<div class="hr"></div><p class="explanation-error" role="alert">${esc(state.message)}</p>`; return; }
    if (state.status !== 'success') return;
    const r = state.result;
    if (r.status !== 'found') {
      output.innerHTML = `<div class="hr"></div><div class="res"><span class="lbl">Result</span><h3>No route found</h3><p class="lead">${esc(r.summary)}</p>
        <div class="note">${info}A missing route isn’t proof of a fault: other parts’ insides aren’t traced.</div></div>`;
      return;
    }
    const last = r.steps.length - 1;
    const pinText = (ref = '', pin = '') => { const p = this.pinInfo(ref, pin); return `${esc(p.ref)} · ${esc(p.name)}`; };
    output.innerHTML = `<div class="hr"></div><div class="res"><span class="lbl">Result</span><h3>Connected in ${last} step${last === 1 ? '' : 's'}</h3>
      <ol class="ipath">${r.steps.map((step, i) => {
        const through = i > 0 && step.kind === 'pin' && r.steps[i - 1].kind === 'pin';
        const text = step.kind === 'net' ? `wire ${esc(step.label.replace(/^\//, ''))}` : `${pinText(step.ref, step.pin)} <span class="who">${esc(this.partName(step.ref || ''))}${through ? ' · through resistor' : ''}</span>`;
        return `<li class="${i === 0 || i === last ? 'end' : ''}">${i === 0 ? glyph('red').replace('class="g"', 'class="tip"') : i === last ? glyph('black').replace('class="g"', 'class="tip"') : ''}${text}<span class="sn">${i === 0 ? 'start' : `step ${i}`}</span></li>`;
      }).join('')}</ol>
      <div class="note">${info}A route doesn’t prove current flows.</div>
      <button type="button" class="btn sm show-route" data-show-route>Show route on the drawing</button></div>`;
  }
}
