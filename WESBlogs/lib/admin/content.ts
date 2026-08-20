/* eslint-disable @typescript-eslint/no-explicit-any */
import matter from 'gray-matter';
import fs from 'node:fs';
import path from 'node:path';
import { deleteContentFile, getContentFile, GitHubContentError, putContentFile } from './github';

export const CONTENT_TYPES = ['profile', 'about', 'moments', 'posts', 'chatters', 'albums', 'projects', 'friends', 'site-settings'] as const;
export type ContentType = typeof CONTENT_TYPES[number];

const APP_ROOT = 'WESBlogs';

const ROOT = {
  about: `${APP_ROOT}/app/about/about.md`,
  albums: `${APP_ROOT}/data/albums.ts`,
  projects: `${APP_ROOT}/data/projects.ts`,
  friends: `${APP_ROOT}/data/friends.ts`,
  settings: `${APP_ROOT}/data/site-settings.json`,
};

type ContentRecord = Record<string, any> & { id: string };
type ContentEnvelope = { type: ContentType; sha: string | null; path: string | null; items: ContentRecord[]; singleton?: any };

export function assertContentType(value: string): asserts value is ContentType {
  if (!CONTENT_TYPES.includes(value as ContentType)) throw new GitHubContentError('不支持的内容类型', 400, 'invalid_type');
}

function safeId(value: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,100}$/.test(value)) throw new GitHubContentError('ID 只能包含字母、数字、点、下划线和连字符', 400, 'invalid_id');
  return value;
}

function markdownPath(type: 'moments' | 'posts' | 'chatters', id: string) {
  return `${APP_ROOT}/${type}/${safeId(id)}.md`;
}

function serializeMarkdown(frontmatter: Record<string, any>, body: string) {
  const normalized = Object.fromEntries(Object.entries(frontmatter).filter(([, value]) => value !== undefined));
  return matter.stringify(body.trimEnd() + '\n', normalized);
}

function parseMarkdown(file: { path: string; sha: string; content: string }) {
  const parsed = matter(file.content);
  const filename = path.basename(file.path, '.md');
  return { id: filename, filename, frontmatter: parsed.data, content: parsed.content.trim(), path: file.path, sha: file.sha };
}

async function readFile(pathname: string) {
  return getContentFile(pathname);
}

function parseArraySource(source: string, exportName: string): ContentRecord[] {
  const start = source.indexOf('[');
  const end = source.lastIndexOf(']');
  if (start < 0 || end <= start) throw new GitHubContentError(`无法解析 ${exportName}`, 500, 'invalid_source');
  try {
    const parsed = JSON.parse(source.slice(start, end + 1));
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed.map((item) => ({ ...item, id: String(item.id) }));
  } catch {
    throw new GitHubContentError(`${exportName} 不是可编辑的 JSON 数组`, 500, 'invalid_source');
  }
}

function serializeArraySource(type: 'albums' | 'projects' | 'friends', items: ContentRecord[]) {
  const json = JSON.stringify(items, null, 2);
  if (type === 'albums') return `// 🛡️ 本文件由 XingHuiSama 控制台自动生成，请勿手动修改\nexport interface Photo { url: string; caption?: string; alt?: string; }\nexport interface Album { id: string; title: string; description: string; cover: string; date: string; photos: Photo[]; }\n\nexport const albums: Album[] = ${json};\n`;
  if (type === 'projects') return `// 🛡️ 本文件由 XingHuiSama 控制台自动生成，请勿手动修改\n\nexport type Project = {\n  id: string;\n  name: string;\n  description: string;\n  icon: string;\n  githubUrl: string;\n  tags: string[];\n};\n\nexport const projectsData: Project[] = ${json};\n`;
  return `// 🛡️ 本文件由 XingHuiSama 控制台自动生成，请勿手动修改\nexport interface Friend { id: string; name: string; url: string; description: string; avatar: string; themeColor: string; }\n\nexport const friendsData: Friend[] = ${json};\n`;
}

function settingsPath() { return ROOT.settings; }

function readLocalDefaults() {
  const localPaths = [
    path.join(process.cwd(), 'data', 'site-settings.json'),
    path.join(process.cwd(), APP_ROOT, 'data', 'site-settings.json'),
  ];
  for (const localPath of localPaths) {
    try { return JSON.parse(fs.readFileSync(localPath, 'utf8')); } catch { /* try the next project-root layout */ }
  }
  return {};
}

