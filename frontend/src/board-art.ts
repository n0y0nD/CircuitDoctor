import { escapeHtml as esc, pinName, type Circuit, type Component } from './types.ts';

export interface BoardPort { pin: string; label: string; x: number; y: number; side: 'left' | 'right'; connected: boolean }
export interface BoardDrawing { width: number; height: number; image: string; ports: Map<string, BoardPort> }

// This is an enlarged logical pin map, not a physical footprint. Names come from
// the export, never from an assumed mapping of KiCad pin IDs to Arduino numbers.
// Reference terminology: https://content.arduino.cc/assets/A000066-full-pinout.pdf
// https://docs.arduino.cc/resources/pinouts/A000005-full-pinout.pdf
export function boardDrawing(circuit: Circuit, component: Component): BoardDrawing {
  const library = circuit.libparts.find(p => p.lib === component.libsource.lib && p.part === component.libsource.part);
  const members = circuit.nets.flatMap(n => n.nodes.filter(p => p.ref === component.ref));
  const definitions = new Map((library?.pins || []).map(p => [p.num, p.name]));
  members.forEach(p => { if (!definitions.has(p.pin)) definitions.set(p.pin, pinName(circuit, p)); });
  const active = new Set(circuit.nets.filter(n => !n.nodes.every(p => p.pintype.split('+').includes('no_connect')))
    .flatMap(n => n.nodes.filter(p => p.ref === component.ref).map(p => p.pin)));
  const clean = (name: string, pin: string) => name && name !== 'unknown'
    ? name.replace(/~\{([^}]+)\}/g, '$1').replace(/^\+/, '').replace(/^3V3$/, '3.3V') : `Pin ${pin}`;
  const pins = [...definitions].map(([pin, name]) => ({ pin, label: clean(name, pin) }));
  const left = pins.filter(p => !/^D\d|^(SDA|SCL|AREF)/.test(p.label));
  const right = pins.filter(p => !left.includes(p));
  const sort = (a: typeof pins[number], b: typeof pins[number]) => a.pin.localeCompare(b.pin, undefined, { numeric: true });
  left.sort(sort); right.sort(sort);
  const width = 420, height = Math.max(440, Math.max(left.length, right.length) * 27 + 130);
  const ports = new Map<string, BoardPort>();
  for (const [side, group] of [['left', left], ['right', right]] as const) {
    group.forEach((p, i) => ports.set(p.pin, { ...p, x: side === 'left' ? 22 : width-22, y: 93+i*27,
      side, connected: active.has(p.pin) }));
  }
  const nano = component.libsource.part === 'Arduino_Nano_v3.x';
  const sockets = [...ports.values()].map(p => {
    const duplicate = pins.filter(other => other.label === p.label).length > 1;
    const textX = p.side === 'left' ? p.x+18 : p.x-18;
    return `<rect x="${p.x-8}" y="${p.y-8}" width="16" height="16" rx="3" fill="${p.connected?'#ffdc7b':'#142e3a'}" stroke="${p.connected?'#ffedb1':'#638b96'}" stroke-width="1.5"/>
      <circle cx="${p.x}" cy="${p.y}" r="3.5" fill="#071c25"/>
      <text x="${textX}" y="${p.y+5}" text-anchor="${p.side==='left'?'start':'end'}" font-size="${p.connected?16:13}" font-weight="${p.connected?700:400}" fill="${p.connected?'#fff1bb':'#c1d8dd'}">${esc(p.label)}${duplicate?` <tspan font-size="10" fill="#9dbbc4">#${esc(p.pin)}</tspan>`:''}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs><linearGradient id="board" x2="1" y2="1"><stop stop-color="#14788d"/><stop offset="1" stop-color="#104759"/></linearGradient><linearGradient id="usb" x2="0" y2="1"><stop stop-color="#ecf0f1"/><stop offset="1" stop-color="#91a4af"/></linearGradient></defs>
    <path d="M18 8H382L412 37V${height-24}Q412 ${height-8} 396 ${height-8}H24Q8 ${height-8} 8 ${height-24}V24Q8 8 18 8Z" fill="url(#board)" stroke="#0d4556" stroke-width="3"/>
    <rect x="161" y="1" width="98" height="54" rx="5" fill="url(#usb)" stroke="#647e8c" stroke-width="2"/><rect x="179" y="8" width="62" height="25" rx="2" fill="#526773"/><rect x="188" y="15" width="44" height="10" fill="#bac8ce"/>
    <g font-family="Arial,sans-serif">${sockets}
      <text x="210" y="${height/2-40}" text-anchor="middle" font-size="21" font-weight="700" fill="#e1f2f5">ARDUINO</text>
      <text x="210" y="${height/2-17}" text-anchor="middle" font-size="14" fill="#b5d7dd">${nano?'CLASSIC NANO':'UNO R3'}</text>
      <rect x="177" y="${height/2+9}" width="66" height="95" rx="4" fill="#122b36" stroke="#547987"/>
      ${Array.from({length:8},(_,i)=>`<path d="M169 ${height/2+19+i*10}h8 M243 ${height/2+19+i*10}h8" stroke="#a7bbc3" stroke-width="3"/>`).join('')}
      <text x="210" y="${height/2+62}" text-anchor="middle" font-family="monospace" font-size="8" fill="#8ea9b5">ATmega328P</text>
      <text x="210" y="${height-36}" text-anchor="middle" font-size="11" fill="#a9cbd3">PIN MAP · NOT TO SCALE</text>
      <circle cx="123" cy="${height-35}" r="4" fill="#ffdc7b"/>
    </g></svg>`;
  return { width, height, ports, image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
}
