import "@fontsource-variable/inter";
import "./style.css";
import { icon } from "./icons";
import { CircuitGraph } from "./graph";
import { ExplanationRequest, type ExplanationState } from "./explanation";
import { ReviewRequest, type ReviewState, type Finding } from "./review";
import {
  componentKind,
  displayValue,
  escapeHtml as esc,
  isUnused,
  netLabel,
  pinName,
  type Circuit,
  type Selection,
  type View,
} from "./types";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let circuit: Circuit | null = null;
let selection: Selection | null = null;
let graph: CircuitGraph | null = null;
let view: View = "graph";
let filename = "";
let query = "";
let showUnused = false;
let requestId = 0;
const explanationRequest = new ExplanationRequest();
let explanation: ExplanationState = { status: "idle" };
const reviewRequest = new ReviewRequest();
let review: ReviewState = { status: "idle" };
let selectedFinding: Finding | null = null;

function clearReview() {
  reviewRequest.cancel();
  review = { status: "idle" };
  selectedFinding = null;
  $("#selected-finding").hidden = true;
  $("#selected-finding").innerHTML = "";
  renderReview();
}

function clearExplanation() {
  explanationRequest.cancel();
  explanation = { status: "idle" };
  graph?.highlightEvidence(null);
}

$("#app").innerHTML = `
<header class="topbar">
  <a class="brand" href="/" aria-label="CircuitDoctor home"><img src="/favicon.svg" alt=""/>CircuitDoctor</a>
  <div class="header-actions"><span class="connection-status" id="connection-status" role="status"><i></i> Connecting…</span><button class="button secondary upload-trigger" id="replace-file" hidden>${icon("upload", 16)} Upload another</button><button class="icon-button help-trigger" aria-label="How to export a netlist" title="How to export a netlist">${icon("help")}</button></div>
</header>
<main>
  <input id="file-input" type="file" accept=".net" hidden />
  <div id="notice" role="alert" hidden></div>
  <section class="welcome" id="welcome" aria-labelledby="welcome-title">
    <p class="supported-boards">ARDUINO UNO R3 <span>·</span> CLASSIC NANO</p>
    <h1 id="welcome-title">Understand your circuit.</h1>
    <p class="welcome-description">Bring your KiCad netlist. See what’s connected,<br class="desktop-break"/> and follow every pin.</p>
    <div class="upload-zone" id="dropzone">
      <span class="upload-symbol">${icon("upload", 28)}</span>
      <button class="button primary upload-trigger">Upload .net file ${icon("arrow", 17)}</button>
      <p class="drop-hint">or drag your file here</p>
      <span class="file-note">KiCad netlist · Up to 10 MiB</span>
    </div>
    <button class="text-button help-trigger">Where do I get a .net file? ${icon("chevron", 14)}</button>
    <p class="scope-note">Explore connections and check Arduino power-rail wiring. Full electrical diagnosis and AI chat are still in development.</p>
  </section>
  <div id="loading-overlay" class="loading-overlay" role="status" hidden><span class="spinner"></span> Reading your circuit…</div>
  <section class="circuit-section" id="circuit-section" aria-label="Your uploaded circuit" hidden>
    <div class="circuit-topline"><div class="circuit-title-group"><span class="file-icon">${icon("file", 23)}</span><div><h1 id="circuit-title"></h1><p id="circuit-summary"></p></div></div><button class="icon-button" id="clear-circuit" aria-label="Close circuit and return to upload" title="Close circuit">${icon("close", 19)}</button></div>
    <section class="review-panel" aria-label="Circuit review">
      <div class="review-heading"><div><h2>Circuit review</h2><p>Check connections and supported Arduino power rails.</p></div><button id="run-review" class="button primary">Run review</button></div>
      <div id="review-results" aria-live="polite"></div>
    </section>
    <div class="workbench">
      <section class="explorer-panel" aria-label="Circuit explorer">
        <div class="explorer-toolbar"><div class="view-tabs" role="tablist" aria-label="Circuit views">
          <button data-view="graph" role="tab" aria-selected="true" class="active">Circuit</button>
          <button data-view="components" role="tab" aria-selected="false">Components</button>
          <button data-view="nets" role="tab" aria-selected="false">Connections</button>
        </div><button class="icon-button" id="expand-canvas" aria-label="Expand workspace" title="Expand workspace">${icon("fit", 18)}</button></div>
        <div class="explorer-subbar"><label class="search-field">${icon("search", 16)}<input id="search" placeholder="Find a component or net" aria-label="Find a component or net"/></label><label class="toggle-label"><input type="checkbox" id="unused-toggle"/><span>Show unused pins</span></label></div>
        <div class="canvas-wrap"><div id="graph-view" class="graph-view" role="tabpanel" aria-label="Circuit graph. Use Components and Connections for keyboard-accessible details."></div><div id="list-view" class="list-view" role="tabpanel" hidden></div><div id="canvas-empty" class="canvas-empty" hidden><h2>No components in this file</h2><p>Upload a netlist with components and connections to explore.</p></div><div class="graph-controls" id="graph-controls"><button class="icon-button" id="zoom-out" aria-label="Zoom out">${icon("minus", 16)}</button><span id="zoom-value">100%</span><button class="icon-button" id="zoom-in" aria-label="Zoom in">${icon("plus", 16)}</button><button class="icon-button" id="fit-view" aria-label="Fit graph to screen">${icon("fit", 17)}</button><button class="reset-layout" id="reset-layout" title="Restore automatic placement">Reset layout</button></div><span class="canvas-hint" id="canvas-hint">Drag parts / ○ wire bends · Double-click part to zoom</span></div>
        <div class="graph-footer"><div class="legend"><span><i class="legend-component"></i> Component</span><span><i class="legend-net"></i> Wire junction</span><span><i class="legend-single"></i> Single pin</span></div><span id="graph-summary"></span></div>
      </section>
      <aside class="inspector" aria-label="Connection details"><div class="panel-heading"><h2>Connection details</h2></div><div id="selected-finding" hidden></div><div id="inspector-body"></div><section id="explanation-panel" class="explanation-panel" aria-label="Connection explanation" hidden></section></aside>
    </div>
    <p class="scope-note">Gold sockets are connected pins. Drag the open circles to route wires. Board labels form an enlarged pin map, not a physical wiring template.</p>
    <details id="storage-details" class="file-details"><summary>File details</summary><p id="read-status"></p><p id="storage-info"></p><div class="file-actions"><button class="button secondary" id="reload-circuit">Reload saved circuit</button><button class="button secondary" data-view="data">View JSON</button><button class="button secondary" id="copy-json">Copy JSON</button></div><pre class="json-view" id="storage-query"></pre></details>
  </section>
</main>
<footer>Connections from your file. No circuit simulation.</footer>
<div class="drop-overlay" id="drop-overlay" hidden>${icon("upload", 32)}<strong>Drop your .net file</strong></div>
<dialog id="help-dialog" aria-labelledby="help-title"><button class="icon-button dialog-close" id="close-help" aria-label="Close help">${icon("close")}</button><h2 id="help-title">Export your circuit from KiCad</h2><ol><li>Open your circuit in the schematic editor.</li><li>Select <strong>File → Export → Netlist</strong>.</li><li>Choose the <strong>KiCad</strong> format and save the <strong>.net</strong> file.</li><li>Upload that file here to explore its connections.</li></ol><p>Uploads are stored in your local database. Images, PCB files and schematics cannot be uploaded directly.</p><button class="button primary" id="got-it">Got it</button></dialog>
<div id="toast" class="toast" role="status" hidden></div>`;

