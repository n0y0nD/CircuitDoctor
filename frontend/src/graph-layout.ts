export interface LayoutPart { ref: string; level: number; width: number; height: number }

/** Pack each connectivity column using actual part bounds, leaving room for labels. */
export function placeParts(parts: LayoutPart[]) {
  const widths = new Map<number, number>();
  for (const part of parts) widths.set(part.level, Math.max(widths.get(part.level) || 0, part.width));
  const columns = new Map<number, number>();
  let right = 0;
  for (const level of [...widths.keys()].sort((a, b) => a - b)) {
    const width = widths.get(level)!;
    columns.set(level, right + width / 2);
    right += width + 160;
  }
  const bottoms = new Map<number, number>();
  return new Map(parts.map(part => {
    const top = bottoms.get(part.level) ?? 0;
    const position = { x: columns.get(part.level)!, y: top + part.height / 2, width: part.width, height: part.height };
    bottoms.set(part.level, top + part.height + 120);
    return [part.ref, position] as const;
  }));
}
