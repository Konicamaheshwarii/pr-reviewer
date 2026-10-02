import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', title: 'ReviewBot', loadComponent: () => import('./features/new/new-review.page').then((m) => m.NewReviewPage) },
  { path: 'review/:id', title: 'Review · ReviewBot', loadComponent: () => import('./features/review/review.page').then((m) => m.ReviewPage) },
  { path: 'history', title: 'History · ReviewBot', loadComponent: () => import('./features/history/history.page').then((m) => m.HistoryPage) },
  { path: 'rules', title: 'Rules · ReviewBot', loadComponent: () => import('./features/rules/rules.page').then((m) => m.RulesPage) },
  { path: 'settings', title: 'Settings · ReviewBot', loadComponent: () => import('./features/settings/settings.page').then((m) => m.SettingsPage) },
  { path: '**', redirectTo: '' },
];
