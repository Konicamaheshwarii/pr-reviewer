import { Injectable, effect, inject, signal } from '@angular/core';
import { DiffFile } from '../diff/models';
import { parseUnifiedDiff } from '../diff/parser';
import { demoReview } from '../llm/demo.provider';
import { LlmService } from '../llm/llm.service';
import { SettingsStore } from '../settings.store';
import { readJson, writeJson } from '../storage';
import { FileReview, Review, ReviewComment, ReviewSource } from './models';
import { batchHunks, parseReview, reviewRequest } from './prompts';
import { runRules } from './rules';

const HISTORY_KEY = 'rb.history';
const MAX_HISTORY = 25;
const MAX_FILE_LINES = 3000;
const CONCURRENCY = 2;

const GENERATED = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|poetry\.lock|Cargo\.lock|composer\.lock)$|\.min\.(js|css)$|(^|\/)(dist|build|vendor)\//;

/** Decides up front which files are worth reviewing. */
export function initialFileState(file: DiffFile): FileReview {
  if (file.binary) return { state: 'skipped', message: 'Binary file' };
  if (file.status === 'deleted') return { state: 'skipped', message: 'File deleted' };
  if (!file.hunks.length) return { state: 'skipped', message: 'No text changes (rename or mode change only)' };
  if (GENERATED.test(file.path)) return { state: 'skipped', message: 'Generated or lock file' };
  const size = file.hunks.reduce((n, h) => n + h.lines.length, 0);
  if (size > MAX_FILE_LINES) return { state: 'skipped', message: `Too large to review (${size} diff lines)` };
  return { state: 'pending' };
}

function loadHistory(): Review[] {
  // A review that was running when the page closed cannot resume.
  return readJson<Review[]>(HISTORY_KEY, []).map((r) => r.status === 'running'
    ? {
        ...r,
        status: 'interrupted',
        files: Object.fromEntries(Object.entries(r.files).map(([k, f]) =>
          [k, f.state === 'running' || f.state === 'pending' ? { state: 'error', message: 'Interrupted' } : f])),
      }
    : r);
}

@Injectable({ providedIn: 'root' })
export class ReviewStore {
  private readonly llm = inject(LlmService);
  private readonly settings = inject(SettingsStore);
  private readonly controllers = new Map<string, AbortController>();

  private readonly history_ = signal<Review[]>(loadHistory());
  readonly history = this.history_.asReadonly();

  constructor() {
    effect(() => {
      // Drop the oldest reviews until the history fits in localStorage.
      let list = this.history_();
      while (!writeJson(HISTORY_KEY, list) && list.length > 1) list = list.slice(0, -1);
    });
  }

  get(id: string): Review | undefined {
    return this.history_().find((r) => r.id === id);
  }

  /** Creates a review from diff text and starts it. Throws if the text contains no diff. */
  create(diffText: string, title: string, source: ReviewSource): string {
    const { files } = parseUnifiedDiff(diffText);
    if (!files.length) throw new Error('No diff found. Paste a unified diff (the output of git diff), starting with "diff --git" or "---".');
    const review: Review = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      title: title.trim() || defaultTitle(files),
      source,
      reviewer: this.settings.reviewerLabel(),
      diffText,
      status: 'running',
      files: Object.fromEntries(files.map((f) => [f.id, initialFileState(f)])),
      comments: [],
    };
    this.history_.update((h) => [review, ...h].slice(0, MAX_HISTORY));
    void this.run(review.id);
    return review.id;
  }

  /** Re-runs the whole review, or only the files that failed. */
  rerun(id: string, onlyFailed = false): void {
    const review = this.get(id);
    if (!review || review.status === 'running') return;
    const { files } = parseUnifiedDiff(review.diffText);
    const retry = new Set(files.filter((f) => !onlyFailed || review.files[f.id]?.state === 'error').map((f) => f.id));
    const paths = new Set(files.filter((f) => retry.has(f.id)).map((f) => f.path));
    this.patch(id, (r) => ({
      ...r,
      status: 'running',
      reviewer: this.settings.reviewerLabel(),
      comments: r.comments.filter((c) => !paths.has(c.file)),
      files: Object.fromEntries(files.map((f) => [f.id, retry.has(f.id) ? initialFileState(f) : r.files[f.id]])),
    }));
    void this.run(id);
  }

  cancel(id: string): void {
    this.controllers.get(id)?.abort();
  }

  isRunning(id: string): boolean {
    return this.get(id)?.status === 'running';
  }

  setDismissed(id: string, commentId: string, dismissed: boolean): void {
    this.patch(id, (r) => ({ ...r, comments: r.comments.map((c) => (c.id === commentId ? { ...c, dismissed } : c)) }));
  }

  remove(id: string): void {
    this.cancel(id);
    this.history_.update((h) => h.filter((r) => r.id !== id));
  }

  clear(): void {
    this.controllers.forEach((c) => c.abort());
    this.history_.set([]);
  }

  private patch(id: string, fn: (r: Review) => Review): void {
    this.history_.update((h) => h.map((r) => (r.id === id ? fn(r) : r)));
  }

  private patchFile(id: string, fileId: string, state: FileReview, comments: ReviewComment[] = []): void {
    this.patch(id, (r) => ({ ...r, files: { ...r.files, [fileId]: state }, comments: [...r.comments, ...comments] }));
  }

  private async run(id: string): Promise<void> {
    const review = this.get(id);
    if (!review) return;
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const { provider, combineRules } = this.settings.settings();
    const useAi = provider !== 'demo';
    const files = parseUnifiedDiff(review.diffText).files.filter((f) => review.files[f.id]?.state === 'pending');
    const queue = [...files];

    const reviewFile = async (file: DiffFile) => {
      this.patchFile(id, file.id, { state: 'running' });
      try {
        const comments: ReviewComment[] = !useAi || combineRules ? runRules(file) : [];
        const summaries: string[] = useAi ? [] : [demoReview({ file, hunks: file.hunks }).summary];
        let dropped = 0;
        // In Demo mode the rule engine is the reviewer, so no provider call is needed.
        for (const hunks of useAi ? batchHunks(file.hunks) : []) {
          const text = await this.llm.complete(reviewRequest(file, hunks), controller.signal);
          const parsed = parseReview(text, file, hunks);
          comments.push(...parsed.comments);
          if (parsed.summary) summaries.push(parsed.summary);
          dropped += parsed.dropped;
        }
        const unique = comments.map((c) => ({ ...c, id: crypto.randomUUID() }));
        this.patchFile(id, file.id, { state: 'done', summary: summaries.join(' '), dropped }, unique);
      } catch (e) {
        if (controller.signal.aborted) {
          this.patchFile(id, file.id, { state: 'error', message: 'Cancelled' });
        } else {
          this.patchFile(id, file.id, { state: 'error', message: (e as Error).message });
        }
      }
    };

    const worker = async () => {
      for (let file = queue.shift(); file && !controller.signal.aborted; file = queue.shift()) await reviewFile(file);
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length || 1) }, worker));

    this.controllers.delete(id);
    this.patch(id, (r) => ({
      ...r,
      status: controller.signal.aborted ? 'cancelled' : 'done',
      files: Object.fromEntries(Object.entries(r.files).map(([k, f]) =>
        [k, f.state === 'pending' ? { state: 'error', message: 'Cancelled' } : f])),
    }));
  }
}

export function defaultTitle(files: DiffFile[]): string {
  const first = files[0]?.path.split('/').pop() ?? 'diff';
  return files.length > 1 ? `${first} and ${files.length - 1} more file${files.length === 2 ? '' : 's'}` : first;
}
