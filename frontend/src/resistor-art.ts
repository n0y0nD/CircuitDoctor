import { escapeHtml as esc } from './types.ts';

const colors = ['#252426','#78442d','#c43128','#e87825','#edc73d','#347a49','#3267a2','#82539c','#85888b','#f1eee5'];
const multipliers: Record<string,number> = { '':1, R:1, r:1, k:1e3, K:1e3, M:1e6 };

/** Render only exact, readable values. Unknown values never acquire decorative numeric bands. */
export function resistorBands(value: string): string[] {
  const text=value.trim().replace(/\s*(?:ohms?|[ΩΩ])\s*$/i,'').trim();
  const plain=text.match(/^(\d+(?:\.\d+)?|\.\d+)\s*([RrkKM]?)$/);
  const embedded=text.match(/^(\d*)([RrkKM])(\d+)$/);
  const ohms=plain ? Number(plain[1])*multipliers[plain[2]]
    : embedded ? Number(`${embedded[1]||'0'}.${embedded[3]}`)*multipliers[embedded[2]] : NaN;
  if(!Number.isFinite(ohms) || ohms<0) return [];
  if(ohms===0) return [colors[0]];
  for(const digits of [2,3]) {
    const exponent=Math.floor(Math.log10(ohms))-digits+1;
    const significant=ohms/10**exponent;
    const rounded=Math.round(significant);
    if(exponent < -2 || exponent > 9 || rounded<10**(digits-1) || rounded>=10**digits
      || Math.abs(significant-rounded)>1e-8) continue;
    return [...String(rounded)].map(d=>colors[Number(d)]).concat(exponent===-2?'#b8bec4':exponent===-1?'#bf9b44':colors[exponent]);
  }
  return [];
}

/** Original axial-body artwork; electrical endpoints are supplied by partDrawing. */
export function resistorBody(value: string, tolerance?: string): string {
  const bands=resistorBands(value);
  // A tolerance band is drawn only when explicitly exported, never assumed to be 5%.
  const toleranceColors:Record<string,string>={'1':'#78442d','2':'#c43128','0.5':'#347a49','0.25':'#3267a2','0.1':'#82539c','0.05':'#85888b','5':'#bf9b44','10':'#b8bec4'};
  const toleranceMatch=tolerance?.trim().match(/^(?:±\s*)?(\d+(?:\.\d+)?)\s*%$/);
  const toleranceColor=toleranceMatch ? toleranceColors[String(Number(toleranceMatch[1]))] : undefined;
  const outline='M59 43 C66 40 70 44 78 46 H122 C130 44 134 40 141 43 C149 47 149 73 141 77 C134 80 130 76 122 74 H78 C70 76 66 80 59 77 C51 73 51 47 59 43Z';
  const paint=bands.map((color,i)=>`<rect x="${bands.length===1?96:64+i*(bands.length===4?17:20)}" y="40" width="${bands.length===1?8:9}" height="40" fill="${color}"/>`).join('');
  return `<defs>
    <linearGradient id="resin" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#bda67f"/><stop offset=".22" stop-color="#f5e7c8"/><stop offset=".48" stop-color="#e7d6b0"/><stop offset=".8" stop-color="#c8ae80"/><stop offset="1" stop-color="#9a7d52"/></linearGradient>
    <linearGradient id="lead-metal" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#87949c"/><stop offset=".35" stop-color="#f4f6f7"/><stop offset=".65" stop-color="#c6cdd1"/><stop offset="1" stop-color="#7b878f"/></linearGradient>
    <linearGradient id="band-light" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#fff" stop-opacity=".05"/><stop offset=".25" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#35281b" stop-opacity=".32"/></linearGradient>
    <clipPath id="resistor-body"><path d="${outline}"/></clipPath>
  </defs>
  <path d="M10 63H190" stroke="#243d4b" stroke-width="5" opacity=".08" stroke-linecap="round"/>
  <rect x="8" y="57" width="184" height="6" rx="2" fill="url(#lead-metal)"/>
  <path d="${outline}" transform="translate(0 2)" fill="#514329" opacity=".15"/>
  <path d="${outline}" fill="url(#resin)" stroke="#9f8964" stroke-width="1"/>
  <g clip-path="url(#resistor-body)">${paint}${bands.length>1 && toleranceColor?`<rect x="134" y="40" width="7" height="40" fill="${toleranceColor}"/>`:''}<rect x="52" y="40" width="96" height="40" fill="url(#band-light)"/></g>
  <path d="M60 47Q67 44 77 49H122Q133 44 140 47" fill="none" stroke="#fff7df" stroke-width="1.5" opacity=".45"/>
  <text x="100" y="98" text-anchor="middle" font-size="12" fill="#465e52">${esc(value)}</text>`;
}
