import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DiffFile } from '../core/diff/models';
import { ReviewComment, SEVERITY_LABEL } from '../core/review/models';
import { InlineCodePipe } from './inline-code.pipe';

/** The review comments attached to one diff line. */
@Component({
  selector: 'app-comment-thread',
  imports: [InlineCodePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (c of comments(); track c.id) {
      <article class="comment {{ c.severity }}" [class.dismissed]="c.dismissed"
               [attr.aria-label]="label[c.severity] + ' on line ' + c.line + ': ' + c.title">
        <div class="c-head">
          <span class="sev {{ c.severity }}">{{ label[c.severity] }}</span>
          <span class="cat">{{ c.category }}</span>
          <strong class="c-title">@for (p of c.title | inlineCode; track $index) {@if (p.code) {<code>{{ p.text }}</code>} @else {<ng-container>{{ p.text }}</ng-container>}}</strong>
          <span class="src" [title]="c.ruleId ? 'Rule: ' + c.ruleId : 'AI reviewer'">{{ c.source === 'rule' ? c.ruleId : 'AI' }}</span>
          <button type="button" class="btn sm" (click)="dismiss.emit({ id: c.id, dismissed: !c.dismissed })"
                  [attr.aria-label]="(c.dismissed ? 'Restore' : 'Dismiss') + ' comment: ' + c.title">
            {{ c.dismissed ? 'Restore' : 'Dismiss' }}
          </button>
        </div>
        @if (!c.dismissed) {
          @if (c.body) {
            <p class="c-body">@for (p of c.body | inlineCode; track $index) {@if (p.code) {<code>{{ p.text }}</code>} @else {<ng-container>{{ p.text }}</ng-container>}}</p>
          }
          @if (c.suggestion !== undefined) {
            <div class="suggest">
              <div class="s-label">Suggested change</div>
              @if (c.side === 'new') { <pre class="s-del"><span aria-hidden="true">- </span>{{ original(c) }}</pre> }
              <pre class="s-add"><span aria-hidden="true">+ </span>{{ c.suggestion }}</pre>
            </div>
          }
        }
      </article>
    }
  `,
  styles: `
    :host { display: grid; gap: 0.4rem; font: 0.88rem/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; white-space: normal; }
    .comment {
      border: 1px solid var(--border); border-left: 4px solid var(--c, var(--accent)); border-radius: 8px;
      background: var(--surface); padding: 0.55rem 0.75rem;
      &.blocker { --c: var(--sev-blocker); }
      &.warning { --c: var(--sev-warning); }
      &.suggestion { --c: var(--sev-suggestion); }
      &.praise { --c: var(--sev-praise); }
      &.dismissed { opacity: 0.65; padding-block: 0.3rem; }
    }
    .c-head { display: flex; align-items: center; gap: 0.4rem 0.5rem; flex-wrap: wrap; }
    .cat { font-size: 0.78rem; color: var(--muted); }
    .c-title { flex: 1 1 12rem; overflow-wrap: anywhere; }
    .src { font: 0.72rem var(--mono); color: var(--muted); }
    .c-body { margin: 0.35rem 0 0; overflow-wrap: anywhere; }
    code { background: var(--surface-2); padding: 0 0.25em; border-radius: 4px; }
    .suggest { margin-top: 0.5rem; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
    .s-label { font-size: 0.75rem; font-weight: 700; padding: 0.2rem 0.6rem; background: var(--surface-2); color: var(--muted); }
    pre { margin: 0; padding: 0.15rem 0.6rem; font: 0.8rem/1.5 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; }
    .s-del { background: var(--del-bg); }
    .s-add { background: var(--add-bg); }
  `,
})
export class CommentThreadComponent {
  readonly comments = input.required<ReviewComment[]>();
  readonly file = input.required<DiffFile>();
  readonly dismiss = output<{ id: string; dismissed: boolean }>();
  protected readonly label = SEVERITY_LABEL;

  protected original(c: ReviewComment): string {
    for (const h of this.file().hunks) for (const l of h.lines) if (l.newLine === c.line) return l.content;
    return '';
  }
}
