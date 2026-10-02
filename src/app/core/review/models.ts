export const SEVERITIES = ['blocker', 'warning', 'suggestion', 'praise'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ['bug', 'security', 'performance', 'readability', 'testing', 'style'] as const;
export type Category = (typeof CATEGORIES)[number];

export type Side = 'new' | 'old';

export interface ReviewComment {
  id: string;
  /** Path of the file the comment belongs to (DiffFile.path). */
  file: string;
  line: number;
  /** "new" = line number in the new file (added or context lines), "old" = a removed line. */
  side: Side;
  severity: Severity;
  category: Category;
  title: string;
  body: string;
  /** Replacement code for the line, rendered as a GitHub suggestion block. */
  suggestion?: string;
  source: 'ai' | 'rule';
  ruleId?: string;
  dismissed?: boolean;
}

export type FileState = 'pending' | 'running' | 'done' | 'skipped' | 'error';

export interface FileReview {
  state: FileState;
  summary?: string;
  /** Why the file was skipped or failed. */
  message?: string;
  /** Comments the model returned that pointed at lines outside the diff, or were malformed. */
  dropped?: number;
}

export type ReviewSource =
  | { kind: 'paste' }
  | { kind: 'github'; url: string; owner: string; repo: string; number: number }
  | { kind: 'compare'; fileName: string };

export interface Review {
  id: string;
  createdAt: string;
  title: string;
  source: ReviewSource;
  /** Provider label at the time of the run, e.g. "Demo rules" or "Gemini (gemini-2.5-flash)". */
  reviewer: string;
  diffText: string;
  status: 'running' | 'done' | 'cancelled' | 'interrupted';
  files: Record<string, FileReview>;
  comments: ReviewComment[];
}

export const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  warning: 'Warning',
  suggestion: 'Suggestion',
  praise: 'Praise',
};

export function countBy<K extends string>(comments: ReviewComment[], key: (c: ReviewComment) => K, keys: readonly K[]): Record<K, number> {
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  for (const c of comments) out[key(c)]++;
  return out;
}

export const severityRank = (s: Severity) => SEVERITIES.indexOf(s);
