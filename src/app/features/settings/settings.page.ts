import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LlmService } from '../../core/llm/llm.service';
import { PROVIDERS, ProviderId, RealProvider, SettingsStore, Theme } from '../../core/settings.store';

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './settings.page.html',
  styleUrl: './settings.page.scss',
})
export class SettingsPage {
  protected readonly store = inject(SettingsStore);
  private readonly llm = inject(LlmService);

  protected readonly providers = PROVIDERS;
  protected readonly themes: Theme[] = ['system', 'light', 'dark'];
  protected readonly current = computed(() => PROVIDERS.find((p) => p.id === this.store.provider())!);
  protected readonly real = computed(() => (this.store.isDemo() ? null : (this.store.provider() as RealProvider)));

  protected readonly test = signal<{ state: 'idle' | 'running' | 'ok' | 'fail'; message?: string }>({ state: 'idle' });

  protected choose(id: ProviderId): void {
    this.store.update({ provider: id });
    this.test.set({ state: 'idle' });
  }

  protected setKey(value: string): void {
    this.store.setKey(this.real()!, value.trim());
    this.test.set({ state: 'idle' });
  }

  protected setModel(value: string): void {
    if (value.trim()) this.store.setModel(this.real()!, value.trim());
  }

  protected async testConnection(): Promise<void> {
    this.test.set({ state: 'running' });
    try {
      const reply = await this.llm.complete({
        task: 'ping',
        json: true,
        system: 'You are a health check.',
        prompt: 'Reply with JSON only: {"ok":true}',
      });
      this.test.set({ state: 'ok', message: reply ? 'Connected. The provider answered.' : 'Connected, but the reply was empty.' });
    } catch (e) {
      this.test.set({ state: 'fail', message: (e as Error).message });
    }
  }

  protected clearKey(): void {
    this.store.setKey(this.real()!, '');
  }
}
