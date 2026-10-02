import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PROVIDERS, SettingsStore } from './core/settings.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="skip" href="#main">Skip to content</a>
    <header class="top">
      <a routerLink="/" class="brand" aria-label="ReviewBot home">
        <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
          <rect width="32" height="32" rx="8" />
          <path d="M11 10l-5 6 5 6M21 10l5 6-5 6" />
          <circle cx="16" cy="16" r="2.4" />
        </svg>
        ReviewBot
      </a>
      <nav aria-label="Main">
        <a routerLink="/" routerLinkActive="active" [routerLinkActiveOptions]="{ exact: true }">New</a>
        <a routerLink="/history" routerLinkActive="active">History</a>
        <a routerLink="/rules" routerLinkActive="active">Rules</a>
        <a routerLink="/settings" routerLinkActive="active">Settings</a>
      </nav>
      <a routerLink="/settings" class="chip provider" [title]="'Reviewer: ' + providerLabel()">{{ providerLabel() }}</a>
    </header>
    <main id="main" tabindex="-1"><router-outlet /></main>
  `,
  styleUrl: './app.scss',
})
export class App {
  private readonly settings = inject(SettingsStore);
  protected readonly providerLabel = computed(
    () => PROVIDERS.find((p) => p.id === this.settings.provider())?.label.split(' (')[0] ?? '');
}
