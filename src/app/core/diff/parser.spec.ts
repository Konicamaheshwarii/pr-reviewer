import { SAMPLES } from '../samples';
import { lineIndex, parseUnifiedDiff, unquotePath } from './parser';

const GIT_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 83db48f..bf269f4 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,4 +1,5 @@ export class A {
 const a = 1;
-const b = 2;
+const b = 3;
+const c = 4;
 const d = 5;
 const e = 6;
@@ -10,2 +11,2 @@
 x();
-y();
+z();
diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -1 +1 @@
-old
+new
`;

describe('parseUnifiedDiff', () => {
  it('reads files, hunks, sections and old/new line numbers', () => {
    const { files, warnings } = parseUnifiedDiff(GIT_DIFF);
    expect(warnings).toEqual([]);
    expect(files.map((f) => f.path)).toEqual(['src/a.ts', 'README.md']);
    const [a, readme] = files;
    expect(a.status).toBe('modified');
    expect(a.language).toBe('ts');
    expect(a.hunks.length).toBe(2);
    expect(a.hunks[0].section).toBe('export class A {');
    expect(a.additions).toBe(3);
    expect(a.deletions).toBe(2);
    const lines = a.hunks[0].lines.map((l) => [l.type, l.oldLine, l.newLine]);
    expect(lines).toEqual([
      ['context', 1, 1], ['del', 2, null], ['add', null, 2], ['add', null, 3], ['context', 3, 4], ['context', 4, 5],
    ]);
    expect(a.hunks[1].lines.map((l) => [l.oldLine, l.newLine])).toEqual([[10, 11], [11, null], [null, 12]]);
    // "@@ -1 +1 @@" means a count of one line on each side.
    expect(readme.hunks[0].oldLines).toBe(1);
    expect(readme.hunks[0].lines.map((l) => l.content)).toEqual(['old', 'new']);
  });

  it('handles new, deleted, renamed and mode-only files', () => {
    const { files } = parseUnifiedDiff(`diff --git a/new.js b/new.js
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/new.js
@@ -0,0 +1,2 @@
+a
+b
diff --git a/gone.js b/gone.js
deleted file mode 100644
--- a/gone.js
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/old/name.ts b/new/name.ts
similarity index 100%
rename from old/name.ts
rename to new/name.ts
diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`);
    expect(files.map((f) => f.status)).toEqual(['added', 'deleted', 'renamed', 'modified']);
    expect(files[0].oldPath).toBeNull();
    expect(files[0].hunks[0].lines.map((l) => l.newLine)).toEqual([1, 2]);
    expect(files[1].path).toBe('gone.js');
    expect(files[1].newPath).toBeNull();
    expect(files[2]).toEqual(jasmine.objectContaining({ oldPath: 'old/name.ts', newPath: 'new/name.ts', similarity: 100, hunks: [] }));
    expect(files[3]).toEqual(jasmine.objectContaining({ oldMode: '100644', newMode: '100755' }));
  });

  it('marks binary files from both "Binary files differ" and GIT binary patch', () => {
    const { files } = parseUnifiedDiff(`diff --git a/logo.png b/logo.png
new file mode 100644
index 0000000..3f4c2a1
Binary files /dev/null and b/logo.png differ
diff --git a/icon.ico b/icon.ico
index 1111111..2222222 100644
GIT binary patch
literal 1150
zcmZQzU<5(|0R|wcz~F&kLc
literal 0
HcmV?d00001

diff --git a/next.txt b/next.txt
--- a/next.txt
+++ b/next.txt
@@ -1 +1 @@
-a
+b
`);
    expect(files.length).toBe(3);
    expect(files[0]).toEqual(jasmine.objectContaining({ binary: true, status: 'added', path: 'logo.png' }));
    expect(files[1]).toEqual(jasmine.objectContaining({ binary: true, status: 'modified', hunks: [] }));
    expect(files[2].additions).toBe(1);
  });

  it('attaches "\\ No newline at end of file" to the line before it', () => {
    const { files } = parseUnifiedDiff(`--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,2 @@
 keep
-old
\\ No newline at end of file
+new
\\ No newline at end of file
`);
    const lines = files[0].hunks[0].lines;
    expect(lines.length).toBe(3);
    expect(lines[1]).toEqual(jasmine.objectContaining({ type: 'del', content: 'old', noNewline: true }));
    expect(lines[2]).toEqual(jasmine.objectContaining({ type: 'add', content: 'new', noNewline: true }));
    expect(lines[0].noNewline).toBeUndefined();
  });

  it('does not mistake a removed "-- comment" line for a file header', () => {
    const { files, warnings } = parseUnifiedDiff(`diff --git a/q.sql b/q.sql
--- a/q.sql
+++ b/q.sql
@@ -1,3 +1 @@
--- legacy query
-++ odd line
 select 1;
`);
    expect(warnings).toEqual([]);
    expect(files.length).toBe(1);
    expect(files[0].hunks[0].lines.map((l) => l.content)).toEqual(['-- legacy query', '++ odd line', 'select 1;']);
  });

  it('accepts CRLF input, plain diff -u headers with timestamps and context lines stripped of their space', () => {
    const text = [
      'Some commit message above the diff',
      '--- lib/util.py\t2026-01-01 10:00:00.000000000 +0000',
      '+++ lib/util.py\t2026-01-02 10:00:00.000000000 +0000',
      '@@ -1,3 +1,3 @@',
      ' def f():',
      '',
      '-    return 1',
      '+    return 2',
    ].join('\r\n');
    const { files, warnings } = parseUnifiedDiff(text);
    expect(warnings).toEqual([]);
    expect(files[0].path).toBe('lib/util.py');
    expect(files[0].language).toBe('python');
    expect(files[0].hunks[0].lines.map((l) => l.type)).toEqual(['context', 'context', 'del', 'add']);
    expect(files[0].hunks[0].lines.every((l) => !l.content.includes('\r'))).toBeTrue();
  });

  it('decodes quoted paths with escapes and paths containing spaces', () => {
    expect(unquotePath('"a/caf\\303\\251 menu.txt"')).toBe('a/café menu.txt');
    expect(unquotePath('"tab\\there"')).toBe('tab\there');
    const { files } = parseUnifiedDiff(`diff --git a/my file.txt b/my file.txt
--- a/my file.txt
+++ b/my file.txt
@@ -1 +1 @@
-a
+b
diff --git "a/caf\\303\\251.md" "b/caf\\303\\251.md"
new file mode 100644
--- /dev/null
+++ "b/caf\\303\\251.md"
@@ -0,0 +1 @@
+hi
`);
    expect(files.map((f) => f.path)).toEqual(['my file.txt', 'café.md']);
  });

  it('warns about truncated hunks and rejects text that is not a diff', () => {
    const truncated = parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n a\n-b\n');
    expect(truncated.warnings.length).toBe(1);
    expect(truncated.warnings[0]).toContain('truncated');
    expect(parseUnifiedDiff('hello world\nnot a diff').files).toEqual([]);
    expect(parseUnifiedDiff('').files).toEqual([]);
  });

  it('indexes the line numbers present on each side', () => {
    const idx = lineIndex(parseUnifiedDiff(GIT_DIFF).files[0]);
    expect([...idx.new].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 11, 12]);
    expect(idx.old.has(2)).toBeTrue();
    expect(idx.new.has(6)).toBeFalse();
  });

  it('parses every bundled sample without warnings', () => {
    for (const s of SAMPLES) {
      const { files, warnings } = parseUnifiedDiff(s.diff);
      expect(warnings).withContext(s.id).toEqual([]);
      expect(files.length).withContext(s.id).toBeGreaterThan(1);
    }
    const node = parseUnifiedDiff(SAMPLES[1].diff).files;
    expect(node.map((f) => f.status)).toEqual(['modified', 'added', 'renamed', 'deleted', 'modified', 'modified']);
    const pkg = node.find((f) => f.path === 'package.json')!;
    expect(pkg.hunks[0].lines.at(-1)).toEqual(jasmine.objectContaining({ type: 'add', content: '}', noNewline: true }));
  });
});
