export type EditOp = 'equal' | 'insert' | 'delete';

export interface Edit {
  op: EditOp;
  /** Index in the old sequence (equal / delete). */
  a?: number;
  /** Index in the new sequence (equal / insert). */
  b?: number;
}

/** Above this many differences we stop searching for the shortest script and replace the middle block. */
const MAX_D = 5000;

/**
 * Myers' O((N+M)D) shortest edit script over two sequences of strings.
 * The common prefix and suffix are trimmed first, which keeps typical edits fast.
 */
export function diffSequences(a: readonly string[], b: readonly string[]): Edit[] {
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++;
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++;

  const out: Edit[] = [];
  for (let i = 0; i < pre; i++) out.push({ op: 'equal', a: i, b: i });
  out.push(...middle(a, b, pre, a.length - suf, pre, b.length - suf));
  for (let k = suf; k > 0; k--) out.push({ op: 'equal', a: a.length - k, b: b.length - k });
  return out;
}

function middle(a: readonly string[], b: readonly string[], a0: number, a1: number, b0: number, b1: number): Edit[] {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n === 0 && m === 0) return [];
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;

  outer: for (let d = 0; d <= Math.min(max, MAX_D); d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = d; break outer; }
    }
  }

  if (found < 0) {
    // Too different: delete everything, insert everything.
    const res: Edit[] = [];
    for (let i = a0; i < a1; i++) res.push({ op: 'delete', a: i });
    for (let j = b0; j < b1; j++) res.push({ op: 'insert', b: j });
    return res;
  }

  // Walk the trace backwards to recover the path.
  const res: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x--; y--; res.push({ op: 'equal', a: a0 + x, b: b0 + y }); }
    if (x === prevX) { y--; res.push({ op: 'insert', b: b0 + y }); }
    else { x--; res.push({ op: 'delete', a: a0 + x }); }
  }
  while (x > 0 && y > 0) { x--; y--; res.push({ op: 'equal', a: a0 + x, b: b0 + y }); }
  return res.reverse();
}

interface SplitText {
  lines: string[];
  /** The last line has no trailing newline. */
  noEol: boolean;
}

function splitText(text: string): SplitText {
  if (text === '') return { lines: [], noEol: false };
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const noEol = lines[lines.length - 1] !== '';
  if (!noEol) lines.pop();
  return { lines, noEol };
}

export interface UnifiedDiffOptions {
  oldPath?: string;
  newPath?: string;
  /** Lines of unchanged context around each change (default 3). */
  context?: number;
}

/**
 * Builds a git-style unified diff of two texts. Returns '' when they are identical.
 * A missing newline at the end of either text is reported with "\ No newline at end of file".
 */
export function createUnifiedDiff(oldText: string, newText: string, opts: UnifiedDiffOptions = {}): string {
  const ctx = opts.context ?? 3;
  const oldPath = opts.oldPath ?? 'file';
  const newPath = opts.newPath ?? oldPath;
  const A = splitText(oldText);
  const B = splitText(newText);
  // Compare with an end-of-file marker so "x" and "x\n" count as different lines.
  const key = (s: SplitText) => s.lines.map((l, i) => (s.noEol && i === s.lines.length - 1 ? l + '\u0000' : l));
  const edits = diffSequences(key(A), key(B));
  if (!edits.some((e) => e.op !== 'equal')) return '';

  // Group edits into hunks: changes plus `ctx` lines either side, merging close groups.
  const changeIdx = edits.map((e, i) => (e.op === 'equal' ? -1 : i)).filter((i) => i >= 0);
  const ranges: [number, number][] = [];
  for (const i of changeIdx) {
    const lo = Math.max(0, i - ctx);
    const hi = Math.min(edits.length - 1, i + ctx);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }

  const out: string[] = [`diff --git a/${oldPath} b/${newPath}`];
  if (!oldText) out.push('new file mode 100644');
  else if (!newText) out.push('deleted file mode 100644');
  out.push(oldText ? `--- a/${oldPath}` : '--- /dev/null');
  out.push(newText ? `+++ b/${newPath}` : '+++ /dev/null');

  const eolMark = '\\ No newline at end of file';
  for (const [lo, hi] of ranges) {
    const slice = edits.slice(lo, hi + 1);
    // Lines before the hunk on each side.
    let oldBefore = 0;
    let newBefore = 0;
    for (let i = 0; i < lo; i++) {
      if (edits[i].op !== 'insert') oldBefore++;
      if (edits[i].op !== 'delete') newBefore++;
    }
    const oldCount = slice.filter((e) => e.op !== 'insert').length;
    const newCount = slice.filter((e) => e.op !== 'delete').length;
    const range = (before: number, count: number) =>
      count === 1 ? `${before + 1}` : `${count === 0 ? before : before + 1},${count}`;
    out.push(`@@ -${range(oldBefore, oldCount)} +${range(newBefore, newCount)} @@`);
    for (const e of slice) {
      if (e.op === 'equal') {
        out.push(' ' + A.lines[e.a!]);
        if (A.noEol && e.a === A.lines.length - 1) out.push(eolMark);
      } else if (e.op === 'delete') {
        out.push('-' + A.lines[e.a!]);
        if (A.noEol && e.a === A.lines.length - 1) out.push(eolMark);
      } else {
        out.push('+' + B.lines[e.b!]);
        if (B.noEol && e.b === B.lines.length - 1) out.push(eolMark);
      }
    }
  }
  return out.join('\n') + '\n';
}
