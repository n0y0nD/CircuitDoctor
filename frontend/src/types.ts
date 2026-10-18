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
export type View = "graph" | "components" | "nets";

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

// Display identity is separate from the backend's verified electrical catalog.
export function boardIdentity(component: Component): 'uno' | 'nano' | 'nano-unspecified' | null {
  if (component.libsource.lib !== 'MCU_Module') return null;
  switch (component.libsource.part) {
    case 'Arduino_UNO_R3': return 'uno';
    case 'Arduino_Nano_v3.x': return 'nano';
    case 'Arduino_Nano': return 'nano-unspecified';
    default: return null;
  }
}

export function boardLabel(component: Component): string {
  const board = boardIdentity(component);
  return board === 'uno' ? 'Arduino Uno R3' : board === 'nano' ? 'Classic Nano'
    : board === 'nano-unspecified' ? 'Arduino Nano (version unspecified)' : 'Board not identified';
}

export function componentKind(
  component: Component,
): "board" | "resistor" | "led" | "oled" | "lcd" | "diode" | "battery" | "capacitor" | "ground" | "component" {
  const part = component.libsource.part || component.value;
  if (boardIdentity(component)) return "board";
  if (part === "R" || part === "R_Small") return "resistor";
  if (part === "LED" || part.startsWith("LED_")) return "led";
  const lib = component.libsource.lib;
  // Match symbol identities, not arbitrary user values such as "OLED controller".
  if (lib === "Display_Graphic" && /(?:OLED|^SSD1306$|^SSD1309$)/i.test(part)) return "oled";
  if (lib === "Display_Character" || (lib === "Display_Graphic" && /^LCD[-_]/i.test(part))) return "lcd";
  if (lib === "Device" && /^(D|D_Small|D_Schottky|D_Schottky_Small|D_Zener|D_Zener_Small)$/.test(part)) return "diode";
  if (lib === "Diode" && /^(1N4148|1N400[1-7]|1N581[7-9]|BAT54|SS14)$/.test(part)) return "diode";
  if (lib === "Device" && /^(Battery|Battery_Cell)$/.test(part)) return "battery";
  if (lib === "Device" && /^(C|C_Small|C_Polarized|C_Polarized_Small)$/.test(part)) return "capacitor";
  if (lib === "power" && /^(GND|GNDA|GNDD|GNDPWR)$/.test(part)) return "ground";
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
