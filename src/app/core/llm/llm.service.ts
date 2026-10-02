import { Injectable, computed, inject } from '@angular/core';
import { SettingsStore } from '../settings.store';
import { DemoProvider } from './demo.provider';
import { GeminiProvider } from './gemini.provider';
import { GroqProvider } from './groq.provider';
import { LlmProvider, LlmRequest } from './llm-provider';

/** Routes requests to the provider chosen in Settings. */
@Injectable({ providedIn: 'root' })
export class LlmService {
  private readonly settings = inject(SettingsStore);

  private readonly provider = computed<LlmProvider>(() => {
    const s = this.settings.settings();
    switch (s.provider) {
      case 'gemini': return new GeminiProvider(s.apiKeys.gemini?.trim() ?? '', s.models.gemini);
      case 'groq': return new GroqProvider(s.apiKeys.groq?.trim() ?? '', s.models.groq);
      default: return new DemoProvider();
    }
  });

  complete(req: LlmRequest, signal?: AbortSignal): Promise<string> {
    return this.provider().complete(req, signal);
  }

  stream(req: LlmRequest, signal?: AbortSignal): AsyncIterable<string> {
    return this.provider().stream(req, signal);
  }
}
