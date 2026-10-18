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
    <text x="556" y="583" text-anchor="middle" font-size="11.5" fill="#8A867E">A7 · pin 5</text>
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
      <text x="236" y="63" text-anchor="middle" font-size="32" font-weight="600" fill="#20231A">SHORT</text>
    </g>
  </svg>`;
}

const netDoc = '<svg class="doc" aria-hidden="true"><use href="#i-netfile"/></svg>';

export function landingHtml() {
  return `<section class="landing" id="welcome" aria-labelledby="welcome-title">
  <div class="fold">
  <header class="nav">
    <a class="brand" href="/" aria-label="CircuitDoctor home">${sym('cd-logo')}CircuitDoctor</a>
    <nav class="navr" aria-label="Site"><a href="#how">How it works</a><a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub</a></nav>
  </header>
  <div class="hero">
    <p class="kicker">Continuity test <b>·)))</b> for KiCad netlists</p>
    <h1 class="display" id="welcome-title">Hear the short<br>before you <em>smell</em> it.</h1>
    <p class="sub">CircuitDoctor probes every pin and net in your KiCad netlist, and highlights possible wiring problems before you connect your board.</p>
    <div class="bench-wrap">${bench()}</div>
    <section class="drop dropzone" id="dropzone" aria-live="polite">
      ${netDoc}
      <div class="t"><h3>Drop your KiCad .net file to test it</h3><p>KiCad netlist · .net · up to 10 MiB · Arduino Uno R3, classic Nano</p></div>
      <button class="btn pri lg upload-trigger" type="button">Choose .net file <span class="kbd">${openShortcut}</span></button>
    </section>
    <div class="links">

      <button class="u help-trigger" type="button">Where do I get a .net file?</button>
    </div>
  </div>
  <footer class="foot">
    <div class="feats">
      <div class="feat"><span class="dial">Ω</span><div><b>Graph-backed wiring checks</b><small>Shorts, rails, power pins, I2C</small></div></div>
      <div class="feat"><span class="dial" style="font-size:10px">↔</span><div><b>Trace a connection</b><small>Pin to pin, every hop shown</small></div></div>
      <div class="feat"><span class="dial">?</span><div><b>Ask AI with evidence</b><small>Answers explain your connections</small></div></div>
    </div>
    <div class="pow">Connections from your file. No circuit simulation.</div>
  </footer>
  </div>
  ${belowFoldHtml()}
