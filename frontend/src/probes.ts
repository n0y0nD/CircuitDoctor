// Multimeter probes drawn over the circuit drawing. They only ever mark the two
// ends of a fault or of a traced route: red on the first end, black on the second.
// Probe symbols have their tip at (0,0) pointing +x, with the body and cable behind.

export interface ProbeEnd { x: number; y: number; fromAbove: boolean }
export interface LabelBox { x1: number; y1: number; w: number; h: number }
export interface Marker { x: number; y: number; n: number }

/** SVG transform that puts a probe tip on (x, y), entering from below or above. */
export function probeTransform(end: ProbeEnd, color: 'red' | 'black', scale: number) {
  const at = `translate(${end.x.toFixed(1)} ${end.y.toFixed(1)})`;
  // Red comes in from the left, black (mirrored) from the right: a V, like the logo.
  if (color === 'red') return `${at} rotate(${end.fromAbove ? 52 : -52}) scale(${scale})`;
  return `${at} scale(-1 1) rotate(${end.fromAbove ? 56 : -56}) scale(${scale})`;
}

export function probeScale(zoom: number) {
  return +(0.52 * Math.min(1.15, Math.max(0.55, zoom))).toFixed(3);
}

export function probesSvg(red: ProbeEnd | null, black: ProbeEnd | null, markers: Marker[], zoom: number, labels: LabelBox[] = []) {
  const scale = probeScale(zoom);
  const ring = (end: ProbeEnd, stroke: string) =>
    `<circle cx="${end.x.toFixed(1)}" cy="${end.y.toFixed(1)}" r="6" fill="#F6F4EF" stroke="${stroke}" stroke-width="2.5"/>`;
  // Cut probe artwork around visible labels; keep the pin rings and issue markers intact.
  const clearLabels = labels.filter(b => [b.x1, b.y1, b.w, b.h].every(Number.isFinite) && b.w > 0 && b.h > 0);
  const mask = clearLabels.length ? `<defs><mask id="probe-label-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="100%" height="100%"><rect x="0" y="0" width="100%" height="100%" fill="white"/>${clearLabels.map(b => `<rect x="${(b.x1 - 3).toFixed(1)}" y="${(b.y1 - 3).toFixed(1)}" width="${(b.w + 6).toFixed(1)}" height="${(b.h + 6).toFixed(1)}" fill="black"/>`).join('')}</mask></defs>` : '';
  const artwork = (end: ProbeEnd, color: 'red' | 'black') => `<g${mask ? ' mask="url(#probe-label-mask)"' : ''}><use href="#probe-${color}" transform="${probeTransform(end, color, scale)}"/></g>`;
  return [mask,
    ...markers.map(m => `<g class="marker"><circle cx="${m.x.toFixed(1)}" cy="${m.y.toFixed(1)}" r="11" fill="#D4362A" stroke="#EFECE5" stroke-width="2"/>`
      + `<text x="${m.x.toFixed(1)}" y="${(m.y + 4).toFixed(1)}" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="12" font-weight="600" fill="#fff">${m.n}</text></g>`),
    red ? artwork(red, 'red') + ring(red, '#D4362A') : '',
    black ? artwork(black, 'black') + ring(black, '#1D1C1A') : '',
  ].join('');
}
