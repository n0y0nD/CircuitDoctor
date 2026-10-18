import type { Finding, Review, ReviewState } from './review.ts';
import { boardRecognized, checkLines, evidencePinCount, friendlyFinding, groupFindings } from './findings.ts';
import { sym } from './icons.ts';
import { connectionLabel, escapeHtml as esc, type Circuit } from './types.ts';

const TRUSTED_SOURCES = ['https://www.nxp.com/docs/', 'https://docs.arduino.cc/', 'https://www.buydisplay.com/', 'https://www.vishay.com/', 'https://github.com/KiCad/kicad-symbols/'];
export function sourceLinks(sources: { title: string; url: string }[]) {
  return sources.filter(source => TRUSTED_SOURCES.some(prefix => source.url.startsWith(prefix)))
    .map(source => `<a class="spec-source" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>`).join('');
}

export interface PanelContext {
  circuit: Circuit;
  expanded: string | null;        // id of the open problem card
  hiddenPins: number;             // unconnected pins not drawn on the canvas
  showingUnused: boolean;
  checkedAt: number | null;
  unrecognizedBoard: boolean;     // a board symbol exists but is not a verified Uno R3 / classic Nano
}

export function checkedAgo(at: number | null, now = Date.now()) {
  if (!at) return '';
  const minutes = Math.floor((now - at) / 60000);
  return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ago`;
}

const ok = `<span class="ok-dot">${sym('i-check')}</span>`;
const chev = '<span class="chev" aria-hidden="true">▸</span>';
const infoDial = '<span class="dial info-dial" aria-hidden="true">i</span>';

function evidencePins(finding: Finding, circuit: Circuit) {
  return finding.evidence.nodes.filter(n => n.kind === 'pin').map(n => {
    try {
      const [ref, pin] = JSON.parse(n.id.slice(2)) as [string, string];
      const spec = finding.specifications?.find(s => s.ref === ref && s.pin === pin);
      const part = circuit.components.find(c => c.ref === ref);
      const lib = circuit.libparts.find(p => p.lib === part?.libsource.lib && p.part === part?.libsource.part);
      const name = spec?.name || lib?.pins.find(p => p.num === pin)?.name || circuit.nets.flatMap(net => net.nodes).find(p => p.ref === ref && p.pin === pin)?.pinfunction;
      return { ref, pin, name: name && name !== 'unknown' && name !== '~' ? name : `Pin ${pin}` };
    } catch { return null; }
  }).filter((p): p is { ref: string; pin: string; name: string } => !!p);
}

/** "See the full path": every pin on the faulty wire, red probe first, black probe last. */
function fullPath(finding: Finding, circuit: Circuit) {
  const pins = evidencePins(finding, circuit);
  const specs = finding.specifications || [];
  const red = specs.find(s => s.role === 'rail');
  const black = specs.find(s => s !== red && (s.role === 'ground' || (s.role === 'rail' && s.nominal_voltage !== red?.nominal_voltage)));
  const key = (p: { ref: string; pin: string }) => `${p.ref}:${p.pin}`;
  const first = pins.find(p => red && key(p) === key(red));
  const last = pins.find(p => black && key(p) === key(black));
  const middle = pins.filter(p => p !== first && p !== last);
  const ordered = [first, ...middle, last].filter((p): p is NonNullable<typeof p> => !!p);
  const tip = (color: 'red' | 'black') => `<svg class="tip" viewBox="0 0 24 20" aria-hidden="true"><g transform="translate(19 10) scale(.16)"><use href="#probe-${color}"/></g></svg>`;
  return `<ol class="ppath">${ordered.map((p, i) => {
    const end = (p === first && first) || (p === last && last);
    return `<li class="${end ? 'end' : ''}">${p === first ? tip('red') : p === last ? tip('black') : ''}${esc(p.ref)} · ${esc(p.name)}<span>${p === first ? 'red probe' : p === last ? 'black probe' : `pin ${esc(p.pin)}`}</span></li>`;
  }).join('')}</ol>`;
}

function problemBody(finding: Finding, circuit: Circuit) {
  const copy = friendlyFinding(finding);
  return `<h3>${esc(copy.title)}</h3><p class="cons">${esc(copy.consequence)}</p>
    <div class="todo"><span class="lbl">What to do</span>${esc(copy.todo)}</div>
    <button class="btn pri lg show-me" type="button" data-finding="${esc(finding.id)}">${sym('i-target')}Show me</button>
    ${sourceLinks(finding.sources || []) ? `<details class="sources"><summary>Board pinout sources</summary>${sourceLinks(finding.sources || [])}</details>` : ''}`;
}

function detailsRow(icon: string, label: string, meta: string, body: string, className = '') {
  return `<details class="row ${className}"><summary>${icon}<span class="rl">${label}</span>${meta ? `<span class="meta">${meta}</span>` : ''}${chev}</summary><div class="row-body">${body}</div></details>`;
}

function extraDetails(result: Review) {
  const required = result.requirements;
  return [
    ...result.electrical.recognized_parts.map(part => `<p><strong>${esc(part.ref)} · ${esc(part.name)}</strong></p>${sourceLinks(part.sources)}`),
    result.electrical.checked_nets ? `<p>${result.electrical.checked_nets} power/ground wire${result.electrical.checked_nets === 1 ? '' : 's'} checked. ${esc(result.electrical.checks.join('; '))}.</p>` : '',
    required?.recognized_parts.length ? `<p><strong>Required power/GND connections:</strong> ${required.checked_pins} pins checked; ${required.connected_pins} have a direct wire route to a known Arduino supply/ground pin. This does not verify voltage or operation.</p>${required.recognized_parts.map(part => `<p>${esc(part.ref)} · ${esc(part.name)}</p>${sourceLinks(part.sources)}`).join('')}` : '',
    ...(required ? [...required.unverified_pins, ...required.skipped_pins].map(pin => `<p><strong>${esc(pin.ref)} · Pin ${esc(pin.pin)}:</strong> ${esc(pin.reason)}</p>`) : []),
    ...(result.voltage?.checks || []).map(part => `<p><strong>${esc(part.ref)}${part.pin ? ` · Pin ${esc(part.pin)}` : ''} supply:</strong> ${part.status === 'unverified' ? `Not verified. ${esc(part.reason)}` : `${esc(part.nominal_voltage)}V nominal, ${part.status === 'within_range' ? 'within' : 'outside'} the ${esc(part.operating_range?.min)}–${esc(part.operating_range?.max)}V operating range.`}</p>${sourceLinks(part.sources)}`),
    ...(result.i2c?.checks || []).filter(pin => pin.status === 'connected' || pin.status === 'unverified').map(pin => `<p>${esc(pin.message)}</p>`),
    result.i2c?.checks.length ? `<p>${esc(result.i2c.scope)}</p>${sourceLinks([...new Map(result.i2c.checks.flatMap(pin => pin.sources).map(source => [source.url, source])).values()])}` : '',
    result.isolation ? `<p>${result.isolation.group_count} connected group${result.isolation.group_count === 1 ? '' : 's'} of parts (FalkorDB ${esc(result.isolation.algorithm)}). Grouping shows which parts share wiring; it does not prove electrical operation.</p>` : '',
    `<p>${result.summary.marked_unused_pins} pins marked intentionally unused in the file.</p>`,
    result.voltage?.unknown_components.length ? `<p>Supply voltage not verified for: ${esc(result.voltage.unknown_components.join(', '))}.</p>` : '',
  ].filter(Boolean).join('');
}

function checksRow(result: Review, passedOnly: boolean) {
  const lines = checkLines(result).filter(line => !passedOnly || line.status === 'passed');
  const passed = lines.filter(line => line.status === 'passed').length;
  const label = passedOnly ? `${passed} other check${passed === 1 ? '' : 's'} passed` : `${passed} check${passed === 1 ? '' : 's'} passed`;
  const meta = passedOnly ? '' : lines.filter(l => l.status === 'passed').map(l => l.label.toLowerCase()).join(', ');
  return detailsRow(ok, label, meta.length > 30 ? `${esc(meta.slice(0, 28))}…` : esc(meta),
    `<ul class="checklist">${lines.map(line => `<li class="${line.status}">${line.status === 'passed' ? ok : '<span class="note-dot" aria-hidden="true"></span>'}${esc(line.label)}${line.status === 'note' ? '<span class="meta">see notes</span>' : ''}</li>`).join('')}</ul>
     <details class="sub"><summary>How these checks work</summary>${extraDetails(result)}</details>`, 'checks-row');
}

function notesRow(notes: Finding[], circuit: Circuit) {
  if (!notes.length) return '';
  const connection = (f: Finding) => {
    const selector = f.selection;
    const net = 'net_code' in selector ? circuit.nets.find(n => n.code === selector.net_code) : null;
    return net ? connectionLabel(circuit, net) : 'ref' in selector ? `${selector.ref} · Pin ${selector.pin}` : '';
  };
  return detailsRow(infoDial, 'Notes', `${notes.length} · not errors`,
    `<p class="hint">These may be intentional. Select one to see it on the circuit.</p><div class="note-list">${notes.map(f =>
      `<button class="note-item" type="button" data-finding="${esc(f.id)}"><strong>${esc(f.title)}</strong><small>${esc(connection(f) || f.message)}</small></button>`).join('')}</div>`, 'notes-row');
}

function cannotRow(result: Review) {
  if (!result.cannot_verify.length) return '';
  return detailsRow('<span class="minus-dot" aria-hidden="true">−</span>', 'What we couldn’t check', String(result.cannot_verify.length),
    result.cannot_verify.map(item => `<p><strong>${esc(item.check)}:</strong> ${esc(item.reason)}</p>`).join(''), 'cannot-row');
}

function tiny(ctx: PanelContext, extra = '') {
  const parts = [ctx.checkedAt ? `Checked ${checkedAgo(ctx.checkedAt)}` : '', extra,
    ctx.hiddenPins ? `<button class="link-button" type="button" data-toggle-unused>${ctx.showingUnused ? `Hide ${ctx.hiddenPins} unconnected pins` : `${ctx.hiddenPins} unconnected pins hidden`}</button>` : ''];
  return `<p class="tiny">${parts.filter(Boolean).join(' · ')}</p>`;
}

export function reviewPanelHtml(state: ReviewState, ctx: PanelContext) {
  if (state.status === 'idle') return `<div class="prob"><div class="found"><h2>Check your wiring</h2></div><p class="cons">Run the wiring check to look for shorts and other problems.</p><button class="btn pri lg" type="button" data-run-review>${sym('i-beep', 'beep')}Check connections</button></div>`;
  if (state.status === 'loading') return `<div class="prob" role="status"><div class="found"><span class="cnt wait">${'<svg class="spin" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="#D8D3C8" stroke-width="2"/><path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="#1D1C1A" stroke-width="2" stroke-linecap="round"/></svg>'}</span><h2>Checking your circuit…</h2></div><p class="cons">Reading every pin and wire in ${esc(ctx.circuit.storage.filename)}.</p></div>`;
  if (state.status === 'error') return `<div class="prob" role="alert"><div class="found">${infoDial}<h2>The check didn’t run</h2></div><p class="cons">${esc(state.message)}</p><button class="btn" type="button" data-run-review>Try again</button></div>`;
  const result = state.result;
  const { problems, notes, unconnected } = groupFindings(result);
  const allNotes = [...notes, ...unconnected];
  const ago = `<span class="meta">checked ${checkedAgo(ctx.checkedAt)}</span>`;
  if (problems.length) {
    const open = problems.find(p => p.id === ctx.expanded) || problems[0];
    const pathPins = evidencePinCount(open);
    const multi = problems.length > 1;
    return `<div class="prob">
      <div class="found"><span class="cnt">!</span><h2>${problems.length} problem${problems.length === 1 ? '' : 's'} found</h2>${ago}</div>
      ${multi ? `<div class="cards">${problems.map((p, i) => p === open
        ? `<article class="card open"><div class="card-title"><span class="num">${i + 1}</span>${problemBody(p, ctx.circuit).replace('<h3>', '<h3 class="in-card">')}</div></article>`
        : `<button class="card" type="button" data-expand-finding="${esc(p.id)}"><span class="num">${i + 1}</span><strong>${esc(friendlyFinding(p).title)}</strong>${chev}</button>`).join('')}</div>`
        : problemBody(open, ctx.circuit)}
      <div class="rows">
        ${pathPins > 1 ? detailsRow('<span class="minipath" aria-hidden="true"><i></i><b></b><i></i><b></b><i></i></span>', 'See the full path', `${pathPins} pins`, fullPath(open, ctx.circuit), 'path-row') : ''}
        ${checksRow(result, true)}
        ${notesRow(allNotes, ctx.circuit)}
      </div>
      ${tiny({ ...ctx, checkedAt: null })}
    </div>`;
  }
  if (result.status === 'incomplete') return `<div class="prob">
      <div class="found">${infoDial}<h2>Not enough in this file to check.</h2></div>
      <p class="cons">The export has no components or no wires to review.</p>
      <div class="rows">${cannotRow(result)}</div>${tiny(ctx)}</div>`;
  if (!boardRecognized(result)) return `<div class="prob unknown">
      <div class="found top">${infoDial}<h2 class="big">${ctx.unrecognizedBoard ? 'We couldn’t confirm which Arduino board this is.' : 'We couldn’t find an Arduino Uno R3 or Nano in this file.'}</h2></div>
      <p class="cons indent">Power and I2C checks need a supported board, so they were skipped.</p>
      <p class="lbl still">What we still checked</p>
      <div class="rows tight">
        <div class="row static">${ok}<span class="rl">Unconnected pins</span></div>
        <div class="row static">${checkLines(result).some(l => l.status === 'note') ? '<span class="note-dot" aria-hidden="true"></span>' : ok}<span class="rl">Separate groups</span></div>
        <div class="row static">${ok}<span class="rl">Trace any two pins</span></div>
        ${notesRow(allNotes, ctx.circuit)}
        ${cannotRow(result)}
      </div>
      <div class="acts-row"><button class="btn" type="button" data-open-trace>${sym('i-trace')}Trace a connection</button><button class="btn upload-trigger" type="button">${sym('i-upload')}Upload another</button></div>
      ${tiny({ ...ctx, hiddenPins: 0 }, 'supported: Uno R3, classic Nano')}</div>`;
  return `<div class="prob clean">
      <div class="found top">${ok.replace('ok-dot', 'ok-dot lg')}<h2 class="big">No wiring problems found in this file.</h2></div>
      <p class="cons indent">This checks your file’s wiring, not the physical board.</p>
      <div class="rows">${checksRow(result, false)}${notesRow(allNotes, ctx.circuit)}</div>
      <div class="acts-row"><button class="btn" type="button" data-open-trace>${sym('i-trace')}Trace a connection</button></div>
      ${tiny(ctx)}</div>`;
}