</section>`;
}

function belowFoldHtml() {
  const kicker = (n: string, text: string) => `<p class="kicker"><i>${n}</i>${text}</p>`;
  return `<section class="sec" id="how" aria-labelledby="how-title">
  <div class="sh"><div>${kicker('01', 'How it works')}<h2 class="display" id="how-title">Three steps.<br>One file.</h2></div>
    <p>No account needed. You export one file from KiCad, drop it here, and we point at the problem.</p></div>
  <div class="steps3">
    <article class="step"><div class="ill"><svg viewBox="0 0 440 208" aria-hidden="true" font-family="JetBrains Mono, monospace">
      <rect x="44" y="34" width="228" height="140" rx="8" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="2"/><path d="M44 56H272" stroke="#1D1C1A" stroke-width="1.5"/>
      <circle cx="58" cy="45" r="3" fill="#B5AFA2"/><circle cx="69" cy="45" r="3" fill="#B5AFA2"/><circle cx="80" cy="45" r="3" fill="#B5AFA2"/>
      <text x="56" y="73" font-size="11" fill="#1D1C1A" font-weight="600">File</text><text x="92" y="73" font-size="11" fill="#8A867E">Edit</text><text x="128" y="73" font-size="11" fill="#8A867E">View</text>
      <rect x="52" y="80" width="112" height="82" rx="5" fill="#FBFAF7" stroke="#C9C3B6"/><text x="62" y="98" font-size="10.5" fill="#8A867E">Save</text><text x="62" y="118" font-size="10.5" fill="#8A867E">Print…</text>
      <rect x="56" y="127" width="104" height="22" rx="4" fill="#1D1C1A"/><text x="62" y="142" font-size="10.5" fill="#F6F4EF" font-weight="600">Export</text><text x="152" y="142" font-size="10.5" fill="#F6F4EF" text-anchor="end">▸</text>
      <rect x="166" y="124" width="96" height="28" rx="5" fill="#FBFAF7" stroke="#1D1C1A" stroke-width="1.5"/><text x="176" y="142" font-size="10.5" fill="#1D1C1A" font-weight="600">Netlist…</text>
      <path d="M290 104H330" stroke="#1D1C1A" stroke-width="2" stroke-linecap="round"/><path d="M323 97l8 7-8 7" fill="none" stroke="#1D1C1A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <use href="#i-netfile" x="348" y="74" width="50" height="59"/><text x="373" y="152" text-anchor="middle" font-size="11" fill="#55524C">uno.net</text></svg></div>
      <div class="tx"><span class="dial">1</span><div><h3>Export from KiCad</h3><p>In your schematic: <span class="mono">File ▸ Export ▸ Netlist…</span> Keep the KiCad format and save.</p></div></div></article>
    <article class="step"><div class="ill"><svg viewBox="0 0 440 208" aria-hidden="true" font-family="JetBrains Mono, monospace">
      <rect x="70" y="96" width="300" height="78" rx="12" fill="#F6F4EF" stroke="#ABA597" stroke-width="1.5" stroke-dasharray="5 4"/><text x="220" y="140" text-anchor="middle" font-size="11.5" fill="#8A867E">drop .net here</text>
      <use href="#i-netfile" x="196" y="18" width="48" height="57"/><path d="M220 82v26" stroke="#1D1C1A" stroke-width="2" stroke-linecap="round"/>
      <path d="M213 101l7 8 7-8" fill="none" stroke="#1D1C1A" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="M176 34v16M166 44v14M264 34v16M274 44v14" stroke="#C9C3B6" stroke-width="2" stroke-linecap="round"/></svg></div>
      <div class="tx"><span class="dial">2</span><div><h3>Drop the .net file</h3><p>Drag it onto the page, or click <strong>Choose .net file</strong>. We read every pin and every wire.</p></div></div></article>
    <article class="step"><div class="ill"><svg viewBox="0 0 440 208" aria-hidden="true" font-family="JetBrains Mono, monospace">
      <path d="M140 92H190V136H250V92H300" fill="none" stroke="#D4362A" stroke-width="3.5" stroke-linejoin="round"/><circle cx="220" cy="136" r="4.5" fill="#D4362A"/>
      <circle cx="140" cy="92" r="9" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="3"/><circle cx="140" cy="92" r="2.8" fill="#1D1C1A"/>
      <circle cx="300" cy="92" r="9" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="3"/><circle cx="300" cy="92" r="2.8" fill="#1D1C1A"/>
      <text x="140" y="122" text-anchor="middle" font-size="11" font-weight="600" fill="#1D1C1A">5V</text><text x="300" y="122" text-anchor="middle" font-size="11" font-weight="600" fill="#1D1C1A">GND</text>
      <use href="#probe-red" transform="translate(138 90) rotate(13) scale(.32)"/><use href="#probe-black" transform="translate(302 90) scale(-1 1) rotate(13) scale(.32)"/>
      <path d="M220 141v15" stroke="#D4362A" stroke-width="1.5"/><rect x="180" y="156" width="80" height="22" rx="11" fill="#D4362A"/>
      <text x="220" y="171" text-anchor="middle" font-size="11" font-weight="600" fill="#fff">same wire</text></svg></div>
      <div class="tx"><span class="dial">3</span><div><h3>See the short in red &amp; fix it</h3><p>The red and black probes mark the two pins that share a wire. Separate them in KiCad, then check the new file.</p></div></div></article>
  </div>
