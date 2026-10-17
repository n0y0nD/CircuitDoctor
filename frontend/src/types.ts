export interface Component {
  ref: string;
  value: string;
  footprint: string;
  datasheet: string;
  libsource: { lib: string; part: string };
  fields: Record<string, string>;
  properties: Record<string, string>;
}
export interface PinNode {
  ref: string;
  pin: string;
  pinfunction: string;
  pintype: string;
}
export interface Net {
  code: string;
  name: string;
  nodes: PinNode[];
}
export interface Circuit {
  storage: {
    source: "falkordb";
    circuit_id: string;
    graph_name: string;
    filename: string;
    sample: string;
    pins: number;
    connections: number;
    query: string;
  };
  version: string;
  design: { source: string; date: string; tool: string };
  components: Component[];
  libparts: {
    lib: string;
    part: string;
    pins: { num: string; name: string; type: string }[];
  }[];
  nets: Net[];
}
export type Selection = { kind: "component" | "net"; id: string } | { kind: "pin"; id: string; ref: string; pin: string };
export type View = "graph" | "components" | "nets" | "data";

export const escapeHtml = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );

export const isUnused = (net: Net) =>
  net.nodes.every((pin) => pin.pintype.split("+").includes("no_connect"));

export function componentKind(
  component: Component,
): "board" | "resistor" | "led" | "component" {
  const part = component.libsource.part || component.value;
  if (["Arduino_UNO_R3", "Arduino_Nano_v3.x"].includes(part)) return "board";
  if (part === "R" || part === "R_Small") return "resistor";
  if (part === "LED" || part.startsWith("LED_")) return "led";
  return "component";
}

export function pinName(circuit: Circuit, node: PinNode): string {
  const comp = circuit.components.find((c) => c.ref === node.ref);
  const library = circuit.libparts.find(
    (p) => p.lib === comp?.libsource.lib && p.part === comp?.libsource.part,
  );
  return (
    library?.pins.find((p) => p.num === node.pin)?.name ||
    (node.pinfunction !== "unknown" ? node.pinfunction : `Pin ${node.pin}`)
  );
}

export const displayValue = (component: Component) =>
  component.value.replaceAll("_", " ");
export const netLabel = (net: Net) =>
  net.name.startsWith("unconnected-")
    ? `${net.nodes[0].ref}.${net.nodes[0].pin}`
    : net.name.replace(/^\//, "");

// Hide disconnected wire stubs, but always reveal the connection being inspected.
export function visibleNets(circuit: Circuit, showUnconnected: boolean, selection: Selection | null = null): Net[] {
  return circuit.nets.filter(net => showUnconnected || net.nodes.length > 1 ||
    (selection?.kind === "net" && selection.id === net.code) ||
    (selection?.kind === "pin" && net.nodes.some(pin => pin.ref === selection.ref && pin.pin === selection.pin)));
}

export function endpointLabel(circuit: Circuit, pin: PinNode): string {
  const name = pinName(circuit, pin);
  const sameName = new Set(circuit.nets.flatMap(net => net.nodes)
    .filter(other => other.ref === pin.ref && pinName(circuit, other) === name).map(other => other.pin));
  return `${pin.ref} · ${name}${sameName.size > 1 ? ` (pin ${pin.pin})` : ""}`;
}
export function connectionLabel(circuit: Circuit, net: Net): string {
  return net.nodes.map(pin => endpointLabel(circuit, pin)).join(" ↔ ") || "No pins connected";
}
