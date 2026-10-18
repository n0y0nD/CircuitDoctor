import { componentKind, escapeHtml as esc, pinName, type Circuit, type Component, type Net } from './types.ts';
import { passiveBody, displayBody } from './component-art.ts';
import { resistorBody } from './resistor-art.ts';
import type { BoardDrawing, BoardPort } from './board-art.ts';

const svgImage = (body: string, width: number, height: number) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g font-family="Arial,sans-serif">${body}</g></svg>`)}`;
export const groundImage = svgImage('<path d="M16 0v12M3 12h26M7 18h18M12 24h8" fill="none" stroke="#8A867E" stroke-width="2.5"/>',32,28);
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
  const pins = [...definitions].map(([pin,label])=>({pin,label:label && label !== 'unknown' && label!=='~' ? label : `Pin ${pin}`}));
  pins.sort((a,b)=>a.pin.localeCompare(b.pin,undefined,{numeric:true}));
  // Multi-terminal diode/LED arrays and resistor networks need their own drawings.
  if (!display && pins.length !== (kind === 'ground' ? 1 : 2)) return null;
  const active = new Set(circuit.nets.filter(n=>n.nodes.length>1).flatMap(n=>n.nodes.filter(p=>p.ref===component.ref).map(p=>p.pin)));
  const width = display ? Math.max(kind === 'lcd' ? 480 : 340,pins.length*25+72) : kind === 'ground' ? 90 : 200;
  const height = display ? (kind==='lcd'?250:230) : 120;
  const ports = new Map<string,BoardPort>();
  if (display) {
    pins.forEach((p,i)=>ports.set(p.pin,{...p,x:width/2+(i-(pins.length-1)/2)*(kind==='lcd'?25:38),y:26,side:'top',connected:active.has(p.pin)}));
  } else {
    // Polarity follows exported A/K or +/- labels, never guessed numeric pin IDs.
    const first = pins.find(p=>/^(A|\+|V\+)$/.test(p.label)) || pins[0];
    const ordered = [first,...pins.filter(p=>p!==first)];
    ordered.forEach((p,i)=>ports.set(p.pin,{...p,x:i===0?8:width-8,y:height/2,side:i===0?'left':'right',connected:active.has(p.pin)}));
  }
  const terminal = [...ports.values()].map(p=>{
    const label=esc(p.label)+(pins.filter(other=>other.label===p.label).length>1?` #${esc(p.pin)}`:'');
    const text=display ? kind==='lcd'
      ? `<text transform="translate(${p.x+4} 43) rotate(-90)" text-anchor="end" fill="#e0edf0" font-size="10">${label}</text>`
      : `<text x="${p.x}" y="48" text-anchor="middle" fill="#e0edf0" font-size="11">${label}</text>`
      : `<text x="${p.x}" y="${p.y-16}" text-anchor="${p.side==='left'?'start':'end'}" fill="#234a3c" font-size="12">${label}</text>`;
    return `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.connected?'#f5d580':'#fff'}" stroke="#426b5c" stroke-width="1.5"/>${text}`;
  }).join('');
  let body = '';
  if (display) {
    body=displayBody(kind==='oled',width,height,[...ports.values()]);
  } else {
    const y = height/2;
    if (kind==='resistor') {
      const tolerance=Object.entries({...component.properties,...component.fields}).find(([key])=>key.toLowerCase()==='tolerance')?.[1];
      body=resistorBody(component.value,tolerance);
    }
    if (['diode','led','battery','capacitor'].includes(kind)) {
      const [left,right]=[...ports.values()];
      const polarized=(left.label==='A' && right.label==='K') || (/^(\+|V\+)$/.test(left.label) && /^(-|V-)$/.test(right.label));
      body=passiveBody(kind,component.value,polarized,component.libsource.part==='C_Polarized');
    }
    if (kind==='ground') body = `<path d="M8 ${y}h37v8M25 ${y+8}h40M31 ${y+15}h28M38 ${y+22}h14" fill="none" stroke="#426b5c" stroke-width="2.5"/>`;
  }
  return {width,height,ports,image:svgImage(body+terminal,width,height)};
}
