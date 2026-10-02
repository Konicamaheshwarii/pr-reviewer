import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SEVERITIES, SEVERITY_LABEL, countBy } from '../../core/review/models';
import { ReviewStore } from '../../core/review/review.store';

@Component({
  selector: 'app-history',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row">
      <h1>Review history</h1>
      <span class="spacer"></span>
      @if (rows().length) { <button class="btn danger sm" type="button" (click)="clear()">Clear all</button> }
    </div>
    <p class="muted">Saved in this browser only (the last 25 reviews).</p>

    @for (r of rows(); track r.id) {
      <article class="card item">
        <a [routerLink]="['/review', r.id]" class="name">{{ r.title }}</a>
        <p class="muted small meta">
          {{ r.when }} · {{ r.reviewer }} · {{ r.fileCount }} file{{ r.fileCount === 1 ? '' : 's' }}
          @if (r.status !== 'done') { · <span class="status">{{ r.status }}</span> }
        </p>
        <div class="row counts">
          @for (s of severities; track s) {
            @if (r.counts[s]) { <span class="sev {{ s }}">{{ r.counts[s] }} {{ label[s] }}</span> }
          }
          @if (!r.total && r.status === 'done') { <span class="muted small">No comments</span> }
          <span class="spacer"></span>
          <button class="btn sm danger" type="button" (click)="store.remove(r.id)" [attr.aria-label]="'Delete review ' + r.title">Delete</button>
        </div>
      </article>
    } @empty {
      <section class="card empty">
        <p>No reviews yet.</p>
        <a class="btn primary" routerLink="/">Review a diff</a>
      </section>
    }
  `,
  styles: `
    :host { display: grid; gap: 0.75rem; padding-top: 0.75rem; max-width: 860px; }
    h1 { margin: 0; }
    :host > p { margin: -0.5rem 0 0; }
    .item { display: grid; gap: 0.3rem; padding: 0.9rem 1.1rem; }
    .name { font-weight: 700; color: var(--text); text-decoration: none; overflow-wrap: anywhere; }
    .name:hover { color: var(--accent); }
    .meta { margin: 0; }
    .status { color: var(--warn); }
    .counts { gap: 0.4rem; }
  `,
})
export class HistoryPage {
  protected readonly store = inject(ReviewStore);
  protected readonly severities = SEVERITIES;
  protected readonly label = SEVERITY_LABEL;

  protected readonly rows = computed(() => this.store.history().map((r) => {
    const active = r.comments.filter((c) => !c.dismissed);
    return {
      id: r.id,
      title: r.title,
      reviewer: r.reviewer,
      status: r.status,
      when: new Date(r.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
      fileCount: Object.keys(r.files).length,
      counts: countBy(active, (c) => c.severity, SEVERITIES),
      total: active.length,
    };
  }));

  protected clear(): void {
    if (confirm('Delete every saved review?')) this.store.clear();
  }
}
