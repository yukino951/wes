'use client';

/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';
import { AdminSidePanel, useAdminEditMode } from './AdminEditMode';

type ManagedType = 'friends' | 'projects' | 'albums' | 'chatters' | 'moments' | 'posts';
type ManagedItem = Record<string, any>;
type FieldKind = 'text' | 'textarea' | 'list' | 'json';
type FieldConfig = { key: string; label: string; kind?: FieldKind; placeholder?: string };

const arrayTypes = new Set<ManagedType>(['friends', 'projects', 'albums']);

const fieldMap: Record<ManagedType, FieldConfig[]> = {
  friends: [
    { key: 'name', label: '名称' },
    { key: 'description', label: '简介', kind: 'textarea' },
    { key: 'url', label: '链接', placeholder: 'https://example.com' },
    { key: 'avatar', label: '头像地址', placeholder: 'https://example.com/avatar.jpg' },
    { key: 'themeColor', label: '主题色', placeholder: 'rgba(99, 102, 241, 0.5)' },
  ],
  projects: [
    { key: 'name', label: '名称' },
    { key: 'description', label: '简介', kind: 'textarea' },
    { key: 'icon', label: '图标', placeholder: '🚀' },
    { key: 'githubUrl', label: '项目链接', placeholder: 'https://github.com/...' },
    { key: 'tags', label: '标签（逗号分隔）', kind: 'list', placeholder: 'Next.js, TypeScript' },
  ],
  albums: [
    { key: 'title', label: '相册名称' },
    { key: 'description', label: '相册简介', kind: 'textarea' },
    { key: 'cover', label: '封面地址', placeholder: 'https://example.com/cover.jpg' },
    { key: 'date', label: '日期' },
    { key: 'photos', label: '照片 JSON', kind: 'json', placeholder: '[{"url":"https://...","caption":"说明"}]' },
  ],
  chatters: [
    { key: 'title', label: '标题' },
    { key: 'date', label: '日期' },
    { key: 'mood', label: '心情' },
    { key: 'cover', label: '封面地址', placeholder: 'https://example.com/cover.jpg' },
    { key: 'tags', label: '标签（逗号分隔）', kind: 'list', placeholder: '日常, 学术' },
    { key: 'content', label: '正文 Markdown', kind: 'textarea' },
  ],
  moments: [
    { key: 'date', label: '日期' },
    { key: 'location', label: '地点' },
    { key: 'images', label: '图片地址（每行一个）', kind: 'list' },
    { key: 'content', label: '正文', kind: 'textarea' },
  ],
  posts: [
    { key: 'title', label: '标题' },
    { key: 'date', label: '日期' },
    { key: 'description', label: '摘要', kind: 'textarea' },
    { key: 'cover', label: '封面地址', placeholder: 'https://example.com/cover.jpg' },
    { key: 'tags', label: '标签（逗号分隔）', kind: 'list', placeholder: '研究, 编程' },
    { key: 'content', label: '正文 Markdown', kind: 'textarea' },
  ],
};

const labels: Record<ManagedType, string> = {
  friends: '友链',
  projects: '项目',
  albums: '相册',
  chatters: '杂谈',
  moments: '说说',
  posts: '文章',
};

function itemId(item: ManagedItem) {
  const id = item.id ?? item.slug;
  return typeof id === 'string' ? id : '';
}

function markdownSource(item: ManagedItem) {
  return item.frontmatter && typeof item.frontmatter === 'object' ? item.frontmatter as ManagedItem : item;
}

function itemToDraft(type: ManagedType, item: ManagedItem | undefined) {
  const source = item ? (arrayTypes.has(type) ? item : markdownSource(item)) : {};
  const next: Record<string, string> = { id: item ? itemId(item) : '' };
  fieldMap[type].forEach((field) => {
    const value = source[field.key];
    if (field.kind === 'list') {
      next[field.key] = Array.isArray(value) ? value.join(type === 'moments' ? '\n' : ', ') : '';
    } else if (field.kind === 'json') {
      next[field.key] = value ? JSON.stringify(value, null, 2) : '[]';
    } else {
      next[field.key] = typeof value === 'string' ? value : value == null ? '' : String(value);
    }
  });
  if (type === 'chatters' || type === 'posts' || type === 'moments') next.content = typeof item?.content === 'string' ? item.content : next.content || '';
  return next;
}

function draftToValue(type: ManagedType, draft: Record<string, string>) {
  const id = draft.id.trim();
  if (!id) throw new Error('请填写 ID（只能使用字母、数字、点、下划线和连字符）。');
  const target: ManagedItem = { id };
  const frontmatter: ManagedItem = { id };
  fieldMap[type].forEach((field) => {
    const raw = draft[field.key] || '';
    if (field.kind === 'list') {
      target[field.key] = raw.split(type === 'moments' ? /\r?\n/ : ',').map((value) => value.trim()).filter(Boolean);
    } else if (field.kind === 'json') {
      try {
        target[field.key] = JSON.parse(raw || '[]');
      } catch {
        throw new Error(`${field.label}必须是有效的 JSON。`);
      }
    } else {
      target[field.key] = raw.trim();
    }
  });
  if (type === 'chatters' || type === 'posts' || type === 'moments') {
    const content = draft.content || '';
    delete target.content;
    delete frontmatter.content;
    Object.assign(frontmatter, target);
    return { id, frontmatter, content };
  }
  return target;
}

