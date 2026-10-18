import type { ReviewState } from './review.ts';
import { boardRecognized, faultLabel, groupFindings } from './findings.ts';
import { escapeHtml as esc } from './types.ts';

// The meter never shows a measured value. It reports words, like a real
// meter's 7-segment "SHrt" or "PASS": the app only reads connections.
export interface Reading { flag: string; text: string; dim?: string; detail?: string }

export function reviewReading(state: ReviewState): Reading | null {
  if (state.status === 'idle') return null;
  if (state.status === 'loading') return { flag: 'AUTO', text: '----', dim: 'checking…' };
  if (state.status === 'error') return { flag: 'INFO', text: 'check did not run' };
  const review = state.result;
  const { problems } = groupFindings(review);
  if (problems.length) {
    const first = problems[0];
    const label = faultLabel(first);
    const what = first.rule === 'power_ground_short' && label ? { flag: 'SHORT', text: label, dim: 'same wire' }
      : label ? { flag: 'JOINED', text: label, dim: 'same wire' } : { flag: 'CHECK', text: first.title };
    if (problems.length === 1) return what;
    return { flag: `${problems.length} PROBLEMS`, text: 'showing 1', detail: `${what.flag} · ${what.text}` };
  }
  if (!boardRecognized(review)) return { flag: 'INFO', text: 'board not recognized' };
  if (review.status === 'incomplete') return { flag: 'INFO', text: 'not enough information' };
  return { flag: 'PASS', text: 'no wiring problems' };
}

export function traceReading(steps: number, from: string, to: string): Reading {
  return { flag: 'TRACE', text: `${steps} step${steps === 1 ? '' : 's'}`, detail: `${from} → ${to}` };
}

export function meterHtml(reading: Reading | null): string {
  if (!reading) return '';
  const label = [reading.flag, reading.text, reading.dim, reading.detail].filter(Boolean).join(' · ');
  return `<div class="meter" role="status" aria-label="${esc(label)}"><div class="lcd"><span class="flag">${esc(reading.flag)}</span>`
    + `<svg aria-hidden="true"><use href="#i-beep"/></svg><span>${esc(reading.text)}</span>`
    + (reading.dim ? `<span class="dim">${esc(reading.dim)}</span>` : '')
    + (reading.detail ? `<span class="sep"></span><span class="dim">${esc(reading.detail)}</span>` : '')
    + '</div></div>';
}