function connectionState(online: boolean) {
  const element = $("#connection-status");
  element.classList.toggle("offline", !online);
  element.innerHTML = `<i></i> ${online ? "Ready" : "Service unavailable"}`;
}
function notice(message = "") {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 3000);
}
function setBusy(value: boolean) {
  $("#loading-overlay").hidden = !value;
  $("#dropzone").classList.toggle("loading", value);
  $("#read-status").innerHTML = value
    ? '<span class="spinner small"></span> Saving and loading circuit'
    : circuit
      ? `${icon("check", 14)} Loaded from FalkorDB`
      : "";
  document.querySelectorAll<HTMLButtonElement>(".upload-trigger, #reload-circuit").forEach((b) => {
    b.disabled = value;
  });
}
async function readCircuit(
  url: string,
  name: string,
  options: RequestInit = {},
) {
  clearExplanation();
  clearReview();
  renderExplanation();
  const currentRequest = ++requestId;
  setBusy(true);
  notice();
  try {
    let response = await fetch(url, options);
    if (response.ok && options.method === "POST") {
      const receipt = (await response.json()) as { circuit_id: string };
      response = await fetch(`/api/circuits/${encodeURIComponent(receipt.circuit_id)}`);
    }
    if (!response.ok) {
      if (response.status >= 500 && currentRequest === requestId)
        connectionState(false);
      const error = await response
        .json()
        .catch(() => ({
          detail: "The local API or FalkorDB is unavailable. Start the services and try again.",
        }));
      throw new Error(
        typeof error.detail === "string"
          ? error.detail
          : "Could not read this netlist.",
      );
    }
    const result = (await response.json()) as Circuit;
    if (currentRequest !== requestId) return;
    if (result.storage?.source !== "falkordb") {
      throw new Error("The server did not return a stored circuit.");
    }
    clearExplanation();
    clearReview();
    circuit = result;
    filename = result.storage.filename || name;
    history.replaceState(null, "", `#circuit=${result.storage.circuit_id}`);
    view = "graph";
    showUnused = false;
    $<HTMLInputElement>("#unused-toggle").checked = false;
    query = "";
    $<HTMLInputElement>("#search").value = "";
    const first =
      result.components.find((c) => componentKind(c) === "board") ||
      result.components[0];
    selection = first ? { kind: "component", id: first.ref } : null;
    connectionState(true);
    renderCircuit();
  } catch (error) {
    if (currentRequest !== requestId) return;
    const message =
      error instanceof Error ? error.message : "Unable to load this netlist.";
    notice(
      `${message}${circuit ? " Your previous circuit is still displayed." : ""}`,
    );
    if (error instanceof TypeError) connectionState(false);
  } finally {
    if (currentRequest === requestId) setBusy(false);
  }
}
async function upload(file: File | undefined) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".net")) {
    notice(
      "Choose a KiCad .net file. Schematics, images and PCB files cannot be read here.",
    );
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    notice("This file is larger than 10 MiB. Choose a smaller netlist.");
    return;
  }
  await readCircuit(`/api/circuits?filename=${encodeURIComponent(file.name)}`, file.name, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
}
function renderCircuit() {
  if (!circuit) return;
  $("#welcome").hidden = true;
  $("#circuit-section").hidden = false;
  $("#replace-file").hidden = false;
  $("#storage-info").textContent = `Saved in FalkorDB · ${circuit.storage.graph_name}`;
  $("#storage-query").textContent = circuit.storage.query;
  const boards = circuit.components.filter((c) => componentKind(c) === "board");
  const board = boards.length === 1
    ? (boards[0].libsource.part || boards[0].value) === "Arduino_UNO_R3" ? "Arduino Uno R3" : "Classic Nano"
    : boards.length > 1 ? `${boards.length} Arduino boards` : "Board not identified";
  $("#circuit-title").textContent = filename;
  $("#circuit-summary").textContent = `${board} · ${circuit.components.length} components · ${circuit.nets.length} nets`;
  $("#copy-json").removeAttribute("disabled");
  $("#canvas-empty").hidden = circuit.components.length > 0 || circuit.nets.length > 0;
  renderView();
  renderInspector();
  renderReview();
}
function selectItem(value: Selection) {
  selectedFinding = null;
  clearExplanation();
  selection = value;
  graph?.select(selection);
  renderInspector();
  if (view === "components" || view === "nets") renderList();
}
function renderView() {
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((button) => {
      const active = button.dataset.view === view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
  const isGraph = view === "graph";
  $("#graph-view").hidden = !isGraph;
  $("#list-view").hidden = isGraph;
  $("#graph-controls").hidden = !isGraph;
  $("#canvas-hint").hidden = !isGraph;
  $(".toggle-label").classList.toggle(
    "invisible",
    view === "components" || view === "data",
  );
  $<HTMLInputElement>("#search").toggleAttribute("disabled", view === "data");
  graph?.destroy();
  graph = null;
  if (!circuit) return;
  if (isGraph) {
    graph = new CircuitGraph(
      $("#graph-view"),
      circuit,
      showUnused,
      selectItem,
      (value) => {
        $("#zoom-value").textContent = `${value}%`;
      },
    );
    graph.select(selection);
    graph.search(query);
    graph.highlightEvidence(selectedFinding || (explanation.status === "success" ? explanation.result : null));
  } else renderList();
  const shown = circuit.nets.filter((n) => showUnused || !isUnused(n)).length;
  $("#graph-summary").textContent =
    `${circuit.components.length} components · ${shown} nets in view`;
}
function renderList() {
  if (!circuit) return;
  const filter = query.toLowerCase();
  if (view === "data") {
    $("#list-view").innerHTML =
      `<pre class="json-view">${esc(JSON.stringify(circuit, null, 2))}</pre>`;
  } else if (view === "components") {
    const list = circuit.components.filter((c) =>
      `${c.ref} ${c.value} ${c.libsource.part}`.toLowerCase().includes(filter),
    );
    $("#list-view").innerHTML =
      `<div class="table-caption">${list.length} component${list.length === 1 ? "" : "s"} in this view</div><table><thead><tr><th>Reference</th><th>Component</th><th>Library</th><th></th></tr></thead><tbody>${list.map((c) => `<tr class="${selection?.kind === "component" && selection.id === c.ref ? "selected-row" : ""}"><td><button class="reference-button" data-component="${esc(c.ref)}">${esc(c.ref)}</button></td><td>${esc(displayValue(c))}</td><td class="muted-cell">${esc(c.libsource.lib || "Unknown")}</td><td><button class="icon-button" data-component="${esc(c.ref)}" aria-label="Inspect ${esc(c.ref)}">${icon("chevron", 15)}</button></td></tr>`).join("")}</tbody></table>${!list.length ? '<div class="no-results">No components match your search.</div>' : ""}`;
  } else {
    const nets = circuit.nets.filter(
      (n) =>
        (showUnused || !isUnused(n)) &&
        `${n.name} ${n.nodes.map((p) => `${p.ref} ${p.pin}`).join(" ")}`
          .toLowerCase()
          .includes(filter),
    );
    $("#list-view").innerHTML =
      `<div class="table-caption">${nets.length} net${nets.length === 1 ? "" : "s"} in this view</div><table><thead><tr><th>Net</th><th>Connected pins</th><th></th></tr></thead><tbody>${nets.map((n) => `<tr class="${selection?.kind === "net" && selection.id === n.code ? "selected-row" : ""}"><td><button class="net-button" data-net="${esc(n.code)}">${esc(netLabel(n))}</button><small class="net-note">${isUnused(n) ? "Intentionally unused" : n.nodes.length === 1 ? "Single pin" : `${n.nodes.length} pins`}</small></td><td class="pin-cell">${esc(n.nodes.map((p) => `${p.ref}.${p.pin}`).join(", "))}</td><td><button class="icon-button" data-net="${esc(n.code)}" aria-label="Inspect net ${esc(n.name)}">${icon("chevron", 15)}</button></td></tr>`).join("")}</tbody></table>${!nets.length ? '<div class="no-results">No nets match your search. Try including unused pins.</div>' : ""}`;
  }
}
function renderInspector() {
  const findingPanel = $("#selected-finding");
  findingPanel.hidden = !selectedFinding;
  findingPanel.innerHTML = selectedFinding ? `<div class="finding-detail"><span class="finding-severity">${selectedFinding.severity === "warning" ? "Check this connection" : "Information"}</span><h3>${esc(selectedFinding.title)}</h3><p>${esc(selectedFinding.message)}</p><p><strong>What to check:</strong> ${esc(selectedFinding.suggestion)}</p>${sourceLinks(selectedFinding.sources || [])}</div>` : "";
  renderExplanation();
  if (!circuit || !selection) {
    $("#inspector-body").innerHTML =
      '<div class="inspector-empty">Select a component or net to inspect it.</div>';
    return;
  }
  if (selection.kind === "pin") {
    const selected = selection;
    const member = circuit.nets.flatMap(net => net.nodes).find(p => p.ref === selected.ref && p.pin === selected.pin);
    const nets = circuit.nets.filter(net => net.nodes.some(p => p.ref === selected.ref && p.pin === selected.pin));
    $("#inspector-body").innerHTML = `<div class="component-heading"><span class="component-symbol">${icon("chip", 25)}</span><div><span class="component-ref">${esc(selected.ref)} · PIN ${esc(selected.pin)}</span><h4>${esc(member ? pinName(circuit, member) : `Pin ${selected.pin}`)}</h4></div></div><p class="inspector-description">Follow this pin’s connections in your uploaded circuit.</p><div class="pin-list">${nets.map(net => `<button class="pin-row" data-net="${esc(net.code)}">${icon("net", 16)}<span><strong>${esc(netLabel(net))}</strong><small>View this net</small></span>${icon("chevron", 13)}</button>`).join("")}<button class="text-button" data-component="${esc(selected.ref)}">Back to ${esc(selected.ref)}</button></div>`;
  } else if (selection.kind === "component") {
    const comp = circuit.components.find((c) => c.ref === selection!.id);
    if (!comp) return;
    const connections = circuit.nets.flatMap((net) =>
      net.nodes.filter((p) => p.ref === comp.ref).map((pin) => ({ net, pin })),
    );
    const active = connections.filter((c) => !isUnused(c.net));
    const library = circuit.libparts.find(
      (p) => p.lib === comp.libsource.lib && p.part === comp.libsource.part,
    );
    const kind = componentKind(comp);
    $("#inspector-body").innerHTML =
      `<div class="component-heading"><span class="component-symbol ${kind}">${icon(kind === "board" || kind === "component" ? "chip" : kind, 26)}</span><div><span class="component-ref">${esc(comp.ref)}</span><h4>${esc(displayValue(comp))}</h4></div></div><dl class="component-facts"><div><dt>Symbol library</dt><dd>${esc(comp.libsource.lib || "Unknown")}</dd></div><div><dt>Exported pins</dt><dd>${library?.pins.length ?? connections.length}</dd></div><div><dt>Pins shown</dt><dd>${active.length}</dd></div></dl><div class="connections-heading">CONNECTIONS <span>${active.length}</span></div><div class="pin-list">${active.map(({ net, pin }) => `<button class="pin-row" data-pin-ref="${esc(pin.ref)}" data-pin="${esc(pin.pin)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pinName(circuit!, pin))}</strong><small>${esc(netLabel(net))}</small></span>${icon("chevron", 13)}</button>`).join("") || '<p class="inspector-description">No pins are shown. Exported unused pins are hidden here.</p>'}</div>${connections.length > active.length ? `<div class="unused-note">${icon("help", 14)} ${connections.length - active.length} pins marked unused in the file.</div>` : ""}`;
  } else {
    const net = circuit.nets.find((n) => n.code === selection!.id);
    if (!net) return;
    $("#inspector-body").innerHTML =
      `<div class="component-heading"><span class="component-symbol net-symbol">${icon("net", 25)}</span><div><span class="component-ref">NET ${esc(net.code)}</span><h4>${esc(netLabel(net))}</h4></div></div><p class="net-full-name">${esc(net.name)}</p><dl class="component-facts"><div><dt>Pin memberships</dt><dd>${net.nodes.length}</dd></div><div><dt>Components</dt><dd>${new Set(net.nodes.map((p) => p.ref)).size}</dd></div></dl>${net.nodes.length === 1 ? `<p class="single-pin-note">${isUnused(net) ? "This pin is marked intentionally unused in the netlist." : "This net contains one pin. This is a connectivity observation, not a diagnosis."}</p>` : ""}<div class="connections-heading">ON THIS NET <span>${net.nodes.length}</span></div><div class="pin-list">${net.nodes.map((pin) => `<button class="pin-row" data-pin-ref="${esc(pin.ref)}" data-pin="${esc(pin.pin)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pin.ref)} · ${esc(pinName(circuit!, pin))}</strong><small>${esc(pin.pintype)}</small></span>${icon("chevron", 13)}</button>`).join("")}</div>`;
  }
}

function renderExplanation() {
  const panel = $("#explanation-panel");
  panel.hidden = !circuit || !selection || selection.kind === "component";
  if (panel.hidden) return;
  const loading = explanation.status === "loading";
  panel.innerHTML = `<button id="explain-connection" class="button primary" ${loading ? 'disabled' : ''}>${loading ? '<span class="spinner small"></span> Reading connections…' : "Explain connection"}</button><button id="trace-power" class="button secondary" ${loading ? 'disabled' : ''}>Trace power rail</button><div id="explanation-result" aria-live="polite" aria-atomic="true">${explanation.status === "success" ? `<p class="evidence-source">${icon("check", 14)} From your saved circuit</p><p class="explanation-summary">${esc(explanation.result.summary)}</p><p class="explanation-hint">Matching pins and wires are highlighted in the Circuit view.</p>${explanation.result.tool === "trace_power" ? `<h4>Direct power connections</h4>${(explanation.result.warnings || []).map(w => `<p class="explanation-error">${esc(w)}</p>`).join("")}<details><summary>Trace limits &amp; sources</summary>${explanation.result.limitations.map(l => `<p class="explanation-limit">${esc(l)}</p>`).join("")}${sourceLinks(explanation.result.sources || [])}</details>` : `<p class="explanation-limit">Connectivity only · This does not confirm whether the circuit works.</p>`}` : explanation.status === "error" ? `<p class="explanation-error" role="alert">${esc(explanation.message)}</p>` : '<p class="explanation-hint">Explain any connection, or trace a known Arduino power pin and the parts on its net.</p>'}</div>`;
}
async function explainSelection(mode: "explain" | "power-trace" = "explain") {
  if (!circuit || !selection || selection.kind === "component") return;
  selectedFinding = null;
  renderInspector();
  graph?.highlightEvidence(null);
  await explanationRequest.run(circuit.storage.circuit_id, selection, state => {
    explanation = state;
    renderExplanation();
    graph?.highlightEvidence(state.status === "success" ? state.result : null);
  }, mode);
}

function sourceLinks(sources: { title: string; url: string }[]) {
  return sources.filter(source => source.url.startsWith("https://docs.arduino.cc/")).map(source => `<a class="spec-source" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>`).join("");
}
function renderReview() {
  const button = $<HTMLButtonElement>("#run-review");
  button.disabled = review.status === "loading";
  button.textContent = review.status === "loading" ? "Reviewing…" : review.status === "success" ? "Run again" : review.status === "error" ? "Retry review" : "Run review";
  const panel = $("#review-results");
  if (review.status === "idle") { panel.innerHTML = ""; return; }
  if (review.status === "loading") { panel.innerHTML = '<p class="review-note" role="status">Reading saved connections from FalkorDB…</p>'; return; }
  if (review.status === "error") { panel.innerHTML = `<p class="explanation-error" role="alert">${esc(review.message)}</p>`; return; }
  const result = review.result;
  const warnings = result.findings.filter(f => f.severity === "warning");
  const information = result.findings.filter(f => f.severity === "info");
  const cards = (items: Finding[]) => items.map(f => `<button class="finding-card ${f.severity}" data-finding="${esc(f.id)}"><span>${f.severity === "warning" ? "Possible issue" : "Information"}</span><strong>${esc(f.title)}</strong><p>${esc(f.message)}</p><small>Inspect connection →</small></button>`).join("");
  const heading = result.status === "incomplete" ? "Not enough circuit data to review" : warnings.length ? `${warnings.length} connection${warnings.length === 1 ? "" : "s"} to check` : "No warnings from the available checks";
  panel.innerHTML = `<h3 class="review-summary">${esc(heading)}</h3><p class="review-note">${result.summary.nets} nets checked · ${result.summary.marked_unused_pins} pins marked unused. Includes limited Arduino power-rail checks; this does not confirm that the circuit works.</p><div class="finding-list">${cards(warnings)}</div>${information.length ? `<details class="review-details"><summary>${information.length} informational finding${information.length === 1 ? "" : "s"}</summary><div class="finding-list">${cards(information)}</div></details>` : ""}<details class="review-details"><summary>Board specifications used · ${result.electrical.recognized_parts.length} matched</summary><p>${result.electrical.checked_nets} nets checked using ${result.electrical.matched_power_pins} identified power/ground pins. Checks: ${esc(result.electrical.checks.join("; "))}.</p>${result.electrical.recognized_parts.map(part => `<p><strong>${esc(part.ref)} · ${esc(part.name)}</strong></p>${sourceLinks(part.sources)}`).join("")}<p>${result.electrical.unknown_components.length ? `No electrical specifications for: ${esc(result.electrical.unknown_components.join(", "))}. Their connections are still included.` : "All component identities matched the supported board catalog."}</p></details><details class="review-details"><summary>What we cannot verify yet</summary>${result.cannot_verify.map(item => `<p><strong>${esc(item.check)}:</strong> ${esc(item.reason)}</p>`).join("")}<p>${result.summary.unknown_pin_names} pins have no name metadata; ${result.summary.unknown_pin_types} have no type metadata. No board pin mapping or electrical limits were guessed.</p></details>`;
}
async function runReview() {
  if (!circuit) return;
  clearExplanation();
  selectedFinding = null;
  renderInspector();
  await reviewRequest.run(circuit.storage.circuit_id, state => { review = state; renderReview(); });
}
function inspectFinding(id: string) {
  if (review.status !== "success") return;
  const finding = review.result.findings.find(f => f.id === id);
  if (!finding) return;
  const selector = finding.selection;
  selectItem('net_code' in selector ? { kind: "net", id: selector.net_code } : {
    kind: "pin", id: `p:${JSON.stringify([selector.ref, selector.pin])}`, ref: selector.ref, pin: selector.pin,
  });
  selectedFinding = finding;
  view = "graph";
  query = "";
  $<HTMLInputElement>("#search").value = "";
  renderView();
  renderInspector();
  $(".workbench").scrollIntoView({ block: "start", behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("#run-review:not(:disabled)")) void runReview();
  const finding = target.closest<HTMLElement>("[data-finding]");
  if (finding) inspectFinding(finding.dataset.finding!);
  if (target.closest(".upload-trigger:not(:disabled)")) $("#file-input").click();
  if (target.closest(".help-trigger"))
    $<HTMLDialogElement>("#help-dialog").showModal();
  if (target.closest("#close-help, #got-it"))
    $<HTMLDialogElement>("#help-dialog").close();
  const tab = target.closest<HTMLElement>("[data-view]");
  if (tab) {
    view = tab.dataset.view as View;
    renderView();
  }
  if (target.closest("#explain-connection:not(:disabled)")) void explainSelection();
  if (target.closest("#trace-power:not(:disabled)")) void explainSelection("power-trace");
  const pin = target.closest<HTMLElement>("[data-pin-ref]");
  if (pin) selectItem({ kind: "pin", id: `p:${JSON.stringify([pin.dataset.pinRef!, pin.dataset.pin!])}`, ref: pin.dataset.pinRef!, pin: pin.dataset.pin! });
  const comp = target.closest<HTMLElement>("[data-component]");
  if (comp) selectItem({ kind: "component", id: comp.dataset.component! });
  const net = target.closest<HTMLElement>("[data-net]");
  if (net) selectItem({ kind: "net", id: net.dataset.net! });
});
$("#file-input").addEventListener("change", (event) => {
  const input = event.target as HTMLInputElement;
  void upload(input.files?.[0]);
  input.value = "";
});
const dropOverlay = $("#drop-overlay");
let dragDepth = 0;
const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
document.addEventListener("dragenter", (event) => {
  if (!hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  dropOverlay.hidden = false;
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dropOverlay.hidden = true;
});
document.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropOverlay.hidden = true;
  if (!hasFiles(event)) return;
  if (event.dataTransfer?.files.length !== 1) {
    notice("Drop one netlist at a time.");
    return;
  }
  void upload(event.dataTransfer.files[0]);
});
$<HTMLInputElement>("#search").addEventListener("input", (event) => {
  query = (event.target as HTMLInputElement).value;
  graph?.search(query);
  if (view !== "graph") renderList();
});
$("#unused-toggle").addEventListener("change", (event) => {
  showUnused = (event.target as HTMLInputElement).checked;
  renderView();
});
$("#zoom-in").onclick = () => graph?.zoomBy(1.2);
$("#zoom-out").onclick = () => graph?.zoomBy(1 / 1.2);
$("#fit-view").onclick = () => graph?.fit();
$("#reset-layout").onclick = () => graph?.resetLayout();
function setExpanded(expanded: boolean) {
  $(".explorer-panel").classList.toggle("expanded", expanded);
  document.body.classList.toggle("canvas-expanded", expanded);
  $("#expand-canvas").setAttribute("aria-label", expanded ? "Close expanded workspace" : "Expand workspace");
  $("#expand-canvas").title = expanded ? "Close expanded workspace (Esc)" : "Expand workspace";
  $("#expand-canvas").innerHTML = icon(expanded ? "close" : "fit", 18);
}
$("#expand-canvas").onclick = () => setExpanded(!$(".explorer-panel").classList.contains("expanded"));
document.addEventListener("keydown", event => {
  if (event.key === "Escape") setExpanded(false);
});
$("#clear-circuit").onclick = () => {
  setExpanded(false);
  clearExplanation();
  clearReview();
  requestId++; // Discard any pending response without deleting stored data.
  graph?.destroy();
  graph = null;
  circuit = null;
  selection = null;
  history.replaceState(null, "", location.pathname + location.search);
  $("#welcome").hidden = false;
  $("#circuit-section").hidden = true;
  $("#replace-file").hidden = true;
  $<HTMLDetailsElement>("#storage-details").open = false;
  notice();
  setBusy(false);
  $(".welcome .upload-trigger").focus();
};
$("#copy-json").onclick = async () => {
  if (!circuit) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(circuit, null, 2));
    toast("Parsed circuit copied as JSON.");
  } catch {
    toast("Clipboard unavailable. You can select and copy from the JSON view.");
  }
};
$<HTMLDialogElement>("#help-dialog").addEventListener("click", (event) => {
  if (event.target === $<HTMLDialogElement>("#help-dialog"))
    $<HTMLDialogElement>("#help-dialog").close();
});
$("#reload-circuit").onclick = () => {
  if (circuit) void readCircuit(`/api/circuits/${circuit.storage.circuit_id}`, filename);
};
fetch("/api/status")
  .then(async (response) => connectionState(response.ok && (await response.json()).graph_storage === "connected"))
  .catch(() => connectionState(false));
const savedId = new URLSearchParams(location.hash.slice(1)).get("circuit");
if (savedId && /^[0-9a-f]{32}$/.test(savedId)) {
  void readCircuit(`/api/circuits/${savedId}`, "Stored circuit");
}
