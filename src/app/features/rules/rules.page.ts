import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SEVERITY_LABEL } from '../../core/review/models';
import { RULES } from '../../core/review/rules';
import { InlineCodePipe } from '../../shared/inline-code.pipe';

const LANG_LABEL: Record<string, string> = { ts: 'TypeScript', js: 'JavaScript', html: 'HTML', python: 'Python' };

@Component({
  selector: 'app-rules',
  imports: [RouterLink, InlineCodePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Static rules</h1>
    <p class="muted intro">
      These {{ rules.length }} checks run on the added lines of every file, entirely in your browser. In Demo mode they are the reviewer;
      with an AI provider they run alongside it (you can turn that off in <a routerLink="/settings">Settings</a>).
      Strings and comments are masked before matching, so <code>"=="</code> inside a string is not flagged.
    </p>
    <div class="grid">
      @for (r of rows; track r.id) {
        <article class="card rule">
          <div class="row">
            <span class="sev {{ r.severity }}">{{ label[r.severity] }}</span>
            <span class="muted small">{{ r.category }}</span>
            <span class="spacer"></span>
            <code class="id">{{ r.id }}</code>
          </div>
          <h2>@for (p of r.title | inlineCode; track $index) {@if (p.code) {<code>{{ p.text }}</code>} @else {<ng-container>{{ p.text }}</ng-container>}}</h2>
          <p class="muted small">{{ r.name }} · {{ r.langs }}</p>
          @if (r.body) { <p class="small body">@for (p of r.body | inlineCode; track $index) {@if (p.code) {<code>{{ p.text }}</code>} @else {<ng-container>{{ p.text }}</ng-container>}}</p> }
        </article>
      }
    </div>
  `,
  styles: `
    :host { display: grid; gap: 0.75rem; padding-top: 0.75rem; }
    h1 { margin: 0; }
    .intro { max-width: 70ch; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 0.75rem; }
    .rule { display: grid; gap: 0.35rem; align-content: start; padding: 1rem; }
    .rule h2 { font-size: 1rem; margin: 0.2rem 0 0; }
    .rule p { margin: 0; }
    .id { font-size: 0.75rem; color: var(--muted); }
    .body code, h2 code { background: var(--surface-2); padding: 0 0.25em; border-radius: 4px; }
  `,
})
export class RulesPage {
  protected readonly rules = RULES;
  protected readonly label = SEVERITY_LABEL;
  protected readonly rows = RULES.map((r) => ({
    ...r,
    langs: r.langs ? r.langs.map((l) => LANG_LABEL[l] ?? l).join(', ') : 'All text files',
    body: r.body || DYNAMIC_BODY[r.id] || '',
  }));
}

const DYNAMIC_BODY: Record<string, string> = {
  'long-function': 'Flags new functions whose whole body is visible in the diff and is longer than the limit. Long functions usually do several things.',
  'magic-number': 'Flags unexplained numbers in comparisons, arithmetic and timer calls. Constants such as `MAX_RETRIES = 3` are allowed.',
  'tests-added': 'Leaves one praise comment when a test file gains new test cases.',
};
