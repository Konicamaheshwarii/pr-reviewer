export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Accepts https://github.com/owner/repo/pull/123 (with or without /files, query or hash),
 * github.com/owner/repo/pull/123, owner/repo#123 and owner/repo/pull/123.
 */
export function parsePullUrl(input: string): PullRef | null {
  const s = input.trim();
  const short = /^([\w.-]+)\/([\w.-]+)#(\d+)$/.exec(s);
  if (short) return { owner: short[1], repo: short[2], number: +short[3] };
  const url = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)(?:[/?#].*)?$/i.exec(s)
    ?? /^([\w.-]+)\/([\w.-]+)\/pulls?\/(\d+)$/.exec(s);
  if (!url) return null;
  return { owner: url[1], repo: url[2].replace(/\.git$/, ''), number: +url[3] };
}

export interface PullDiff {
  ref: PullRef;
  title: string;
  diff: string;
}

function headers(accept: string, token?: string): HeadersInit {
  return {
    accept,
    'x-github-api-version': '2022-11-28',
    ...(token?.trim() ? { authorization: `Bearer ${token.trim()}` } : {}),
  };
}

async function githubError(res: Response): Promise<Error> {
  let detail = '';
  try {
    detail = (await res.json())?.message ?? '';
  } catch {
    // not JSON
  }
  const remaining = res.headers.get('x-ratelimit-remaining');
  if ((res.status === 403 || res.status === 429) && (remaining === '0' || /rate limit/i.test(detail))) {
    return new Error('GitHub rate limit reached (60 requests an hour without a token). Add a GitHub token in Settings, or try again later.');
  }
  if (res.status === 404) return new Error('Pull request not found. Check the URL; private repositories need a token with access.');
  if (res.status === 401) return new Error('GitHub rejected the token. Check it in Settings.');
  if (res.status === 406 || res.status === 422) return new Error(`GitHub could not produce this diff${detail ? `: ${detail}` : ''}. It may be too large.`);
  return new Error(`GitHub error ${res.status}${detail ? `: ${detail}` : ''}.`);
}

/** Fetches a pull request's unified diff (and its title) straight from the GitHub REST API. */
export async function fetchPullDiff(ref: PullRef, token?: string, signal?: AbortSignal): Promise<PullDiff> {
  const api = `https://api.github.com/repos/${ref.owner}/${ref.repo}/pulls/${ref.number}`;
  const [diffRes, metaRes] = await Promise.all([
    fetch(api, { headers: headers('application/vnd.github.v3.diff', token), signal }),
    fetch(api, { headers: headers('application/vnd.github+json', token), signal }).catch(() => null),
  ]);
  if (!diffRes.ok) throw await githubError(diffRes);
  const diff = await diffRes.text();
  let title = `${ref.owner}/${ref.repo}#${ref.number}`;
  if (metaRes?.ok) {
    try {
      const meta = await metaRes.json();
      if (meta?.title) title = `${meta.title} (${ref.owner}/${ref.repo}#${ref.number})`;
    } catch {
      // keep the fallback title
    }
  }
  return { ref, title, diff };
}
