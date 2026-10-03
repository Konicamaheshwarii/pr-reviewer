import { fetchPullDiff, parsePullUrl } from './github';

describe('parsePullUrl', () => {
  it('accepts the common ways of pointing at a pull request', () => {
    const ref = { owner: 'angular', repo: 'angular', number: 123 };
    expect(parsePullUrl('https://github.com/angular/angular/pull/123')).toEqual(ref);
    expect(parsePullUrl('https://github.com/angular/angular/pull/123/files?w=1#diff-abc')).toEqual(ref);
    expect(parsePullUrl('github.com/angular/angular/pull/123')).toEqual(ref);
    expect(parsePullUrl('  angular/angular#123 ')).toEqual(ref);
    expect(parsePullUrl('angular/angular/pull/123')).toEqual(ref);
  });

  it('rejects URLs that are not pull requests', () => {
    expect(parsePullUrl('https://github.com/angular/angular')).toBeNull();
    expect(parsePullUrl('https://github.com/angular/angular/issues/5')).toBeNull();
    expect(parsePullUrl('https://gitlab.com/a/b/pull/1')).toBeNull();
    expect(parsePullUrl('')).toBeNull();
  });
});

describe('fetchPullDiff', () => {
  it('requests the diff media type, sends the optional token and reads the title', async () => {
    const spy = spyOn(window, 'fetch').and.callFake(async (_url, init) => {
      const accept = new Headers(init?.headers).get('accept');
      return accept === 'application/vnd.github.v3.diff'
        ? new Response('diff --git a/x b/x\n')
        : new Response(JSON.stringify({ title: 'Fix bug' }));
    });
    const pr = await fetchPullDiff({ owner: 'o', repo: 'r', number: 7 }, ' tok ');
    expect(pr.diff).toBe('diff --git a/x b/x\n');
    expect(pr.title).toBe('Fix bug (o/r#7)');
    const [url, init] = spy.calls.first().args;
    expect(url).toBe('https://api.github.com/repos/o/r/pulls/7');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer tok');
  });

  it('explains rate limits and missing pull requests', async () => {
    spyOn(window, 'fetch').and.returnValues(
      Promise.resolve(new Response('{"message":"API rate limit exceeded"}', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })),
      Promise.resolve(new Response('{}')),
      Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 })),
      Promise.resolve(new Response('{}')),
    );
    await expectAsync(fetchPullDiff({ owner: 'o', repo: 'r', number: 1 })).toBeRejectedWithError(/rate limit/);
    await expectAsync(fetchPullDiff({ owner: 'o', repo: 'r', number: 2 })).toBeRejectedWithError(/not found/);
  });
});
