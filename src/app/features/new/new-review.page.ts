import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { createUnifiedDiff } from '../../core/diff/generator';
import { languageOf } from '../../core/diff/models';
import { parseUnifiedDiff } from '../../core/diff/parser';
import { fetchPullDiff, parsePullUrl } from '../../core/github';
import { ReviewStore } from '../../core/review/review.store';
import { RULES } from '../../core/review/rules';
import { SAMPLES, SampleDiff } from '../../core/samples';
import { SettingsStore } from '../../core/settings.store';

type Mode = 'paste' | 'github' | 'compare';

const COMPARE_OLD = `function total(items) {
  var sum = 0;
  for (var i = 0; i < items.length; i++) {
    sum += items[i].price;
  }
  return sum;
}
`;
const COMPARE_NEW = `export function total(items: any[]): number {
  console.log('total', items.length);
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function hasDiscount(total: number) {
  return total > 150;
}
`;

@Component({
  selector: 'app-new-review',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './new-review.page.html',
  styleUrl: './new-review.page.scss',
})
export class NewReviewPage {
  private readonly store = inject(ReviewStore);
  private readonly router = inject(Router);
  protected readonly settings = inject(SettingsStore);

  protected readonly samples = SAMPLES;
  protected readonly ruleCount = RULES.length;
  protected readonly modes: { id: Mode; label: string }[] = [
    { id: 'paste', label: 'Paste a diff' },
    { id: 'github', label: 'GitHub PR' },
    { id: 'compare', label: 'Compare snippets' },
  ];
  protected readonly mode = signal<Mode>('paste');
  protected readonly diffText = signal('');
  protected readonly title = signal('');
  protected readonly prUrl = signal('');
  protected readonly oldText = signal(COMPARE_OLD);
  protected readonly newText = signal(COMPARE_NEW);
  protected readonly fileName = signal('cart.ts');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  private abort?: AbortController;

  protected readonly preview = computed(() => {
    const text = this.diffText();
    if (!text.trim()) return null;
    const { files, warnings } = parseUnifiedDiff(text);
    return {
      files: files.length,
      additions: files.reduce((n, f) => n + f.additions, 0),
      deletions: files.reduce((n, f) => n + f.deletions, 0),
      warnings,
    };
  });

  protected readonly prRef = computed(() => parsePullUrl(this.prUrl()));
  protected readonly compareLang = computed(() => languageOf(this.fileName()));

  protected readonly canStart = computed(() => {
    if (this.busy() || this.settings.needsKey()) return false;
    switch (this.mode()) {
      case 'paste': return (this.preview()?.files ?? 0) > 0;
      case 'github': return !!this.prRef();
      case 'compare': return !!(this.oldText() || this.newText());
    }
  });

  protected setMode(mode: Mode): void {
    this.mode.set(mode);
    this.error.set(null);
  }

  /** Arrow-key navigation between tabs, as the ARIA tabs pattern expects. */
  protected onTabKey(event: KeyboardEvent, index: number): void {
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (index + delta + this.modes.length) % this.modes.length;
    this.setMode(this.modes[next].id);
    document.getElementById('tab-' + this.modes[next].id)?.focus();
  }

  protected loadSample(sample: SampleDiff): void {
    this.setMode('paste');
    this.diffText.set(sample.diff);
    this.title.set(sample.title);
  }

  protected async openFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.diffText.set(await file.text());
    if (!this.title()) this.title.set(file.name.replace(/\.(diff|patch|txt)$/i, ''));
    input.value = '';
  }

  protected async start(): Promise<void> {
    if (!this.canStart()) return;
    this.error.set(null);
    this.busy.set(true);
    this.abort?.abort();
    this.abort = new AbortController();
    try {
      let id: string;
      switch (this.mode()) {
        case 'paste':
          id = this.store.create(this.diffText(), this.title(), { kind: 'paste' });
          break;
        case 'github': {
          const ref = this.prRef()!;
          const pr = await fetchPullDiff(ref, this.settings.settings().githubToken, this.abort.signal);
          if (!pr.diff.trim()) throw new Error('This pull request has no changes.');
          id = this.store.create(pr.diff, this.title() || pr.title, {
            kind: 'github', url: `https://github.com/${ref.owner}/${ref.repo}/pull/${ref.number}`, ...ref,
          });
          break;
        }
        case 'compare': {
          const name = this.fileName().trim() || 'snippet.txt';
          const diff = createUnifiedDiff(this.oldText(), this.newText(), { oldPath: name });
          if (!diff) throw new Error('The two snippets are identical, so there is nothing to review.');
          id = this.store.create(diff, this.title() || `Snippet comparison: ${name}`, { kind: 'compare', fileName: name });
          break;
        }
      }
      await this.router.navigate(['/review', id]);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
