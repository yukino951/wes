import { GitHubContentError } from './github';

function invalid(message: string): never { throw new GitHubContentError(message, 400, 'invalid_content'); }

export function objectValue(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('内容必须是一个对象');
}

function stringField(value: Record<string, unknown>, key: string, required = false) {
  if (value[key] === undefined && !required) return;
  if (typeof value[key] !== 'string') invalid(`${key} 必须是文字`);
  if (required && !(value[key] as string).trim()) invalid(`${key} 不能为空`);
}

function stringList(value: Record<string, unknown>, key: string) {
  if (value[key] !== undefined && (!Array.isArray(value[key]) || !(value[key] as unknown[]).every((entry) => typeof entry === 'string'))) invalid(`${key} 必须是文字数组`);
}

function imageUrl(value: unknown) {
  if (typeof value !== 'string' || !/^(https?:\/\/|\/(?!\/))/.test(value)) invalid('图片地址必须是 HTTP(S) 地址或站内路径');
}

export function validateMarkdown(value: unknown) {
  objectValue(value);
  stringField(value, 'content', false);
  if (value.frontmatter !== undefined) {
    objectValue(value.frontmatter);
    for (const key of ['title', 'description', 'date', 'mood', 'cover', 'location']) stringField(value.frontmatter, key);
    stringList(value.frontmatter, 'tags');
    stringList(value.frontmatter, 'images');
  }
}

export function validateArrayItem(type: 'albums' | 'projects' | 'friends', value: unknown) {
  objectValue(value);
  stringField(value, 'id', true);
  const fields = type === 'albums' ? ['title', 'description', 'cover', 'date']
    : type === 'projects' ? ['name', 'description', 'icon', 'githubUrl']
    : ['name', 'url', 'description', 'avatar', 'themeColor'];
  for (const key of fields) stringField(value, key, key === 'title' || key === 'name');
  if (type === 'projects') stringList(value, 'tags');
  if (type === 'albums') {
    if (!Array.isArray(value.photos)) invalid('照片必须是数组');
    for (const photo of value.photos as unknown[]) {
      objectValue(photo);
      imageUrl(photo.url);
      stringField(photo, 'caption');
      stringField(photo, 'alt');
    }
    if (value.coverMode !== undefined && value.coverMode !== 'manual' && value.coverMode !== 'latest') invalid('封面模式无效');
    if (value.coverMode === 'manual' && !(value.photos as Array<{ url: string }>).some((photo) => photo.url === value.cover)) invalid('指定的封面必须在当前相册中');
  }
}

export function validateSettings(value: unknown, defaults: Record<string, unknown>) {
  objectValue(value);
  for (const [key, entry] of Object.entries(value)) {
    const expected = defaults[key];
    if (expected === undefined || expected === null) continue;
    if (Array.isArray(expected)) {
      if (!Array.isArray(entry)) invalid(`${key} 必须是数组`);
    } else if (typeof expected === 'object') {
      validateSettings(entry, expected as Record<string, unknown>);
    } else if (typeof entry !== typeof expected) invalid(`${key} 的内容类型不正确`);
  }
}
