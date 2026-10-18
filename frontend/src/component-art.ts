import { escapeHtml as esc } from './types.ts';

// Original illustrations. Geometry is illustrative; callers retain imported pin IDs.
const materials = `<defs>
  <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#80929d"/><stop offset=".3" stop-color="#f1f4f6"/><stop offset=".55" stop-color="#c5cfd4"/><stop offset="1" stop-color="#6c808c"/></linearGradient>
  <linearGradient id="dark" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#1a242c"/><stop offset=".3" stop-color="#596670"/><stop offset=".6" stop-color="#293640"/><stop offset="1" stop-color="#101d25"/></linearGradient>
  <linearGradient id="blue" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#102e46"/><stop offset=".35" stop-color="#376a89"/><stop offset=".65" stop-color="#1f4a65"/><stop offset="1" stop-color="#102b40"/></linearGradient>
</defs>`;
const leads = '<path d="M8 60H64M136 60H192" stroke="#7a8d98" stroke-width="5"/><path d="M8 59H64M136 59H192" stroke="#e1e7eb" stroke-width="2"/>';

export function passiveBody(kind:string, value:string, polarized:boolean, electrolytic:boolean):string {
  const valueLabel=`<text x="100" y="110" text-anchor="middle" font-size="11" fill="#526b70">${esc(value)}</text>`;
  if(kind==='led') {
    // Lens colour is appearance only; no halo or animation implies an operating LED.
    const color=/\bgreen\b/i.test(value)?'#3b9e69':/\bblue\b/i.test(value)?'#4283bb':/\b(yellow|amber)\b/i.test(value)?'#d9a62e':'#c24b4d';
    return `${materials}<defs><linearGradient id="lens" x1="0" y1="0" x2="1" y2=".4"><stop stop-color="${color}"/><stop offset=".35" stop-color="#f4d7d2"/><stop offset=".6" stop-color="${color}"/><stop offset="1" stop-color="#6a333c"/></linearGradient></defs>
      <path d="M8 60H69V86H88V65M192 60H131V86H112V65" fill="none" stroke="#83929b" stroke-width="5"/>
      <path d="M8 59H68V85H87M192 59H132V85H113" fill="none" stroke="#dfe6e9" stroke-width="1.8"/>
      <path d="M74 66V39C74 5 126 5 126 39V66Z" fill="url(#lens)" stroke="#8a4c50" stroke-width="1.4"/>
      <path d="M88 64V49H99L105 57H113V64" fill="#998c8b" opacity=".55"/>
      <path d="M96 49L105 42L112 53" fill="none" stroke="#e9cdbe" stroke-width="1"/>
      <ellipse cx="100" cy="66" rx="32" ry="6" fill="${color}" stroke="#86464b" stroke-width="1.3"/>
      <path d="M83 42V35Q83 21 95 20" fill="none" stroke="#fff4ec" opacity=".65" stroke-width="5" stroke-linecap="round"/>
      ${valueLabel}`;
  }
  if(kind==='diode') return `${materials}${leads}
    <rect x="57" y="44" width="86" height="34" rx="7" fill="#13232c" opacity=".12"/>
    <rect x="57" y="41" width="86" height="35" rx="6" fill="url(#dark)" stroke="#253640" stroke-width="1.3"/>
    ${polarized?'<path d="M128 42V75H136V42Z" fill="url(#metal)"/>':''}
    <path d="M65 46H124" stroke="#d1d9dd" opacity=".22" stroke-width="2"/>
    <text x="96" y="63" text-anchor="middle" font-size="8" fill="#b9c5cb">DIODE</text>${valueLabel}`;
  if(kind==='battery') return `${materials}${leads}
    <rect x="52" y="46" width="9" height="28" rx="2" fill="url(#metal)"/>
    <rect x="59" y="34" width="86" height="52" rx="7" fill="url(#dark)" stroke="#283a46"/>
    <path d="M67 34H86V86H67Q59 86 59 78V42Q59 34 67 34" fill="#b89e60"/>
    <path d="M64 39H137" stroke="#edf0e8" opacity=".35" stroke-width="2"/>
    ${polarized?'<text x="72" y="66" text-anchor="middle" font-size="20" fill="#fff4ce">+</text><text x="132" y="66" text-anchor="middle" font-size="20" fill="#ced9df">−</text>':''}
    <text transform="translate(108 62) rotate(-90)" text-anchor="middle" font-size="7" letter-spacing="1" fill="#c6d1d6">CELL</text>${valueLabel}`;
  if(kind==='capacitor' && electrolytic) return `${materials}
    <path d="M8 60H63V89H88V74M192 60H137V89H112V74" fill="none" stroke="#8c9ca6" stroke-width="4"/>
    <path d="M8 59H62V88H87M192 59H138V88H113" fill="none" stroke="#e6ebee" stroke-width="1.4"/>
    <path d="M69 29H131V74C131 92 69 92 69 74Z" fill="url(#blue)" stroke="#1f3747"/>
    ${polarized?'<path d="M118 29H129V77Q127 83 118 84Z" fill="#aabcc6"/><path d="M120 43H126M120 55H126M120 67H126" stroke="#2c4555" stroke-width="2"/>':''}
    <ellipse cx="100" cy="29" rx="31" ry="12" fill="url(#metal)" stroke="#6c7f8b"/>
    <ellipse cx="100" cy="29" rx="25" ry="8" fill="#c5ced2" stroke="#9ba9b0"/>
    <path d="M84 24L116 34M84 34L116 24" stroke="#8b9ba4" stroke-width="1.2"/>
    <text x="95" y="59" text-anchor="middle" font-size="7" fill="#d3e2e8">CAP</text>${valueLabel}`;
  if(kind==='capacitor') return `${materials}<defs><radialGradient id="ceramic-disc" cx=".35" cy=".3" r=".8"><stop stop-color="#f5c994"/><stop offset=".55" stop-color="#c8894c"/><stop offset="1" stop-color="#935b32"/></radialGradient></defs>
    <path d="M8 60H61V86H86V61M192 60H139V86H114V61" fill="none" stroke="#95a3aa" stroke-width="4"/>
    <ellipse cx="100" cy="47" rx="35" ry="31" fill="url(#ceramic-disc)" stroke="#9d683c" stroke-width="1.5"/>
    <path d="M77 36Q81 24 96 23" fill="none" stroke="#fbe0b5" opacity=".6" stroke-width="3" stroke-linecap="round"/>
    ${valueLabel}`;
  return '';
}

