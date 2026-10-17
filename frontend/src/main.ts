import "@fontsource-variable/inter";
import "./style.css";
import { PathPanel } from "./path-panel";
import { ChatPanel } from "./chat-panel";
import type { Explanation } from "./explanation";
import { renderConnectionExplanation } from "./connection-explanation";
import { icon } from "./icons";
import { CircuitGraph } from "./graph";
import { ExplanationRequest, singleEvidencePin, type ExplanationState } from "./explanation";
import { ReviewRequest, type ReviewState, type Finding } from "./review";
import {
  componentKind,
  connectionLabel,
  endpointLabel,
  visibleNets,
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
let chatEvidence: Pick<Explanation, "evidence"> | null = null;

function clearReview() {
  reviewRequest.cancel();
  review = { status: "idle" };
  selectedFinding = null;
  $("#selected-finding").hidden = true;
  $("#selected-finding").innerHTML = "";
  renderReview();
}

function clearExplanation() {
  chatEvidence = null;
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
    <p class="scope-note">Explore connections and check Arduino power-rail wiring. Ask Gemini about your connections. Full electrical diagnosis is not available.</p>
  </section>
  <div id="loading-overlay" class="loading-overlay" role="status" hidden><span class="spinner"></span> Reading your circuit…</div>
  <section class="circuit-section" id="circuit-section" aria-label="Your uploaded circuit" hidden>
    <div class="circuit-topline"><div class="circuit-title-group"><span class="file-icon">${icon("file", 23)}</span><div><h1 id="circuit-title"></h1><p id="circuit-summary"></p></div></div><button class="icon-button" id="clear-circuit" aria-label="Close circuit and return to upload" title="Close circuit">${icon("close", 19)}</button></div>
    <section class="review-panel" aria-label="Circuit review">
      <div class="review-heading"><div><h2>Check your connections</h2><p>See what needs attention, then select it to see the wiring.</p></div><button id="run-review" class="button primary">Run review</button></div>
      <div id="review-results" aria-live="polite"></div>
    </section>
    <section id="path-panel" class="path-panel" aria-label="Connection route" hidden></section>
    <div class="workbench">
      <section class="explorer-panel" aria-label="Circuit explorer">
        <div class="explorer-toolbar"><div class="view-tabs" role="tablist" aria-label="Circuit views">
          <button data-view="graph" role="tab" aria-selected="true" class="active">Circuit</button>
          <button data-view="components" role="tab" aria-selected="false">Components</button>
          <button data-view="nets" role="tab" aria-selected="false">Connections</button>
        </div><button class="icon-button" id="expand-canvas" aria-label="Expand workspace" title="Expand workspace">${icon("fit", 18)}</button></div>
        <div class="explorer-subbar"><label class="search-field">${icon("search", 16)}<input id="search" placeholder="Find a component or net" aria-label="Find a component or net"/></label><label class="toggle-label"><input type="checkbox" id="unused-toggle"/><span>Show unconnected pins</span></label></div>
        <div class="canvas-wrap"><div id="graph-view" class="graph-view" role="tabpanel" aria-label="Circuit graph. Use Components and Connections for keyboard-accessible details."></div><div id="list-view" class="list-view" role="tabpanel" hidden></div><div id="canvas-empty" class="canvas-empty" hidden><h2>No components in this file</h2><p>Upload a netlist with components and connections to explore.</p></div><div class="graph-controls" id="graph-controls"><button class="icon-button" id="zoom-out" aria-label="Zoom out">${icon("minus", 16)}</button><span id="zoom-value">100%</span><button class="icon-button" id="zoom-in" aria-label="Zoom in">${icon("plus", 16)}</button><button class="icon-button" id="fit-view" aria-label="Fit graph to screen">${icon("fit", 17)}</button><button class="reset-layout" id="reset-layout" title="Restore automatic placement">Reset layout</button></div><span class="canvas-hint" id="canvas-hint">Drag parts / ○ wire bends · Double-click part to zoom</span></div>
        <div class="graph-footer"><div class="legend"><span><i class="legend-component"></i> Component</span><span><i class="legend-net"></i> Wire junction</span><span><i class="legend-single"></i> Unconnected pin</span></div><span id="graph-summary"></span></div>
      </section>
      <aside class="inspector" aria-label="Connection details"><div class="panel-heading"><h2>Connection details</h2></div><div id="selected-finding" hidden></div><div id="inspector-body"></div><section id="explanation-panel" class="explanation-panel" aria-label="Connection explanation" hidden></section></aside>
    </div>
    <p class="scope-note">Gold sockets are connected pins. Drag the open circles to route wires. Board labels form an enlarged pin map, not a physical wiring template.</p>
    <section id="chat-panel" class="chat-panel" aria-label="Ask about your circuit" hidden></section>
    <details id="storage-details" class="file-details"><summary>File details</summary><p id="read-status"></p><p id="storage-info"></p><div class="file-actions"><button class="button secondary" id="reload-circuit">Reload saved circuit</button><button class="button secondary" data-view="data">View JSON</button><button class="button secondary" id="copy-json">Copy JSON</button></div><pre class="json-view" id="storage-query"></pre></details>
  </section>
</main>
<footer>Connections from your file. No circuit simulation.</footer>
<div class="drop-overlay" id="drop-overlay" hidden>${icon("upload", 32)}<strong>Drop your .net file</strong></div>
<dialog id="help-dialog" aria-labelledby="help-title"><button class="icon-button dialog-close" id="close-help" aria-label="Close help">${icon("close")}</button><h2 id="help-title">Export your circuit from KiCad</h2><ol><li>Open your circuit in the schematic editor.</li><li>Select <strong>File → Export → Netlist</strong>.</li><li>Choose the <strong>KiCad</strong> format and save the <strong>.net</strong> file.</li><li>Upload that file here to explore its connections.</li></ol><p>Uploads are stored in your local database. Images, PCB files and schematics cannot be uploaded directly.</p><button class="button primary" id="got-it">Got it</button></dialog>
<div id="toast" class="toast" role="status" hidden></div>`;

function showEvidence(evidence: Explanation["evidence"] | null, reveal = false) {
  clearExplanation();
  selectedFinding = null;
  chatEvidence = evidence ? { evidence } : null;
  if (!evidence) { renderInspector(); return; }
  view = "graph";
  query = "";
  $("#search").setAttribute("value", "");
  $<HTMLInputElement>("#search").value = "";
  if (circuit) {
    selection = singleEvidencePin(circuit, evidence) || selection;
    const visible = new Set(visibleNets(circuit, showUnused, selection).map(n => `n:${n.code}`));
    if (evidence.nodes.some(n => n.kind === "net" && !visible.has(n.id))) showUnused = true;
  }
  $<HTMLInputElement>("#unused-toggle").checked = showUnused;
  renderView();
  renderInspector();
  if (reveal) $(".workbench").scrollIntoView({ block: "start", behavior: "smooth" });
}
const chatPanel = new ChatPanel($("#chat-panel"), evidence => {
  showEvidence(evidence);
  $(".workbench").scrollIntoView({ block: "start", behavior: "smooth" });
});
const pathPanel = new PathPanel($("#path-panel"), showEvidence);

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
  chatPanel.setCircuit("");
  pathPanel.setCircuit(null);
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
    chatPanel.setCircuit(result.storage.circuit_id);
    pathPanel.setCircuit(result);
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
    if (circuit) { chatPanel.setCircuit(circuit.storage.circuit_id); pathPanel.setCircuit(circuit); }
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
  $("#circuit-summary").textContent = `${board} · ${circuit.components.length} components · ${circuit.nets.filter(n => n.nodes.length > 1).length} connections`;
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
      selection,
    );
    graph.select(selection);
    graph.search(query);
    graph.highlightEvidence(chatEvidence || selectedFinding || (explanation.status === "success" ? explanation.result : null));
  } else renderList();
  const shown = visibleNets(circuit, showUnused, selection).length;
  $("#graph-summary").textContent =
    `${circuit.components.length} components · ${shown} connections in view`;
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
    const nets = visibleNets(circuit, showUnused, selection).filter(
      (n) =>
        `${n.name} ${n.nodes.map((p) => `${p.ref} ${p.pin} ${pinName(circuit!, p)}`).join(" ")}`
          .toLowerCase()
          .includes(filter),
    );
    $("#list-view").innerHTML =
      `<div class="table-caption">${nets.length} connections · Select a row to see the details</div><div class="wiring-list">${nets.map(n => `<button class="wiring-row ${selection?.kind === "net" && selection.id === n.code ? "selected-row" : ""}" data-net="${esc(n.code)}"><span><strong>${esc(connectionLabel(circuit!, n))}</strong><small>${n.nodes.length > 1 ? n.nodes.map(p => { const c = circuit!.components.find(c => c.ref === p.ref); return `${p.ref}: ${c ? displayValue(c) : "Component"}`; }).filter((v, i, all) => all.indexOf(v) === i).map(esc).join(" · ") : isUnused(n) ? "Marked unused in the file" : "No other pin connected"}</small></span>${icon("chevron", 15)}</button>`).join("")}</div>${!nets.length ? '<div class="no-results">No connections match. Try showing unconnected pins.</div>' : ""}`;
  }
}
function renderInspector() {
  const findingPanel = $("#selected-finding");
  findingPanel.hidden = !selectedFinding;
  findingPanel.innerHTML = selectedFinding ? `<div class="finding-detail ${selectedFinding.severity}"><span class="finding-severity">${selectedFinding.severity === "warning" ? "Check this connection" : "Information"}</span><h3>${esc(selectedFinding.title)}</h3><p>${esc(selectedFinding.message)}</p><p><strong>What to check:</strong> ${esc(selectedFinding.suggestion)}</p>${sourceLinks(selectedFinding.sources || [])}</div>` : "";
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
    $("#inspector-body").innerHTML = `<div class="component-heading"><span class="component-symbol">${icon("chip", 25)}</span><div><span class="component-ref">${esc(selected.ref)} · PIN ${esc(selected.pin)}</span><h4>${esc(pinName(circuit, member || { ref: selected.ref, pin: selected.pin, pinfunction: "unknown", pintype: "unknown" }))}</h4></div></div><p class="inspector-description">${nets.length ? "Follow this pin’s connections in your uploaded circuit." : "This pin has no wire connection in the uploaded file."}</p><div class="pin-list">${nets.map(net => `<button class="pin-row" data-net="${esc(net.code)}">${icon("net", 16)}<span><strong>${esc(connectionLabel(circuit!, net))}</strong><small>See connected pins</small></span>${icon("chevron", 13)}</button>`).join("")}<button class="text-button" data-component="${esc(selected.ref)}">Back to ${esc(selected.ref)}</button></div>`;
  } else if (selection.kind === "component") {
    const comp = circuit.components.find((c) => c.ref === selection!.id);
    if (!comp) return;
    const connections = circuit.nets.flatMap((net) =>
      net.nodes.filter((p) => p.ref === comp.ref).map((pin) => ({ net, pin })),
    );
    const active = connections.filter(c => showUnused || c.net.nodes.length > 1);
    const library = circuit.libparts.find(
      (p) => p.lib === comp.libsource.lib && p.part === comp.libsource.part,
    );
    const kind = componentKind(comp);
    $("#inspector-body").innerHTML =
      `<div class="component-heading"><span class="component-symbol ${kind}">${icon(kind === "board" || kind === "component" ? "chip" : kind, 26)}</span><div><span class="component-ref">${esc(comp.ref)}</span><h4>${esc(displayValue(comp))}</h4></div></div><dl class="component-facts"><div><dt>Symbol library</dt><dd>${esc(comp.libsource.lib || "Unknown")}</dd></div><div><dt>Exported pins</dt><dd>${library?.pins.length ?? connections.length}</dd></div><div><dt>Pins shown</dt><dd>${active.length}</dd></div></dl><div class="connections-heading">CONNECTIONS <span>${active.length}</span></div><div class="pin-list">${active.map(({ net, pin }) => `<button class="pin-row" data-pin-ref="${esc(pin.ref)}" data-pin="${esc(pin.pin)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pinName(circuit!, pin))}</strong><small>${esc(net.nodes.filter(p => p.ref !== pin.ref || p.pin !== pin.pin).map(p => endpointLabel(circuit!, p)).join(", ") || "No other pin connected")}</small></span>${icon("chevron", 13)}</button>`).join("") || '<p class="inspector-description">No connections to other pins. Enable “Show unconnected pins” to see more.</p>'}</div>${connections.length > active.length ? `<div class="unused-note">${icon("help", 14)} ${connections.length - active.length} unconnected pins hidden. Use “Show unconnected pins” to see them.</div>` : ""}`;
  } else {
    const net = circuit.nets.find((n) => n.code === selection!.id);
    if (!net) return;
    $("#inspector-body").innerHTML =
      `<div class="component-heading"><span class="component-symbol net-symbol">${icon("net", 25)}</span><div><span class="component-ref">NET ${esc(net.code)}</span><h4>${esc(connectionLabel(circuit, net))}</h4></div></div><details class="net-file-name"><summary>Wire name in file</summary><p class="net-full-name">${esc(net.name)}</p></details><dl class="component-facts"><div><dt>Pin memberships</dt><dd>${net.nodes.length}</dd></div><div><dt>Components</dt><dd>${new Set(net.nodes.map((p) => p.ref)).size}</dd></div></dl>${net.nodes.length === 1 ? `<p class="single-pin-note">${isUnused(net) ? "This pin is marked intentionally unused in the netlist." : "This pin has no connection to another pin. That may be intentional; check whether your design needs it."}</p>` : ""}<div class="connections-heading">CONNECTED PINS <span>${net.nodes.length}</span></div><div class="pin-list">${net.nodes.map((pin) => `<button class="pin-row" data-pin-ref="${esc(pin.ref)}" data-pin="${esc(pin.pin)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pin.ref)} · ${esc(pinName(circuit!, pin))}</strong><small>${esc(pin.pintype)}</small></span>${icon("chevron", 13)}</button>`).join("")}</div>`;
  }
}

function renderExplanation() {
  const panel = $("#explanation-panel");
  panel.hidden = !circuit || !selection || selection.kind === "component";
  if (panel.hidden) return;
  const loading = explanation.status === "loading";
  const result = explanation.status === "success" ? explanation.result : null;
  panel.innerHTML = `<button id="explain-connection" class="button primary" ${loading ? 'disabled' : ''}>${loading ? '<span class="spinner small"></span> Checking connection…' : "Explain connection"}</button>
    <div id="explanation-result" aria-live="polite" aria-atomic="true">${result ? `
      ${renderConnectionExplanation(result)}
      ${result.tool === "trace_power" ? `<p class="explanation-summary">If this supply stops, parts that depend on it may stop working. Other power sources are not checked.</p>${(result.warnings || []).map(w => `<p class="explanation-error">${esc(w)}</p>`).join("")}<details><summary>Power check details</summary>${result.limitations.map(l => `<p class="explanation-hint">${esc(l)}</p>`).join("")}${sourceLinks(result.sources || [])}</details>` : ""}
      <button class="button secondary show-connection" id="show-explained-connection">Show on circuit</button>`
      : explanation.status === "error" ? `<p class="explanation-error" role="alert">${esc(explanation.message)}</p>` : '<p class="explanation-hint">See which pins are connected to this one.</p>'}</div>
    <details class="extra-connection-tools"><summary>Explore power connections</summary><p class="explanation-hint">For an Arduino supply pin, see the pins connected to it.</p><button id="trace-power" class="button secondary" ${loading ? 'disabled' : ''}>Show connected power pins</button></details>`;
}
async function explainSelection(mode: "explain" | "power-trace" = "explain") {
  if (!circuit || !selection || selection.kind === "component") return;
  selectedFinding = null;
  chatEvidence = null;
  renderInspector();
  graph?.highlightEvidence(null);
  await explanationRequest.run(circuit.storage.circuit_id, selection, state => {
    explanation = state;
    renderExplanation();
    graph?.highlightEvidence(state.status === "success" ? state.result : null);
  }, mode);
}

function sourceLinks(sources: { title: string; url: string }[]) {
  return sources.filter(source => ["https://docs.arduino.cc/", "https://www.buydisplay.com/", "https://www.vishay.com/", "https://github.com/KiCad/kicad-symbols/"].some(prefix => source.url.startsWith(prefix))).map(source => `<a class="spec-source" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(source.title)} ↗</a>`).join("");
}
function renderReview() {
  const button = $<HTMLButtonElement>("#run-review");
  button.disabled = review.status === "loading";
  button.textContent = review.status === "loading" ? "Checking…" : review.status === "success" ? "Check again" : review.status === "error" ? "Retry" : "Check connections";
  const panel = $("#review-results");
  if (review.status === "idle") { panel.innerHTML = ""; return; }
  if (review.status === "loading") { panel.innerHTML = '<p class="review-note" role="status">Reading saved connections from FalkorDB…</p>'; return; }
  if (review.status === "error") { panel.innerHTML = `<p class="explanation-error" role="alert">${esc(review.message)}</p>`; return; }
  const result = review.result;
  const warnings = result.findings.filter(f => f.severity === "warning");
  const information = result.findings.filter(f => f.severity === "info");
  const unconnected = information.filter(f => f.rule === "single_pin_net" || f.rule === "unassigned_pin");
  const groups = information.filter(f => f.rule === "isolated_group");
  const other = information.filter(f => !unconnected.includes(f) && !groups.includes(f));
  const required = result.requirements;
  const uncertainRequirements = (required?.unverified_pins.length || 0) + (required?.skipped_pins.length || 0) + (result.voltage?.unverified_parts || 0) + (result.i2c?.unverified_pins || 0);
  const heading = result.status === "incomplete" ? "Not enough information to check this circuit" : warnings.length ? `${warnings.length} wiring problem${warnings.length === 1 ? "" : "s"} to check` : groups.length ? `${groups.length} separate group${groups.length === 1 ? "" : "s"} to check` : uncertainRequirements ? "Some connections need a closer look" : required?.checked_pins ? "No issues found in the supported wiring checks" : result.electrical.checked_nets ? "No Arduino power-wire conflicts found" : "No supported power connections to check";
  const connectionFor = (f: Finding) => {
    const selector = f.selection;
    const net = 'net_code' in selector ? circuit?.nets.find(n => n.code === selector.net_code) : null;
    return net && circuit ? connectionLabel(circuit, net) : 'ref' in selector ? `${selector.ref} · Pin ${selector.pin}` : f.title;
  };
  panel.innerHTML = `<h3 class="review-summary">${esc(heading)}</h3>
    <p class="review-note">Checks power connections, supply voltage and SDA/SCL wiring for recognized parts.</p>
    ${warnings.length ? `<div class="finding-list">${warnings.map(f => `<button class="finding-card warning" data-finding="${esc(f.id)}"><strong>${esc(f.title)}</strong><p>${esc(connectionFor(f))}</p>${(f.rule.startsWith("required_") || f.rule === "supply_voltage_mismatch" || f.rule.startsWith("i2c_")) ? `<p>${esc(f.message)}</p>` : ""}<p><b>What to do:</b> ${esc(f.suggestion)}</p><small>Show this connection →</small></button>`).join("")}</div>` : ""}
    ${result.voltage?.checks.length ? `<div class="review-note"><strong>Supply voltage</strong>${result.voltage.checks.map(part => `<p>${esc(part.ref)}${part.pin ? ` · Pin ${esc(part.pin)}` : ""}: ${part.status === "unverified" ? `Not verified. ${esc(part.reason)}` : `${esc(part.nominal_voltage)}V nominal — ${part.status === "within_range" ? "within" : "outside"} the ${esc(part.operating_range?.min)}–${esc(part.operating_range?.max)}V operating range.`}</p>`).join("")}</div>` : ""}
    ${result.i2c?.checks.some(pin => pin.status === "connected" || pin.status === "unverified") ? `<div class="review-note"><strong>I2C signal wires</strong>${result.i2c.checks.filter(pin => pin.status === "connected" || pin.status === "unverified").map(pin => `<p>${esc(pin.message)}</p>`).join("")}</div>` : ""}
    ${groups.length ? `<div class="finding-list">${groups.map(f => `<button class="finding-card info" data-finding="${esc(f.id)}"><strong>${esc(f.title)}</strong><p>${esc(f.message)}</p><small>Show these parts →</small></button>`).join("")}</div>` : ""}
    ${unconnected.length ? `<details class="review-details"><summary>${unconnected.length} pins with no connection</summary><p>These may be intentional. Select a pin to check whether your design needs it.</p><div class="unconnected-list">${unconnected.map(f => `<button class="unconnected-row" data-finding="${esc(f.id)}">${esc(connectionFor(f))}<span>Show pin →</span></button>`).join("")}</div></details>` : ""}
    <details class="review-details"><summary>Check details</summary>
      ${other.map(f => `<button class="unconnected-row" data-finding="${esc(f.id)}">${esc(f.title)}<span>Show details →</span></button>`).join("")}
      ${result.isolation ? `<p>${result.isolation.group_count} connected component group${result.isolation.group_count === 1 ? "" : "s"} found by FalkorDB. Grouping shows which parts share wiring; it does not prove electrical operation.</p>` : ""}
      <p>${result.summary.marked_unused_pins} pins marked intentionally unused in the file.</p>
      <p>${result.electrical.checked_nets} power/ground nets checked. ${esc(result.electrical.checks.join("; "))}.</p>
      ${result.electrical.recognized_parts.map(part => `<p><strong>${esc(part.ref)} · ${esc(part.name)}</strong></p>${sourceLinks(part.sources)}`).join("")}
      ${required?.recognized_parts.length ? `<p><strong>Required power/GND connections</strong>: ${required.checked_pins} pins checked; ${required.connected_pins} have a direct wire route to a known Arduino supply/ground pin. This does not verify voltage or operation.</p>${required.recognized_parts.map(part => `<p>${esc(part.ref)} · ${esc(part.name)}</p>${sourceLinks(part.sources)}`).join("")}` : ""}
      ${required ? [...required.unverified_pins, ...required.skipped_pins].map(pin => `<p><strong>${esc(pin.ref)} · Pin ${esc(pin.pin)}:</strong> ${esc(pin.reason)}</p>`).join("") : ""}
      ${result.voltage?.checks.map(part => `<p><strong>${esc(part.ref)} supply specification</strong></p>${sourceLinks(part.sources)}`).join("") || ""}
      ${result.i2c?.checks.length ? `<p>${esc(result.i2c.scope)}</p>${sourceLinks([...new Map(result.i2c.checks.flatMap(pin => pin.sources).map(source => [source.url, source])).values()])}` : ""}
      ${result.voltage?.unknown_components.length ? `<p>Supply voltage not verified for unknown parts: ${esc(result.voltage.unknown_components.join(", "))}.</p>` : ""}
      ${result.electrical.unknown_components.length ? `<p>No current-limit checks for: ${esc(result.electrical.unknown_components.join(", "))}.</p>` : ""}
      ${result.cannot_verify.map(item => `<p><strong>${esc(item.check)}:</strong> ${esc(item.reason)}</p>`).join("")}
    </details>`;
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
  selectItem('component_refs' in selector ? { kind: "component", id: selector.component_refs[0] } : 'net_code' in selector ? { kind: "net", id: selector.net_code } : {
    kind: "pin", id: `p:${JSON.stringify([selector.ref, selector.pin])}`, ref: selector.ref, pin: selector.pin,
  });
  selectedFinding = finding;
  if (circuit && "component_refs" in selector) {
    const visible = new Set(visibleNets(circuit, showUnused, selection).map(n => `n:${n.code}`));
    if (finding.evidence.nodes.some(n => n.kind === "net" && !visible.has(n.id))) showUnused = true;
    $<HTMLInputElement>("#unused-toggle").checked = showUnused;
  }
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
  if (target.closest("#show-explained-connection") && explanation.status === "success") {
    view = "graph";
    query = "";
    $<HTMLInputElement>("#search").value = "";
    renderView();
    $(".workbench").scrollIntoView({ block: "start", behavior: "smooth" });
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
  renderInspector();
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
  chatPanel.setCircuit("");
  pathPanel.setCircuit(null);
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
