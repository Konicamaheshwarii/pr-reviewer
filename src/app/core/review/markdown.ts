import { DiffFile } from '../diff/models';
import { CATEGORIES, Review, ReviewComment, SEVERITIES, SEVERITY_LABEL, countBy, severityRank } from './models';

/** A fence longer than any backtick run inside the content, so code never breaks out of its block. */
export function fence(content: string, lang = ''): string {
  const longest = Math.max(2, ...(content.match(/`+/g) ?? []).map((m) => m.length));
  const ticks = '`'.repeat(longest + 1);
  return `${ticks}${lang}\n${content}\n${ticks}`;
}

function codeAt(file: DiffFile | undefined, c: ReviewComment): string | null {
  if (!file) return null;
  for (const h of file.hunks) for (const l of h.lines) {
    if (c.side === 'new' ? l.newLine === c.line : l.oldLine === c.line && l.type === 'del') {
      return (l.type === 'add' ? '+' : l.type === 'del' ? '-' : ' ') + l.content;
    }
  }
  return null;
}

export function commentMarkdown(c: ReviewComment, file?: DiffFile): string {
  const where = c.side === 'old' ? `Removed line ${c.line}` : `Line ${c.line}`;
  const parts = [`#### ${where} · ${SEVERITY_LABEL[c.severity]} · ${c.category}`, `**${c.title}**`];
  const code = codeAt(file, c);
  if (code !== null) parts.push(fence(code, 'diff'));
  if (c.body) parts.push(c.body);
  if (c.suggestion !== undefined) parts.push(fence(c.suggestion, 'suggestion'));
  return parts.join('\n\n');
}

/** The whole review as one GitHub-flavoured Markdown comment. Dismissed comments are left out. */
export function reviewMarkdown(review: Review, files: DiffFile[]): string {
  const comments = review.comments.filter((c) => !c.dismissed);
  const sev = countBy(comments, (c) => c.severity, SEVERITIES);
  const cat = countBy(comments, (c) => c.category, CATEGORIES);
  const adds = files.reduce((n, f) => n + f.additions, 0);
  const dels = files.reduce((n, f) => n + f.deletions, 0);
  const date = review.createdAt.slice(0, 10);

  const out: string[] = [
    `## Code review: ${review.title}`,
    `> Reviewed by ReviewBot (${review.reviewer}) on ${date} · ${files.length} file${files.length === 1 ? '' : 's'} · +${adds} −${dels}`,
    '| Blockers | Warnings | Suggestions | Praise |\n|---:|---:|---:|---:|\n' +
      `| ${sev.blocker} | ${sev.warning} | ${sev.suggestion} | ${sev.praise} |`,
  ];
  const topCategories = CATEGORIES.filter((k) => cat[k]).map((k) => `${k} ${cat[k]}`);
  if (topCategories.length) out.push(`By category: ${topCategories.join(' · ')}`);

  if (!comments.length) out.push('No issues found. Looks good to merge.');
  else if (sev.blocker) out.push(`**${sev.blocker} blocker${sev.blocker === 1 ? '' : 's'} must be fixed before merging.**`);

  for (const file of files) {
    const mine = comments
      .filter((c) => c.file === file.path)
      .sort((a, b) => a.line - b.line || severityRank(a.severity) - severityRank(b.severity));
    const summary = review.files[file.id]?.summary;
    if (!mine.length) continue;
    out.push(`### \`${file.path}\``);
    if (summary) out.push(summary);
    for (const c of mine) out.push(commentMarkdown(c, file));
  }
  return out.join('\n\n') + '\n';
}
