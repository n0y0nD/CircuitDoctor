import "@fontsource-variable/bricolage-grotesque/standard.css";
import "@fontsource-variable/jetbrains-mono";
import "./style.css";
import probeSymbols from "./assets/probe-symbols.svg?raw";
import { meterHtml, reviewReading, type Reading } from "./meter";
import { VerifyPanel } from "./verify-panel";
import { comparisonFromHash, circuitHash } from "./verify-fix";
import { PathPanel } from "./path-panel";
import type { ChatComparison } from "./chat";
import { ChatPanel } from "./chat-panel";
import type { Explanation } from "./explanation";
import { renderConnectionExplanation } from "./connection-explanation";
import { icon, sym } from "./icons";
import { dropHtml, helpDialogHtml, landingHtml, loadingHtml, loadingSteps, type DropState, type LoadStep } from "./landing";
import { CircuitGraph, type ProbeTargets } from "./graph";
import { graphPinId } from "./graph-focus";
import { ExplanationRequest, singleEvidencePin, type ExplanationState } from "./explanation";
import { ReviewRequest, type ReviewState, type Finding } from "./review";
import { reviewPanelHtml, sourceLinks } from "./review-panel";
import { boardRecognized, faultEnds, groupFindings, pinWord } from "./findings";
import {
  componentKind,
  boardLabel,
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

document.body.insertAdjacentHTML("afterbegin", probeSymbols);
$("#app").innerHTML = `
<header class="topbar">
  <a class="brand sm" href="/" aria-label="CircuitDoctor home">${sym("cd-logo")}CircuitDoctor</a>
  <span class="vr" id="file-divider" hidden></span>
  <div class="file" id="topbar-file" hidden>${sym("i-netfile")}<b id="topbar-filename"></b><span id="topbar-board"></span></div>
  <ol class="fix-steps" id="fix-steps" aria-label="Fix it in three steps" hidden></ol>
  <div class="header-actions"><span class="stat" id="connection-status" role="status"><i class="live wait"></i>Connecting…</span><button class="btn quiet" id="cancel-load" type="button" hidden>Cancel</button><button class="btn" id="back-to-problem" type="button" hidden>← Back to the problem</button><button class="btn pri" id="run-review" type="button" hidden>${sym("i-beep", "beep")}Check again</button><button class="btn upload-trigger" id="replace-file" type="button" hidden>${sym("i-upload")}Upload another</button>
    <div class="menu" id="more-menu" hidden><button class="btn quiet" id="more-button" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="more-list">More <span class="caret" aria-hidden="true">▼</span></button>
      <div class="menu-list" id="more-list" role="menu" hidden>
        <button type="button" role="menuitem" data-open-trace>${sym("i-trace")}Trace a connection</button>
        <button type="button" role="menuitem" id="open-verify" aria-controls="verify-panel" aria-expanded="false">${sym("i-check")}Check an updated file</button>
        <button type="button" role="menuitem" class="upload-trigger">${sym("i-upload")}Upload another file</button>
        <label class="toggle-label" role="menuitemcheckbox"><input type="checkbox" id="unused-toggle"/><span>Show unconnected pins</span></label>
        <button type="button" role="menuitem" id="expand-canvas">${icon("fit", 15)}<span>Expand drawing</span></button>
        <button type="button" role="menuitem" id="reset-layout">${icon("graph", 15)}Reset layout</button>
        <button type="button" role="menuitem" class="help-trigger">${icon("help", 15)}Where do I get a .net file?</button>
        <hr/>
        <button type="button" role="menuitem" id="clear-circuit">${icon("close", 15)}Close circuit</button>
      </div>
    </div>
  </div>
</header>
<main>
  <input id="file-input" type="file" accept=".net" hidden />
  <div id="notice" role="alert" hidden></div>
  ${landingHtml()}
  ${loadingHtml()}
  <section class="workspace" id="circuit-section" aria-label="Your uploaded circuit" hidden>
    <div class="col">
      <section class="panel problems" id="review-panel" aria-label="Wiring check"><div id="review-results" aria-live="polite"></div></section>
      <section id="path-panel" class="panel side-panel" aria-label="Trace a connection" hidden></section>
      <section id="verify-panel" class="panel side-panel" aria-label="Check an updated file" hidden></section>
      <section id="chat-panel" class="panel ask chat-panel" aria-label="Ask about your circuit" hidden></section>
    </div>
    <section class="panel canvas explorer-panel" aria-label="Circuit explorer">
      <div class="chead">
        <div class="view-tabs" role="tablist" aria-label="Circuit views">
          <button data-view="graph" role="tab" aria-selected="true" class="tab active">Circuit</button>
          <button data-view="components" role="tab" aria-selected="false" class="tab">Components</button>
          <button data-view="nets" role="tab" aria-selected="false" class="tab">Connections</button>
        </div>
        <label class="find"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5 14 14"/></svg><input id="search" placeholder="Find a part or pin" aria-label="Find a part or pin"/></label>
        <span class="key" id="canvas-key"></span>
      </div>
      <div class="cbody">
        <div class="canvas-wrap"><div id="graph-view" class="graph-view" role="tabpanel" aria-label="Circuit drawing. Use Components and Connections for keyboard-accessible details."></div><div id="list-view" class="list-view" role="tabpanel" hidden></div><div id="canvas-empty" class="canvas-empty" hidden><h2>No components in this file</h2><p>Upload a netlist with components and connections to explore.</p></div>
          <div class="zoom" id="graph-controls"><button type="button" id="zoom-out" aria-label="Zoom out">−</button><span id="zoom-value">100%</span><button type="button" id="zoom-in" aria-label="Zoom in">+</button><button type="button" id="fit-view" aria-label="Fit drawing to screen">Fit</button></div>
          <span class="canvas-hint" id="canvas-hint">Drag parts to tidy the layout</span><span class="sr-only" id="graph-summary" role="status"></span></div>
        <aside class="inspector" id="inspector" aria-label="Connection details" hidden><div class="ph"><h2>Connection details</h2><button class="x" type="button" id="close-inspector" aria-label="Close details">×</button></div><div class="inspector-scroll"><div id="selected-finding" hidden></div><div id="inspector-body"></div><section id="explanation-panel" class="explanation-panel" aria-label="Connection explanation" hidden></section></div></aside>
      </div>
    </section>
  </section>
</main>
<footer class="statusbar"><div id="meter"></div><div class="st"><span id="db-status"><i class="live wait"></i>FalkorDB…</span><span class="d">·</span><span>Connections from your file. No circuit simulation.</span></div></footer>
<div class="drop-overlay" id="drop-overlay" hidden>${icon("upload", 32)}<strong>Drop your .net file</strong></div>
${helpDialogHtml()}`;

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
  if (reveal) $(".explorer-panel").scrollIntoView({ block: "nearest", behavior: "smooth" });
}
let activeComparison: ChatComparison | null = null;
const chatPanel = new ChatPanel($("#chat-panel"), evidence => {
  showEvidence(evidence);
  $(".explorer-panel").scrollIntoView({ block: "nearest", behavior: "smooth" });
});
const verifyPanel = new VerifyPanel($("#verify-panel"), async (id, evidence) => {
  if (circuit?.storage.circuit_id !== id) await readCircuit(`/api/circuits/${encodeURIComponent(id)}`, "saved circuit", {}, true, false);
  if (circuit?.storage.circuit_id === id) showEvidence(evidence, true);
}, $("#open-verify"), result => {
  activeComparison = result ? { original_id: result.original_id, corrected_id: result.corrected_id } : null;
  chatPanel.setComparison(activeComparison);
  if (circuit) history.replaceState(null, "", circuitHash(circuit.storage.circuit_id, activeComparison));
});
const pathPanel = new PathPanel($("#path-panel"), showEvidence);

