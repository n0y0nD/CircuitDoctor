import { boardIdentity, escapeHtml as esc, pinName, type Circuit, type Component } from './types.ts';

export interface BoardPort { pin: string; label: string; x: number; y: number; side: 'left' | 'right' | 'top' | 'bottom'; connected: boolean }
export interface BoardDrawing { width: number; height: number; image: string; ports: Map<string, BoardPort> }

// This is an illustrative board view, not a physical footprint. Names come from
// the export, never from an assumed mapping of KiCad pin IDs to Arduino numbers.
// Reference terminology: https://content.arduino.cc/assets/A000066-full-pinout.pdf
// https://docs.arduino.cc/resources/pinouts/A000005-full-pinout.pdf
export function boardDrawing(circuit: Circuit, component: Component, visiblePins?: Set<string>): BoardDrawing {
  const library = circuit.libparts.find(p => p.lib === component.libsource.lib && p.part === component.libsource.part);
  const members = circuit.nets.flatMap(n => n.nodes.filter(p => p.ref === component.ref));
  const definitions = new Map((library?.pins || []).map(p => [p.num, p.name]));
  members.forEach(p => { if (!definitions.has(p.pin)) definitions.set(p.pin, pinName(circuit, p)); });
  const active = new Set(circuit.nets.filter(n => n.nodes.length > 1)
    .flatMap(n => n.nodes.filter(p => p.ref === component.ref).map(p => p.pin)));
  const clean = (name: string, pin: string) => name && name !== 'unknown'
    ? name.replace(/~\{([^}]+)\}/g, '$1').replace(/^\+/, '').replace(/^3V3$/, '3.3V') : `Pin ${pin}`;
  const pins = [...definitions].map(([pin, name]) => ({ pin, label: clean(name, pin) }));
  const identity = boardIdentity(component);
  const nano = identity === 'nano' || identity === 'nano-unspecified';
  // An original, illustrative board drawing. Slot matching uses exported names,
  // never numeric symbol IDs; repeated/unknown names retain separate terminals.
  const topLabels = nano
    ? ['D13','3.3V','AREF','A0','A1','A2','A3','A4','A5','A6','A7','5V','RESET','GND','VIN']
    : ['SCL','SDA','AREF','GND','D13','D12','D11','D10','D9','D8','D7','D6','D5','D4','D3','D2','D1','D0'];
  const bottomLabels = nano
    ? ['D12','D11','D10','D9','D8','D7','D6','D5','D4','D3','D2','GND','RESET','D0','D1']
    : ['NC','IOREF','RESET','3.3V','5V','GND','GND','VIN','A0','A1','A2','A3','A4','A5'];
  const boardWidth = 540, boardHeight = nano ? 240 : 365;
  type Slot = { label:string; x:number; y:number; side:BoardPort['side']; used?:boolean };
  const slots:Slot[] = [
    ...topLabels.map((label,i)=>({label,x:(nano?95:104)+i*(nano?28:23),y:30,side:'top' as const})),
    ...bottomLabels.map((label,i)=>({label,x:(nano?95:140)+i*(nano?28:27),y:boardHeight-30,side:'bottom' as const})),
  ];
  const allPorts = new Map<string,BoardPort>();
  let extra = 0;
  for (const p of pins) {
    const aliases=p.label.toUpperCase().replace(/^\+/, '').replace(/3V3/g,'3.3V').replace(/~/g,'').split(/[ /]+/);
    const slot=slots.find(s=>!s.used && aliases.includes(s.label.toUpperCase()));
    if(slot) slot.used=true;
    allPorts.set(p.pin,{...p,x:slot?.x ?? 590,y:slot?.y ?? 55+extra++*28,side:slot?.side ?? 'right',connected:active.has(p.pin)});
  }
  const width=extra?660:boardWidth, height=Math.max(boardHeight,extra*28+85);
  const ports=new Map([...allPorts].filter(([pin])=>!visiblePins || visiblePins.has(pin)));
  const hole=(x:number,y:number)=>`<circle cx="${x}" cy="${y}" r="10" fill="#d0b982" stroke="#edd8a6" stroke-width="2"/><circle cx="${x}" cy="${y}" r="5.5" fill="#f4f8f7" stroke="#536e76"/>`;
  const socket=(x:number,y:number,on=false)=>`<rect x="${x-7}" y="${y-8}" width="14" height="16" rx="1.5" fill="${on?'#eabf57':'#25323b'}" stroke="${on?'#fff0af':'#52616a'}"/><circle cx="${x}" cy="${y}" r="3" fill="#080f16" stroke="#64737b" stroke-width=".7"/>`;
  const headers=slots.map(s=>`${socket(s.x,s.y)}${[...ports.values()].some(p=>p.connected && p.x===s.x && p.y===s.y)?'':`<text transform="translate(${s.x+4} ${s.side==='top'?49:boardHeight-48}) rotate(-90)" text-anchor="${s.side==='top'?'end':'start'}" font-size="9" fill="#d1e8ed">${s.label}</text>`}`).join('');
  const activeSockets=[...ports.values()].map(p=>{
    const duplicate=pins.filter(o=>o.label===p.label).length>1;
    const slot=slots.find(s=>s.x===p.x && s.y===p.y);
    const label=`${slot?.label ?? p.label}${duplicate?` #${p.pin}`:''}`;
    return `${socket(p.x,p.y,p.connected)}${p.side==='right'?`<text x="${p.x+13}" y="${p.y+4}" font-size="12" fill="#344e60">${esc(label)}</text>`:p.connected?`<text transform="translate(${p.x+4} ${p.side==='top'?49:boardHeight-48}) rotate(-90)" text-anchor="${p.side==='top'?'end':'start'}" font-size="12" font-weight="700" fill="#f8fbfc" stroke="#173e52" stroke-width="2" paint-order="stroke">${esc(label)}</text>`:''}`;
  }).join('');
  const chip=(x:number,y:number,w:number,h:number,n:number)=>`<g>${Array.from({length:n},(_,i)=>`<path d="M${x+9+i*(w-18)/(n-1)} ${y-7}v${h+14}" stroke="#bec7cd" stroke-width="5"/>`).join('')}<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="url(#chip)" stroke="#101c26" stroke-width="2"/><circle cx="${x+10}" cy="${y+11}" r="3" fill="#66727a"/></g>`;
  const passives=Array.from({length:8},(_,i)=>`<g transform="translate(${155+i*36} ${nano?91:150})"><rect width="17" height="8" rx="1" fill="#bec4c7"/><rect x="4" width="9" height="8" fill="${i%2?'#393a38':'#b99f77'}"/></g>`).join('');
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="pcb" x2=".8" y2="1"><stop stop-color="#117fa8"/><stop offset=".5" stop-color="#08678f"/><stop offset="1" stop-color="#064b71"/></linearGradient>
      <linearGradient id="metal" x2="0" y2="1"><stop stop-color="#f1f3f4"/><stop offset=".25" stop-color="#c7cfd4"/><stop offset=".6" stop-color="#8999a5"/><stop offset="1" stop-color="#d5dce1"/></linearGradient>
      <linearGradient id="chip" x2="0" y2="1"><stop stop-color="#34434c"/><stop offset="1" stop-color="#101b24"/></linearGradient>
    </defs>
    <g font-family="Arial,sans-serif">
      <path d="M45 17H505L528 40V${boardHeight-42}L507 ${boardHeight-17}H45Z" fill="#063c55" opacity=".2" transform="translate(2 4)"/>
      <path d="M43 16H502L526 40V${boardHeight-43}L503 ${boardHeight-18}H43Z" fill="url(#pcb)" stroke="#174c60" stroke-width="2"/>
      <path d="M70 80H190L211 101H414M120 ${boardHeight-65}H172L192 ${boardHeight-85}H465M240 75V110L269 139H460M470 100V${boardHeight-96}H430" fill="none" stroke="#42a3bd" opacity=".25" stroke-width="2"/>
      ${hole(63,45)}${hole(508,64)}${hole(63,boardHeight-44)}${hole(507,boardHeight-64)}
      <rect x="${nano?85:94}" y="19" width="${nano?420:411}" height="23" rx="2" fill="#17232c" stroke="#070d12" stroke-width="2"/>
      <rect x="${nano?85:130}" y="${boardHeight-42}" width="${nano?420:374}" height="23" rx="2" fill="#17232c" stroke="#070d12" stroke-width="2"/>
      ${headers}
      <g transform="translate(12 ${nano?85:83})"><rect x="0" y="0" width="79" height="${nano?58:82}" rx="4" fill="url(#metal)" stroke="#697c89" stroke-width="2"/><path d="M6 7H69V${nano?49:73}H6Z" fill="none" stroke="#e7ecee" stroke-width="2"/><rect x="-4" y="12" width="11" height="${nano?34:58}" rx="2" fill="#778b9a"/><path d="M18 8v10h40V8M18 ${nano?50:74}v-10h40v10" fill="none" stroke="#718694" stroke-width="3"/></g>
      ${nano?'':`<g transform="translate(22 250)"><rect width="83" height="58" rx="5" fill="#17232b" stroke="#0a131b" stroke-width="2"/><rect x="0" width="24" height="58" rx="4" fill="#26353f"/><ellipse cx="8" cy="29" rx="8" ry="18" fill="#070e13"/><path d="M29 5H77V12H29" fill="#52616b"/></g><g transform="translate(116 230)"><circle r="16" fill="#213a48"/><ellipse cy="-6" rx="15" ry="11" fill="url(#metal)"/><path d="M-9 -6H9M0 -13V1" stroke="#728591"/></g><g transform="translate(154 230)"><circle r="13" fill="#213a48"/><ellipse cy="-5" rx="12" ry="9" fill="url(#metal)"/><path d="M-7 -5H7" stroke="#728591"/></g>`}
      <rect x="104" y="${nano?93:88}" width="28" height="24" rx="2" fill="#b4c0c5" stroke="#758993"/><circle cx="118" cy="${nano?105:100}" r="7" fill="#ba5b4c" stroke="#753a32"/>
      <text x="102" y="${nano?128:123}" font-size="7" fill="#d3e8ed">RESET</text>
      ${nano?chip(238,115,68,58,8):chip(234,245,225,43,14)}
      ${nano?'':chip(154,103,46,35,6)}
      ${passives}
      <rect x="${nano?153:192}" y="${nano?152:197}" width="44" height="17" rx="8" fill="url(#metal)" stroke="#617785"/><text x="${nano?160:199}" y="${nano?163:209}" font-size="6" fill="#5c717b">16.000</text>
      <text x="${nano?371:350}" y="${nano?126:192}" text-anchor="middle" font-size="${nano?19:25}" letter-spacing="1" font-weight="700" fill="#e5f5f7">ARDUINO</text>
      <text x="${nano?371:350}" y="${nano?149:219}" text-anchor="middle" font-size="${nano?15:23}" font-weight="700" fill="#e5f5f7">${nano?'NANO':'UNO'}</text>
      <text x="${nano?272:345}" y="${nano?147:270}" text-anchor="middle" font-family="monospace" font-size="${nano?6:9}" fill="#9baab1">${identity==='nano-unspecified'?'': 'ATmega328P'}</text>
      ${Array.from({length:6},(_,i)=>`<rect x="${475+(i%2)*10}" y="${nano?114+Math.floor(i/2)*10:239+Math.floor(i/2)*10}" width="6" height="6" fill="#dfc284" stroke="#354954" stroke-width="2"/>`).join('')}
      <rect x="444" y="${nano?176:114}" width="14" height="7" fill="#cdd9c6"/><rect x="448" y="${nano?177:115}" width="6" height="5" fill="#b5cf50"/><text x="465" y="${nano?182:121}" font-size="8" fill="#e1eef0">ON</text>
      ${extra?`<text x="562" y="27" font-size="10" fill="#587081">EXPORTED PINS</text>`:''}
      ${activeSockets}
    </g></svg>`;
  return {width,height,ports,image:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`};
}
