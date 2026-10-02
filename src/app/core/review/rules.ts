import { DiffFile, Lang, isJsLike } from '../diff/models';
import { codeOnly, commentsOf, tokenize } from '../diff/tokenizer';
import { Category, ReviewComment, Severity } from './models';

/** One line on the new side of the diff (added or unchanged context). */
export interface CodeLine {
  n: number;
  raw: string;
  /** Strings blanked and comments removed. */
  code: string;
  /** Comments removed, strings kept. */
  nocom: string;
  added: boolean;
}

export interface RuleContext {
  file: DiffFile;
  lang: Lang;
  path: string;
  isTest: boolean;
  lines: CodeLine[];
  added: CodeLine[];
  byNumber: Map<number, CodeLine>;
  /** All visible new-side code, comments and strings masked. */
  code: string;
}

export interface RuleHit {
  line: number;
  title?: string;
  body?: string;
  suggestion?: string;
}

export interface Rule {
  id: string;
  /** Short description for the rule list. */
  name: string;
  severity: Severity;
  category: Category;
  /** Languages the rule applies to; omitted = every text file. */
  langs?: Lang[];
  title: string;
  body: string;
  check(ctx: RuleContext): RuleHit[];
}

export const LONG_LINE = 140;
export const LONG_FUNCTION = 40;
const MAX_HITS_PER_RULE = 10;

const JS: Lang[] = ['ts', 'js'];
const JS_PY: Lang[] = ['ts', 'js', 'python'];

export function buildContext(file: DiffFile): RuleContext {
  const lang = file.language;
  const lines: CodeLine[] = [];
  for (const h of file.hunks) for (const l of h.lines) {
    if (l.newLine === null) continue;
    const tokens = tokenize(l.content, lang);
    lines.push({
      n: l.newLine,
      raw: l.content,
      code: codeOnly(l.content, lang),
      nocom: lang === 'plain' ? l.content : tokens.filter((t) => t.k !== 'com').map((t) => t.v).join(''),
      added: l.type === 'add',
    });
  }
  return {
    file,
    lang,
    path: file.path,
    isTest: /(\.|_)(spec|test)\.[a-z]+$|(^|\/)(__tests__|tests?)\/|(^|\/)test_[^/]*\.py$/i.test(file.path),
    lines,
    added: lines.filter((l) => l.added),
    byNumber: new Map(lines.map((l) => [l.n, l])),
    code: lines.map((l) => l.code).join('\n'),
  };
}

/** Added lines whose masked code matches `re`. */
function matchAdded(ctx: RuleContext, re: RegExp, field: 'code' | 'nocom' | 'raw' = 'code'): RuleHit[] {
  return ctx.added.filter((l) => re.test(l[field])).map((l) => ({ line: l.n }));
}

/** Contiguous new-side lines after `n` (stops at a gap between hunks). */
function after(ctx: RuleContext, n: number, max: number): CodeLine[] {
  const out: CodeLine[] = [];
  for (let i = n + 1; out.length < max; i++) {
    const l = ctx.byNumber.get(i);
    if (!l) break;
    out.push(l);
  }
  return out;
}

function before(ctx: RuleContext, n: number, max: number): CodeLine[] {
  const out: CodeLine[] = [];
  for (let i = n - 1; out.length < max; i--) {
    const l = ctx.byNumber.get(i);
    if (!l) break;
    out.unshift(l);
  }
  return out;
}

/**
 * The brace-balanced block that starts on line `n`, or null when its end is not visible in the diff.
 * The opening brace may be up to 6 lines down (multi-line signatures).
 */
export function braceBlock(ctx: RuleContext, n: number): CodeLine[] | null {
  const first = ctx.byNumber.get(n);
  if (!first) return null;
  const block: CodeLine[] = [];
  let depth = 0;
  let opened = false;
  for (const l of [first, ...after(ctx, n, 10_000)]) {
    block.push(l);
    for (const ch of l.code) {
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') depth--;
      if (opened && depth === 0) return block;
    }
    if (!opened && block.length > 6) return null;
  }
  return null;
}

const indent = (s: string) => s.match(/^\s*/)![0].replace(/\t/g, '    ').length;