</section>
<section class="sec" id="checks" aria-labelledby="checks-title">
  <div class="sh"><div>${kicker('02', 'What it checks')}<h2 class="display" id="checks-title">Wiring problems<br>we check</h2></div>
    <p>Wiring checks use fixed rules on the connections in your file, so the same file produces the same wiring-check results. Power and I2C checks cover the Arduino Uno R3, the classic Nano and supported OLED / LCD displays.</p></div>
  <div class="checks">
    <div>
      <div class="ck"><span class="n">01</span><b>Power shorted to ground</b><code>5V ↔ GND</code></div>
      <div class="ck"><span class="n">02</span><b>Two different voltages joined</b><code>5V ↔ 3V3</code></div>
      <div class="ck"><span class="n">03</span><b>Display missing power</b><code>OLED / LCD</code></div>
      <div class="ck"><span class="n">04</span><b>Display voltage too high or too low</b><code>VCC vs. rail</code></div>
    </div>
    <div>
      <div class="ck"><span class="n">05</span><b>I2C SDA / SCL swapped or missing</b><code>board I2C pins</code></div>
      <div class="ck"><span class="n">06</span><b>Pull-up resistors on I2C</b><code>SDA · SCL</code></div>
      <div class="ck"><span class="n">07</span><b>Unconnected pins &amp; parts cut off</b><code>every part</code></div>
      <div class="ck"><span class="n">08</span><b>Find a route between pins</b><code>pin → pin</code></div>
    </div>
  </div>
  <p class="checks-note"><span class="ok-dot">${sym('i-check')}</span>Checks that pass stay quiet. Other parts are still shown, and checked for unconnected pins and separate groups.</p>
</section>
<section class="sec" id="graph" aria-labelledby="graph-title">
  <div class="why">
    <div>${kicker('03', 'Follow the connections')}<h2 class="display" id="graph-title">A circuit is<br>already a graph.</h2>
      <p class="body">Parts have pins, and pins sit on wires (nets). CircuitDoctor follows those connections to help you understand which pins share a wire.</p>
      <p class="body">Trace the route between two pins over wires and through two-pin resistors. Each step shows which connection to inspect.</p></div>
    <div class="gpanel">
      <div class="ph"><h2>How parts connect</h2></div>
      <div class="gd"><svg viewBox="0 0 880 236" role="img" aria-label="A component has pins; each pin is on a net" font-family="JetBrains Mono, monospace">
        <rect x="56" y="70" width="176" height="96" rx="10" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="2"/>
        <text x="72" y="58" font-size="10.5" letter-spacing="1.2" fill="#8A867E">COMPONENT</text>
        <text x="76" y="110" font-family="Bricolage Grotesque Variable, Bricolage Grotesque, sans-serif" font-size="19" font-weight="650" fill="#1D1C1A">Arduino Uno</text>
        <text x="76" y="134" font-size="11.5" fill="#8A867E">A7 · Uno R3</text>
        <path d="M232 118H352" stroke="#1D1C1A" stroke-width="2"/><path d="M344 111l9 7-9 7" fill="none" stroke="#1D1C1A" stroke-width="2" stroke-linejoin="round"/>
        <rect x="246" y="96" width="92" height="18" rx="4" fill="#EFECE5"/><text x="292" y="109" text-anchor="middle" font-size="10.5" fill="#55524C">has pin</text>
        <text x="398" y="58" text-anchor="middle" font-size="10.5" letter-spacing="1.2" fill="#8A867E">PIN</text>
        <circle cx="398" cy="118" r="38" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="2"/>
        <text x="398" y="117" text-anchor="middle" font-size="15" font-weight="600" fill="#1D1C1A">5V</text><text x="398" y="135" text-anchor="middle" font-size="10.5" fill="#8A867E">pin 5</text>
        <path d="M436 118H556" stroke="#1D1C1A" stroke-width="2"/><path d="M548 111l9 7-9 7" fill="none" stroke="#1D1C1A" stroke-width="2" stroke-linejoin="round"/>
        <rect x="452" y="96" width="88" height="18" rx="4" fill="#EFECE5"/><text x="496" y="109" text-anchor="middle" font-size="10.5" fill="#55524C">on wire</text>
        <text x="576" y="58" font-size="10.5" letter-spacing="1.2" fill="#8A867E">NET</text>
        <rect x="560" y="96" width="132" height="44" rx="22" fill="#F6F4EF" stroke="#1D1C1A" stroke-width="2"/><text x="626" y="123" text-anchor="middle" font-size="14" font-weight="600" fill="#1D1C1A">/SUPPLY</text>
        <path d="M692 118H732M732 84V152M732 84H760M732 118H760M732 152H760" fill="none" stroke="#BDB7AB" stroke-width="2"/>
        <circle cx="768" cy="84" r="8" fill="#F6F4EF" stroke="#BDB7AB" stroke-width="2"/><circle cx="768" cy="118" r="8" fill="#F6F4EF" stroke="#BDB7AB" stroke-width="2"/><circle cx="768" cy="152" r="8" fill="#F6F4EF" stroke="#BDB7AB" stroke-width="2"/>
        <text x="784" y="88" font-size="11" fill="#8A867E">A7·GND ×3</text><text x="784" y="122" font-size="11" fill="#8A867E">J9·2</text><text x="784" y="156" font-size="11" fill="#8A867E">R12·1</text>
        <text x="440" y="208" text-anchor="middle" font-size="11.5" fill="#8A867E">Upload your circuit to explore its connections.</text>
      </svg></div>
      <div class="query"><span class="lbl">Follow each connection</span><p class="res">Choose two pins to see their route, then select a connection to highlight it on the drawing.</p></div>
    </div>
  </div>
