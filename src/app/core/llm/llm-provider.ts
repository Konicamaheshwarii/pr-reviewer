export type LlmTask = 'review' | 'ping';

export interface LlmRequest {
  task: LlmTask;
  system: string;
  prompt: string;
  /** Ask the model for a single JSON object. */
  json?: boolean;
  /** The structured data the prompt was built from (used by the offline demo provider). */
  input?: unknown;
}

export interface LlmProvider {
  complete(req: LlmRequest, signal?: AbortSignal): Promise<string>;
  stream(req: LlmRequest, signal?: AbortSignal): AsyncIterable<string>;
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

/** Turns a provider error response into a message a user can act on. */
export async function toLlmError(res: Response, provider: string): Promise<LlmError> {
  let detail = '';
  try {
    const body = await res.json();
    detail = body?.error?.message ?? '';
  } catch {
    // body was not JSON
  }
  const hint =
    res.status === 401 || res.status === 403 ? 'Check your API key in Settings.'
    : res.status === 429 ? 'Rate limit reached. Wait a minute and try again.'
    : '';
  return new LlmError([`${provider} error ${res.status}.`, hint, detail].filter(Boolean).join(' '), res.status);
}

/** Yields the `data:` payloads of a server-sent-events response. */
export async function* readSse(res: Response): AsyncIterable<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data:')) yield trimmed.slice(5).trim();
    }
  }
  const last = buffer.trim();
  if (last.startsWith('data:')) yield last.slice(5).trim();
}
