import { LlmProvider, LlmRequest, readSse, toLlmError } from './llm-provider';

const URL = 'https://api.groq.com/openai/v1/chat/completions';

/** Groq speaks the OpenAI chat-completions format. */
export class GroqProvider implements LlmProvider {
  constructor(private readonly apiKey: string, private readonly model: string) {}

  private request(req: LlmRequest, stream: boolean, signal?: AbortSignal) {
    return fetch(URL, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        stream,
        temperature: req.json ? 0.4 : 0.7,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.prompt },
        ],
        ...(req.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  }

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<string> {
    const res = await this.request(req, false, signal);
    if (!res.ok) throw await toLlmError(res, 'Groq');
    const body = await res.json();
    return body?.choices?.[0]?.message?.content ?? '';
  }

  async *stream(req: LlmRequest, signal?: AbortSignal): AsyncIterable<string> {
    const res = await this.request(req, true, signal);
    if (!res.ok) throw await toLlmError(res, 'Groq');
    for await (const data of readSse(res)) {
      if (data === '[DONE]') return;
      const text = JSON.parse(data)?.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
