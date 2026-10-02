import { SEVERITIES, countBy } from '../review/models';
import { ReviewInput } from '../review/prompts';
import { runRules } from '../review/rules';
import { LlmProvider, LlmRequest } from './llm-provider';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Offline reviewer: answers review requests with the built-in rule engine, in the same JSON shape a model returns. */
export function demoReview({ file, hunks }: ReviewInput) {
  const comments = runRules({ ...file, hunks });
  const counts = countBy(comments, (c) => c.severity, SEVERITIES);
  const issues = counts.blocker + counts.warning + counts.suggestion;
  const summary = !issues
    ? counts.praise ? 'No rule violations, and the change comes with tests.' : 'No rule violations in the added lines.'
    : `${issues} finding${issues === 1 ? '' : 's'} from the static rules` +
      (counts.blocker ? `, including ${counts.blocker} blocker${counts.blocker === 1 ? '' : 's'} to fix before merging.` : '.');
  return {
    summary,
    comments: comments.map(({ line, side, severity, category, title, body, suggestion }) =>
      ({ line, side, severity, category, title, body, suggestion })),
  };
}

export class DemoProvider implements LlmProvider {
  constructor(private readonly delayMs = 250) {}

  async complete(req: LlmRequest): Promise<string> {
    await sleep(this.delayMs);
    if (req.task === 'review') return JSON.stringify(demoReview(req.input as ReviewInput));
    return JSON.stringify({ ok: true });
  }

  async *stream(req: LlmRequest): AsyncIterable<string> {
    yield await this.complete(req);
  }
}
