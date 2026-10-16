import { componentKind, escapeHtml as esc, type Component } from './types';

const bandColors = ['#24262b', '#78472d', '#bf3636', '#ed8133', '#e7c845', '#448562', '#3d68ad', '#8c5899', '#8a8f95', '#f6f1de'];

/** Three value bands only. Tolerance is not inferred from a resistance value. */
function resistorBands(value: string): string {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([RrKkMm]?)(?:Ω|ohms?)?$/);
  if (!match) return '';
  const ohms = Number(match[1]) * ({ k: 1e3, m: 1e6 }[match[2].toLowerCase()] || 1);
  if (ohms <= 0) return '';
  const exponent = Math.floor(Math.log10(ohms)) - 1;
  const digits = ohms / 10 ** exponent;
  if (exponent < 0 || exponent > 9 || Math.abs(digits - Math.round(digits)) > 1e-6) return '';
  return [Math.floor(Math.round(digits) / 10), Math.round(digits) % 10, exponent].map((digit, i) =>
    `<rect x="${58 + i * 24}" y="-17" width="9" height="34" fill="${bandColors[digit]}"/>`).join('');
}

/** Recognizable illustrations, not physical pinout or footprint drawings. */
export function circuitArt(component: Component, height: number): string {
  const kind = componentKind(component);
  const nano = component.libsource.part === 'Arduino_Nano_v3.x';
  const width = kind === 'board' ? 260 : 180;
  const y = height / 2;
  const defs = `<defs>
    <linearGradient id="pcb" x2="1" y2="1"><stop stop-color="#168c99"/><stop offset="1" stop-color="#096278"/></linearGradient>
    <linearGradient id="metal" x2="0" y2="1"><stop stop-color="#f0f3f3"/><stop offset=".45" stop-color="#a6b2b8"/><stop offset=".7" stop-color="#dce2e4"/><stop offset="1" stop-color="#7c8a93"/></linearGradient>
    <linearGradient id="ceramic" x2="0" y2="1"><stop stop-color="#eddfbd"/><stop offset=".4" stop-color="#f9edcf"/><stop offset="1" stop-color="#bc9e67"/></linearGradient>
    <linearGradient id="lens" x2="1" y2=".6"><stop stop-color="#ee9a91"/><stop offset=".4" stop-color="#d84d47"/><stop offset="1" stop-color="#a82e36"/></linearGradient>
  </defs>`;
  let art: string;
  if (kind === 'board') {
    const left = nano ? 55 : 10, right = nano ? 205 : 250;
    const headerX = [left + 9, right - 22];
    const holes = [[left+31, 36],[right-33,36],[left+31,height-33],[right-33,height-33]];
    art = `<path d="M${left+10} 19H${right-20}L${right} 39V${height-36}Q${right} ${height-20} ${right-15} ${height-20}H${left+10}Q${left} ${height-20} ${left} ${height-30}V29Q${left} 19 ${left+10} 19Z" fill="#063f51" transform="translate(0 4)" opacity=".16"/>
      <path d="M${left+10} 16H${right-20}L${right} 36V${height-39}Q${right} ${height-23} ${right-15} ${height-23}H${left+10}Q${left} ${height-23} ${left} ${height-33}V26Q${left} 16 ${left+10} 16Z" fill="url(#pcb)" stroke="#075769" stroke-width="2"/>
      <g opacity=".22" stroke="#9ed6d2" stroke-width="1.4" fill="none"><path d="M${left+22} 78H90L108 96V${y-10}M${right-22} ${height-67}H164L150 ${height-81}V${y+35}M${left+22} ${height-70}H65L80 ${height-85}V${y+36}"/></g>
      ${holes.map(([x,h])=>`<circle cx="${x}" cy="${h}" r="7" fill="#a7ac82"/><circle cx="${x}" cy="${h}" r="4" fill="#f9fbfa"/>`).join('')}
      ${headerX.map(x=>`<rect x="${x-2}" y="64" width="17" height="${height-120}" rx="2" fill="#102831" stroke="#395e65"/>`+Array.from({length:Math.max(5,Math.floor((height-125)/17))},(_,i)=>`<rect x="${x+2}" y="${70+i*17}" width="8" height="9" rx="1" fill="#bdad7e"/><rect x="${x+4}" y="${72+i*17}" width="4" height="5" fill="#0d2029"/>`).join('')).join('')}
      <rect x="${nano?101:57}" y="6" width="${nano?58:60}" height="49" rx="3" fill="url(#metal)" stroke="#8c9ba3"/>
      <rect x="${nano?110:64}" y="10" width="${nano?40:46}" height="22" rx="2" fill="#5b6c78"/><rect x="${nano?116:72}" y="17" width="${nano?28:30}" height="8" fill="#b9c4c9"/>
      ${nano?'':`<rect x="155" y="18" width="43" height="34" rx="4" fill="#1e303a"/><ellipse cx="177" cy="20" rx="15" ry="8" fill="#101d24" stroke="#4a5a62"/>`}
      <text x="130" y="${y-50}" text-anchor="middle" fill="#e6f6ef" font-family="Arial,sans-serif" font-weight="bold" font-size="${nano?18:24}" letter-spacing="1">ARDUINO</text>
      <text x="130" y="${y-30}" text-anchor="middle" fill="#bcdfdf" font-family="Arial,sans-serif" font-size="12" letter-spacing="2">${nano?'CLASSIC NANO':'UNO R3'}</text>
      <rect x="${nano?98:75}" y="${y-7}" width="${nano?64:110}" height="${nano?64:43}" rx="3" fill="#152630" stroke="#0c1d27" stroke-width="2"/>
      ${Array.from({length:8},(_,i)=>`<path d="M${(nano?103:82)+i*(nano?8:14)} ${y-13}v6 M${(nano?103:82)+i*(nano?8:14)} ${y+(nano?57:36)}v6" stroke="#bac6c9" stroke-width="3"/>`).join('')}
      <circle cx="${nano?104:82}" cy="${y+1}" r="2" fill="#89979f"/>
      <text x="130" y="${y+20}" text-anchor="middle" fill="#7e929c" font-family="monospace" font-size="${nano?7:9}">ATmega328P</text>
      <rect x="110" y="${y+76}" width="36" height="12" rx="5" fill="url(#metal)" stroke="#8aa8ae"/>
      ${nano?'':`<circle cx="68" cy="${y+73}" r="10" fill="#273e46" stroke="#a8b5b7" stroke-width="3"/><path d="M63 ${y+73}h10" stroke="#a8b5b7"/>`}
      <rect x="${nano?103:166}" y="${height-53}" width="20" height="16" rx="2" fill="#b7c4c4"/><rect x="${nano?108:171}" y="${height-49}" width="10" height="8" fill="#913e3e"/>
      <text x="${nano?127:193}" y="${height-41}" font-family="Arial,sans-serif" font-size="6" fill="#d4e9e5">RESET</text>`;
  } else if (kind === 'resistor') {
    art = `<g transform="translate(0 ${y})"><path d="M0 0H180" stroke="#c5d0d3" stroke-width="5"/><path d="M0 -1H180" stroke="#82949e" stroke-width="1"/>
      <rect x="36" y="-19" width="108" height="40" rx="13" fill="#514b3b" opacity=".1" transform="translate(0 3)"/>
      <rect x="36" y="-18" width="108" height="36" rx="12" fill="url(#ceramic)" stroke="#b39b6b" stroke-width="1.5"/>
      ${resistorBands(component.value)}<path d="M49 -12H130" stroke="#fff7e2" opacity=".4" stroke-width="3" stroke-linecap="round"/></g>`;
  } else if (kind === 'led') {
    art = `<path d="M0 ${y}H69V${y-16}M111 ${y-16}V${y}H180" fill="none" stroke="#a8b7be" stroke-width="4"/>
      <path d="M62 ${y-17}V${y-43}A28 28 0 0 1 118 ${y-43}V${y-17}Z" fill="url(#lens)" stroke="#b64343" stroke-width="1.5"/>
      <path d="M76 ${y-19}V${y-36}H87L98 ${y-28}H105V${y-18}" fill="none" stroke="#883331" opacity=".3" stroke-width="4"/>
      <ellipse cx="90" cy="${y-17}" rx="33" ry="7" fill="#b53d42"/><ellipse cx="90" cy="${y-19}" rx="32" ry="6" fill="#d96560"/>
      <path d="M72 ${y-39}Q70 ${y-56} 85 ${y-61}" fill="none" stroke="#ffe1d8" opacity=".8" stroke-width="5" stroke-linecap="round"/>
      <path d="M61 ${y-17}H119" stroke="#922e35" stroke-width="2"/>`;
  } else {
    art = `<rect x="28" y="${y-35}" width="124" height="70" rx="7" fill="#edf3f1" stroke="#8ba79a" stroke-width="2"/>
      <rect x="66" y="${y-20}" width="48" height="40" rx="3" fill="#354d54"/>
      ${[0,1,2,3].map(i=>`<path d="M58 ${y-13+i*9}h8 M114 ${y-13+i*9}h8" stroke="#879da2" stroke-width="3"/>`).join('')}
      <text x="90" y="${y+52}" text-anchor="middle" font-family="Arial,sans-serif" font-size="9" fill="#789087">${esc(component.libsource.part || 'Component')}</text>`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${defs}${art}</svg>`)}`;
}