/** A Python block by indentation: the `def` line and every deeper-indented line after it. */
export function indentBlock(ctx: RuleContext, n: number): CodeLine[] | null {
  const first = ctx.byNumber.get(n);
  if (!first) return null;
  const base = indent(first.raw);
  const block = [first];
  for (let i = n + 1; ; i++) {
    const l = ctx.byNumber.get(i);
    if (!l) return ctx.file.status === 'added' ? trimBlank(block) : null;
    if (l.raw.trim() && indent(l.raw) <= base) return trimBlank(block);
    block.push(l);
  }
}

function trimBlank(block: CodeLine[]): CodeLine[] {
  while (block.length > 1 && !block[block.length - 1].raw.trim()) block.pop();
  return block;
}

const FN_START_JS =
  /\bfunction\b\s*\*?\s*[\w$]*\s*\(|^\s*(?:(?:export|public|private|protected|static|async|override|default)\s+)*(?!(?:if|for|while|switch|catch|return|else|do|try|new|await|typeof)\b)[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*\([^;]*(?:\{|\(|,)\s*$|=>\s*\{\s*$/;

const LOOSE_EQ = /(^|[^=!<>])(==|!=)(?!=)(?!\s*null\b)/g;

const SECRET_PATTERNS: [RegExp, string][] = [
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key ID'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'a GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{22,}/, 'a GitHub token'],
  [/\bsk[-_](?:live|test|proj)[-_][A-Za-z0-9_-]{16,}/, 'a secret API key'],
  [/\bAIza[0-9A-Za-z_-]{35}\b/, 'a Google API key'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'a Slack token'],
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/, 'a private key'],
];
const SECRET_ASSIGN =
  /([A-Za-z_]*(?:secret|passwd|password|pwd|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret)[A-Za-z_]*)["']?\s*[:=]\s*["']([^"'\s]{6,})["']/i;
const PLACEHOLDER = /^(x+|\*+|\.+|changeme|change[-_]me|your[-_].*|<.*>|\$\{.*\}|\{\{.*\}\}|example.*|dummy.*|placeholder|redacted|password|secret|test|null|undefined)$/i;

const ALLOWED_NUMBERS = new Set(['0', '1', '2', '10', '100', '1000', '0.5']);
const MAGIC_CONTEXTS = [
  /(?:[<>]=?|[!=]==?)\s*-?(\d+(?:\.\d+)?)\b/g,
  /[*/%]\s*(\d+(?:\.\d+)?)\b/g,
  /\b(\d+(?:\.\d+)?)\s*[*/%]/g,
  /\b(?:setTimeout|setInterval|debounceTime|throttleTime|auditTime|delay|sleep|timeout|retry)\s*\(.*?[(,\s](\d+(?:\.\d+)?)\s*\)/g,
];
const CONSTANT_DECL = /^\s*(?:export\s+)?(?:(?:const|let|var|static|readonly|private|public|protected)\s+)*[A-Z][A-Z0-9_]*\s*(?::[^=]+)?=/;

export const RULES: Rule[] = [
  {
    id: 'no-debug-output', name: 'console.log / print left in', severity: 'warning', category: 'style', langs: JS_PY,
    title: 'Debug output left in',
    body: 'This looks like a leftover debugging statement. Remove it, or use the project logger so it can be filtered in production.',
    check: (ctx) => ctx.isTest ? [] : ctx.lang === 'python'
      ? matchAdded(ctx, /^\s*print\s*\(/)
      : matchAdded(ctx, /\bconsole\.(?:log|debug|info|trace|dir|table)\s*\(/),
  },
  {
    id: 'no-debugger', name: 'debugger / breakpoint statement', severity: 'blocker', category: 'bug', langs: JS_PY,
    title: 'Debugger statement',
    body: 'A debugger statement pauses execution whenever dev tools are open (or blocks a Python process). It must not be merged.',
    check: (ctx) => ctx.lang === 'python'
      ? matchAdded(ctx, /\bi?pdb\.set_trace\s*\(|(?<![\w.])breakpoint\s*\(\s*\)/)
      : matchAdded(ctx, /(?<![\w$.])debugger\s*(?:;|$)/),
  },
  {
    id: 'no-explicit-any', name: 'explicit any type', severity: 'warning', category: 'readability', langs: ['ts'],
    title: 'Avoid `any`',
    body: '`any` turns off type checking for everything it touches. Use a real type, a generic, or `unknown` and narrow it.',
    check: (ctx) => ctx.added
      .filter((l) => /:\s*any\b(?!\s*[\w$])|\bas\s+any\b|<any>|\bany\s*\[\]|<any\s*[,>]|,\s*any\s*>/.test(l.code))
      .map((l) => {
        const raw = l.raw.match(/\bany\b/g)?.length ?? 0;
        const code = l.code.match(/\bany\b/g)?.length ?? 0;
        return { line: l.n, suggestion: raw === code ? l.raw.replace(/\bany\b/g, 'unknown') : undefined };
      }),
  },
  {
    id: 'todo-comment', name: 'TODO / FIXME comments', severity: 'suggestion', category: 'readability',
    title: 'Unresolved TODO',
    body: 'New TODO/FIXME comments tend to stay forever. Fix it in this PR or link a ticket so it is tracked.',
    check: (ctx) => ctx.added
      .filter((l) => /\b(?:TODO|FIXME|HACK|XXX)\b/.test(commentsOf(l.raw, ctx.lang)))
      .map((l) => ({ line: l.n, title: `Unresolved ${l.raw.match(/\b(TODO|FIXME|HACK|XXX)\b/)![1]}` })),
  },
  {
    id: 'empty-catch', name: 'empty catch / except block', severity: 'warning', category: 'bug', langs: JS_PY,
    title: 'Error swallowed silently',
    body: 'This catch block ignores the error, so failures disappear without a trace. Log it, rethrow it, or add a comment explaining why it is safe to ignore.',
    check: (ctx) => {
      const hits: RuleHit[] = [];
      for (const l of ctx.added) {
        if (ctx.lang === 'python') {
          if (/^\s*except\b[^:]*:\s*pass\s*$/.test(l.code)) hits.push({ line: l.n });
          else if (/^\s*except\b[^:]*:\s*$/.test(l.code) && after(ctx, l.n, 1)[0]?.code.trim() === 'pass') hits.push({ line: l.n });
          continue;
        }
        if (/\bcatch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(l.code) || /\.catch\(\s*(?:\(\s*\)|\w+|\(\s*\w+\s*\))\s*=>\s*\{\s*\}\s*\)/.test(l.code)) {
          hits.push({ line: l.n });
        } else if (/\bcatch\s*(?:\([^)]*\))?\s*\{\s*$/.test(l.code) && after(ctx, l.n, 1)[0]?.raw.trim().startsWith('}')) {
          hits.push({ line: l.n });
        }
      }
      return hits;
    },
  },
  {
    id: 'eqeqeq', name: '== instead of ===', severity: 'warning', category: 'bug', langs: JS,
    title: 'Use strict equality',
    body: '`==` and `!=` convert types before comparing (`"0" == 0` is true). Use `===` / `!==`. Comparing with `null` to also catch `undefined` is the one common exception.',
    check: (ctx) => ctx.added
      .filter((l) => new RegExp(LOOSE_EQ.source).test(l.code))
      .map((l) => {
        const count = (s: string) => s.match(LOOSE_EQ)?.length ?? 0;
        return {
          line: l.n,
          suggestion: count(l.raw) === count(l.code) ? l.raw.replace(LOOSE_EQ, (_m, p: string, op: string) => p + op + '=') : undefined,
        };
      }),
  },
  {
    id: 'hardcoded-secret', name: 'hard-coded secrets and keys', severity: 'blocker', category: 'security',
    title: 'Hard-coded secret',
    body: 'Credentials in source code end up in git history, CI logs and every clone. Move it to an environment variable or a secret manager, and rotate this value because it is already exposed.',
    check: (ctx) => {
      const hits: RuleHit[] = [];
      for (const l of ctx.added) {
        const known = SECRET_PATTERNS.find(([re]) => re.test(l.raw));
        if (known) { hits.push({ line: l.n, title: `Hard-coded secret: ${known[1]}` }); continue; }
        const m = SECRET_ASSIGN.exec(l.nocom);
        if (m && !PLACEHOLDER.test(m[2]) && !/process\.env|os\.environ|getenv|import\.meta\.env/.test(l.raw)) {
          hits.push({ line: l.n, title: `Hard-coded secret in \`${m[1]}\`` });
        }
      }
      return hits;
    },
  },
  {
    id: 'angular-subscribe-leak', name: 'subscribe() without takeUntilDestroyed', severity: 'warning', category: 'performance', langs: ['ts'],
    title: 'Subscription is never cleaned up',
    body: 'This subscription lives on after the component is destroyed, which leaks memory and can run callbacks on a dead view. Pipe it through `takeUntilDestroyed()` (or use the `async` pipe / `toSignal`) unless the source completes on its own, like a single HttpClient call.',
    check: (ctx) => {
      const angular = /\.(component|directive|page|pipe)\.ts$/.test(ctx.path) || /@(?:Component|Directive)\s*\(/.test(ctx.code);
      if (!angular || ctx.isTest) return [];
      const managed = /\.unsubscribe\s*\(|\bSubscription\b.*\.add\s*\(/.test(ctx.code);
      return ctx.added
        .filter((l) => /\.subscribe\s*\(/.test(l.code))
        .filter((l) => {
          const window = [...before(ctx, l.n, 6), l].map((x) => x.code).join('\n');
          if (/takeUntilDestroyed|takeUntil\s*\(|\btake\s*\(\s*1\s*\)|\bfirst\s*\(\s*\)/.test(window)) return false;
          return !(managed && /[\w$\]]\s*=\s*[^=]|\.add\s*\(/.test(l.code));
        })
        .map((l) => ({ line: l.n }));
    },
  },
  {
    id: 'unsafe-html', name: 'innerHTML / raw HTML injection', severity: 'warning', category: 'security', langs: ['ts', 'js', 'html'],
    title: 'Raw HTML injection',
    body: 'Writing raw HTML opens the door to XSS if any part of it comes from user input. Prefer text content or a template; if HTML is truly needed, sanitize it first.',
    check: (ctx) => matchAdded(ctx,
      /\.(?:inner|outer)HTML\s*\+?=|\[innerHTML\]|\binsertAdjacentHTML\s*\(|\bdocument\.write\s*\(|\bbypassSecurityTrust\w*\s*\(|\bdangerouslySetInnerHTML\b|\bv-html\s*=/, 'nocom'),
  },
  {
    id: 'img-alt', name: '<img> without alt text', severity: 'warning', category: 'readability', langs: ['html', 'ts', 'js'],
    title: 'Image without alt text',
    body: 'Screen readers announce images without `alt` by their file name. Describe the image, or use `alt=""` if it is purely decorative.',
    check: (ctx) => {
      const hits: RuleHit[] = [];
      for (const l of ctx.added) {
        const start = l.nocom.search(/<img\b/i);
        if (start < 0) continue;
        let tag = l.nocom.slice(start);
        for (const next of after(ctx, l.n, 6)) {
          if (tag.includes('>')) break;
          tag += ' ' + next.nocom;
        }
        tag = tag.slice(0, tag.indexOf('>') + 1 || undefined);
        if (!/\balt\s*=|\[alt\]|\[attr\.alt\]|\balt\b\s*(?=[\s/>])/i.test(tag)) {
          hits.push({ line: l.n, suggestion: l.raw.replace(/<img\b/i, '<img alt="Describe the image"') });
        }
      }
      return hits;
    },
  },
  {
    id: 'long-line', name: `lines over ${LONG_LINE} characters`, severity: 'suggestion', category: 'style',
    title: 'Very long line',
    body: `Lines over ${LONG_LINE} characters are hard to read and review side by side. Break it up or extract a variable.`,
    check: (ctx) => /\.(md|lock|min\.\w+|svg|snap|csv)$/i.test(ctx.path) || ctx.lang === 'json' ? []
      : ctx.added
        .filter((l) => l.raw.length > LONG_LINE && !/^\s*(import|export\s.*\sfrom)\b/.test(l.raw))
        .map((l) => ({ line: l.n, body: `This line is ${l.raw.length} characters long (limit ${LONG_LINE}). Break it up or extract a variable.` })),
  },
  {
    id: 'long-function', name: `functions over ${LONG_FUNCTION} lines`, severity: 'suggestion', category: 'readability', langs: JS_PY,
    title: 'Very long function',
    body: '',
    check: (ctx) => {
      if (ctx.isTest) return [];
      const hits: RuleHit[] = [];
      let skipUntil = 0;
      for (const l of ctx.added) {
        if (l.n < skipUntil) continue;
        const isStart = ctx.lang === 'python' ? /^\s*(?:async\s+)?def\s/.test(l.code) : FN_START_JS.test(l.code);
        if (!isStart) continue;
        const block = ctx.lang === 'python' ? indentBlock(ctx, l.n) : braceBlock(ctx, l.n);
        if (!block || block.length <= LONG_FUNCTION) continue;
        hits.push({
          line: l.n,
          body: `This function is ${block.length} lines long. Functions over ${LONG_FUNCTION} lines usually do several things; split it into smaller, named steps that can be tested on their own.`,
        });
        skipUntil = block[block.length - 1].n;
      }
      return hits;
    },
  },
  {
    id: 'magic-number', name: 'magic numbers', severity: 'suggestion', category: 'readability', langs: JS_PY,
    title: 'Magic number',
    body: '',
    check: (ctx) => {
      if (ctx.isTest) return [];
      const hits: RuleHit[] = [];
      for (const l of ctx.added) {
        if (CONSTANT_DECL.test(l.code) || /^\s*(import|from|export\s+enum|enum)\b/.test(l.code) || /^\s*[A-Z][A-Z0-9_]*\s*=\s*\d/.test(l.code)) continue;
        let found: string | undefined;
        for (const re of MAGIC_CONTEXTS) {
          for (const m of l.code.matchAll(new RegExp(re.source, 'g'))) {
            if (!ALLOWED_NUMBERS.has(m[1])) { found = m[1]; break; }
          }
          if (found) break;
        }
        if (found) hits.push({
          line: l.n,
          title: `Magic number ${found}`,
          body: `What does \`${found}\` mean here? Give it a named constant (for example \`const RETRY_DELAY_MS = ${found}\`) so the intent is clear and it is changed in one place.`,
        });
      }
      return hits;
    },
  },
  {
    id: 'async-no-await', name: 'async function without await', severity: 'suggestion', category: 'readability', langs: JS_PY,
    title: '`async` without `await`',
    body: 'This function is marked `async` but never awaits anything, so it wraps its result in a Promise for no reason and misleads readers. Drop `async`, or await the call you meant to wait for.',
    check: (ctx) => ctx.added
      .filter((l) => ctx.lang === 'python' ? /^\s*async\s+def\s/.test(l.code) : /\basync\b\s*(?:function\b|\(|[\w$]+\s*(?:=>|\(|<))/.test(l.code))
      .filter((l) => {
        const block = ctx.lang === 'python' ? indentBlock(ctx, l.n) : braceBlock(ctx, l.n);
        if (!block) return false;
        const body = block.map((x) => x.code).join('\n');
        const asyncCount = body.match(/\basync\b/g)?.length ?? 0;
        return asyncCount === 1 && !/\bawait\b/.test(body);
      })
      .map((l) => ({ line: l.n })),
  },
  {
    id: 'no-var', name: 'var declarations', severity: 'suggestion', category: 'style', langs: JS,
    title: 'Use `let` or `const`',
    body: '`var` is function-scoped and hoisted, which causes subtle bugs in loops and closures. Use `const` (or `let` if it is reassigned).',
    check: (ctx) => ctx.added
      .filter((l) => /(?:^|[^\w$.])var\s+[A-Za-z_$]/.test(l.code))
      .map((l) => ({ line: l.n, suggestion: l.raw.replace(/\bvar\b/, 'let') })),
  },
  {
    id: 'no-eval', name: 'eval / new Function / exec', severity: 'blocker', category: 'security', langs: JS_PY,
    title: 'Dynamic code execution',
    body: 'Executing strings as code runs whatever an attacker manages to put in them, and defeats static analysis and CSP. Parse the data instead (e.g. `JSON.parse`) or use a lookup table.',
    check: (ctx) => ctx.lang === 'python'
      ? matchAdded(ctx, /(?<![\w.])(?:eval|exec)\s*\(/)
      : matchAdded(ctx, /(?<![\w$.])eval\s*\(|\bnew\s+Function\s*\(/),
  },
  {
    id: 'bare-except', name: 'bare except:', severity: 'warning', category: 'bug', langs: ['python'],
    title: 'Bare `except:`',
    body: 'A bare `except:` also catches `KeyboardInterrupt` and `SystemExit`, so the program cannot be stopped cleanly. Catch the specific exception, or at least `Exception`.',
    check: (ctx) => ctx.added
      .filter((l) => /^\s*except\s*:/.test(l.code))
      .map((l) => ({ line: l.n, suggestion: l.raw.replace(/except\s*:/, 'except Exception:') })),
  },
  {
    id: 'focused-test', name: 'fdescribe / it.only', severity: 'blocker', category: 'testing', langs: JS,
    title: 'Focused test',
    body: 'A focused test makes the runner skip every other test, so CI goes green while most of the suite never ran.',
    check: (ctx) => ctx.added
      .filter((l) => /(?<![\w$.])(?:fdescribe|fit)\s*\(|\b(?:describe|it|test)\.only\s*\(/.test(l.code))
      .map((l) => ({ line: l.n, suggestion: l.raw.replace(/\bf(describe|it)\s*\(/, '$1(').replace(/\.only\s*\(/, '(') })),
  },
  {
    id: 'skipped-test', name: 'xit / it.skip / pytest skip', severity: 'warning', category: 'testing', langs: JS_PY,
    title: 'Skipped test',
    body: 'Skipped tests silently stop protecting the code. Fix the test, delete it, or link the ticket that tracks re-enabling it.',
    check: (ctx) => ctx.lang === 'python'
      ? matchAdded(ctx, /@(?:pytest\.mark\.skip|unittest\.skip)\b/)
      : matchAdded(ctx, /(?<![\w$.])(?:xdescribe|xit)\s*\(|\b(?:describe|it|test)\.skip\s*\(/),
  },
  {
    id: 'tests-added', name: 'praise for new tests', severity: 'praise', category: 'testing', langs: JS_PY,
    title: 'Nice: new tests',
    body: '',
    check: (ctx) => {
      if (!ctx.isTest) return [];
      const cases = ctx.lang === 'python'
        ? ctx.added.filter((l) => /^\s*(?:async\s+)?def\s+test_/.test(l.code))
        : ctx.added.filter((l) => /(?<![\w$.])(?:it|test)\s*\(/.test(l.code));
      if (!cases.length) return [];
      return [{
        line: cases[0].n,
        body: `This change adds ${cases.length} test case${cases.length === 1 ? '' : 's'}. Thanks for covering the new behaviour.`,
      }];
    },
  },
];

/** Runs every applicable rule over the added lines of one file. */
export function runRules(file: DiffFile, rules: Rule[] = RULES): ReviewComment[] {
  if (file.binary || file.status === 'deleted' || !file.hunks.length) return [];
  const ctx = buildContext(file);
  const out: ReviewComment[] = [];
  for (const rule of rules) {
    if (rule.langs && !rule.langs.includes(ctx.lang)) continue;
    const seen = new Set<number>();
    for (const hit of rule.check(ctx).slice(0, MAX_HITS_PER_RULE)) {
      if (seen.has(hit.line)) continue;
      seen.add(hit.line);
      out.push({
        id: `rule:${rule.id}:${file.path}:${hit.line}`,
        file: file.path,
        line: hit.line,
        side: 'new',
        severity: rule.severity,
        category: rule.category,
        title: hit.title ?? rule.title,
        body: hit.body ?? rule.body,
        ...(hit.suggestion !== undefined && hit.suggestion !== ctx.byNumber.get(hit.line)?.raw ? { suggestion: hit.suggestion } : {}),
        source: 'rule',
        ruleId: rule.id,
      });
    }
  }
  return out.sort((a, b) => a.line - b.line);
}
