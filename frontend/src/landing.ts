import { sym } from './icons.ts';
import { escapeHtml as esc } from './types.ts';

export const GITHUB_URL = 'https://github.com/n0y0nD/CircuitDoctor';
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const openShortcut = isMac ? '⌘O' : 'Ctrl O';

// 7-segment word on a ghost "8888" (glyphs are 100 units tall, 66 apart).
function segments(x: number, y: number, scale: number, glyphs: string[]) {
  const row = (ids: string[]) => ids.map((id, i) => `<use href="#seg-${id}"${i ? ` x="${i * 66}"` : ''}/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${scale})" style="color:#BCC0A7">${row(['8', '8', '8', '8'])}</g>`
    + `<g transform="translate(${x} ${y}) scale(${scale})" style="color:#20231A">${row(glyphs)}</g>`;
}

/** Landing hero: probes come in from the page edges and touch +5V and GND. An illustration, not a reading. */
function bench() {
  return `<svg class="bench" viewBox="0 360 1440 240" aria-hidden="true" font-family="JetBrains Mono, monospace">
    <path d="M556 520 H636 V556 H804 V520 H884" fill="none" stroke="#D4362A" stroke-width="5" stroke-linejoin="round"/>
    <circle cx="720" cy="556" r="6" fill="#D4362A"/>
    <rect x="672" y="568" width="96" height="20" rx="4" fill="#ECE9E2"/>
    <text x="720" y="582" text-anchor="middle" font-size="12" fill="#55524C">via J9·Pin_2</text>
    <circle cx="556" cy="520" r="17" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="5"/><circle cx="556" cy="520" r="5" fill="#1D1C1A"/>
    <circle cx="884" cy="520" r="17" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="5"/><circle cx="884" cy="520" r="5" fill="#1D1C1A"/>
    <text x="556" y="566" text-anchor="middle" font-size="13" font-weight="600" fill="#1D1C1A">+5V</text>
    <text x="556" y="583" text-anchor="middle" font-size="11.5" fill="#8A867E">A7 · pin 5V</text>
    <text x="884" y="566" text-anchor="middle" font-size="13" font-weight="600" fill="#1D1C1A">GND</text>
    <text x="884" y="583" text-anchor="middle" font-size="11.5" fill="#8A867E">A7 · pin 29</text>
    <use href="#probe-red" transform="translate(553 517) rotate(13)"/>
    <use href="#probe-black" transform="translate(887 517) scale(-1 1) rotate(13)"/>
    <g font-size="11.5" letter-spacing="1.2" font-weight="600"><text x="48" y="428" fill="#D4362A">VΩ</text><text x="1392" y="428" text-anchor="end" fill="#1D1C1A">COM</text></g>
    <g transform="translate(560 366)">
      <rect width="320" height="104" rx="16" fill="#F3C21B"/><rect x="9" y="9" width="302" height="86" rx="9" fill="#2A2A27"/><rect x="14" y="14" width="292" height="76" rx="6" fill="#C7CBB2"/>
      <g fill="#20231A">
        <text x="26" y="34" font-size="11" font-weight="600" letter-spacing="1.4">CONTINUITY</text>
        <use href="#i-beep" x="114" y="21" width="16" height="16" style="color:#20231A"/>
        <text x="26" y="60" font-size="15" font-weight="600">5V ↔ GND</text>
        <rect x="25" y="68" width="46" height="15" rx="2"/>
        <text x="48" y="79" text-anchor="middle" font-size="10" font-weight="600" fill="#C7CBB2" letter-spacing="1">SHORT</text>
        <text x="78" y="79" font-size="10" fill="#4a4e3f" letter-spacing=".4">· same wire</text>
      </g>
      ${segments(170, 26, .46, ['S', 'H', 'r', 't'])}
    </g>
  </svg>`;
}

const netDoc = '<svg class="doc" aria-hidden="true"><use href="#i-netfile"/></svg>';

export function landingHtml() {
  return `<section class="landing" id="welcome" aria-labelledby="welcome-title">
  <header class="nav">
    <a class="brand" href="/" aria-label="CircuitDoctor home">${sym('cd-logo')}CircuitDoctor</a>
    <nav class="navr" aria-label="Site"><a href="#how">How it works</a><a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub</a><span class="stat" id="landing-status" role="status"><i class="live wait"></i>Graph DB…</span></nav>
  </header>
  <div class="hero">
    <p class="kicker">Continuity test <b>·)))</b> for KiCad netlists</p>
    <h1 class="display" id="welcome-title">Hear the short<br>before you <em>smell</em> it.</h1>
    <p class="sub">CircuitDoctor probes every pin and net in your KiCad netlist, and beeps before the USB goes in.</p>
    <div class="bench-wrap">${bench()}</div>
    <section class="drop dropzone" id="dropzone" aria-live="polite">
      ${netDoc}
      <div class="t"><h3>Drop your KiCad .net file to test it</h3><p>KiCad netlist · .net · up to 10 MiB · Arduino Uno R3, classic Nano</p></div>
      <button class="btn pri lg upload-trigger" type="button">Choose .net file <span class="kbd">${openShortcut}</span></button>
    </section>
    <div class="links">
      <button class="btn quiet sample-trigger" type="button">${sym('i-flask')}Try a sample circuit</button>
      <i class="dot"></i>
      <button class="u help-trigger" type="button">Where do I get a .net file?</button>
    </div>
  </div>
  <footer class="foot">
    <div class="feats">
      <div class="feat"><span class="dial">Ω</span><div><b>Graph-backed wiring checks</b><small>Shorts, rails, power pins, I2C</small></div></div>
      <div class="feat"><span class="dial" style="font-size:10px">↔</span><div><b>Trace any connection</b><small>Pin to pin, every hop shown</small></div></div>
      <div class="feat"><span class="dial">?</span><div><b>Ask AI with evidence</b><small>Answers cite the graph query</small></div></div>
    </div>
    <div class="pow">Powered by <b>FalkorDB graph</b><br>Connections from your file. No circuit simulation.</div>
  </footer>
</section>`;
}

/** Drop-zone contents for the normal, wrong-file and offline states. */
export type DropState = { kind: 'ready' } | { kind: 'error'; title: string; detail: string; kicadPath: boolean } | { kind: 'offline'; server: boolean };
export function dropHtml(state: DropState) {
  const choose = (label = 'Choose .net file', kbd = true, disabled = false) =>
    `<button class="btn pri lg upload-trigger" type="button"${disabled ? ' aria-disabled="true" disabled' : ''}>${label}${kbd ? ` <span class="kbd">${openShortcut}</span>` : ''}</button>`;
  if (state.kind === 'error') return `<svg class="doc" viewBox="0 0 44 52" aria-hidden="true">
      <path d="M3 4a3 3 0 0 1 3-3h22l13 13v34a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="2"/>
      <path d="M28 1v10a3 3 0 0 0 3 3h10" fill="none" stroke="#1D1C1A" stroke-width="2"/>
      <circle cx="22" cy="34" r="10" fill="#D4362A"/><path d="M22 28.5v6.5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><circle cx="22" cy="39.2" r="1.4" fill="#fff"/></svg>
    <div class="t" role="alert"><h3>${esc(state.title)}</h3><p>${[state.detail ? esc(state.detail) : '',
      state.kicadPath ? 'We need the .net file — in KiCad:<br><span class="mono">File ▸ Export ▸ Netlist</span>' : ''].filter(Boolean).join('<br>')}</p></div>
    ${choose('Choose another file', false)}`;
  if (state.kind === 'offline') return `<svg class="doc" viewBox="0 0 44 52" aria-hidden="true" fill="none" stroke-width="2">
      <ellipse cx="22" cy="12" rx="15" ry="5.5" fill="#F6F4EF" stroke="#1D1C1A"/><path d="M7 12v26c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5V12" stroke="#1D1C1A"/>
      <path d="M7 25c0 3 6.7 5.5 15 5.5s15-2.5 15-5.5" stroke="#1D1C1A"/><circle cx="35" cy="41" r="8" fill="#C98410" stroke="#F6F4EF" stroke-width="2.5"/>
      <path d="M35 37v4.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/><circle cx="35" cy="44.6" r="1.1" fill="#fff" stroke="none"/></svg>
    <div class="t" role="status"><h3>${state.server ? 'Can’t reach the CircuitDoctor server.' : 'Can’t reach the database.'}</h3><p>Start it with <code>docker compose up</code>, then refresh.</p></div>
    ${choose('Choose .net file', true, true)}`;
  return `${netDoc}<div class="t"><h3>Drop your KiCad .net file to test it</h3><p>KiCad netlist · .net · up to 10 MiB · Arduino Uno R3, classic Nano</p></div>${choose()}`;
}

export function helpDialogHtml() {
  return `<dialog id="help-dialog" class="modal" aria-labelledby="help-title">
  <div class="mh"><div><h2 id="help-title">Where do I get a .net file?</h2><p>KiCad makes it for you. It takes about ten seconds.</p></div>
    <button class="x" id="close-help" type="button" aria-label="Close">×</button></div>
  <ol class="how">
    <li><span class="dial">1</span><div><b>Open your schematic</b><small>In KiCad, open your project and double-click the schematic (the Schematic Editor).</small></div></li>
    <li><span class="dial">2</span><div><b class="path">File ▸ Export ▸ Netlist…</b><small>It’s in the top menu of the Schematic Editor.</small></div></li>
    <li><span class="dial">3</span><div><b>Choose KiCad format, save the .net</b><small>Leave the <strong>KiCad</strong> tab selected, click Export Netlist, and save. Then drop that file here.</small></div></li>
  </ol>
  <div class="mock" aria-hidden="true"><svg viewBox="0 0 656 196" font-family="JetBrains Mono, monospace" font-size="11.5">
    <rect x="20" y="18" width="350" height="196" rx="8" fill="#FBFAF7" stroke="#C9C3B6"/><path d="M20 46H370" stroke="#E6E2D9"/>
    <text x="34" y="37" fill="#1D1C1A" font-weight="600">File</text><text x="76" y="37" fill="#8A867E">Edit</text><text x="118" y="37" fill="#8A867E">View</text>
    <text x="160" y="37" fill="#8A867E">Place</text><text x="210" y="37" fill="#8A867E">Inspect</text><text x="274" y="37" fill="#8A867E">Tools</text>
    <rect x="28" y="24" width="38" height="19" rx="4" fill="none" stroke="#1D1C1A" stroke-width="1.5"/>
    <rect x="28" y="50" width="160" height="134" rx="6" fill="#F6F4EF" stroke="#C9C3B6"/>
    <text x="40" y="70" fill="#8A867E">New Schematic…</text><text x="40" y="91" fill="#8A867E">Open…</text><text x="40" y="112" fill="#8A867E">Save</text>
    <path d="M36 121H180" stroke="#E6E2D9"/><rect x="32" y="127" width="152" height="23" rx="4" fill="#1D1C1A"/>
    <text x="40" y="143" fill="#F6F4EF" font-weight="600">Export</text><text x="176" y="143" fill="#F6F4EF" text-anchor="end">▸</text>
    <text x="40" y="171" fill="#8A867E">Print…</text>
    <rect x="190" y="104" width="172" height="76" rx="6" fill="#F6F4EF" stroke="#C9C3B6"/><text x="202" y="124" fill="#8A867E">Drawing to Clipboard</text>
    <rect x="194" y="131" width="164" height="23" rx="4" fill="#1D1C1A"/><text x="202" y="147" fill="#F6F4EF" font-weight="600">Netlist…</text>
    <text x="202" y="171" fill="#8A867E">Symbols to Library…</text>
    <path d="M380 142H416" stroke="#1D1C1A" stroke-width="1.8" stroke-linecap="round"/><path d="M410 136l7 6-7 6" fill="none" stroke="#1D1C1A" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="428" y="56" width="208" height="158" rx="8" fill="#FBFAF7" stroke="#C9C3B6"/><text x="442" y="78" fill="#1D1C1A" font-weight="600">Export Netlist</text>
    <path d="M428 88H636" stroke="#E6E2D9"/><rect x="440" y="98" width="56" height="22" rx="4" fill="#1D1C1A"/>
    <text x="468" y="113" text-anchor="middle" fill="#F6F4EF" font-weight="600">KiCad</text><text x="508" y="113" fill="#B5AFA2">OrcadPCB2</text><text x="584" y="113" fill="#B5AFA2">SPICE</text>
    <path d="M440 126H624" stroke="#E6E2D9"/><text x="442" y="146" fill="#8A867E" font-size="10.5">save as</text><text x="494" y="146" fill="#1D1C1A">uno.net</text>
    <rect x="512" y="160" width="112" height="26" rx="6" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="1.5"/>
    <text x="568" y="177" text-anchor="middle" fill="#1D1C1A" font-weight="600" font-size="11">Export Netlist</text>
  </svg></div>
  <p class="note"><svg class="no" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="9" cy="9" r="7.2"/><path d="M4 14 14 4"/></svg>
    <span>We don’t accept <code>.kicad_sch</code>, <code>.kicad_pcb</code>, images or Gerbers. Only the <code>.net</code> file.</span></p>
  <div class="mf"><button class="btn sample-trigger" type="button">${sym('i-flask')}Try a sample instead</button><button class="btn pri" id="got-it" type="button" style="padding:0 24px">Got it</button></div>
</dialog>`;
}

export type LoadStep = 'reading' | 'checking';
/** Loading screen. Three named stages, no counters: the upload is one request. */
export function loadingHtml() {
  return `<section class="loading-view" id="loading-view" aria-labelledby="loading-title" hidden>
  <svg class="meterbig" viewBox="0 0 480 144" role="img" aria-label="Meter: checking">
    <rect width="480" height="144" rx="20" fill="#F3C21B"/><rect x="11" y="11" width="458" height="122" rx="11" fill="#2A2A27"/><rect x="17" y="17" width="446" height="110" rx="7" fill="#C7CBB2"/>
    <g font-family="JetBrains Mono, monospace" fill="#20231A">
      <text x="34" y="44" font-size="11.5" font-weight="600" letter-spacing="1.4">CONTINUITY</text>
      <use href="#i-beep" x="126" y="31" width="16" height="16" style="color:#20231A"/>
      <text x="34" y="76" font-size="18" font-weight="600">CHECKING…</text>
      <rect x="33" y="92" width="58" height="17" rx="2"/><text x="62" y="104.5" text-anchor="middle" font-size="10.5" font-weight="600" fill="#C7CBB2" letter-spacing="1">AUTO</text>
    </g>
    ${segments(262, 32, .62, ['minus', 'minus', 'minus', 'minus'])}
  </svg>
  <h1 id="loading-title">Checking your circuit…</h1>
  <p class="sub">Reading every pin and wire in <span class="mono" id="loading-file"></span>.</p>
  <div class="steps" id="loading-steps" role="status"></div>
</section>`;
}

const spinner = '<svg class="spin" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="#D8D3C8" stroke-width="2"/><path d="M10 2a8 8 0 0 1 8 8" fill="none" stroke="#1D1C1A" stroke-width="2" stroke-linecap="round"/></svg>';
const done = `<span class="ok-dot">${sym('i-check')}</span>`;
const waiting = '<span class="todo-dot"></span>';
export function loadingSteps(step: LoadStep) {
  // Reading and building the graph happen in the same upload request, so they finish together.
  const stages: [string, 'done' | 'now' | 'todo'][] = step === 'reading'
    ? [['Reading your file', 'now'], ['Building the graph', 'now'], ['Checking connections', 'todo']]
    : [['Reading your file', 'done'], ['Building the graph', 'done'], ['Checking connections…', 'now']];
  return stages.map(([label, state]) => `<span class="s ${state}">${state === 'done' ? done : state === 'now' ? spinner : waiting}${label}</span>`)
    .join('<i class="sep"></i>');
}