export function displayBody(oled:boolean,width:number,height:number,ports:Array<{x:number;y:number;side:string}>):string {
  const screenY=oled?67:92, screenX=oled?40:44, screenWidth=width-screenX*2, center=width/2;
  return `${materials}<defs>
    <linearGradient id="pcb" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${oled?'#23668c':'#3b9274'}"/><stop offset="1" stop-color="${oled?'#123d5b':'#165242'}"/></linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2=".4" y2="1"><stop stop-color="${oled?'#203544':'#99ae7d'}"/><stop offset=".45" stop-color="${oled?'#101e2a':'#b3c59b'}"/><stop offset="1" stop-color="${oled?'#080f17':'#8a9f70'}"/></linearGradient>
  </defs>
    <rect x="20" y="15" width="${width-30}" height="${height-24}" rx="6" fill="#244550" opacity=".16"/>
    <rect x="18" y="12" width="${width-30}" height="${height-24}" rx="6" fill="url(#pcb)" stroke="#163a4b" stroke-width="2"/>
    <path d="M52 54H71L80 63M53 ${height-28}H70L81 ${height-39}" fill="none" stroke="#91c1b9" opacity=".35"/>
    ${[36,width-30].flatMap(x=>[25,height-25].map(y=>`<circle cx="${x}" cy="${y}" r="6" fill="#c7b782" stroke="#e0d1a6"/><circle cx="${x}" cy="${y}" r="3" fill="#f7faf9"/>`)).join('')}
    <rect x="${screenX-3}" y="${screenY-7}" width="${screenWidth+6}" height="126" rx="4" fill="#081219" stroke="#7c8d93" stroke-width="2"/>
    <rect x="${screenX+5}" y="${screenY+1}" width="${screenWidth-10}" height="110" rx="2" fill="url(#glass)"/>
    <path d="M${screenX+10} ${screenY+7}H${screenX+screenWidth-6}L${screenX+screenWidth-27} ${screenY+36}H${screenX+10}Z" fill="#c8e5e9" opacity=".035"/>
    ${oled?'':Array.from({length:2},(_,r)=>Array.from({length:12},(_,c)=>`<rect x="${center-128+c*23}" y="${screenY+27+r*29}" width="15" height="18" fill="#567045" opacity=".13"/>`).join('')).join('')}
    ${Array.from({length:12},(_,i)=>`<rect x="${center-36+i*6}" y="${screenY+120}" width="3" height="9" fill="#c2a870" opacity=".8"/>`).join('')}
    <text x="${center}" y="${height-20}" text-anchor="middle" font-size="10" font-weight="700" letter-spacing="2" fill="#dbedf0">${oled?'OLED':'LCD'}</text>
    ${ports.map(p=>`<path d="M${p.x} 15V32" stroke="#b9a877" stroke-width="5"/><rect x="${p.x-6}" y="${p.y-6}" width="12" height="12" rx="1" fill="#203440" stroke="#91a4ac"/>`).join('')}`;
}
