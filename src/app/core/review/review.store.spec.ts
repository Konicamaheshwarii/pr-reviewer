import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { parseUnifiedDiff } from '../diff/parser';
import { LlmService } from '../llm/llm.service';
import { SAMPLES } from '../samples';
import { SettingsStore } from '../settings.store';
import { ReviewStore, defaultTitle, initialFileState } from './review.store';

async function waitFor(check: () => boolean, ms = 5000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('ReviewStore', () => {
  let store: ReviewStore;
  let llm: jasmine.SpyObj<LlmService>;

  beforeEach(() => {
    localStorage.clear();
    llm = jasmine.createSpyObj<LlmService>('LlmService', ['complete', 'stream']);
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: LlmService, useValue: llm }] });
    store = TestBed.inject(ReviewStore);
  });

  afterEach(() => localStorage.clear());

  it('decides which files to skip before reviewing', () => {
    const files = parseUnifiedDiff(SAMPLES[1].diff).files;
    const states = Object.fromEntries(files.map((f) => [f.path, initialFileState(f).state]));
    expect(states['server/utils/deprecated.js']).toBe('skipped');
    expect(states['server/routes/webhook.js']).toBe('pending');
    const lock = parseUnifiedDiff('--- a/package-lock.json\n+++ b/package-lock.json\n@@ -1 +1 @@\n-a\n+b\n').files[0];
    expect(initialFileState(lock)).toEqual({ state: 'skipped', message: 'Generated or lock file' });
    expect(defaultTitle(files)).toBe('config.js and 5 more files');
  });

  it('reviews every file with the provider, validates the replies and saves the result', async () => {
    TestBed.inject(SettingsStore).update({ provider: 'groq', apiKeys: { groq: 'k' }, combineRules: false });
    llm.complete.and.callFake(async (req) => {
      const { file } = req.input as { file: { path: string } };
      if (file.path.endsWith('.html')) throw new Error('Groq error 429. Rate limit reached.');
      return JSON.stringify({ summary: `Looked at ${file.path}`, comments: [{ line: 1, severity: 'warning', category: 'bug', title: 'Check this' }, { line: 999, title: 'bogus' }] });
    });

    const id = store.create(SAMPLES[0].diff, '', { kind: 'paste' });
    expect(store.get(id)?.status).toBe('running');
    await waitFor(() => store.get(id)?.status === 'done');

    const review = store.get(id)!;
    const states = Object.values(review.files).map((f) => f.state).sort();
    expect(states).toEqual(['done', 'done', 'done', 'error', 'skipped']); // 4 text files (one fails) + 1 binary
    expect(review.comments.length).toBe(3);
    expect(review.comments.every((c) => c.line === 1 && c.source === 'ai')).toBeTrue();
    expect(Object.values(review.files).find((f) => f.state === 'done')?.dropped).toBe(1);
    expect(review.title).toBe('user-list.component.ts and 4 more files');
    expect(JSON.parse(localStorage.getItem('rb.history')!)[0].id).toBe(id);

    // Retrying only the failed file keeps the other comments.
    llm.complete.and.resolveTo('{"comments":[{"line":2,"severity":"suggestion","title":"Label"}]}');
    store.rerun(id, true);
    await waitFor(() => store.get(id)?.status === 'done');
    expect(llm.complete).toHaveBeenCalledTimes(5);
    expect(store.get(id)!.comments.length).toBe(4);
  });

  it('uses the rule engine as the reviewer in Demo mode, without calling a provider', async () => {
    const id = store.create(SAMPLES[1].diff, '', { kind: 'paste' });
    await waitFor(() => store.get(id)?.status === 'done');
    const review = store.get(id)!;
    expect(llm.complete).not.toHaveBeenCalled();
    expect(review.reviewer).toBe('Demo rules');
    expect(review.comments.length).toBeGreaterThan(5);
    expect(review.comments.every((c) => c.source === 'rule' && !!c.ruleId)).toBeTrue();
    expect(review.comments.some((c) => c.ruleId === 'no-eval')).toBeTrue();
  });

  it('adds the static rules next to AI comments when enabled', async () => {
    TestBed.inject(SettingsStore).update({ provider: 'gemini', apiKeys: { gemini: 'k' }, combineRules: true });
    llm.complete.and.resolveTo('{"comments":[]}');
    const id = store.create(SAMPLES[2].diff, 'Report', { kind: 'paste' });
    await waitFor(() => store.get(id)?.status === 'done');
    const review = store.get(id)!;
    expect(review.reviewer).toContain('+ rules');
    expect(review.comments.some((c) => c.ruleId === 'bare-except')).toBeTrue();
  });

  it('rejects text without a diff, and supports dismiss and delete', async () => {
    TestBed.inject(SettingsStore).update({ provider: 'groq', apiKeys: { groq: 'k' }, combineRules: false });
    expect(() => store.create('just some text', '', { kind: 'paste' })).toThrowError(/No diff found/);
    llm.complete.and.resolveTo('{"comments":[{"line":1,"title":"Hi"}]}');
    const id = store.create('--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-a\n+b\n', 'Tiny', { kind: 'paste' });
    await waitFor(() => store.get(id)?.status === 'done');
    const commentId = store.get(id)!.comments[0].id;
    store.setDismissed(id, commentId, true);
    expect(store.get(id)!.comments[0].dismissed).toBeTrue();
    store.remove(id);
    expect(store.history()).toEqual([]);
  });
});
