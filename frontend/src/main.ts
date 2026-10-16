import "@fontsource-variable/inter";
import "./style.css";
import { icon } from "./icons";
import { CircuitGraph } from "./graph";
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
let sampleName = "";
let query = "";
let showUnused = false;
let requestId = 0;

$("#app").innerHTML = `
<aside class="sidebar" id="sidebar">
  <a class="brand" href="/" aria-label="CircuitDoctor workspace"><img src="/favicon.svg" alt=""/><span>Circuit<span class="brand-light">Doctor</span></span></a>
  <div class="workspace-label"><span class="workspace-avatar">N</span><div><strong>Local workspace</strong><span>Your circuit workbench</span></div><span class="local-dot"></span></div>
  <p class="nav-label">WORKSPACE</p>
  <nav aria-label="Workspace"><button class="nav-item active" id="workspace-nav">${icon("graph")} Circuit explorer <span class="nav-dot"></span></button></nav>
  <div class="sample-heading"><p class="nav-label">EXAMPLE CIRCUITS</p><span>02</span></div>
  <button class="sample-item" data-sample="clean">${icon("file", 18)}<span>Arduino LED blink<small>Complete wiring</small></span></button>
  <button class="sample-item" data-sample="missing-ground">${icon("file", 18)}<span>Missing ground<small>One connection removed</small></span></button>
  <div class="sidebar-note"><span class="note-icon">${icon("chip", 19)}</span><strong>A little clarity.<br>A better circuit.</strong><p>Explore how your components connect, one pin at a time.</p><button class="text-button help-trigger">How it works ${icon("arrow", 15)}</button></div>
  <div class="sidebar-bottom"><button class="nav-item help-trigger">${icon("help", 18)} Help &amp; quick start</button><div class="sidebar-foot"><span class="brand-mini">CD</span><span>CircuitDoctor<span class="version">Local preview · v0.1</span></span><span class="foot-spark">✳</span></div></div>
</aside>
<div class="main-shell">
  <header class="topbar"><button class="icon-button mobile-menu" id="menu-button" aria-label="Toggle navigation">${icon("menu")}</button><div class="breadcrumb"><span>Workspace</span>${icon("chevron", 14)}<strong>Circuit explorer</strong></div><div class="topbar-right"><span class="connection-status" id="connection-status"><i></i> Connecting to parser</span><span class="topbar-divider"></span><button class="icon-button help-trigger" aria-label="Open help">${icon("help", 19)}</button></div></header>
  <main>
    <div class="page-heading"><div><div class="eyebrow"><span></span> YOUR CIRCUIT, CONNECTED</div><h1>See the whole connection.</h1><p>Turn your KiCad netlist into a circuit you can explore.</p></div><button class="button primary upload-trigger">${icon("upload", 18)} Upload netlist</button></div>
    <input id="file-input" type="file" accept=".net" hidden />
    <section class="upload-zone" id="dropzone" aria-label="Upload a netlist"><div class="upload-symbol">${icon("upload", 23)}</div><div class="upload-copy"><strong>Drop your circuit here, <button class="inline-button upload-trigger">or browse files</button></strong><p>KiCad .net files <span>·</span> Up to 10 MiB <span>·</span> Processed on this computer</p></div><span class="file-type">.net</span></section>
    <div id="notice" role="alert" hidden></div>
    <section class="circuit-section" aria-label="Current circuit">
      <div class="circuit-topline"><div class="circuit-name"><span class="document-icon">${icon("file", 18)}</span><h2 id="circuit-title">Your circuit workspace</h2><span class="badge" id="source-badge">No file loaded</span></div><span class="read-status" id="read-status"></span></div>
      <div class="stats" id="stats"><div class="stat"><span>Components</span><strong>—</strong></div><div class="stat"><span>Nets</span><strong>—</strong></div><div class="stat"><span>Pin connections</span><strong>—</strong></div><div class="stat board-stat"><span>Board</span><strong>—</strong></div></div>
      <div class="workbench">
        <section class="explorer-panel" aria-label="Circuit explorer">
          <div class="explorer-toolbar"><div class="view-tabs" role="tablist" aria-label="Circuit views">
            <button data-view="graph" role="tab" aria-selected="true" class="active">${icon("graph", 17)} Graph</button>
            <button data-view="components" role="tab" aria-selected="false">${icon("chip", 17)} Components</button>
            <button data-view="nets" role="tab" aria-selected="false">${icon("net", 17)} Nets</button>
            <button data-view="data" role="tab" aria-selected="false">${icon("code", 17)} Data</button>
          </div><button id="copy-json" class="icon-button" aria-label="Copy parsed JSON" title="Copy parsed JSON" disabled>${icon("copy", 16)}</button></div>
          <div class="explorer-subbar"><label class="search-field">${icon("search", 16)}<input id="search" placeholder="Find a component or net…" aria-label="Find a component or net"/></label><label class="toggle-label"><input type="checkbox" id="unused-toggle"/><span>Unused pins</span></label></div>
          <div class="canvas-wrap"><div id="graph-view" class="graph-view" role="tabpanel" aria-label="Circuit graph. Use the Components and Nets tabs for keyboard-accessible details."></div><div id="list-view" class="list-view" role="tabpanel" hidden></div><div id="canvas-empty" class="canvas-empty"><span>${icon("graph", 36)}</span><h3>Every circuit tells a story.</h3><p>Upload a netlist or try an example to follow its connections.</p><button class="button secondary" data-sample="clean">Explore the LED example ${icon("arrow", 16)}</button></div><div id="loading-overlay" class="loading-overlay" hidden><span class="spinner"></span><span>Reading your circuit…</span></div><div class="graph-controls" id="graph-controls"><button class="icon-button" id="zoom-out" aria-label="Zoom out">${icon("minus", 16)}</button><span id="zoom-value">100%</span><button class="icon-button" id="zoom-in" aria-label="Zoom in">${icon("plus", 16)}</button><span class="control-divider"></span><button class="icon-button" id="fit-view" aria-label="Fit graph to screen" title="Fit graph">${icon("fit", 17)}</button></div><span class="canvas-hint" id="canvas-hint">Drag to move · Scroll to zoom</span></div>
          <div class="graph-footer"><div class="legend"><span><i class="legend-component"></i> Component</span><span><i class="legend-net"></i> Net</span><span><i class="legend-single"></i> Single pin</span></div><span id="graph-summary">Waiting for a netlist</span></div>
        </section>
        <aside class="detail-column"><section class="inspector" aria-label="Selected item details"><div class="panel-heading"><h3>Inspector</h3><span class="eyebrow-tiny">CIRCUIT DETAILS</span></div><div id="inspector-body"><div class="inspector-empty">${icon("chip", 32)}<p>Select a component or net<br>to see its connections.</p></div></div></section><section class="review-card"><div class="review-heading"><span>${icon("heart", 19)} Electrical review</span><span class="planned-badge">Coming next</span></div><p>Explore connections now. Automated electrical checks will appear here when ready.</p><button class="button review-button" disabled>${icon("check", 17)} Run review</button></section></aside>
      </div>
      <div class="workspace-bottom"><span>${icon("net", 15)} Connections from your netlist. Not a PCB layout or simulation.</span><span class="scope-label">Built for the Arduino workbench</span></div>
    </section>
  </main>
  <footer class="main-footer"><span>Make sense of your circuit.</span><span>Graph storage &amp; AI diagnosis are not connected yet.</span></footer>
</div>
<dialog id="help-dialog"><button class="icon-button dialog-close" id="close-help" aria-label="Close help">${icon("close")}</button><div class="dialog-symbol">${icon("graph", 28)}</div><p class="eyebrow">A QUICK WALKTHROUGH</p><h2>Your circuit, made readable.</h2><ol><li><strong>Bring a netlist.</strong><p>In KiCad, export the schematic as a KiCad .net file. Upload it here, or select an example from the sidebar.</p></li><li><strong>Follow the connections.</strong><p>Click a component or net to inspect its pins. Switch to Components or Nets for a searchable list. Unused pins are hidden from the graph by default.</p></li><li><strong>See exactly what is known.</strong><p>This preview reads real connectivity. It does not diagnose electrical faults yet. Initial diagnosis targets are Uno R3 and classic Nano (ATmega328P).</p></li></ol><button class="button primary" id="got-it">Got it ${icon("arrow", 16)}</button></dialog>
<div id="toast" class="toast" role="status" hidden></div>`;

