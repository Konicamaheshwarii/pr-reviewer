import { Injectable, computed, effect, signal } from '@angular/core';
import { readJson, writeJson } from './storage';

export type ProviderId = 'demo' | 'gemini' | 'groq';
export type RealProvider = Exclude<ProviderId, 'demo'>;
export type Theme = 'system' | 'light' | 'dark';
export type DiffView = 'unified' | 'split';

export interface Settings {
  provider: ProviderId;
  theme: Theme;
  apiKeys: Partial<Record<RealProvider, string>>;
  models: Record<RealProvider, string>;
  /** Optional GitHub token, only used to raise the API rate limit when fetching pull requests. */
  githubToken: string;
  /** With an AI provider, also run the built-in static rules. */
  combineRules: boolean;
  diffView: DiffView;
}

export const PROVIDERS: { id: ProviderId; label: string; keyUrl?: string }[] = [
  { id: 'demo', label: 'Demo rules (no key, offline)' },
  { id: 'gemini', label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq', keyUrl: 'https://console.groq.com/keys' },
];

export const DEFAULT_SETTINGS: Settings = {
  provider: 'demo',
  theme: 'system',
  apiKeys: {},
  models: { gemini: 'gemini-2.5-flash', groq: 'llama-3.3-70b-versatile' },
  githubToken: '',
  combineRules: true,
  diffView: 'unified',
};

const KEY = 'rb.settings';

function load(): Settings {
  const saved = readJson<Partial<Settings>>(KEY, {});
  return { ...DEFAULT_SETTINGS, ...saved, models: { ...DEFAULT_SETTINGS.models, ...saved.models } };
}

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly state = signal<Settings>(load());

  readonly settings = this.state.asReadonly();
  readonly provider = computed(() => this.state().provider);
  readonly isDemo = computed(() => this.state().provider === 'demo');
  /** A real provider is selected but has no key yet. */
  readonly needsKey = computed(() => {
    const s = this.state();
    return s.provider !== 'demo' && !s.apiKeys[s.provider]?.trim();
  });
  /** Human-readable name of the reviewer, stored with each review. */
  readonly reviewerLabel = computed(() => {
    const s = this.state();
    if (s.provider === 'demo') return 'Demo rules';
    const name = s.provider === 'gemini' ? 'Gemini' : 'Groq';
    return `${name} (${s.models[s.provider]})${s.combineRules ? ' + rules' : ''}`;
  });

  constructor() {
    effect(() => writeJson(KEY, this.state()));
    effect(() => {
      const theme = this.state().theme;
      if (theme === 'system') document.documentElement.removeAttribute('data-theme');
      else document.documentElement.setAttribute('data-theme', theme);
    });
  }

  update(patch: Partial<Settings>): void {
    this.state.update((s) => ({ ...s, ...patch }));
  }

  setKey(provider: RealProvider, key: string): void {
    this.state.update((s) => ({ ...s, apiKeys: { ...s.apiKeys, [provider]: key } }));
  }

  setModel(provider: RealProvider, model: string): void {
    this.state.update((s) => ({ ...s, models: { ...s.models, [provider]: model } }));
  }
}
