import { escapeHtml } from './types.ts';

// Deliberately limited formatting: model text never supplies HTML or link targets.
function inline(text: string): string {
  // Only unwrap simple electrical labels, not prices or arbitrary LaTeX.
  const electrical = String.raw`[+-]?(?:\d+(?:\.\d+)?\s*(?:V|mV|A|mA|uA|µA|Ω|kΩ|MΩ|ohms?|Hz|kHz|MHz)|[A-Za-z][A-Za-z0-9_+-]*)`;
  const tokens = new RegExp(String.raw`\x60([^\x60\n]+)\x60|\*\*(\S(?:[^*\n]*\S)?)\*\*|__([^_\n]+)__|\*(\S(?:[^*\n]*\S)?)\*|\$(${electrical})\$|\\\((${electrical})\\\)`, 'g');
  let html = '', end = 0;
  for (const match of text.matchAll(tokens)) {
    html += escapeHtml(text.slice(end, match.index));
    if (match[5] !== undefined || match[6] !== undefined) {
      html += escapeHtml(match[5] ?? match[6]);
      end = match.index! + match[0].length;
      continue;
    }
    const tag = match[1] !== undefined ? 'code' : match[4] !== undefined ? 'em' : 'strong';
    html += `<${tag}>${escapeHtml(match[1] ?? match[2] ?? match[3] ?? match[4])}</${tag}>`;
    end = match.index! + match[0].length;
  }
  return html + escapeHtml(text.slice(end));
}

export function formatChatAnswer(text: string): string {
  const blocks: string[] = [];
  let paragraph: string[] = [], items: string[] = [], list = '';
  const flushParagraph = () => {
    if (paragraph.length) blocks.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (items.length) blocks.push(`<${list}>${items.map(item => `<li>${inline(item)}</li>`).join('')}</${list}>`);
    items = []; list = '';
  };
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) { flushParagraph(); flushList(); continue; }
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (bullet || numbered) {
      flushParagraph();
      const kind = bullet ? 'ul' : 'ol';
      if (list && list !== kind) flushList();
      list = kind; items.push((bullet ?? numbered)![1]);
    } else if (/^\s+\S/.test(line) && items.length) {
      items[items.length - 1] += ' ' + line.trim();
    } else {
      flushList();
      const heading = line.match(/^#{1,6}\s+(.+)$/);
      if (heading) { flushParagraph(); blocks.push(`<p><strong>${inline(heading[1])}</strong></p>`); }
      else paragraph.push(line);
    }
  }
  flushParagraph(); flushList();
  return blocks.join('');
}
