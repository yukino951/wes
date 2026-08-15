/* eslint-disable @typescript-eslint/no-explicit-any */
const OWNER = 'yukino951';
const REPO = 'wes';
const API_ROOT = `https://api.github.com/repos/${OWNER}/${REPO}`;

export class GitHubContentError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(message: string, status: number, code = 'github_error', details?: unknown) {
    super(message);
    this.name = 'GitHubContentError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function getToken() {
  const token = process.env.GITHUB_ADMIN_TOKEN;
  if (!token) throw new GitHubContentError('GITHUB_ADMIN_TOKEN is not configured', 503, 'missing_token');
  return token;
}

function getBranch() {
  return process.env.GITHUB_CONTENT_BRANCH || 'main';
}

async function githubFetch(pathname: string, init?: RequestInit) {
  const response = await fetch(`${API_ROOT}${pathname}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${getToken()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init?.headers || {}),
    },
    cache: 'no-store',
  });
  let body: any = null;
  try { body = await response.json(); } catch { /* GitHub may return an empty response. */ }
  if (!response.ok) {
    const message = body?.message || `GitHub API request failed (${response.status})`;
    const code = response.status === 409 ? 'conflict' : response.status === 404 ? 'not_found' : response.status === 403 ? 'forbidden' : 'github_error';
    throw new GitHubContentError(message, response.status, code, body);
  }
  return body;
}

export type GitHubFile = { path: string; sha: string; content: string; url?: string };

export async function getContentFile(pathname: string): Promise<GitHubFile | null> {
  try {
    const result = await githubFetch(`/contents/${encodePath(pathname)}?ref=${encodeURIComponent(getBranch())}`);
    if (Array.isArray(result) || result.type !== 'file') throw new GitHubContentError('Expected a file', 422, 'invalid_file');
    return {
      path: result.path,
      sha: result.sha,
      content: Buffer.from(String(result.content || '').replace(/\n/g, ''), 'base64').toString('utf8'),
      url: result.html_url,
    };
  } catch (error) {
    if (error instanceof GitHubContentError && error.status === 404) return null;
    throw error;
  }
}

export async function putContentFile(pathname: string, content: string, message: string, expectedSha?: string) {
  const current = await getContentFile(pathname);
  if (expectedSha && (!current || current.sha !== expectedSha)) {
    throw new GitHubContentError('文件已被其他修改更新，请刷新后重试。', 409, 'conflict', { currentSha: current?.sha || null });
  }
  if (!expectedSha && current) {
    throw new GitHubContentError('目标文件已存在，请刷新后重试。', 409, 'conflict', { currentSha: current.sha });
  }
  const result = await githubFetch(`/contents/${encodePath(pathname)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: getBranch(),
      ...(current ? { sha: current.sha } : {}),
    }),
  });
  return { sha: result.content?.sha || result.commit?.sha, commitUrl: result.commit?.html_url };
}

export async function deleteContentFile(pathname: string, message: string, expectedSha: string) {
  const current = await getContentFile(pathname);
  if (!current || current.sha !== expectedSha) {
    throw new GitHubContentError('文件已被其他修改更新，请刷新后重试。', 409, 'conflict', { currentSha: current?.sha || null });
  }
  const result = await githubFetch(`/contents/${encodePath(pathname)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, sha: current.sha, branch: getBranch() }),
  });
  return { commitUrl: result.commit?.html_url };
}

function encodePath(pathname: string) {
  return pathname.split('/').map(encodeURIComponent).join('/');
}

export async function getGitHubUser(accessToken: string) {
  const response = await fetch('https://api.github.com/user', {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${accessToken}`, 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new GitHubContentError(body?.message || 'GitHub 用户信息读取失败', response.status, 'oauth_user_failed');
  return body as { login: string; name?: string | null; avatar_url?: string };
}

export async function exchangeGitHubCode(code: string) {
  const clientId = process.env.ADMIN_GITHUB_CLIENT_ID;
  const clientSecret = process.env.ADMIN_GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new GitHubContentError('Admin GitHub OAuth 尚未配置', 503, 'missing_oauth');
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    cache: 'no-store',
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.access_token) throw new GitHubContentError(body?.error_description || 'GitHub OAuth 换取令牌失败', response.status || 502, 'oauth_exchange_failed');
  return body.access_token as string;
}