</section>
<section class="sec" id="faq" aria-labelledby="faq-title">
  <div class="sh"><div>${kicker('04', 'Questions')}<h2 class="display" id="faq-title">Good to know.</h2></div><p></p></div>
  <div class="faq">
    <div>
      <div class="qa"><h3>Is this a simulator?</h3><p><b>No.</b> We only read which pins are connected in your file. We don’t model current, timing or parts behaving.</p></div>
      <div class="qa"><h3>Which boards does it know?</h3><p><b>Arduino Uno R3 and classic Nano.</b> Other parts are shown and checked for unconnected pins and separate groups.</p></div>
    </div>
    <div>
      <div class="qa"><h3>Do I need an account?</h3><p><b>No.</b> Drop a file and you get results. Nothing to sign up for.</p></div>
      <div class="qa"><h3>Does AI decide the result?</h3><p><b>No.</b> Wiring checks use fixed rules. AI explains the results and connections in plain words using your circuit’s evidence. Its wording can vary.</p></div>
    </div>
  </div>
</section>
<section class="close" aria-label="Upload a netlist">
  <svg class="doc" aria-hidden="true"><use href="#i-netfile"/></svg>
  <div><h3>Ready when your board is.</h3><p>KiCad netlist · .net · up to 10 MiB · Arduino Uno R3, classic Nano</p></div>
  <div class="btns"><button class="btn pri lg upload-trigger" type="button">Choose .net file <span class="kbd">${openShortcut}</span></button></div>
</section>
<footer class="pfoot">
  <div class="brand sm">${sym('cd-logo')}CircuitDoctor</div>
  <nav aria-label="Footer"><a href="#how">How it works</a><a href="${GITHUB_URL}" target="_blank" rel="noopener noreferrer">GitHub</a></nav>
  <div class="pow">Connections from your file. No circuit simulation.</div>
</footer>`;
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
    <div class="t" role="status"><h3>CircuitDoctor is temporarily unavailable.</h3><p>Please try again shortly.</p></div>
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
  <div class="mf"><button class="btn pri" id="got-it" type="button" style="padding:0 24px">Got it</button></div>
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
