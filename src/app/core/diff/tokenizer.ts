import { Lang } from './models';

export type TokenKind = 'kw' | 'str' | 'num' | 'com' | 'fn' | 'type' | 'tag' | 'attr' | 'prop' | 'lit' | '';

export interface Token {
  k: TokenKind;
  v: string;
}

type Rule = [RegExp, TokenKind | ((m: string, rest: string) => TokenKind)];

const JS_KEYWORDS = new Set(
  ('abstract as async await break case catch class const constructor continue debugger declare default delete do else enum export extends ' +
    'finally for from function get if implements import in instanceof interface keyof let new of private protected public readonly return ' +
    'satisfies set static super switch this throw try type typeof var void while with yield').split(' '));
const JS_LITERALS = new Set(['true', 'false', 'null', 'undefined', 'NaN', 'Infinity']);
const PY_KEYWORDS = new Set(
  ('and as assert async await break class continue def del elif else except finally for from global if import in is lambda match ' +
    'nonlocal not or pass raise return try while with yield self').split(' '));
const PY_LITERALS = new Set(['True', 'False', 'None']);

const ident = (keywords: Set<string>, literals: Set<string>) => (m: string, rest: string): TokenKind =>
  keywords.has(m) ? 'kw' : literals.has(m) ? 'lit' : /^\s*\(/.test(rest) ? 'fn' : /^[A-Z]/.test(m) ? 'type' : '';

const NUMBER: Rule = [/0[xX][\da-fA-F_]+n?|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?n?/y, 'num'];

const RULES: Record<Exclude<Lang, 'plain'>, Rule[]> = {
  js: [
    [/\/\/.*/y, 'com'],
    [/\/\*.*?(?:\*\/|$)/y, 'com'],
    [/^\s*\*.*/y, 'com'],
    [/"(?:\\.|[^"\\])*"?/y, 'str'],
    [/'(?:\\.|[^'\\])*'?/y, 'str'],
    [/`(?:\\.|[^`\\])*`?/y, 'str'],
    [/@[A-Za-z_]\w*/y, 'fn'],
    NUMBER,
    [/[A-Za-z_$][\w$]*/y, ident(JS_KEYWORDS, JS_LITERALS)],
  ],
  ts: [],
  python: [
    [/#.*/y, 'com'],
    [/[rbfuRBFU]{0,2}("""|''').*?(?:\1|$)/y, 'str'],
    [/[rbfuRBFU]{0,2}"(?:\\.|[^"\\])*"?/y, 'str'],
    [/[rbfuRBFU]{0,2}'(?:\\.|[^'\\])*'?/y, 'str'],
    [/@[A-Za-z_][\w.]*/y, 'fn'],
    NUMBER,
    [/[A-Za-z_]\w*/y, ident(PY_KEYWORDS, PY_LITERALS)],
  ],
  css: [
    [/\/\*.*?(?:\*\/|$)/y, 'com'],
    [/\/\/.*/y, 'com'],
    [/"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/y, 'str'],
    [/@[\w-]+/y, 'kw'],
    [/#[\da-fA-F]{3,8}\b/y, 'num'],
    [/-?\d*\.?\d+(?:px|r?em|%|vh|vw|s|ms|deg|fr|ch)?/y, 'num'],
    [/--?[A-Za-z][\w-]*(?=\s*:)|[A-Za-z][\w-]*(?=\s*:[^:])/y, 'prop'],
    [/[.#][A-Za-z_][\w-]*/y, 'type'],
    [/[A-Za-z][\w-]*(?=\()/y, 'fn'],
  ],
  html: [
    [/<!--.*?(?:-->|$)/y, 'com'],
    [/<\/?[A-Za-z][\w:-]*/y, 'tag'],
    [/\/?>/y, 'tag'],
    [/"[^"]*"?|'[^']*'?/y, 'str'],
    [/[A-Za-z_:@[\]()*#.-][\w:@[\]().*#-]*(?=\s*=)/y, 'attr'],
    [/\{\{|\}\}/y, 'kw'],
  ],
  json: [
    [/"(?:\\.|[^"\\])*"(?=\s*:)/y, 'prop'],
    [/"(?:\\.|[^"\\])*"?/y, 'str'],
    [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y, 'num'],
    [/\b(?:true|false|null)\b/y, 'lit'],
    [/\/\/.*/y, 'com'],
  ],
};
RULES.ts = RULES.js;

/**
 * A small line-based tokenizer for syntax colouring in the diff viewer and for
 * the rule engine (to look at code with strings and comments masked out).
 * It does not track state across lines; lines that start with "*" are treated as
 * the inside of a block comment, which covers the usual JSDoc style.
 */
export function tokenize(line: string, lang: Lang): Token[] {
  if (lang === 'plain' || !line) return line ? [{ k: '', v: line }] : [];
  const rules = RULES[lang];
  const out: Token[] = [];
  let plain = '';
  let i = 0;
  while (i < line.length) {
    let matched = false;
    for (const [re, kind] of rules) {
      if (re.source.startsWith('^') && i !== 0) continue;
      re.lastIndex = i;
      const m = re.exec(line);
      if (!m || !m[0]) continue;
      // Identifiers and numbers must start on a word boundary.
      if (/^[\w$]/.test(m[0]) && i > 0 && /[\w$]/.test(line[i - 1])) continue;
      const k = typeof kind === 'function' ? kind(m[0], line.slice(i + m[0].length)) : kind;
      if (plain) { out.push({ k: '', v: plain }); plain = ''; }
      if (k === '' && out.length && out[out.length - 1].k === '') out[out.length - 1].v += m[0];
      else out.push({ k, v: m[0] });
      i += m[0].length;
      matched = true;
      break;
    }
    if (!matched) plain += line[i++];
  }
  if (plain) out.push({ k: '', v: plain });
  return out;
}

/** The line with string contents and comments blanked out, so rules match only real code. */
export function codeOnly(line: string, lang: Lang): string {
  if (lang === 'plain') return line;
  return tokenize(line, lang)
    .map((t) => (t.k === 'com' ? '' : t.k === 'str' && t.v.length > 1 ? t.v[0] + ' '.repeat(t.v.length - 2) + t.v[t.v.length - 1] : t.v))
    .join('');
}

/** Only the comment text of a line. */
export function commentsOf(line: string, lang: Lang): string {
  if (lang === 'plain') return line;
  return tokenize(line, lang).filter((t) => t.k === 'com').map((t) => t.v).join(' ');
}
