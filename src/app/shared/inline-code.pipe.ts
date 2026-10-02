import { Pipe, PipeTransform } from '@angular/core';

export interface TextPart {
  code: boolean;
  text: string;
}

/** Splits text on `backticks` so comment bodies can show inline code without using innerHTML. */
export function splitInlineCode(text: string): TextPart[] {
  const parts: TextPart[] = [];
  const re = /`([^`\n]+)`/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) parts.push({ code: false, text: text.slice(last, m.index) });
    parts.push({ code: true, text: m[1] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) parts.push({ code: false, text: text.slice(last) });
  return parts;
}

@Pipe({ name: 'inlineCode' })
export class InlineCodePipe implements PipeTransform {
  transform(text: string | undefined | null): TextPart[] {
    return splitInlineCode(text ?? '');
  }
}