function displayItem(item: ManagedItem) {
  const source = markdownSource(item);
  return source.title || source.name || itemId(item) || '未命名';
}

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  return fallback;
}

export default function AdminCollectionManager({
  type,
  initialItems,
  onItemsChange,
}: {
  type: ManagedType;
  initialItems: unknown[];
  onItemsChange: (items: ManagedItem[]) => void;
}) {
  const { editMode, workspaceView, reportStatus } = useAdminEditMode();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'new' | 'edit'>('new');
  const [selectedId, setSelectedId] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>(() => itemToDraft(type, undefined));
  const [latestItems, setLatestItems] = useState<ManagedItem[] | null>(null);
  const [sha, setSha] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const fallbackItems = useMemo(() => initialItems.filter((item): item is ManagedItem => Boolean(item && typeof item === 'object')).map((item) => item as ManagedItem), [initialItems]);
  const items = latestItems ?? fallbackItems;

  const refresh = async () => {
    const response = await fetch(`/api/admin/content/${type}`, { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(getErrorMessage(body, `无法读取${labels[type]}数据`));
    const nextItems = Array.isArray(body?.items) ? body.items as ManagedItem[] : [];
    setLatestItems(nextItems);
    setSha(typeof body?.sha === 'string' ? body.sha : null);
    onItemsChange(nextItems);
    return { items: nextItems, sha: typeof body?.sha === 'string' ? body.sha : null };
  };

  const openManager = () => {
    setOpen(true);
    setError(null);
    void refresh().catch((refreshError) => {
      const message = refreshError instanceof Error ? refreshError.message : '读取失败';
      setError(message);
      reportStatus('error', message);
    });
  };

  const beginNew = () => {
    setMode('new');
    setSelectedId('');
    setDraft(itemToDraft(type, undefined));
    setError(null);
    setConfirmingDelete(false);
  };

  const beginEdit = (id: string) => {
    const item = items.find((entry) => itemId(entry) === id);
    setMode('edit');
    setSelectedId(id);
    setDraft(itemToDraft(type, item));
    setError(null);
    setConfirmingDelete(false);
  };

  const updateDraft = (key: string, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    reportStatus('saving', `正在保存${labels[type]}…`);
    try {
      const currentItems = latestItems ?? (await refresh()).items;
      const current = currentItems.find((entry) => itemId(entry) === (mode === 'edit' ? selectedId : draft.id.trim()));
      const value = draftToValue(type, draft);
      // Some list pages only receive Markdown frontmatter. Preserve the live
      // body when an edit form was opened before the fresh CMS item arrived.
      if (!arrayTypes.has(type) && current && value.content === '' && typeof current.content === 'string') {
        value.content = current.content;
      }
      const endpoint = mode === 'edit' ? `/api/admin/content/${type}/${encodeURIComponent(selectedId)}` : `/api/admin/content/${type}`;
      const response = await fetch(endpoint, {
        method: mode === 'edit' ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value,
          baseSha: current?.sha || sha || null,
          message: `content: ${mode === 'edit' ? 'update' : 'add'} ${type} from inline editor`,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(body, `保存${labels[type]}失败`));
      const refreshed = await refresh();
      setMode('edit');
      setSelectedId(draft.id.trim());
      setDraft(itemToDraft(type, refreshed.items.find((entry) => itemId(entry) === draft.id.trim())));
      reportStatus('saved', `${labels[type]}已保存到 GitHub`);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : `保存${labels[type]}失败`;
      setError(message);
      reportStatus('error', message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!selectedId || saving) return;
    setSaving(true);
    setError(null);
    reportStatus('saving', `正在删除${labels[type]}…`);
    try {
      const currentItems = latestItems ?? (await refresh()).items;
      const current = currentItems.find((entry) => itemId(entry) === selectedId);
      if (!current) throw new Error('该内容已不存在，请刷新后重试。');
      const response = await fetch(`/api/admin/content/${type}/${encodeURIComponent(selectedId)}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseSha: current.sha || sha || null, message: `content: delete ${type} from inline editor` }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(body, `删除${labels[type]}失败`));
      await refresh();
      beginNew();
      reportStatus('saved', `${labels[type]}已从 GitHub 删除`);
    } catch (removeError) {
      const message = removeError instanceof Error ? removeError.message : `删除${labels[type]}失败`;
      setError(message);
      reportStatus('error', message);
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setLatestItems(null);
  }, [type, open]);

  useEffect(() => {
    if (!editMode || workspaceView === 'preview') setOpen(false);
  }, [editMode, workspaceView]);

  if (!editMode || workspaceView === 'preview') return null;

  return (
    <>
      <button type="button" onClick={openManager} className="fixed bottom-24 right-4 z-[10005] rounded-2xl border border-indigo-300/30 bg-slate-950/90 px-4 py-3 text-sm font-black text-white shadow-2xl backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-indigo-500 sm:right-6">
        管理{labels[type]}
      </button>

      {open ? (
        <AdminSidePanel
          title={`${labels[type]}内容`}
          description={`集中新增、选择和编辑${labels[type]}。保存操作会立即写入 GitHub。`}
          onClose={() => setOpen(false)}
          wide
        >
          <div className="grid min-h-[calc(100vh_-_9rem)] gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
            <div className="min-h-0 rounded-2xl border border-white/10 bg-white/5 p-3">
              <button type="button" onClick={beginNew} className={`mb-3 w-full rounded-xl px-3 py-2.5 text-left text-sm font-bold transition ${mode === 'new' ? 'bg-indigo-500 text-white shadow-lg' : 'bg-white/[0.08] text-slate-200 hover:bg-white/[0.12]'}`}>
                ＋ 新增{labels[type]}
              </button>
              <p className="mb-2 px-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">已有内容 · {items.length}</p>
              <div className="max-h-[55vh] space-y-1 overflow-y-auto pr-1">
                {items.map((item) => {
                  const id = itemId(item);
                  return (
                    <button key={id} type="button" onClick={() => beginEdit(id)} className={`w-full rounded-xl px-3 py-2 text-left transition ${mode === 'edit' && selectedId === id ? 'bg-indigo-500/20 text-indigo-100 ring-1 ring-indigo-400/40' : 'text-slate-300 hover:bg-white/[0.08] hover:text-white'}`}>
                      <span className="block truncate text-sm font-bold">{displayItem(item)}</span>
                      <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500">{id}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <form onSubmit={save} className="grid content-start gap-4 md:grid-cols-2">
              <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-sm font-black text-white">{mode === 'edit' ? `编辑${labels[type]}` : `新增${labels[type]}`}</p>
                  <p className="mt-1 text-xs text-slate-500">标签使用逗号分隔；图片和链接填写完整地址。</p>
                </div>
                {mode === 'edit' ? (
                  confirmingDelete ? (
                    <div className="flex items-center gap-2 rounded-xl border border-rose-400/20 bg-rose-500/10 p-2">
                      <span className="text-xs font-bold text-rose-200">确定删除？</span>
                      <button type="button" onClick={() => void remove()} disabled={saving} className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-500 disabled:opacity-50">确认</button>
                      <button type="button" onClick={() => setConfirmingDelete(false)} disabled={saving} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/15">取消</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmingDelete(true)} disabled={saving} className="rounded-xl border border-rose-400/20 px-3 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-500/10 disabled:opacity-50">删除当前</button>
                  )
                ) : null}
              </div>

              <label className="flex flex-col gap-1.5 text-xs font-bold text-slate-300">
                ID / 文件名
                <input required value={draft.id || ''} onChange={(event) => updateDraft('id', event.target.value)} disabled={mode === 'edit'} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400 disabled:opacity-50" placeholder="my-content-id" />
              </label>
              {fieldMap[type].map((field) => (
                <label key={field.key} className={`flex flex-col gap-1.5 text-xs font-bold text-slate-300 ${field.kind === 'textarea' || field.kind === 'json' ? 'md:col-span-2' : ''}`}>
                  {field.label}
                  {field.kind === 'textarea' || field.kind === 'json' ? (
                    <textarea value={draft[field.key] || ''} onChange={(event) => updateDraft(field.key, event.target.value)} rows={field.kind === 'json' ? 7 : 8} className={`rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400 ${field.kind === 'json' ? 'font-mono text-xs' : ''}`} placeholder={field.placeholder} />
                  ) : (
                    <input value={draft[field.key] || ''} onChange={(event) => updateDraft(field.key, event.target.value)} className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none transition focus:border-indigo-400" placeholder={field.placeholder} />
                  )}
                </label>
              ))}
              <div className="md:col-span-2 sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-white/10 bg-slate-950/95 pt-4">
                <button type="submit" disabled={saving} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-400 disabled:opacity-50">{saving ? '保存中…' : mode === 'edit' ? '保存到 GitHub' : `新增${labels[type]}`}</button>
                {error ? <span className="rounded-lg bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">{error}</span> : null}
              </div>
            </form>
          </div>
        </AdminSidePanel>
      ) : null}
    </>
  );
}

export function normalizeMarkdownItems(type: 'chatters' | 'moments' | 'posts', items: ManagedItem[]) {
  return items.map((item) => {
    const frontmatter = markdownSource(item);
    return {
      ...item,
      slug: item.id,
      id: item.id,
      title: frontmatter.title || '',
      date: frontmatter.date || '未知时间',
      tags: Array.isArray(frontmatter.tags) ? frontmatter.tags : [],
      mood: frontmatter.mood || '',
      cover: frontmatter.cover || '',
      description: frontmatter.description || '',
      location: frontmatter.location || '',
      images: Array.isArray(frontmatter.images) ? frontmatter.images : [],
      content: typeof item.content === 'string' ? item.content : '',
    };
  });
}