function connectionState(online: boolean) {
  const element = $("#connection-status");
  element.classList.toggle("offline", !online);
  element.innerHTML = `<i class="live"></i>Graph DB ${online ? "connected" : "offline"}`;
  $("#db-status").classList.toggle("offline", !online);
  $("#landing-status").classList.toggle("offline", !online);
  $("#landing-status").innerHTML = element.innerHTML;
  serviceOnline = online;
  if (!online) { setDrop({ kind: "offline", server: !apiReachable }); scheduleStatusCheck(); }
  else if (dropState.kind === "offline") setDrop({ kind: "ready" });
  $("#db-status").innerHTML = `<i class="live"></i>FalkorDB ${online ? "connected" : "offline"}`;
}
let serviceOnline = true;
let apiReachable = true;
let dropState: DropState = { kind: "ready" };
function setDrop(state: DropState) {
  dropState = state;
  const zone = $("#dropzone");
  zone.className = `drop dropzone${state.kind === "error" ? " err" : state.kind === "offline" ? " off" : ""}`;
  zone.innerHTML = dropHtml(state);
  document.querySelectorAll<HTMLButtonElement>(".sample-trigger").forEach(b => { b.disabled = state.kind === "offline"; });
}
let statusTimer = 0;
// While the service is down, look again every few seconds so the page recovers on its own.
function scheduleStatusCheck() {
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(checkStatus, 5000);
}
function checkStatus() {
  fetch("/api/status")
    .then(async (response) => { apiReachable = true; connectionState(response.ok && (await response.json()).graph_storage === "connected"); })
    .catch(() => { apiReachable = false; connectionState(false); });
}
type Screen = "landing" | "loading" | "workspace";
function setScreen(screen: Screen) {
  document.body.dataset.screen = screen;
  $("#welcome").hidden = screen !== "landing";
  $("#loading-view").hidden = screen !== "loading";
  $("#circuit-section").hidden = screen !== "workspace";
  $("#cancel-load").hidden = screen !== "loading";
  $("#replace-file").hidden = true;
  $("#run-review").hidden = screen !== "workspace";
  $("#more-menu").hidden = screen !== "workspace";
  $("#fix-steps").hidden = screen !== "workspace" || $("#fix-steps").innerHTML === "";
  $("#topbar-file").hidden = screen === "landing";
  $("#file-divider").hidden = screen === "landing";
  document.querySelector<HTMLElement>(".topbar #topbar-board")!.hidden = screen === "loading";
}
function setLoadStep(step: LoadStep) { $("#loading-steps").innerHTML = loadingSteps(step); }
// The status-bar meter: words only (SHORT, PASS, TRACE…), never a measured value.
let meterOverride: Reading | null = null;
function renderMeter() {
  $("#meter").innerHTML = circuit ? meterHtml(meterOverride || reviewReading(review)) : "";
}
function notice(message = "") {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}
function setBusy(value: boolean) {
  document.querySelectorAll<HTMLButtonElement>(".upload-trigger").forEach((b) => {
    b.disabled = value;
  });
}
let loadController: AbortController | null = null;
class LoadError extends Error { constructor(message: string, readonly status = 0) { super(message); } }
async function readCircuit(
  url: string,
  name: string,
  options: RequestInit = {},
  keepComparison = false,
  showLoading = true,
) {
  clearExplanation();
  clearReview();
  renderExplanation();
  chatPanel.setCircuit("");
  pathPanel.setCircuit(null);
  if (!keepComparison) verifyPanel.setCircuit(null);
  const currentRequest = ++requestId;
  loadController?.abort();
  const controller = loadController = new AbortController();
  const previous = circuit;
  setBusy(true);
  notice();
  if (dropState.kind === "error") setDrop({ kind: "ready" });
  if (showLoading) {
    $("#loading-file").textContent = name;
    $("#topbar-filename").textContent = name;
    setLoadStep("reading");
    setScreen("loading");
  }
  try {
    let response = await fetch(url, { ...options, signal: controller.signal });
    if (response.ok && options.method === "POST") {
      const receipt = (await response.json()) as { circuit_id: string };
      if (currentRequest === requestId) setLoadStep("checking");
      response = await fetch(`/api/circuits/${encodeURIComponent(receipt.circuit_id)}`, { signal: controller.signal });
    }
    if (!response.ok) {
      if (response.status >= 500 && currentRequest === requestId)
        connectionState(false);
      const error = await response
        .json()
        .catch(() => ({
          detail: "Unable to connect to CircuitDoctor. Please try again shortly.",
        }));
      throw new LoadError(
        typeof error.detail === "string"
          ? error.detail
          : "Could not read this netlist.",
        response.status,
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
    if (!keepComparison) verifyPanel.setCircuit(result);
    chatPanel.setCircuit(result.storage.circuit_id);
    chatPanel.setComparison(activeComparison);
    pathPanel.setCircuit(result);
    filename = result.storage.filename || name;
    history.replaceState(null, "", circuitHash(result.storage.circuit_id, activeComparison));
    view = "graph";
    showUnused = false;
    $<HTMLInputElement>("#unused-toggle").checked = false;
    query = "";
    $<HTMLInputElement>("#search").value = "";
    selection = null;
    connectionState(true);
    setLoadStep("checking");
    // Every load runs the wiring review, so the workspace opens on the answer.
    await runReview();
    if (currentRequest !== requestId) return;
    renderCircuit();
  } catch (error) {
    if (currentRequest !== requestId) return;
    circuit = previous;
    const message =
      error instanceof Error ? error.message : "Unable to load this netlist.";
    const offline = error instanceof TypeError || (error instanceof LoadError && error.status >= 500);
    if (error instanceof TypeError) { apiReachable = false; connectionState(false); }
    if (circuit) {
      setScreen("workspace");
      notice(`${message} Your previous circuit is still displayed.`);
      if (!keepComparison) verifyPanel.setCircuit(circuit);
      chatPanel.setCircuit(circuit.storage.circuit_id); chatPanel.setComparison(activeComparison); pathPanel.setCircuit(circuit);
      renderCircuit();
    } else {
      setScreen("landing");
      if (offline) setDrop({ kind: "offline", server: error instanceof TypeError });
      else if (error instanceof LoadError && error.status === 413) setDrop({ kind: "error", title: "This file is too large.", detail: message, kicadPath: false });
      else if (error instanceof LoadError && error.status === 400) setDrop({ kind: "error", title: "That’s not a KiCad netlist.", detail: message, kicadPath: true });
      else setDrop({ kind: "error", title: "Couldn’t open this circuit.", detail: message, kicadPath: false });
    }
  } finally {
    if (currentRequest === requestId) setBusy(false);
  }
}
function cancelLoad() {
  if (document.body.dataset.screen !== "loading") return;
  requestId++;
  loadController?.abort();
  reviewRequest.cancel();
  setBusy(false);
  // If the circuit already arrived, open it; the review can be run again from the workspace.
  if (circuit) { if (review.status === "loading") review = { status: "idle" }; renderCircuit(); }
  else setScreen("landing");
}
function wrongFile(title: string, detail: string, kicadPath: boolean) {
  if (circuit) notice(`${title} ${detail}`.trim());
  else setDrop({ kind: "error", title, detail, kicadPath });
}
async function upload(file: File | undefined) {
  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".net")) {
    wrongFile("That’s not a KiCad netlist.", circuit ? "Choose a KiCad .net file (File ▸ Export ▸ Netlist)." : "", true);
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    wrongFile("This file is too large.", "Choose a KiCad netlist up to 10 MiB.", false);
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
  setScreen("workspace");
  const boards = circuit.components.filter((c) => componentKind(c) === "board");
  const board = boards.length === 1
    ? boardLabel(boards[0])
    : boards.length > 1 ? `${boards.length} Arduino boards` : "Board not recognized";
  $("#topbar-filename").textContent = filename;
  $("#topbar-board").textContent = `${board} · ${circuit.components.length} component${circuit.components.length === 1 ? "" : "s"}`;
  $("#topbar-file").hidden = false;
  $("#file-divider").hidden = false;
  $("#canvas-empty").hidden = circuit.components.length > 0 || circuit.nets.length > 0;
  renderView();
  renderInspector();
  renderReview();
  renderMeter();
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
    view === "components",
  );
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
    graph.highlightEvidence(chatEvidence || selectedFinding || (explanation.status === "success" ? explanation.result : null), selectedFinding ? "issue" : "route", focusLabel());
    graph.setProbes(probeTargets());
  } else renderList();
  const shown = visibleNets(circuit, showUnused, selection).length;
  $("#graph-summary").textContent =
    `${circuit.components.length} components · ${shown} connections in view`;
}
function focusLabel() {
  if (!selectedFinding || review.status !== "success") return "";
  const problems = groupFindings(review.result).problems;
  const n = problems.indexOf(selectedFinding);
  return n >= 0 ? `Showing · problem ${n + 1} in red` : `Showing · ${selectedFinding.title}`;
}
// Probes touch the two ends of the shown fault: the first rail pin (red) and the first ground pin (black).
function probeTargets(): ProbeTargets | null {
  if (!selectedFinding || review.status !== "success") return null;
  const problems = groupFindings(review.result).problems;
  const markers = problems.filter(p => p !== selectedFinding && problems.includes(selectedFinding!)).map(p => ({
    n: problems.indexOf(p) + 1,
    ids: p.evidence.nodes.filter(node => node.kind === "pin").map(node => node.id),
  }));
  const ends = faultEnds(selectedFinding);
  const tags = (selectedFinding.specifications || []).filter(spec => spec.role === "rail" || spec.role === "ground")
    .map(spec => ({ id: graphPinId(spec.ref, spec.pin), text: pinWord(spec), tone: spec.role === "rail" && ends?.[0] === spec ? "red" as const : "ink" as const }));
  return ends ? { red: graphPinId(ends[0].ref, ends[0].pin), black: graphPinId(ends[1].ref, ends[1].pin), tags, markers } : { markers };
}
function renderList() {
  if (!circuit) return;
  const filter = query.toLowerCase();
  if (view === "components") {
    const list = circuit.components.filter((c) =>
      `${c.ref} ${c.value} ${c.libsource.part}`.toLowerCase().includes(filter),
    );
    $("#list-view").innerHTML =
      `<div class="table-caption">${list.length} component${list.length === 1 ? "" : "s"} in this view</div><table><thead><tr><th>Reference</th><th>Component</th><th></th></tr></thead><tbody>${list.map((c) => `<tr class="${selection?.kind === "component" && selection.id === c.ref ? "selected-row" : ""}"><td><button class="reference-button" data-component="${esc(c.ref)}">${esc(c.ref)}</button></td><td>${esc(displayValue(c))}</td><td><button class="icon-button" data-component="${esc(c.ref)}" aria-label="Inspect ${esc(c.ref)}">${icon("chevron", 15)}</button></td></tr>`).join("")}</tbody></table>${!list.length ? '<div class="no-results">No components match your search.</div>' : ""}`;
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
  // The problems panel explains findings; the drawer is for things picked on the canvas or in a list.
  $("#inspector").hidden = !circuit || !selection || !!selectedFinding;
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
      `<div class="component-heading"><span class="component-symbol ${kind}">${icon(kind === "board" || kind === "component" ? "chip" : kind, 26)}</span><div><span class="component-ref">${esc(comp.ref)}</span><h4>${esc(displayValue(comp))}</h4></div></div><dl class="component-facts"><div><dt>Total pins</dt><dd>${library?.pins.length ?? connections.length}</dd></div><div><dt>Pins shown</dt><dd>${active.length}</dd></div></dl><div class="connections-heading">CONNECTIONS <span>${active.length}</span></div><div class="pin-list">${active.map(({ net, pin }) => `<button class="pin-row" data-pin-ref="${esc(pin.ref)}" data-pin="${esc(pin.pin)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pinName(circuit!, pin))}</strong><small>${esc(net.nodes.filter(p => p.ref !== pin.ref || p.pin !== pin.pin).map(p => endpointLabel(circuit!, p)).join(", ") || "No other pin connected")}</small></span>${icon("chevron", 13)}</button>`).join("") || '<p class="inspector-description">No connections to other pins. Enable “Show unconnected pins” to see more.</p>'}</div>${connections.length > active.length ? `<div class="unused-note">${icon("help", 14)} ${connections.length - active.length} unconnected pins hidden. Use “Show unconnected pins” to see them.</div>` : ""}`;
  } else {
    const net = circuit.nets.find((n) => n.code === selection!.id);
    if (!net) return;
    $("#inspector-body").innerHTML =
      `<div class="component-heading"><span class="component-symbol net-symbol">${icon("net", 25)}</span><div><span class="component-ref">NET ${esc(net.code)}</span><h4>${esc(connectionLabel(circuit, net))}</h4></div></div><details class="net-file-name"><summary>Wire name in file</summary><p class="net-full-name">${esc(net.name)}</p></details><dl class="component-facts"><div><dt>Connected pins</dt><dd>${net.nodes.length}</dd></div><div><dt>Components</dt><dd>${new Set(net.nodes.map((p) => p.ref)).size}</dd></div></dl>${net.nodes.length === 1 ? `<p class="single-pin-note">${isUnused(net) ? "This pin is marked intentionally unused in the netlist." : "This pin has no connection to another pin. That may be intentional; check whether your design needs it."}</p>` : ""}<div class="connections-heading">CONNECTED PINS <span>${net.nodes.length}</span></div><div class="pin-list">${net.nodes.map((pin) => `<button class="pin-row" data-pin-ref="${esc(pin.ref)}" data-pin="${esc(pin.pin)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pin.ref)} · ${esc(pinName(circuit!, pin))}</strong><small>${esc(pin.pintype)}</small></span>${icon("chevron", 13)}</button>`).join("")}</div>`;
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

let expandedFinding: string | null = null;
let checkedAt: number | null = null;
function hiddenPinCount() {
  return circuit ? circuit.nets.filter(net => net.nodes.length < 2).length : 0;
}
function fixSteps(done: boolean) {
  const steps = ["Find it in red", "Fix it in KiCad", "Upload the fixed file"];
  return steps.map((label, i) => `<li class="s${done ? " done" : i === 0 ? " on" : ""}"><span class="n">${done ? sym("i-check") : i + 1}</span>${label}</li>`).join('<li class="line" aria-hidden="true"></li>');
}
function renderKey() {
  const key = $("#canvas-key");
  if (review.status !== "success") { key.innerHTML = ""; return; }
  const { problems } = groupFindings(review.result);
  if (problems.length) {
    const first = problems.find(p => p.id === expandedFinding) || problems[0];
    const others = problems.filter(p => p !== first);
    key.innerHTML = `<s class="swatch red"></s>Red = ${first.rule === "power_ground_short" ? "the short" : "the problem"}${others.length ? `<span class="nums">${others.map(p => `<i>${problems.indexOf(p) + 1}</i>`).join("")}</span>other problem${others.length === 1 ? "" : "s"}` : ""}`;
  } else if (!boardRecognized(review.result)) key.innerHTML = '<i class="kdot grey"></i>Board checks skipped';
  else key.innerHTML = '<i class="kdot green"></i>Nothing to flag';
}
function renderReview() {
  renderMeter();
  const button = $<HTMLButtonElement>("#run-review");
  button.disabled = review.status === "loading";
  button.innerHTML = `${sym("i-beep", "beep")}${review.status === "loading" ? "Checking…" : review.status === "idle" ? "Check connections" : "Check again"}`;
  const problems = review.status === "success" ? groupFindings(review.result).problems : [];
  const clean = review.status === "success" && !problems.length;
  const workspace = document.body.dataset.screen === "workspace";
  button.hidden = !workspace || clean;
  $("#replace-file").hidden = !workspace || !clean || !(review.status === "success" && boardRecognized(review.result));
  $("#fix-steps").hidden = !problems.length;
  $("#fix-steps").innerHTML = problems.length ? fixSteps(false) : "";
  renderKey();
  if (!circuit) { $("#review-results").innerHTML = ""; return; }
  const boards = circuit.components.filter(c => componentKind(c) === "board");
  $("#review-results").innerHTML = reviewPanelHtml(review, {
    circuit, expanded: expandedFinding, hiddenPins: hiddenPinCount(), showingUnused: showUnused, checkedAt,
    unrecognizedBoard: boards.length > 0,
  });
}
async function runReview() {
  if (!circuit) return;
  clearExplanation();
  selectedFinding = null;
  renderInspector();
  expandedFinding = null;
  await reviewRequest.run(circuit.storage.circuit_id, state => {
    review = state;
    if (state.status === "success") checkedAt = Date.now();
    renderReview();
    // Open on the answer: the first problem is already drawn in red.
    const first = state.status === "success" ? groupFindings(state.result).problems[0] : null;
    if (first) showFinding(first.id, false);
  });
}
function showFinding(id: string, reveal = true) {
  if (review.status !== "success") return;
  if (review.result.findings.some(f => f.id === id && f.severity === "warning")) { expandedFinding = id; renderReview(); }
  inspectFinding(id, reveal);
}
function inspectFinding(id: string, reveal = true) {
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
  renderMeter();
  if (reveal) $(".explorer-panel").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest("#run-review:not(:disabled), [data-run-review]")) void runReview();
  const finding = target.closest<HTMLElement>("[data-finding]");
  if (finding) showFinding(finding.dataset.finding!);
  const expand = target.closest<HTMLElement>("[data-expand-finding]");
  if (expand) showFinding(expand.dataset.expandFinding!);
  if (target.closest("[data-toggle-unused]")) setShowUnused(!showUnused);
  if (target.closest("[data-open-trace]")) {
    $("#circuit-section").classList.add("trace-open");
    $("#path-panel").scrollIntoView({ block: "nearest" });
    $("#path-panel").querySelector<HTMLElement>("summary, select")?.focus();
  }
  if (target.closest("#close-inspector")) { selection = null; graph?.select(null); renderInspector(); }
  const menu = $("#more-list");
  if (target.closest("#more-button")) setMenu(menu.hidden !== false);
  else if (!menu.hidden && (!target.closest("#more-list") || target.closest("button"))) setMenu(false);
  if (target.closest(".upload-trigger:not(:disabled)")) $("#file-input").click();
  if (target.closest(".sample-trigger:not(:disabled)")) {
    $<HTMLDialogElement>("#help-dialog").close();
    void readCircuit("/api/samples/uno_short", "uno_short.net", { method: "POST" });
  }
  if (target.closest("#cancel-load")) cancelLoad();
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
    $(".explorer-panel").scrollIntoView({ block: "nearest", behavior: "smooth" });
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
function setShowUnused(value: boolean) {
  showUnused = value;
  $<HTMLInputElement>("#unused-toggle").checked = value;
  renderView();
  renderInspector();
  renderReview();
}
$("#unused-toggle").addEventListener("change", (event) => setShowUnused((event.target as HTMLInputElement).checked));
function setMenu(open: boolean) {
  $("#more-list").hidden = !open;
  $("#more-button").setAttribute("aria-expanded", String(open));
  if (open) $("#more-list").querySelector<HTMLElement>("button")?.focus();
}
// Keep "checked just now" honest as time passes.
setInterval(() => { if (document.body.dataset.screen === "workspace" && review.status === "success") renderReview(); }, 60000);
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
  if (event.key === "Escape") { setExpanded(false); cancelLoad(); if (!$("#more-list").hidden) { setMenu(false); $("#more-button").focus(); } }
  // The shortcut shown on the "Choose .net file" button.
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "o"
      && document.body.dataset.screen !== "loading" && serviceOnline && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    $("#file-input").click();
  }
});
$("#clear-circuit").onclick = () => {
  verifyPanel.setCircuit(null);
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
  setScreen("landing");
  renderMeter();
  notice();
  setBusy(false);
  document.querySelector<HTMLButtonElement>("#dropzone .upload-trigger")?.focus();
};
$<HTMLDialogElement>("#help-dialog").addEventListener("click", (event) => {
  if (event.target === $<HTMLDialogElement>("#help-dialog"))
    $<HTMLDialogElement>("#help-dialog").close();
});
setScreen("landing");
checkStatus();
const savedComparison = comparisonFromHash(location.hash);
const savedId = new URLSearchParams(location.hash.slice(1)).get("circuit");
if (savedId && /^[0-9a-f]{32}$/.test(savedId)) {
  const loading = readCircuit(`/api/circuits/${savedId}`, "your saved circuit");
  const loadingVersion = requestId;
  void loading.then(async () => {
    if (!savedComparison || requestId !== loadingVersion || circuit?.storage.circuit_id !== savedId) return;
    try {
      const response = await fetch(`/api/circuits/${savedComparison.original_id}`);
      if (!response.ok) throw new Error('The earlier file could not be loaded.');
      const original = await response.json() as Circuit;
      if (requestId !== loadingVersion) return;
      if (original.storage?.source !== 'falkordb' || original.storage.circuit_id !== savedComparison.original_id)
        throw new Error('The earlier file could not be verified.');
      await verifyPanel.restore(original, savedComparison.corrected_id);
    } catch {
      if (requestId === loadingVersion) notice('Could not restore the comparison. Use “Check an updated file” to try again.');
    }
  });
}
