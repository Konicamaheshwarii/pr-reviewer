import { parseUnifiedDiff } from '../diff/parser';
import { commentMarkdown, fence, reviewMarkdown } from './markdown';
import { Review, ReviewComment } from './models';

const DIFF = `diff --git a/app.js b/app.js
--- a/app.js
+++ b/app.js
@@ -1,2 +1,3 @@
 const a = 1;
-var b = 2;
+var b = 3;
+debugger;
diff --git a/clean.js b/clean.js
--- a/clean.js
+++ b/clean.js
@@ -1 +1 @@
-x
+y
`;
const files = parseUnifiedDiff(DIFF).files;

const base = (over: Partial<ReviewComment>): ReviewComment => ({
  id: Math.random().toString(36), file: 'app.js', line: 2, side: 'new', severity: 'suggestion', category: 'style',
  title: 'Use `let`', body: 'var is function-scoped.', source: 'rule', ...over,
});

const review: Review = {
  id: 'r1',
  createdAt: '2026-10-02T10:00:00.000Z',
  title: 'Tidy app',
  source: { kind: 'paste' },
  reviewer: 'Demo rules',
  diffText: DIFF,
  status: 'done',
  files: { [files[0].id]: { state: 'done', summary: 'Two findings.' }, [files[1].id]: { state: 'done' } },
  comments: [
    base({ line: 3, severity: 'blocker', category: 'bug', title: 'Debugger statement', body: 'Remove it.' }),
    base({ suggestion: 'let b = 3;' }),
    base({ line: 2, side: 'old', severity: 'warning', title: 'Removed var' }),
    base({ line: 1, title: 'Dismissed one', dismissed: true }),
  ],
};

describe('markdown export', () => {
  it('writes a GitHub-style review with counts, files, code and suggestion blocks', () => {
    const md = reviewMarkdown(review, files);
    expect(md).toContain('## Code review: Tidy app');
    expect(md).toContain('Demo rules');
    expect(md).toContain('| 1 | 1 | 1 | 0 |');
    expect(md).toContain('**1 blocker must be fixed before merging.**');
    expect(md).toContain('### `app.js`\n\nTwo findings.');
    expect(md).toContain('#### Line 3 · Blocker · bug\n\n**Debugger statement**\n\n```diff\n+debugger;\n```\n\nRemove it.');
    expect(md).toContain('```suggestion\nlet b = 3;\n```');
    expect(md).toContain('#### Removed line 2 · Warning');
    expect(md).toContain('```diff\n-var b = 2;\n```');
  });

  it('orders comments by line, leaves out dismissed comments and files without comments', () => {
    const md = reviewMarkdown(review, files);
    expect(md).not.toContain('Dismissed one');
    expect(md).not.toContain('clean.js');
    expect(md.indexOf('Line 2 ·')).toBeLessThan(md.indexOf('Line 3 ·'));
  });

  it('says so when there is nothing to fix', () => {
    const md = reviewMarkdown({ ...review, comments: [] }, files);
    expect(md).toContain('No issues found');
    expect(md).toContain('| 0 | 0 | 0 | 0 |');
  });

  it('uses a longer fence when the code itself contains backticks', () => {
    expect(fence('a ``` b', 'diff')).toBe('````diff\na ``` b\n````');
    expect(commentMarkdown(base({ suggestion: 'const s = `x`;' }), files[0])).toContain('```suggestion\nconst s = `x`;\n```');
  });
});
