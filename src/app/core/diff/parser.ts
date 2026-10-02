import { DiffFile, DiffHunk, DiffLine, ParsedDiff, languageOf } from './models';

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;
const BINARY = /^Binary files (.+) and (.+) differ$/;

interface Draft {
  oldPath: string | null;
  newPath: string | null;
  /** Saw a "---" header for this file. */
  sawMinus: boolean;
  isNew: boolean;
  isDeleted: boolean;
  rename: boolean;
  copy: boolean;
  binary: boolean;
  similarity?: number;
  oldMode?: string;
  newMode?: string;
  hunks: DiffHunk[];
}

const draft = (oldPath: string | null = null, newPath: string | null = null): Draft => ({
  oldPath, newPath, sawMinus: false, isNew: false, isDeleted: false, rename: false, copy: false, binary: false, hunks: [],
});

/** Decodes a git C-style quoted path: "a/caf\303\251.txt" -> a/café.txt */
export function unquotePath(raw: string): string {
  if (!raw.startsWith('"') || !raw.endsWith('"') || raw.length < 2) return raw;
  const body = raw.slice(1, -1);
  const bytes: number[] = [];
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, '\\': 92, a: 7, b: 8, f: 12, v: 11 };
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) {
      const next = body[i + 1];
      if (/[0-7]/.test(next)) {
        const oct = body.slice(i + 1, i + 4).match(/^[0-7]{1,3}/)![0];
        bytes.push(parseInt(oct, 8));
        i += oct.length;
        continue;
      }
      if (next in simple) {
        bytes.push(simple[next]);
        i++;
        continue;
      }
    }
    bytes.push(...new TextEncoder().encode(ch));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Strips the a/ or b/ prefix git adds, and the timestamp `diff -u` appends after a tab. */
function cleanPath(raw: string, prefix: 'a/' | 'b/'): string | null {
  let p = raw.trim();
  if (!p.startsWith('"')) p = p.split('\t')[0].trim();
  p = unquotePath(p);
  if (p === '/dev/null') return null;
  return p.startsWith(prefix) ? p.slice(2) : p;
}

/** Reads the two paths of a "diff --git" line, which may be quoted or contain spaces. */
function gitHeaderPaths(rest: string): [string | null, string | null] {
  if (rest.startsWith('"')) {
    const end = rest.indexOf('" ', 1);
    if (end > 0) return [cleanPath(rest.slice(0, end + 1), 'a/'), cleanPath(rest.slice(end + 2), 'b/')];
  }
  if (rest.endsWith('"')) {
    const start = rest.lastIndexOf(' "');
    if (start > 0) return [cleanPath(rest.slice(0, start), 'a/'), cleanPath(rest.slice(start + 1), 'b/')];
  }
  // Same path on both sides (the common case): "a/X b/X"
  const half = (rest.length - 1) / 2;
  if (Number.isInteger(half) && rest[half] === ' ') {
    const a = rest.slice(0, half);
    const b = rest.slice(half + 1);
    if (a.slice(2) === b.slice(2)) return [cleanPath(a, 'a/'), cleanPath(b, 'b/')];
  }
  const split = rest.lastIndexOf(' b/');
  if (split > 0) return [cleanPath(rest.slice(0, split), 'a/'), cleanPath(rest.slice(split + 1), 'b/')];
  return [null, null];
}

function finish(d: Draft, index: number): DiffFile {
  let additions = 0;
  let deletions = 0;
  for (const h of d.hunks) for (const l of h.lines) {
    if (l.type === 'add') additions++;
    else if (l.type === 'del') deletions++;
  }
  const isNew = d.isNew || (d.oldPath === null && d.newPath !== null);
  const isDeleted = d.isDeleted || (d.newPath === null && d.oldPath !== null);
  const status = isNew ? 'added' : isDeleted ? 'deleted' : d.copy ? 'copied'
    : d.rename || (d.oldPath && d.newPath && d.oldPath !== d.newPath) ? 'renamed' : 'modified';
  const oldPath = isNew ? null : d.oldPath;
  const newPath = isDeleted ? null : d.newPath;
  const path = newPath ?? oldPath ?? `file-${index + 1}`;
  return {
    id: `${index}:${path}`,
    oldPath, newPath, path, status,
    binary: d.binary,
    hunks: d.hunks,
    additions, deletions,
    similarity: d.similarity,
    oldMode: d.oldMode,
    newMode: d.newMode,
    language: languageOf(path),
  };
}

/**
 * Parses git / `diff -u` unified diffs: several files, renames, copies, mode changes,
 * binary files, quoted paths, CRLF input and "\ No newline at end of file".
 * Hunk bodies are read by their line counts, so removed lines that start with "--- "
 * are not mistaken for a new file header.
 */
