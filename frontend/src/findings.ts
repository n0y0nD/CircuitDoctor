import type { Finding, Review } from './review.ts';

export interface PinSpec { ref: string; pin: string; name: string; role?: string; nominal_voltage?: number }

const short = (name: string) => name.replace(/^\+/, '');
export const pinWord = (spec: PinSpec) => short(spec.name || `Pin ${spec.pin}`);

/** The two pins the probes touch: first rail (red) and first ground or other-voltage rail (black). */
export function faultEnds(finding: Finding): [PinSpec, PinSpec] | null {
  const specs = finding.specifications || [];
  const rails = specs.filter(s => s.role === 'rail');
  if (finding.rule === 'power_ground_short') {
    const ground = specs.find(s => s.role === 'ground');
    return rails[0] && ground ? [rails[0], ground] : null;
  }
  if (finding.rule === 'voltage_rail_conflict') {
    const other = rails.find(s => s.nominal_voltage !== rails[0]?.nominal_voltage);
    return rails[0] && other ? [rails[0], other] : null;
  }
  return null;
}

/**
 * Plain-language copy for a finding. Only the power-to-ground short gets the
 * friendlier wording from the approved screens; everything else uses the
 * finding's own title, message and suggestion. Nothing here names a pin to move.
 */
export function friendlyFinding(finding: Finding): { title: string; consequence: string; todo: string } {
  const ends = finding.rule === 'power_ground_short' ? faultEnds(finding) : null;
  if (ends) {
    const [rail, ground] = ends.map(pinWord);
    return {
      title: `Your ${rail} pin is connected to ${ground}.`,
      consequence: 'They’re on the same wire, so powering the board would short it.',
      todo: `In KiCad, separate the ${rail} wire from ${ground}, then upload the fixed file.`,
    };
  }
  return { title: finding.title, consequence: finding.message, todo: finding.suggestion };
}

/** "5V ↔ GND" for the meter and labels, or null when the finding has no two ends. */
export function faultLabel(finding: Finding): string | null {
  const ends = faultEnds(finding);
  return ends ? `${pinWord(ends[0])} ↔ ${pinWord(ends[1])}` : null;
}

export const isUnconnectedNote = (f: Finding) => f.rule === 'single_pin_net' || f.rule === 'unassigned_pin';

export interface CheckLine { label: string; status: 'passed' | 'problem' | 'note' }

/** Checks that actually ran for this file, derived from the review's own coverage. */
export function checkLines(review: Review): CheckLine[] {
  const has = (test: (f: Finding) => boolean) => review.findings.some(test);
  const line = (label: string, test: (f: Finding) => boolean, note = false): CheckLine =>
    ({ label, status: has(test) ? (note ? 'note' : 'problem') : 'passed' });
  const lines: CheckLine[] = [];
  if (review.electrical.recognized_parts.length) {
    lines.push(line('Power shorted to ground', f => f.rule === 'power_ground_short'));
    lines.push(line('Two different voltages joined', f => f.rule === 'voltage_rail_conflict'));
  }
  if (review.requirements?.checked_pins) lines.push(line('Display power pins connected', f => f.rule.startsWith('required_')));
  if (review.voltage?.checked_parts) lines.push(line('Display supply voltage', f => f.rule === 'supply_voltage_mismatch'));
  if (review.i2c?.checked_pins) lines.push(line('I2C SDA / SCL wiring', f => f.rule.startsWith('i2c_') && f.rule !== 'i2c_pullup_check'));
  if (review.isolation) lines.push(line('Parts cut off in separate groups', f => f.rule === 'isolated_group', true));
  return lines;
}

export const boardRecognized = (review: Review) => review.electrical.recognized_parts.length > 0;

/** Split findings the way the problems panel shows them. */
export function groupFindings(review: Review) {
  const problems = review.findings.filter(f => f.severity === 'warning');
  const info = review.findings.filter(f => f.severity !== 'warning');
  return { problems, notes: info.filter(f => !isUnconnectedNote(f)), unconnected: info.filter(isUnconnectedNote) };
}

/** Number of distinct pins named in a finding's evidence. */
export const evidencePinCount = (finding: Finding) => finding.evidence.nodes.filter(n => n.kind === 'pin').length;