export async function listContent(type: ContentType): Promise<ContentEnvelope> {
  if (type === 'profile') {
    const settings = await listContent('site-settings');
    return { type, sha: settings.sha, path: settings.path, items: [], singleton: settings.singleton };
  }
  if (type === 'about') {
    const file = await readFile(ROOT.about);
    return { type, sha: file?.sha || null, path: ROOT.about, items: [], singleton: file ? parseMarkdown(file) : { frontmatter: {}, content: '' } };
  }
  if (type === 'site-settings') {
    const file = await readFile(settingsPath());
    const settings = file ? JSON.parse(file.content) : readLocalDefaults();
    return { type, sha: file?.sha || null, path: settingsPath(), items: [], singleton: settings };
  }
  if (type === 'moments' || type === 'posts' || type === 'chatters') {
    const dir = type === 'moments' ? 'moments' : type;
    const tree = await getDirectory(dir);
    const files = tree.filter((item) => item.type === 'file' && item.name.endsWith('.md'));
    const parsed = await Promise.all(files.map(async (item) => {
      const file = await readFile(item.path);
      return file ? parseMarkdown(file) : null;
    }));
    return { type, sha: null, path: `${APP_ROOT}/${dir}`, items: parsed.filter(Boolean) as ContentRecord[] };
  }
  const pathname = ROOT[type];
  const file = await readFile(pathname);
  const exportName = type === 'albums' ? 'albums' : type === 'projects' ? 'projectsData' : 'friendsData';
  return { type, sha: file?.sha || null, path: pathname, items: file ? parseArraySource(file.content, exportName) : [] };
}

async function getDirectory(directory: string) {
  const token = process.env.GITHUB_ADMIN_TOKEN;
  if (!token) throw new GitHubContentError('GITHUB_ADMIN_TOKEN is not configured', 503, 'missing_token');
  const repoDirectory = `${APP_ROOT}/${directory}`;
  const response = await fetch(`https://api.github.com/repos/yukino951/wes/contents/${repoDirectory}?ref=${encodeURIComponent(process.env.GITHUB_CONTENT_BRANCH || 'main')}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' }, cache: 'no-store'
  });
  const body = await response.json().catch(() => null);
  if (response.status === 404) return [];
  if (!response.ok || !Array.isArray(body)) throw new GitHubContentError(body?.message || '目录读取失败', response.status, 'github_error');
  return body as Array<{ type: string; name: string; path: string }>;
}

export async function saveSingleton(type: 'profile' | 'site-settings', value: any, baseSha: string | null | undefined, message: string) {
  const next = type === 'profile' ? { ...readLocalDefaults(), ...value } : value;
  const result = await putContentFile(settingsPath(), `${JSON.stringify(next, null, 2)}\n`, message, baseSha || undefined);
  return { ...result, path: settingsPath(), value: next };
}

export async function saveAbout(value: { frontmatter?: Record<string, any>; content: string }, baseSha: string | null | undefined, message: string) {
  const current = await readFile(ROOT.about);
  if (baseSha && (!current || current.sha !== baseSha)) throw new GitHubContentError('关于页已被其他修改更新，请刷新后重试。', 409, 'conflict');
  const result = await putContentFile(ROOT.about, serializeMarkdown(value.frontmatter || {}, value.content || ''), message, baseSha || undefined);
  return { ...result, path: ROOT.about };
}

export async function saveMarkdown(type: 'moments' | 'posts' | 'chatters', value: { id: string; frontmatter?: Record<string, any>; content: string }, baseSha: string | null | undefined, message: string) {
  const id = safeId(value.id);
  const pathname = markdownPath(type, id);
  const result = await putContentFile(pathname, serializeMarkdown({ id, ...(value.frontmatter || {}) }, value.content || ''), message, baseSha || undefined);
  return { ...result, path: pathname, id };
}

export async function deleteMarkdown(type: 'moments' | 'posts' | 'chatters', id: string, baseSha: string, message: string) {
  return deleteContentFile(markdownPath(type, id), message, baseSha);
}

export async function saveArrayItem(type: 'albums' | 'projects' | 'friends', value: ContentRecord, baseSha: string | null | undefined, message: string) {
  const pathname = ROOT[type];
  const file = await readFile(pathname);
  const exportName = type === 'albums' ? 'albums' : type === 'projects' ? 'projectsData' : 'friendsData';
  const items = file ? parseArraySource(file.content, exportName) : [];
  const id = safeId(String(value.id));
  const next = { ...value, id };
  const index = items.findIndex((item) => item.id === id);
  if (index >= 0) items[index] = next;
  else items.push(next);
  const result = await putContentFile(pathname, serializeArraySource(type, items), message, baseSha || undefined);
  return { ...result, path: pathname, id, items };
}

export async function deleteArrayItem(type: 'albums' | 'projects' | 'friends', id: string, baseSha: string, message: string) {
  const pathname = ROOT[type];
  const file = await readFile(pathname);
  if (!file || file.sha !== baseSha) throw new GitHubContentError('内容已被其他修改更新，请刷新后重试。', 409, 'conflict');
  const exportName = type === 'albums' ? 'albums' : type === 'projects' ? 'projectsData' : 'friendsData';
  const items = parseArraySource(file.content, exportName).filter((item) => item.id !== id);
  const result = await putContentFile(pathname, serializeArraySource(type, items), message, baseSha);
  return { ...result, path: pathname, items };
}