function connectionState(online: boolean) {
  const element = $("#connection-status");
  element.classList.toggle("offline", !online);
  element.innerHTML = `<i></i> ${online ? "Parser connected" : "Parser unavailable"}`;
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
    ? '<span class="spinner small"></span> Reading netlist'
    : circuit
      ? `${icon("check", 14)} Netlist parsed`
      : "";
  document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((b) => {
    b.disabled = value;
  });
}
async function readCircuit(
  url: string,
  name: string,
  example = "",
  options: RequestInit = {},
) {
  const currentRequest = ++requestId;
  setBusy(true);
  notice();
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      if (response.status >= 500 && currentRequest === requestId)
        connectionState(false);
      const error = await response
        .json()
        .catch(() => ({
          detail: "The local parser is unavailable. Start it and try again.",
        }));
      throw new Error(
        typeof error.detail === "string"
          ? error.detail
          : "Could not read this netlist.",
      );
    }
    const result = (await response.json()) as Circuit;
    if (currentRequest !== requestId) return;
    circuit = result;
    filename = name;
    sampleName = example;
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
function loadSample(name: string) {
  document.body.classList.remove("nav-open");
  void readCircuit(
    `/api/samples/${name}`,
    name === "clean" ? "clean.net" : "missing_ground.net",
    name,
  );
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
  await readCircuit("/api/parse", file.name, "", {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
}
function renderCircuit() {
  if (!circuit) return;
  const components = circuit.components;
  const unused = circuit.nets.filter(isUnused).length;
  const pinCount = circuit.nets.reduce(
    (total, net) => total + net.nodes.length,
    0,
  );
  const boards = components.filter((c) => componentKind(c) === "board");
  $("#circuit-title").textContent = filename;
  $("#source-badge").textContent = sampleName
    ? "Example circuit"
    : "Uploaded netlist";
  $("#stats").innerHTML =
    `<div class="stat"><span>${icon("chip", 15)} Components</span><strong>${components.length}<small>parts in your circuit</small></strong></div><div class="stat"><span>${icon("net", 15)} Nets</span><strong>${circuit.nets.length}<small>${circuit.nets.length - unused} shown by default · ${unused} unused</small></strong></div><div class="stat"><span>${icon("graph", 15)} Pin connections</span><strong>${pinCount}<small>exported pin memberships</small></strong></div><div class="stat board-stat"><span>${icon("box", 15)} Board</span><strong>${boards.length === 1 ? esc((boards[0].libsource.part || boards[0].value) === "Arduino_UNO_R3" ? "Arduino Uno R3" : "Classic Nano") : boards.length > 1 ? `${boards.length} Arduino boards` : "Not identified"}<small>${boards.length ? "From the exported symbol" : "Components are still available to explore"}</small></strong></div>`;
  document
    .querySelectorAll<HTMLElement>(".sample-item")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.sample === sampleName),
    );
  $("#copy-json").removeAttribute("disabled");
  $("#canvas-empty").hidden = components.length > 0 || circuit.nets.length > 0;
  renderView();
  renderInspector();
}
function selectItem(value: Selection) {
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
  if (!circuit || !selection) {
    $("#inspector-body").innerHTML =
      '<div class="inspector-empty">Select a component or net to inspect it.</div>';
    return;
  }
  if (selection.kind === "component") {
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
      `<div class="component-heading"><span class="component-symbol ${kind}">${icon(kind === "board" || kind === "component" ? "chip" : kind, 26)}</span><div><span class="component-ref">${esc(comp.ref)}</span><h4>${esc(displayValue(comp))}</h4></div></div><dl class="component-facts"><div><dt>Symbol library</dt><dd>${esc(comp.libsource.lib || "Unknown")}</dd></div><div><dt>Exported pins</dt><dd>${library?.pins.length ?? connections.length}</dd></div><div><dt>Pins shown</dt><dd>${active.length}</dd></div></dl><div class="connections-heading">CONNECTIONS <span>${active.length}</span></div><div class="pin-list">${active.map(({ net, pin }) => `<button class="pin-row" data-net="${esc(net.code)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pinName(circuit!, pin))}</strong><small>${esc(netLabel(net))}</small></span>${icon("chevron", 13)}</button>`).join("") || '<p class="inspector-description">No pins are shown. Exported unused pins are hidden here.</p>'}</div>${connections.length > active.length ? `<div class="unused-note">${icon("help", 14)} ${connections.length - active.length} pins marked unused in the file.</div>` : ""}`;
  } else {
    const net = circuit.nets.find((n) => n.code === selection!.id);
    if (!net) return;
    $("#inspector-body").innerHTML =
      `<div class="component-heading"><span class="component-symbol net-symbol">${icon("net", 25)}</span><div><span class="component-ref">NET ${esc(net.code)}</span><h4>${esc(netLabel(net))}</h4></div></div><p class="net-full-name">${esc(net.name)}</p><dl class="component-facts"><div><dt>Pin memberships</dt><dd>${net.nodes.length}</dd></div><div><dt>Components</dt><dd>${new Set(net.nodes.map((p) => p.ref)).size}</dd></div></dl>${net.nodes.length === 1 ? `<p class="single-pin-note">${isUnused(net) ? "This pin is marked intentionally unused in the netlist." : "This net contains one pin. This is a connectivity observation, not a diagnosis."}</p>` : ""}<div class="connections-heading">ON THIS NET <span>${net.nodes.length}</span></div><div class="pin-list">${net.nodes.map((pin) => `<button class="pin-row" data-component="${esc(pin.ref)}"><span class="pin-square">${esc(pin.pin)}</span><span><strong>${esc(pin.ref)} · ${esc(pinName(circuit!, pin))}</strong><small>${esc(pin.pintype)}</small></span>${icon("chevron", 13)}</button>`).join("")}</div>`;
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const sample = target.closest<HTMLButtonElement>("[data-sample]");
  if (sample && !sample.disabled) loadSample(sample.dataset.sample!);
  if (target.closest(".upload-trigger")) $("#file-input").click();
  if (target.closest(".help-trigger"))
    $<HTMLDialogElement>("#help-dialog").showModal();
  if (target.closest("#close-help, #got-it"))
    $<HTMLDialogElement>("#help-dialog").close();
  const tab = target.closest<HTMLElement>("[data-view]");
  if (tab) {
    view = tab.dataset.view as View;
    renderView();
  }
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
const dropzone = $("#dropzone");
let dragDepth = 0;
dropzone.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth++;
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragover", (event) => {
  event.preventDefault();
});
dropzone.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) dropzone.classList.remove("dragover");
});
dropzone.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  dropzone.classList.remove("dragover");
  if (event.dataTransfer?.files.length !== 1) {
    notice("Drop one netlist at a time.");
    return;
  }
  void upload(event.dataTransfer.files[0]);
});
document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => event.preventDefault());
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
$("#workspace-nav").onclick = () => {
  view = "graph";
  renderView();
  document.body.classList.remove("nav-open");
};
$("#menu-button").onclick = () => document.body.classList.toggle("nav-open");
$("#copy-json").onclick = async () => {
  if (!circuit) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(circuit, null, 2));
    toast("Parsed circuit copied as JSON.");
  } catch {
    toast("Clipboard unavailable. You can select and copy from the Data tab.");
  }
};
$<HTMLDialogElement>("#help-dialog").addEventListener("click", (event) => {
  if (event.target === $<HTMLDialogElement>("#help-dialog"))
    $<HTMLDialogElement>("#help-dialog").close();
});
fetch("/api/status")
  .then((response) => connectionState(response.ok))
  .catch(() => connectionState(false));
loadSample("clean");
