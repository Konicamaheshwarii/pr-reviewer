import { createUnifiedDiff, diffSequences } from './generator';
import { DiffFile } from './models';
import { parseUnifiedDiff } from './parser';

/** Rebuilds the new text from the old text and a parsed diff, to prove the diff is correct. */
function apply(oldText: string, file: DiffFile): string {
  const old = oldText === '' ? [] : oldText.split('\n');
  if (old.length && old[old.length - 1] === '') old.pop();
  const out: string[] = [];
  let i = 0;
  let noEol = false;
  for (const h of file.hunks) {
    const start = h.oldLines === 0 ? h.oldStart : h.oldStart - 1;
    while (i < start) out.push(old[i++]);
    for (const l of h.lines) {
      if (l.type === 'context') { out.push(old[i++]); noEol = !!l.noNewline; }
      else if (l.type === 'del') { i++; }
      else { out.push(l.content); noEol = !!l.noNewline; }
    }
  }
  while (i < old.length) { out.push(old[i++]); noEol = false; }
  return out.length ? out.join('\n') + (noEol ? '' : '\n') : '';
}

const lines = (n: number, f = (i: number) => `line ${i}`) => Array.from({ length: n }, (_, i) => f(i + 1)).join('\n') + '\n';

describe('diffSequences (Myers)', () => {
  it('finds a shortest edit script', () => {
    const a = 'ABCABBA'.split('');
    const b = 'CBABAC'.split('');
    const edits = diffSequences(a, b);
    expect(edits.filter((e) => e.op !== 'equal').length).toBe(5); // the classic example has D = 5
    // replaying the script gives b back
    const rebuilt = edits.filter((e) => e.op !== 'delete').map((e) => (e.op === 'equal' ? a[e.a!] : b[e.b!]));
    expect(rebuilt.join('')).toBe('CBABAC');
  });

  it('handles empty sides', () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences(['a'], []).map((e) => e.op)).toEqual(['delete']);
    expect(diffSequences([], ['a', 'b']).map((e) => e.op)).toEqual(['insert', 'insert']);
  });
});

describe('createUnifiedDiff', () => {
  it('returns an empty string for identical text', () => {
    expect(createUnifiedDiff('a\nb\n', 'a\nb\n')).toBe('');
  });

  it('writes git-style headers and hunks with 3 lines of context', () => {
    const diff = createUnifiedDiff('a\nb\nc\nd\ne\n', 'a\nb\nC\nd\ne\n', { oldPath: 'x.ts' });
    expect(diff).toBe(`diff --git a/x.ts b/x.ts
--- a/x.ts
+++ b/x.ts
@@ -1,5 +1,5 @@
 a
 b
-c
+C
 d
 e
`);
  });

  it('splits distant changes into separate hunks and merges close ones', () => {
    const old = lines(30);
    const far = old.replace('line 2\n', 'line two\n').replace('line 25\n', 'line twenty-five\n');
    expect(parseUnifiedDiff(createUnifiedDiff(old, far)).files[0].hunks.length).toBe(2);
    const near = old.replace('line 2\n', 'line two\n').replace('line 8\n', 'line eight\n');
    expect(parseUnifiedDiff(createUnifiedDiff(old, near)).files[0].hunks.length).toBe(1);
  });

  it('round-trips through the parser for inserts, deletes, new files and deleted files', () => {
    const cases: [string, string][] = [
      [lines(20), lines(20).replace('line 10\n', 'line 10\nextra a\nextra b\n')],
      [lines(20), lines(20).replace('line 1\nline 2\n', '').replace('line 20\n', '')],
      ['', 'brand\nnew\n'],
      ['going\naway\n', ''],
      [lines(12), lines(12, (i) => (i % 3 ? `line ${i}` : `changed ${i}`))],
    ];
    for (const [a, b] of cases) {
      const { files, warnings } = parseUnifiedDiff(createUnifiedDiff(a, b, { oldPath: 'f.txt' }));
      expect(warnings).toEqual([]);
      expect(apply(a, files[0])).withContext(JSON.stringify([a, b])).toBe(b);
    }
    expect(parseUnifiedDiff(createUnifiedDiff('', 'x\n')).files[0].status).toBe('added');
    expect(parseUnifiedDiff(createUnifiedDiff('x\n', '')).files[0].status).toBe('deleted');
  });

  it('reports a missing final newline and treats it as a change', () => {
    const diff = createUnifiedDiff('a\nb', 'a\nb\n');
    expect(diff).toContain('-b\n\\ No newline at end of file\n+b\n');
    const file = parseUnifiedDiff(diff).files[0];
    expect(apply('a\nb', file)).toBe('a\nb\n');
    expect(apply('a\nb\n', parseUnifiedDiff(createUnifiedDiff('a\nb\n', 'a\nc')).files[0])).toBe('a\nc');
  });
});
