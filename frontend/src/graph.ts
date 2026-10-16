import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import {
  componentKind,
  displayValue,
  escapeHtml as esc,
  isUnused,
  netLabel,
  pinName,
  type Circuit,
  type Component,
  type Selection,
} from "./types";
import { icon } from "./icons";

function card(component: Component): string {
  const kind = componentKind(component);
  const colors = {
    board: ["#e9f5ef", "#16836b"],
    resistor: ["#fff4df", "#ad7925"],
    led: ["#f1edfd", "#8063bb"],
    component: ["#edf2f7", "#677b8c"],
  }[kind];
  const symbol = icon(
    kind === "board" || kind === "component" ? "chip" : kind,
    20,
  );
  const title = displayValue(component);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="194" height="80" viewBox="0 0 194 80">
    <rect x="1" y="1" width="192" height="78" rx="10" fill="white" stroke="#dce4e0"/>
    <rect x="14" y="20" width="38" height="38" rx="9" fill="${colors[0]}"/>
    <g transform="translate(23,29)" color="${colors[1]}">${symbol}</g>
    <text x="64" y="32" font-family="Arial,sans-serif" font-size="11" fill="#738079">${esc(component.ref.slice(0, 17))}</text>
    <text x="64" y="51" font-family="Arial,sans-serif" font-size="12" font-weight="600" fill="#273d33">${esc(title.length > 17 ? title.slice(0, 16) + "…" : title)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export class CircuitGraph {
  private cy: Core;
  private observer: ResizeObserver;
  constructor(
    container: HTMLElement,
    circuit: Circuit,
    showUnused: boolean,
    onSelect: (selection: Selection) => void,
    onZoom: (value: number) => void,
  ) {
    const nets = circuit.nets.filter((n) => showUnused || !isUnused(n));
    const root =
      circuit.components.find((c) => componentKind(c) === "board") ||
      circuit.components[0];
    const others = circuit.components.filter((c) => c !== root);
    const height = Math.max(340, nets.length * 95, others.length * 125);
    const elements: ElementDefinition[] = [];
    circuit.components.forEach((component) => {
      const index = others.indexOf(component);
      elements.push({
        data: {
          id: `c:${component.ref}`,
          ref: component.ref,
          kind: "component",
          image: card(component),
          search: `${component.ref} ${component.value}`.toLowerCase(),
        },
        position: {
          x: component === root ? 100 : 660,
          y:
            component === root
              ? height / 2
              : ((index + 1) * height) / (others.length + 1),
        },
      });
    });
    nets.forEach((net, index) => {
      elements.push({
        data: {
          id: `n:${net.code}`,
          code: net.code,
          kind: "net",
          label: netLabel(net),
          single: net.nodes.length === 1 ? "yes" : "no",
          search: net.name.toLowerCase(),
        },
        position: { x: 380, y: ((index + 1) * height) / (nets.length + 1) },
      });
      const groups = new Map<string, typeof net.nodes>();
      net.nodes.forEach((pin) =>
        groups.set(pin.ref, [...(groups.get(pin.ref) || []), pin]),
      );
      groups.forEach((pins, ref) => {
        const label =
          pins.length > 1
            ? `Pins ${pins.map((p) => p.pin).join(", ")}`
            : pinName(circuit, pins[0]);
        elements.push({
          data: {
            id: `e:${net.code}:${ref}`,
            source: `c:${ref}`,
            target: `n:${net.code}`,
            label: label.length > 22 ? label.slice(0, 21) + "…" : label,
          },
        });
      });
    });
    this.cy = cytoscape({
      container,
      elements,
      layout: { name: "preset" },
      minZoom: 0.12,
      maxZoom: 2.5,
      boxSelectionEnabled: false,
      autounselectify: true,
      style: [
        {
          selector: 'node[kind = "component"]',
          style: {
            shape: "round-rectangle",
            width: 194,
            height: 80,
            "background-image": "data(image)",
            "background-fit": "contain",
            "background-opacity": 0,
            "border-width": 0,
            "border-color": "#16836b",
            "overlay-opacity": 0,
          },
        },
        {
          selector: 'node[kind = "net"]',
          style: {
            shape: "round-rectangle",
            width: 116,
            height: 34,
            "background-color": "#f0f5f3",
            "border-color": "#d9e5de",
            "border-width": 1,
            label: "data(label)",
            "font-family": "Inter Variable, sans-serif",
            "font-size": 10,
            color: "#526a5e",
            "text-valign": "center",
            "text-halign": "center",
            "text-max-width": "98px",
            "text-wrap": "ellipsis",
            "overlay-opacity": 0,
          },
        },
        {
          selector: 'node[single = "yes"]',
          style: {
            "background-color": "#fff8e9",
            "border-color": "#e9d4a4",
            color: "#926c24",
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.6,
            "line-color": "#c4d5cc",
            "curve-style": "bezier",
            label: "data(label)",
            "font-size": 9,
            color: "#7f8f86",
            "text-background-color": "#fbfdfc",
            "text-background-opacity": 1,
            "text-background-padding": "4px",
            "text-rotation": "autorotate",
            "overlay-opacity": 0,
          },
        },
        {
          selector: ".active",
          style: { "border-width": 2, "border-color": "#16836b" },
        },
        {
          selector: "edge.connected",
          style: { width: 2, "line-color": "#4f9f88", color: "#467961" },
        },
        { selector: ".muted", style: { opacity: 0.3 } },
        {
          selector: ".match",
          style: { "border-width": 3, "border-color": "#16836b", opacity: 1 },
        },
      ],
    });
    this.cy.on("tap", "node", (event) => {
      const data = event.target.data();
      onSelect({
        kind: data.kind,
        id: data.kind === "component" ? data.ref : data.code,
      });
    });
    this.cy.on("mouseover", "node", () => {
      container.style.cursor = "pointer";
    });
    this.cy.on("mouseout", "node", () => {
      container.style.cursor = "grab";
    });
    this.cy.on("zoom", () => onZoom(Math.round(this.cy.zoom() * 100)));
    this.observer = new ResizeObserver(() => this.fit());
    this.observer.observe(container);
    this.fit();
  }
  select(selection: Selection | null) {
    this.cy.elements().removeClass("active muted connected");
    if (!selection) return;
    const node = this.cy.getElementById(
      `${selection.kind === "component" ? "c" : "n"}:${selection.id}`,
    );
    if (!node.length) return;
    node.addClass("active");
    node.connectedEdges().addClass("connected");
  }
  search(query: string) {
    this.cy.elements().removeClass("muted match");
    if (!query.trim()) return;
    const matches = this.cy
      .nodes()
      .filter((node) => node.data("search").includes(query.toLowerCase()));
    this.cy.elements().addClass("muted");
    matches.addClass("match").removeClass("muted");
    matches.neighborhood().removeClass("muted");
  }
  zoomBy(amount: number) {
    this.cy.zoom({
      level: this.cy.zoom() * amount,
      renderedPosition: { x: this.cy.width() / 2, y: this.cy.height() / 2 },
    });
  }
  fit() {
    this.cy.resize();
    this.cy.fit(undefined, 45);
  }
  destroy() {
    this.observer.disconnect();
    this.cy.destroy();
  }
}
