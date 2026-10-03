import { demoReview } from '../llm/demo.provider';
import { parseUnifiedDiff } from '../diff/parser';
import { SAMPLES } from '../samples';
import { batchHunks, extractJson, formatHunks, parseReview, reviewRequest } from './prompts';

const DIFF = `diff --git a/src/cart.ts b/src/cart.ts
--- a/src/cart.ts
+++ b/src/cart.ts
@@ -10,4 +10,5 @@ export class Cart {
 total() {
-  return this.items.length;
+  const sum = this.items.reduce((s, i) => s + i.price, 0);
+  return sum;
 }
 }
`;
const file = parseUnifiedDiff(DIFF).files[0];

describe('review prompt', () => {
  it('labels every line with an explicit new (R) or old (L) number', () => {
    expect(formatHunks(file.hunks)).toBe([
      '@@ -10,4 +10,5 @@ export class Cart {',
      'R10   total() {',
      'L11 -   return this.items.length;',
      'R11 +   const sum = this.items.reduce((s, i) => s + i.price, 0);',
      'R12 +   return sum;',
      'R13   }',
      'R14   }',
    ].join('\n'));
  });

  it('fences the diff as data and asks for JSON', () => {
    const req = reviewRequest(file);
    expect(req.task).toBe('review');
    expect(req.json).toBeTrue();
    expect(req.system).toContain('untrusted data');
    expect(req.prompt).toContain('<diff>\n@@ -10,4');
    expect(req.prompt).toContain('</diff>');
  });

  it('batches large files by whole hunks', () => {
    const big = { ...file, hunks: [file.hunks[0], file.hunks[0], file.hunks[0]] };
    expect(batchHunks(big.hunks, 12).map((b) => b.length)).toEqual([2, 1]);
    expect(batchHunks(big.hunks, 1000).length).toBe(1);
  });
});

describe('parseReview (AI comment validation)', () => {
  it('extracts JSON wrapped in prose, code fences or think tags', () => {
    expect(extractJson('<think>hmm</think>```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: [{"line":1}] hope it helps')).toEqual([{ line: 1 }]);
    expect(() => extractJson('no json here')).toThrowError(/not valid JSON/);
  });

  it('keeps comments on real lines and drops the ones outside the diff', () => {
    const reply = JSON.stringify({
      summary: 'Sums prices now.',
      comments: [
        { line: 11, side: 'new', severity: 'warning', category: 'bug', title: 'Quantity ignored', body: 'Multiply by qty.', suggestion: '  const sum = this.items.reduce((s, i) => s + i.price * i.qty, 0);' },
        { line: 11, side: 'old', severity: 'praise', category: 'readability', title: 'Good removal' },
        { line: 99, side: 'new', severity: 'blocker', category: 'bug', title: 'Hallucinated line' },
        { line: 'abc', title: 'Bad line' },
        { line: 12, severity: 'warning', category: 'bug', title: '', body: '' },
      ],
    });
    const parsed = parseReview(reply, file);
    expect(parsed.summary).toBe('Sums prices now.');
    expect(parsed.dropped).toBe(3);
    expect(parsed.comments.map((c) => [c.line, c.side, c.severity, c.source])).toEqual([
      [11, 'new', 'warning', 'ai'],
      [11, 'old', 'praise', 'ai'],
    ]);
    expect(parsed.comments[0].suggestion).toContain('i.qty');
    expect(parsed.comments.every((c) => c.file === 'src/cart.ts')).toBeTrue();
  });

  it('infers the side, accepts "R12"/"L11" line labels and maps unknown severities and categories', () => {
    const parsed = parseReview(JSON.stringify([
      { line: 'R12', severity: 'critical', category: 'correctness', title: 'A' },
      { line: 'L11', severity: 'nit', category: 'perf', body: 'Shorter is fine. More words.' },
      { line: 14, severity: '???', category: 'whatever', title: 'C' },
    ]), file);
    expect(parsed.comments.map((c) => [c.line, c.side, c.severity, c.category])).toEqual([
      [11, 'old', 'suggestion', 'performance'],
      [12, 'new', 'blocker', 'bug'],
      [14, 'new', 'suggestion', 'bug'],
    ]);
    expect(parsed.comments[0].title).toBe('Shorter is fine.');
  });

  it('removes duplicates and ignores suggestions on removed lines', () => {
    const parsed = parseReview(JSON.stringify({ comments: [
      { line: 12, title: 'Same', body: 'x' },
      { line: 12, title: 'same', body: 'y' },
      { line: 11, side: 'old', title: 'Old', suggestion: 'nope' },
    ] }), file);
    expect(parsed.comments.length).toBe(2);
    expect(parsed.dropped).toBe(1);
    expect(parsed.comments.find((c) => c.side === 'old')?.suggestion).toBeUndefined();
  });

  it('accepts every comment the demo reviewer produces for the samples (line numbers are valid)', () => {
    for (const s of SAMPLES) {
      for (const f of parseUnifiedDiff(s.diff).files) {
        const reply = demoReview({ file: f, hunks: f.hunks });
        const parsed = parseReview(JSON.stringify(reply), f);
        expect(parsed.dropped).withContext(f.path).toBe(0);
        expect(parsed.comments.length).withContext(f.path).toBe(reply.comments.length);
      }
    }
  });
});
