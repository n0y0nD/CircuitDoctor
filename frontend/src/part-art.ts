import { componentKind, escapeHtml as esc, pinName, type Circuit, type Component, type Net } from './types.ts';
import type { BoardDrawing, BoardPort } from './board-art.ts';

const svgImage = (body: string, width: number, height: number) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Arial,sans-serif">${body}</g></svg>`)}`;
export const groundImage = svgImage('<path d="M16 0v12M3 12h26M7 18h18M12 24h8" fill="none" stroke="#43675a" stroke-width="2.5"/>',32,28);
export function isGroundNet(circuit: Circuit, net: Net): boolean {
  return /^(GND|GNDA|GNDD|GNDPWR|GROUND)$/i.test(net.name.replace(/^\//,'')) ||
    net.nodes.some(pin => /^(GND|GNDA|GNDD|GNDPWR)$/.test(pinName(circuit,pin)));
}

/** Original schematic illustrations. Exported pins remain authoritative; placement is a logical layout. */
export function partDrawing(circuit: Circuit, component: Component): BoardDrawing | null {
  const kind = componentKind(component);
  const display = kind === 'oled' || kind === 'lcd';
  if (!display && !['resistor','led','diode','battery','capacitor','ground'].includes(kind)) return null;
  const library = circuit.libparts.find(p => p.lib === component.libsource.lib && p.part === component.libsource.part);
  const definitions = new Map((library?.pins || []).map(p => [p.num,p.name]));
  const members = circuit.nets.flatMap(n => n.nodes.filter(p => p.ref === component.ref));
  members.forEach(p => { if (!definitions.has(p.pin)) definitions.set(p.pin,pinName(circuit,p)); });
  const pins = [...definitions].map(([pin,label])=>({pin,label:label && label !== 'unknown' ? label : `Pin ${pin}`}));
  pins.sort((a,b)=>a.pin.localeCompare(b.pin,undefined,{numeric:true}));
  // Multi-terminal diode/LED arrays and resistor networks need their own drawings.
  if (!display && pins.length !== (kind === 'ground' ? 1 : 2)) return null;
  const active = new Set(circuit.nets.filter(n=>n.nodes.length>1).flatMap(n=>n.nodes.filter(p=>p.ref===component.ref).map(p=>p.pin)));
  const width = display ? (kind === 'lcd' ? 480 : 340) : kind === 'ground' ? 90 : 200;
  const rows = kind === 'lcd' ? Math.ceil(pins.length/2) : pins.length;
  const height = display ? Math.max(210, rows*28+78) : 120;
  const ports = new Map<string,BoardPort>();
  if (display) {
    pins.forEach((p,i)=>{
      const right = kind === 'lcd' && i >= rows;
      ports.set(p.pin,{...p,x:right?width-12:12,y:52+(right?i-rows:i)*28,side:right?'right':'left',connected:active.has(p.pin)});
    });
  } else {
    // Polarity follows exported A/K or +/- labels, never guessed numeric pin IDs.
    const first = pins.find(p=>/^(A|\+|V\+)$/.test(p.label)) || pins[0];
    const ordered = [first,...pins.filter(p=>p!==first)];
    ordered.forEach((p,i)=>ports.set(p.pin,{...p,x:i===0?8:width-8,y:height/2,side:i===0?'left':'right',connected:active.has(p.pin)}));
  }
  const terminal = [...ports.values()].map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.connected?'#f5d580':'#fff'}" stroke="#426b5c" stroke-width="1.5"/><text x="${display?(p.side==='left'?26:width-26):p.x}" y="${display?p.y+4:p.y-16}" text-anchor="${p.side==='left'?'start':'end'}" fill="#234a3c" font-size="12">${esc(p.label)}${pins.filter(other=>other.label===p.label).length>1?` #${esc(p.pin)}`:''}</text>`).join('');
  let body = '';
  if (display) {
    const oled = kind === 'oled';
    const screenY = (height-100)/2;
    const screenWidth = oled ? 190 : width-244;
    const screenCenter = 122+screenWidth/2;
    body = `<rect x="18" y="12" width="${width-30}" height="${height-24}" rx="6" fill="${oled?'#174c68':'#24796b'}" stroke="#123f45" stroke-width="2"/>
      <rect x="20" y="32" width="92" height="${height-54}" rx="3" fill="#eef4ef"/>
      ${oled?'':`<rect x="${width-112}" y="32" width="92" height="${height-54}" rx="3" fill="#eef4ef"/>`}
      ${[36,width-30].flatMap(x=>[23,height-23].map(y=>`<circle cx="${x}" cy="${y}" r="5" fill="#c0c9b4"/><circle cx="${x}" cy="${y}" r="2.5" fill="#f8fbf9"/>`)).join('')}
      <rect x="122" y="${screenY-8}" width="${screenWidth}" height="116" rx="3" fill="#132b32" stroke="#718d8f" stroke-width="2"/>
      <rect x="132" y="${screenY+2}" width="${screenWidth-20}" height="96" rx="2" fill="${oled?'#101d2b':'#9ebc75'}"/>
      ${oled?'<path d="M140 '+(screenY+12)+'h70" stroke="#294557" stroke-width="2"/>':Array.from({length:2},(_,row)=>Array.from({length:12},(_,col)=>`<rect x="${screenCenter-70+col*12}" y="${screenY+26+row*25}" width="8" height="14" fill="#89a765"/>`).join('')).join('')}
      <text x="${screenCenter}" y="${height-30}" text-anchor="middle" font-size="13" font-weight="700" letter-spacing="2" fill="#e3f1e8">${oled?'OLED':'LCD'}</text>
      ${[...ports.values()].map(p=>`<path d="M${p.side==='left'?12:width-20} ${p.y}h8" stroke="#426b5c" stroke-width="2"/>`).join('')}`;
  } else {
    const y = height/2;
    const lead = `<path d="M8 ${y}h48M144 ${y}h48" stroke="#426b5c" stroke-width="2"/>`;
    if (kind==='resistor') body = `${lead}<rect x="56" y="${y-13}" width="88" height="26" fill="#f4edda" stroke="#695e42" stroke-width="2"/><text x="100" y="${y+38}" text-anchor="middle" font-size="12" fill="#465e52">${esc(component.value)}</text>`;
    if (kind==='diode' || kind==='led') {
      const left = [...ports.values()][0];
      const right = [...ports.values()][1];
      const polarized = left.label==='A' && right.label==='K';
      body = `${lead}<rect x="56" y="${y-12}" width="88" height="24" rx="3" fill="${kind==='led'?'#cf6560':'#3c4650'}" stroke="#263d3b" stroke-width="2"/>${polarized?`<rect x="129" y="${y-11}" width="6" height="22" fill="#d8e0dc"/>`:''}${kind==='led'?`<path d="M86 ${y-21}l13-13m-6 0h6v6M106 ${y-21}l13-13m-6 0h6v6" fill="none" stroke="#af4c46" stroke-width="2"/>`:''}`;
    }
    if (kind==='battery') {
      const polarityKnown = [...ports.values()].some(p=>p.label==='+'||p.label==='V+');
      body = `<path d="M8 ${y}h69M123 ${y}h69M77 ${y-23}v46M89 ${y-13}v26M111 ${y-23}v46M123 ${y-13}v26M89 ${y}h22" fill="none" stroke="#426b5c" stroke-width="3"/>${polarityKnown?`<text x="65" y="${y-29}" font-size="16" fill="#426b5c">+</text>`:''}`;
    }
    if (kind==='capacitor') body = `<path d="M8 ${y}h80M112 ${y}h80M88 ${y-24}v48M112 ${y-24}v48" fill="none" stroke="#426b5c" stroke-width="3"/>`;
    if (kind==='ground') body = `<path d="M8 ${y}h37v8M25 ${y+8}h40M31 ${y+15}h28M38 ${y+22}h14" fill="none" stroke="#426b5c" stroke-width="2.5"/>`;
  }
  return {width,height,ports,image:svgImage(body+terminal,width,height)};
}
