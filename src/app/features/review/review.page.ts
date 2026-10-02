import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { parseUnifiedDiff } from '../../core/diff/parser';
import { reviewMarkdown } from '../../core/review/markdown';
import { CATEGORIES, Category, ReviewComment, SEVERITIES, SEVERITY_LABEL, Severity, countBy } from '../../core/review/models';
import { ReviewStore } from '../../core/review/review.store';
import { DiffView, SettingsStore } from '../../core/settings.store';
import { DiffFileComponent } from '../../shared/diff-file.component';

const LARGE_FILE = 800;

@Component({
  selector: 'app-review',
  imports: [RouterLink, DiffFileComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './review.page.html',
  styleUrl: './review.page.scss',
})
export class ReviewPage {
  readonly id = input.required<string>();

  private readonly store = inject(ReviewStore);
  private readonly router = inject(Router);
  protected readonly settings = inject(SettingsStore);

  protected readonly severities = SEVERITIES;
  protected readonly categories = CATEGORIES;
  protected readonly severityLabel = SEVERITY_LABEL;

  protected readonly review = computed(() => this.store.history().find((r) => r.id === this.id()));
  /** Only re-parse when the diff text itself changes, not on every comment update. */
  private readonly diffText = computed(() => this.review()?.diffText ?? '');
  protected readonly files = computed(() => parseUnifiedDiff(this.diffText()).files);

  // ---- filters ----
  protected readonly severityOn = signal<Record<Severity, boolean>>({ blocker: true, warning: true, suggestion: true, praise: true });
  protected readonly category = signal<Category | 'all'>('all');
  protected readonly source = signal<'all' | 'ai' | 'rule'>('all');
  protected readonly showDismissed = signal(false);
  protected readonly onlyCommented = signal(false);

  private readonly active = computed(() => (this.review()?.comments ?? []).filter((c) => !c.dismissed));
  protected readonly counts = computed(() => countBy(this.active(), (c) => c.severity, SEVERITIES));
  protected readonly categoryCounts = computed(() => countBy(this.active(), (c) => c.category, CATEGORIES));
  protected readonly dismissedCount = computed(() => (this.review()?.comments.length ?? 0) - this.active().length);
  protected readonly hasAi = computed(() => this.review()?.comments.some((c) => c.source === 'ai') ?? false);

  protected readonly visibleComments = computed(() => {
    const on = this.severityOn();
    const cat = this.category();
    const src = this.source();
    const dismissed = this.showDismissed();
    return (this.review()?.comments ?? []).filter((c) =>
      on[c.severity] && (cat === 'all' || c.category === cat) && (src === 'all' || c.source === src) && (dismissed || !c.dismissed));
  });

  protected readonly byFile = computed(() => {
    const map = new Map<string, ReviewComment[]>();
    for (const c of this.visibleComments()) map.set(c.file, [...(map.get(c.file) ?? []), c]);
    return map;
  });

  protected readonly visibleFiles = computed(() =>
    this.onlyCommented() ? this.files().filter((f) => this.byFile().has(f.path)) : this.files());

  protected readonly totals = computed(() => ({
    additions: this.files().reduce((n, f) => n + f.additions, 0),
    deletions: this.files().reduce((n, f) => n + f.deletions, 0),
  }));

  protected readonly progress = computed(() => {
    const states = Object.values(this.review()?.files ?? {});
    const reviewable = states.filter((s) => s.state !== 'skipped');
    const finished = reviewable.filter((s) => s.state === 'done' || s.state === 'error');
    return {
      done: finished.length,
      total: reviewable.length,
      failed: states.filter((s) => s.state === 'error').length,
    };
  });

  protected readonly verdict = computed(() => {
    const c = this.counts();
    if (this.review()?.status === 'running') return null;
    if (c.blocker) return { tone: 'bad', text: `Changes requested: ${c.blocker} blocker${c.blocker === 1 ? '' : 's'} must be fixed before merging.` };
    if (c.warning) return { tone: 'warn', text: `Approve after addressing ${c.warning} warning${c.warning === 1 ? '' : 's'}.` };
    return { tone: 'good', text: 'Looks good to merge.' };
  });

  // ---- view ----
  private readonly narrow = signal(false);
  protected readonly view = computed<DiffView>(() => (this.narrow() ? 'unified' : this.settings.settings().diffView));
  protected readonly isNarrow = this.narrow.asReadonly();
  private readonly collapsedOverrides = signal<Record<string, boolean>>({});
  protected readonly copied = signal(false);

  constructor() {
    const mq = window.matchMedia('(max-width: 760px)');
    this.narrow.set(mq.matches);
    const onChange = (e: MediaQueryListEvent) => this.narrow.set(e.matches);
    mq.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => mq.removeEventListener('change', onChange));
  }

  /** Very large files start collapsed so the page stays fast; the user's choice wins after that. */
  protected readonly collapsed = computed(() => {
    const overrides = this.collapsedOverrides();
    return Object.fromEntries(this.files().map((f) =>
      [f.id, overrides[f.id] ?? f.hunks.reduce((n, h) => n + h.lines.length, 0) > LARGE_FILE]));
  });

  protected setCollapsed(fileId: string, value: boolean): void {
    this.collapsedOverrides.update((m) => ({ ...m, [fileId]: value }));
  }

  protected setAll(collapsed: boolean): void {
    this.collapsedOverrides.set(Object.fromEntries(this.files().map((f) => [f.id, collapsed])));
  }

  protected toggleSeverity(s: Severity): void {
    this.severityOn.update((m) => ({ ...m, [s]: !m[s] }));
  }

  protected setView(view: DiffView): void {
    this.settings.update({ diffView: view });
  }

  protected jumpTo(fileId: string): void {
    this.setCollapsed(fileId, false);
    requestAnimationFrame(() => document.getElementById('file-' + this.anchor(fileId))?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  protected anchor(fileId: string): string {
    return fileId.replace(/[^\w-]/g, '_');
  }

  protected dismiss(e: { id: string; dismissed: boolean }): void {
    this.store.setDismissed(this.id(), e.id, e.dismissed);
  }

  protected cancel(): void {
    this.store.cancel(this.id());
  }

  protected rerun(onlyFailed = false): void {
    this.store.rerun(this.id(), onlyFailed);
  }

  protected remove(): void {
    if (!confirm('Delete this review from history?')) return;
    this.store.remove(this.id());
    void this.router.navigate(['/history']);
  }

  private markdown(): string {
    const r = this.review();
    return r ? reviewMarkdown(r, this.files()) : '';
  }

  protected async copyMarkdown(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.markdown());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      this.downloadMarkdown();
    }
  }

  protected downloadMarkdown(): void {
    const r = this.review();
    if (!r) return;
    const blob = new Blob([this.markdown()], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `review-${r.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'diff'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
}
