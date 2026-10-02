export type Lang = 'ts' | 'js' | 'html' | 'css' | 'json' | 'python' | 'plain';

export type LineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: LineType;
  content: string;
  /** Line number in the old file (null for added lines). */
  oldLine: number | null;
  /** Line number in the new file (null for removed lines). */
  newLine: number | null;
  /** The line was followed by "\ No newline at end of file". */
  noNewline?: boolean;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Text after the second @@, usually the enclosing function. */
  section: string;
  lines: DiffLine[];
}

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied';

export interface DiffFile {
  /** Stable key within one diff: index plus path. */
  id: string;
  oldPath: string | null;
  newPath: string | null;
  /** The path to show and to attach comments to (new path, or old path for deletions). */
  path: string;
  status: FileStatus;
  binary: boolean;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  similarity?: number;
  oldMode?: string;
  newMode?: string;
  language: Lang;
}

export interface ParsedDiff {
  files: DiffFile[];
  /** Problems found while parsing (counts that do not match, unknown lines). */
  warnings: string[];
}

const EXT: Record<string, Lang> = {
  ts: 'ts', tsx: 'ts', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'js', mjs: 'js', cjs: 'js',
  html: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'html', svg: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css',
  json: 'json', jsonc: 'json',
  py: 'python', pyi: 'python',
};

export function languageOf(path: string | null | undefined): Lang {
  const ext = (path ?? '').split('/').pop()?.split('.').pop()?.toLowerCase() ?? '';
  return EXT[ext] ?? 'plain';
}

export const isJsLike = (lang: Lang) => lang === 'ts' || lang === 'js';