export function parseUnifiedDiff(input: string): ParsedDiff {
  const lines = input.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();

  const drafts: Draft[] = [];
  const warnings: string[] = [];
  let file: Draft | null = null;
  let hunk: DiffHunk | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let oldNo = 0;
  let newNo = 0;
  let inBinaryPatch = false;

  const start = (d: Draft) => {
    drafts.push(d);
    file = d;
    hunk = null;
    inBinaryPatch = false;
    return d;
  };
  const lastLine = (): DiffLine | undefined => hunk?.lines[hunk.lines.length - 1];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const c = line[0];
      const h: DiffHunk = hunk;
      if (c === ' ' || line === '') {
        h.lines.push({ type: 'context', content: line.slice(1), oldLine: oldNo++, newLine: newNo++ });
        oldLeft--; newLeft--;
        continue;
      }
      if (c === '-' && oldLeft > 0) {
        h.lines.push({ type: 'del', content: line.slice(1), oldLine: oldNo++, newLine: null });
        oldLeft--;
        continue;
      }
      if (c === '+' && newLeft > 0) {
        h.lines.push({ type: 'add', content: line.slice(1), oldLine: null, newLine: newNo++ });
        newLeft--;
        continue;
      }
      if (c === '\\') {
        const last = lastLine();
        if (last) last.noNewline = true;
        continue;
      }
      warnings.push(`Hunk "${h.header}" ended early at line ${i + 1}.`);
      hunk = null;
    }

    if (line.startsWith('\\')) {
      const last = lastLine();
      if (last) last.noNewline = true;
      continue;
    }
    hunk = null;

    if (line.startsWith('diff --git ')) {
      const [a, b] = gitHeaderPaths(line.slice(11));
      start(draft(a, b));
      continue;
    }
    if (line.startsWith('diff --cc ') || line.startsWith('diff --combined ')) {
      warnings.push(`Combined (merge) diffs are not supported: ${line.slice(5)}`);
      file = null;
      continue;
    }
    if (inBinaryPatch) continue;

    if (line.startsWith('--- ') && lines[i + 1]?.startsWith('+++ ')) {
      const cur = file as Draft | null;
      const d: Draft = cur && !cur.sawMinus && !cur.hunks.length ? cur : start(draft());
      d.sawMinus = true;
      const oldPath = cleanPath(line.slice(4), 'a/');
      const newPath = cleanPath(lines[i + 1].slice(4), 'b/');
      d.oldPath = oldPath;
      d.newPath = newPath;
      if (oldPath === null) d.isNew = true;
      if (newPath === null) d.isDeleted = true;
      i++;
      continue;
    }

    const m = HUNK.exec(line);
    if (m) {
      const d: Draft = file ?? start(draft());
      const oldStart = +m[1];
      const newStart = +m[3];
      const oldLines = m[2] === undefined ? 1 : +m[2];
      const newLines = m[4] === undefined ? 1 : +m[4];
      const h: DiffHunk = { header: line, oldStart, oldLines, newStart, newLines, section: m[5]?.trim() ?? '', lines: [] };
      d.hunks.push(h);
      hunk = h;
      oldLeft = oldLines;
      newLeft = newLines;
      // A count of 0 means the start points at the line before the (empty) range.
      oldNo = oldLines === 0 ? oldStart + 1 : oldStart;
      newNo = newLines === 0 ? newStart + 1 : newStart;
      continue;
    }

    if (!file) continue; // preamble: commit message, email headers, etc.
    const f: Draft = file;

    if (line.startsWith('new file mode ')) { f.isNew = true; f.newMode = line.slice(14).trim(); }
    else if (line.startsWith('deleted file mode ')) { f.isDeleted = true; f.oldMode = line.slice(18).trim(); }
    else if (line.startsWith('old mode ')) f.oldMode = line.slice(9).trim();
    else if (line.startsWith('new mode ')) f.newMode = line.slice(9).trim();
    else if (line.startsWith('rename from ')) { f.rename = true; f.oldPath = unquotePath(line.slice(12)); }
    else if (line.startsWith('rename to ')) { f.rename = true; f.newPath = unquotePath(line.slice(10)); }
    else if (line.startsWith('copy from ')) { f.copy = true; f.oldPath = unquotePath(line.slice(10)); }
    else if (line.startsWith('copy to ')) { f.copy = true; f.newPath = unquotePath(line.slice(8)); }
    else if (line.startsWith('similarity index ')) f.similarity = parseInt(line.slice(17), 10);
    else if (line.startsWith('GIT binary patch')) { f.binary = true; inBinaryPatch = true; }
    else {
      const bin = BINARY.exec(line);
      if (bin) {
        f.binary = true;
        const a = cleanPath(bin[1], 'a/');
        const b = cleanPath(bin[2], 'b/');
        if (a === null) f.isNew = true;
        if (b === null) f.isDeleted = true;
        f.oldPath = a ?? f.oldPath;
        f.newPath = b ?? f.newPath;
      }
    }
  }

  if (hunk && (oldLeft > 0 || newLeft > 0)) {
    warnings.push(`Hunk "${(hunk as DiffHunk).header}" is missing ${Math.max(oldLeft, newLeft)} line(s); the diff may be truncated.`);
  }

  return { files: drafts.map(finish), warnings };
}

/** Every line number that appears in the diff, per side. Used to validate review comments. */
export function lineIndex(file: DiffFile): { old: Set<number>; new: Set<number> } {
  const idx = { old: new Set<number>(), new: new Set<number>() };
  for (const h of file.hunks) for (const l of h.lines) {
    if (l.oldLine !== null) idx.old.add(l.oldLine);
    if (l.newLine !== null) idx.new.add(l.newLine);
  }
  return idx;
}
