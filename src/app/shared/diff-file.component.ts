import { ChangeDetectionStrategy, Component, computed, input, model, output } from '@angular/core';
import { DiffFile, DiffLine } from '../core/diff/models';
import { Token, tokenize } from '../core/diff/tokenizer';
import { FileReview, ReviewComment, severityRank } from '../core/review/models';
import { DiffView } from '../core/settings.store';
import { CommentThreadComponent } from './comment-thread.component';

interface HunkRow { kind: 'hunk'; key: string; header: string }
interface LineRow { kind: 'line'; key: string; line: DiffLine; tokens: Token[]; comments: ReviewComment[] }
interface PairRow {
  kind: 'pair';
  key: string;
  left: DiffLine | null;
  right: DiffLine | null;
  leftTokens: Token[];
  rightTokens: Token[];
  comments: ReviewComment[];
}
type UnifiedRow = HunkRow | LineRow;
type SplitRow = HunkRow | PairRow;

/** Pairs removed and added lines side by side, the way split diff views do. */
export function pairLines(lines: DiffLine[]): { left: DiffLine | null; right: DiffLine | null }[] {
  const out: { left: DiffLine | null; right: DiffLine | null }[] = [];
  let dels: DiffLine[] = [];
  let adds: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(dels.length, adds.length); i++) out.push({ left: dels[i] ?? null, right: adds[i] ?? null });
    dels = [];
    adds = [];
  };
  for (const l of lines) {
    if (l.type === 'del') {
      if (adds.length) flush();
      dels.push(l);
    } else if (l.type === 'add') adds.push(l);
    else {
      flush();
      out.push({ left: l, right: l });
    }
  }
  flush();
  return out;
}

@Component({
  selector: 'app-diff-file',
  imports: [CommentThreadComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './diff-file.component.html',
  styleUrl: './diff-file.component.scss',
})
export class DiffFileComponent {
  readonly file = input.required<DiffFile>();
  readonly comments = input<ReviewComment[]>([]);
  readonly view = input<DiffView>('unified');
  readonly state = input<FileReview | undefined>(undefined);
  readonly collapsed = model(false);
  readonly dismiss = output<{ id: string; dismissed: boolean }>();

  private readonly tokens = computed(() => {
    const f = this.file();
    const map = new Map<DiffLine, Token[]>();
    for (const h of f.hunks) for (const l of h.lines) map.set(l, tokenize(l.content, f.language));
    return map;
  });

  private readonly commentIndex = computed(() => {
    const map = new Map<string, ReviewComment[]>();
    const sorted = [...this.comments()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    for (const c of sorted) {
      const key = `${c.side}:${c.line}`;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return map;
  });

  private commentsFor(line: DiffLine | null): ReviewComment[] {
    if (!line) return [];
    const idx = this.commentIndex();
    return [
      ...(line.newLine !== null ? idx.get(`new:${line.newLine}`) ?? [] : []),
      ...(line.oldLine !== null && line.type !== 'add' ? idx.get(`old:${line.oldLine}`) ?? [] : []),
    ];
  }

  protected readonly unifiedRows = computed<UnifiedRow[]>(() => {
    const tokens = this.tokens();
    const rows: UnifiedRow[] = [];
    this.file().hunks.forEach((h, hi) => {
      rows.push({ kind: 'hunk', key: `h${hi}`, header: h.header });
      h.lines.forEach((line, li) =>
        rows.push({ kind: 'line', key: `${hi}:${li}`, line, tokens: tokens.get(line) ?? [], comments: this.commentsFor(line) }));
    });
    return rows;
  });

  protected readonly splitRows = computed<SplitRow[]>(() => {
    const tokens = this.tokens();
    const rows: SplitRow[] = [];
    this.file().hunks.forEach((h, hi) => {
      rows.push({ kind: 'hunk', key: `h${hi}`, header: h.header });
      pairLines(h.lines).forEach(({ left, right }, pi) => {
        const comments = left === right ? this.commentsFor(left) : [...this.commentsFor(left), ...this.commentsFor(right)];
        rows.push({
          kind: 'pair', key: `${hi}:${pi}`, left, right,
          leftTokens: left ? tokens.get(left) ?? [] : [],
          rightTokens: right ? tokens.get(right) ?? [] : [],
          comments,
        });
      });
    });
    return rows;
  });

  protected readonly openCount = computed(() => this.comments().filter((c) => !c.dismissed).length);
  protected readonly bodyId = computed(() => 'diff-' + this.file().id.replace(/[^\w-]/g, '_'));

  protected toggle(): void {
    this.collapsed.update((c) => !c);
  }

  protected sign(line: DiffLine): string {
    return line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' ';
  }

}
