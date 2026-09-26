'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AdminNavigationGuard, confirmAdminLeave, useAdminPending, useDraftStorage } from './AdminDraftGuard';

type ContentType = 'albums' | 'chatters' | 'moments' | 'posts' | 'projects' | 'friends';

type EditableResource =
  | { type: 'profile'; field: string }
  | { type: ContentType; id: string; field: string; scope?: 'frontmatter' | 'record' };

type MarkdownResource =
  | { type: 'about' }
  | { type: Extract<ContentType, 'chatters' | 'moments' | 'posts'>; id: string };

type MarkdownSnapshot = {
  value: string;
  html: string;
};

function prepareMarkdownForInlinePreview(markdown: string) {
  const normalized = markdown
    .replace(/\r\n/g, '\n')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/^[ \t]+$/gm, '')
    .replace(/^(\s*\d+)\.([^ \n])/gm, '$1. $2');
  const blocks = normalized.split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g);

  return blocks.map((block, index) => {
    if (index % 2 === 1) return block;
    return block.replace(/\n{3,}/g, (match) => '\n\n' + '<br>'.repeat(match.length - 2) + '\n\n');
  }).join('');
}

function fallbackMarkdownHtml(markdown: string) {
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\n/g, '<br>');
}

async function renderInlineMarkdown(markdown: string) {
  const source = prepareMarkdownForInlinePreview(markdown);

  try {
    const [
      { unified },
      { default: remarkParse },
      { default: remarkGfm },
      { default: remarkMath },
      { default: remarkRehype },
      { default: rehypeHighlight },
      { default: rehypeKatex },
      { default: rehypeStringify },
    ] = await Promise.all([
      import('unified'),
      import('remark-parse'),
      import('remark-gfm'),
      import('remark-math'),
      import('remark-rehype'),
      import('rehype-highlight'),
      import('rehype-katex'),
      import('rehype-stringify'),
    ]);

    const processed = await unified()
      .use(remarkParse)
      .use(remarkGfm)
      .use(remarkMath)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeHighlight, {
        detect: true,
        ignoreMissing: true,
        subset: ['cpp', 'c', 'python', 'java', 'javascript', 'typescript', 'go', 'rust', 'bash', 'json', 'html', 'css', 'sql', 'xml'],
      })
      .use(rehypeKatex)
      .use(rehypeStringify, { allowDangerousHtml: true })
      .process(source);

    return processed.toString();
  } catch {
    return fallbackMarkdownHtml(markdown);
  }
}

export type AdminWorkspaceView = 'edit' | 'preview';
export type AdminSaveState = 'idle' | 'saving' | 'saved' | 'error';

type AdminStatus = {
  state: AdminSaveState;
  message: string;
};

type AdminEditModeContextValue = {
  editMode: boolean;
  starting: boolean;
  workspaceView: AdminWorkspaceView;
  status: AdminStatus;
  startEditing: () => Promise<void>;
  stopEditing: () => void;
  setWorkspaceView: (view: AdminWorkspaceView) => void;
  reportStatus: (state: AdminSaveState, message: string) => void;
};

const AdminEditModeContext = createContext<AdminEditModeContextValue | null>(null);

async function hasAdminSession() {
  const response = await fetch('/api/admin/session', { cache: 'no-store' });
  if (!response.ok) return false;
  const body = await response.json().catch(() => null);
  return body?.authenticated === true;
}

function returnToCurrentPage() {
  const target = new URL(window.location.href);
  target.searchParams.set('edit', '1');
  return `${target.pathname}${target.search}`;
}

export function AdminEditModeProvider({ children }: { children: React.ReactNode }) {
  const [editMode, setEditMode] = useState(false);
  const [starting, setStarting] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<AdminWorkspaceView>('edit');
  const [status, setStatus] = useState<AdminStatus>({ state: 'idle', message: '已连接 GitHub 内容源' });

  const reportStatus = useCallback((state: AdminSaveState, message: string) => {
    setStatus({ state, message });
  }, []);

  const startEditing = useCallback(async () => {
    setStarting(true);
    try {
      if (await hasAdminSession()) {
        setEditMode(true);
        setWorkspaceView('edit');
        setStatus({ state: 'idle', message: '编辑工作区已开启' });
        return;
      }
      window.location.assign(`/api/admin/auth/login?next=${encodeURIComponent(returnToCurrentPage())}`);
    } finally {
      setStarting(false);
    }
  }, []);

  const stopEditing = useCallback(() => {
    if (!confirmAdminLeave()) return;
    setEditMode(false);
    setWorkspaceView('edit');
    setStatus({ state: 'idle', message: '已连接 GitHub 内容源' });
  }, []);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('edit')) return;
    let cancelled = false;
    void hasAdminSession().then((authenticated) => {
      if (!cancelled && authenticated) {
        setEditMode(true);
        setWorkspaceView('edit');
        setStatus({ state: 'idle', message: '编辑工作区已开启' });
        const target = new URL(window.location.href);
        target.searchParams.delete('edit');
        window.history.replaceState({}, '', `${target.pathname}${target.search}${target.hash}`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <AdminEditModeContext.Provider value={{
      editMode,
      starting,
      workspaceView,
      status,
      startEditing,
      stopEditing,
      setWorkspaceView: (view) => { if (view === workspaceView || confirmAdminLeave()) setWorkspaceView(view); },
      reportStatus,
    }}>
      <AdminNavigationGuard />
      {children}
    </AdminEditModeContext.Provider>
  );
}

export function useAdminEditMode() {
  const value = useContext(AdminEditModeContext);
  if (!value) throw new Error('useAdminEditMode must be used inside AdminEditModeProvider');
  return value;
}

export function AdminEditIndicator() {
  const { editMode } = useAdminEditMode();
  if (!editMode) return null;
  return <AdminWorkspaceBar />;
}

function AdminWorkspaceBar() {
  const { workspaceView, setWorkspaceView, status, stopEditing } = useAdminEditMode();
  const statusTone = status.state === 'error'
    ? 'text-rose-300'
    : status.state === 'saved'
      ? 'text-emerald-300'
      : status.state === 'saving'
        ? 'text-amber-200'
        : 'text-slate-300';

  return (
    <div className="fixed bottom-4 left-1/2 z-[10010] flex w-[calc(100%_-_1.5rem)] max-w-3xl -translate-x-1/2 items-center gap-2 rounded-2xl border border-indigo-300/30 bg-slate-950/90 p-2 text-white shadow-2xl backdrop-blur-2xl sm:w-auto sm:min-w-[560px]">
      <div className="hidden min-w-0 flex-1 px-2 sm:block">
        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-300">管理员工作区</p>
        <p role="status" aria-live="polite" className={`truncate text-xs ${statusTone}`}>{status.message}</p>
      </div>
      <div className="flex flex-1 rounded-xl bg-white/[0.08] p-1 sm:flex-none">
        <button
          type="button"
          onClick={() => setWorkspaceView('edit')}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition sm:flex-none ${workspaceView === 'edit' ? 'bg-indigo-500 text-white shadow-lg' : 'text-slate-300 hover:bg-white/10'}`}
        >
          编辑
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceView('preview')}
          className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition sm:flex-none ${workspaceView === 'preview' ? 'bg-white text-slate-900 shadow-lg' : 'text-slate-300 hover:bg-white/10'}`}
        >
          预览
        </button>
      </div>
      <button type="button" onClick={stopEditing} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-rose-300/50 hover:bg-rose-500/15 hover:text-rose-200">
        退出编辑
      </button>
    </div>
  );
}

export function AdminSidePanel({
  title,
  description,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  const [previousFocus] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key === 'Tab') {
        const nodes = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]') || []).filter((node) => node.getClientRects().length > 0);
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); panelRef.current?.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !panelRef.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.body.style.overflow = 'hidden';
    if (!panelRef.current?.contains(document.activeElement)) panelRef.current?.focus();
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape, true);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [previousFocus]);

  return createPortal(
    <div className="fixed inset-0 z-[10020]" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
      <button type="button" aria-label="关闭编辑面板" onClick={onClose} className="absolute inset-0 h-full w-full bg-slate-950/55 backdrop-blur-[2px]" />
      <aside ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`absolute inset-y-0 right-0 flex w-full flex-col border-l border-white/10 bg-slate-950/[0.97] text-slate-100 shadow-2xl ${wide ? 'max-w-3xl' : 'max-w-md'}`}>
        <header className="flex items-start justify-between gap-4 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.24em] text-indigo-300">管理员编辑</p>
            <h2 className="mt-1 truncate text-lg font-black text-white">{title}</h2>
            {description ? <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/10 text-lg text-slate-300 transition hover:bg-white/20 hover:text-white" aria-label="关闭">
            ×
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}

function resourceLabel(resource: EditableResource) {
  const labels: Record<string, string> = {
    title: '标题',
    description: '简介',
    shortName: '导航标题',
    authorName: '昵称',
    bio: '个人简介',
    date: '日期',
    location: '地点',
    subtitle: '副标题',
    name: '名称',
    url: '链接',
    chatterTitle: '杂谈页标题',
    chatterDescription: '杂谈页简介',
    friendsTitle: '友链页标题',
    friendsDescription: '友链页简介',
    momentsTitle: '说说页标题',
    momentsDescription: '说说页简介',
    musicTitle: '音乐页标题',
    musicDescription: '音乐页简介',
    photoWallTitle: '照片墙标题',
    photoWallDescription: '照片墙简介',
    content: '正文',
  };
  return labels[resource.field] || resource.field;
}

function getErrorMessage(body: unknown, fallback: string) {
  if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error;
  return fallback;
}

export function InlineTextEditor({
  value,
  resource,
  as: Tag = 'span',
  className,
  multiline = false,
}: {
  value: string;
  resource: EditableResource;
  as?: 'span' | 'p' | 'h1' | 'h2' | 'h3';
  className?: string;
  multiline?: boolean;
}) {
  const { editMode, workspaceView, reportStatus } = useAdminEditMode();
  const [currentValue, setCurrentValue] = useState(value);
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPropValue = useRef(value);
  const pendingPropValue = useRef<string | null>(null);
  const draftStore = useDraftStorage(`text:${resource.type}:${'id' in resource ? resource.id : ''}:${'scope' in resource ? resource.scope || '' : ''}:${resource.field}`);
  const dirty = draft !== currentValue;
  useAdminPending(editing && dirty, saving);
  const changeDraft = (next: string) => {
    setDraft(next);
    if (next === currentValue) draftStore.clear(); else draftStore.write(next);
  };

  useEffect(() => {
    if (Object.is(lastPropValue.current, value)) return;
    lastPropValue.current = value;

    if (editing) {
      pendingPropValue.current = value;
      return;
    }

    pendingPropValue.current = null;
    setCurrentValue(value);
    setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (editMode && workspaceView !== 'preview') return;
    setEditing(false);
    setError(null);
    setDraft(currentValue);
  }, [currentValue, editMode, workspaceView]);

  const stopInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const beginEditing = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!editMode || workspaceView !== 'edit' || editing) return;
    stopInteraction(event);
    setError(null);
    setDraft(draftStore.read() ?? currentValue);
    setEditing(true);
  };

  const cancel = (event?: React.SyntheticEvent) => {
    if (event) stopInteraction(event);
    if (!confirmAdminLeave(dirty, saving)) return;
    const committedValue = pendingPropValue.current ?? currentValue;
    pendingPropValue.current = null;
    setCurrentValue(committedValue);
    setDraft(committedValue);
    setError(null);
    setEditing(false);
  };

  const save = async (event: React.MouseEvent | React.KeyboardEvent) => {
    stopInteraction(event);
    if (saving) return;
    setSaving(true);
    setError(null);
    reportStatus('saving', `正在保存${resourceLabel(resource)}…`);
    try {
      const readResponse = await fetch(`/api/admin/content/${resource.type}`, { cache: 'no-store' });
      const envelope = await readResponse.json().catch(() => null);
      if (!readResponse.ok) throw new Error(getErrorMessage(envelope, '无法读取当前内容'));

      let endpoint = `/api/admin/content/${resource.type}`;
      let method = 'POST';
      let valueToSave: Record<string, unknown>;
      let baseSha = envelope?.sha ?? null;

      if (resource.type === 'profile') {
        const remoteValue = String(envelope?.singleton?.[resource.field] ?? currentValue);
        if (remoteValue !== currentValue && remoteValue !== draft) throw new Error('远端文字已变化，请刷新后核对再保存。你的草稿已保留。');
        valueToSave = { ...(envelope?.singleton || {}), [resource.field]: draft };
      } else {
        const item = envelope?.items?.find((entry: { id: string }) => entry.id === resource.id);
        if (!item) throw new Error('该内容已不存在或已被其他修改更新，请刷新页面后重试。');
        const remoteValue = String((resource.scope === 'frontmatter' ? item.frontmatter?.[resource.field] : item[resource.field]) ?? currentValue);
        if (remoteValue !== currentValue && remoteValue !== draft) throw new Error('远端文字已变化，请刷新后核对再保存。你的草稿已保留。');
        endpoint = `/api/admin/content/${resource.type}/${encodeURIComponent(resource.id)}`;
        method = 'PUT';
        baseSha = item.sha || envelope?.sha || null;
        valueToSave = resource.scope === 'frontmatter'
          ? { ...item, frontmatter: { ...(item.frontmatter || {}), [resource.field]: draft } }
          : { ...item, [resource.field]: draft };
      }

      const saveResponse = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: valueToSave,
          baseSha,
          message: `content: update ${resource.type} from inline editor`,
        }),
      });
      const saved = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(getErrorMessage(saved, '保存失败'));
      const committedValue = draft;
      draftStore.clear();
      pendingPropValue.current = null;
      setCurrentValue(committedValue);
      setDraft(committedValue);
      setEditing(false);
      reportStatus('saved', `${resourceLabel(resource)}已保存到 GitHub`);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '保存失败';
      setError(message);
      reportStatus('error', message);
    } finally {
      setSaving(false);
    }
  };

  if (!editMode || workspaceView === 'preview') return <Tag className={className}>{currentValue}</Tag>;

  if (!editing) {
    return (
      <Tag
        className={`${className || ''} cursor-text rounded-md outline outline-1 outline-offset-4 outline-transparent transition hover:bg-indigo-500/10 hover:outline-indigo-400/70`}
        onClick={beginEditing}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') beginEditing(event); }}
        title="点击打开编辑面板"
      >
        {currentValue}
      </Tag>
    );
  }

  const editorClass = 'min-w-0 w-full rounded-xl border border-white/15 bg-slate-900 px-3 py-3 text-sm text-slate-100 shadow-inner outline-none ring-indigo-300 transition focus:border-indigo-300 focus:ring-2';
  return (
    <>
      <Tag className={`${className || ''} rounded-md bg-indigo-500/10 outline outline-2 outline-offset-4 outline-indigo-400/80`}>{currentValue}</Tag>
      <AdminSidePanel
        title={`编辑${resourceLabel(resource)}`}
        description="页面会保持原样显示；保存后内容将立即写入 GitHub 并触发自动部署。"
        onClose={() => cancel()}
      >
        <div className="flex min-h-full flex-col">
          <p role="status" className="mb-3 text-xs text-amber-200">{saving ? '保存中…' : dirty ? (draftStore.storageError ? '未保存 · 浏览器未允许储存草稿，请勿刷新' : '未保存 · 草稿已保留在当前浏览器会话') : '没有未保存的修改'}</p>
          <label htmlFor="admin-text-input" className="text-xs font-black uppercase tracking-[0.18em] text-slate-400">{resourceLabel(resource)}</label>
          {multiline ? (
            <textarea
              id="admin-text-input"
              autoFocus
              value={draft}
              onChange={(event) => changeDraft(event.target.value)}
              disabled={saving}
              onKeyDown={(event) => {
                if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') void save(event);
              }}
              className={`${editorClass} mt-2 min-h-52 resize-y text-base leading-relaxed`}
            />
          ) : (
            <input
              id="admin-text-input"
              autoFocus
              value={draft}
              onChange={(event) => changeDraft(event.target.value)}
              disabled={saving}
              onKeyDown={(event) => {
                if (!event.nativeEvent.isComposing && event.key === 'Enter') void save(event);
              }}
              className={`${editorClass} mt-2`}
            />
          )}
          <p className="mt-3 text-xs leading-relaxed text-slate-500">单行内容按 Enter 保存；多行内容按 Ctrl / ⌘ + Enter 保存。</p>
          {error ? <p className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">{error}</p> : null}
          <div className="mt-6 flex items-center gap-2 border-t border-white/10 pt-4">
            <button type="button" onClick={(event) => void save(event)} disabled={saving} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-400 disabled:opacity-50">
              {saving ? '正在保存…' : '保存到 GitHub'}
            </button>
            <button type="button" onClick={() => cancel()} disabled={saving} className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-white/15 disabled:opacity-50">
              关闭
            </button>
            {dirty && <button type="button" disabled={saving} onClick={() => { if (window.confirm('放弃这份未保存的草稿？')) { draftStore.clear(); setDraft(currentValue); setError(null); } }} className="text-sm text-rose-300">放弃草稿</button>}
          </div>
        </div>
      </AdminSidePanel>
    </>
  );
}

export function InlineMarkdownEditor({
  value,
  html,
  resource,
  className,
  id,
}: {
  value: string;
  html: string;
  resource: MarkdownResource;
  className?: string;
  id?: string;
}) {
  const { editMode, workspaceView, reportStatus } = useAdminEditMode();
  const [currentValue, setCurrentValue] = useState(value);
  const [currentHtml, setCurrentHtml] = useState(html);
  const [draft, setDraft] = useState(value);
  const [draftHtml, setDraftHtml] = useState(html);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPropSnapshot = useRef<MarkdownSnapshot>({ value, html });
  const pendingPropSnapshot = useRef<MarkdownSnapshot | null>(null);
  const draftStore = useDraftStorage(`markdown:${resource.type}:${'id' in resource ? resource.id : ''}`);
  const dirty = draft !== currentValue;
  useAdminPending(editing && dirty, saving);
  const changeDraft = (next: string) => {
    setDraft(next);
    if (next === currentValue) draftStore.clear(); else draftStore.write(next);
  };

  useEffect(() => {
    const previous = lastPropSnapshot.current;
    if (previous.value === value && previous.html === html) return;
    lastPropSnapshot.current = { value, html };

    if (editing) {
      pendingPropSnapshot.current = { value, html };
      return;
    }

    pendingPropSnapshot.current = null;
    setCurrentValue(value);
    setCurrentHtml(html);
    setDraft(value);
    setDraftHtml(html);
  }, [editing, html, value]);

  useEffect(() => {
    if (!editing) {
      setDraftHtml(currentHtml);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void renderInlineMarkdown(draft).then((preview) => {
        if (!cancelled) setDraftHtml(preview);
      });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [currentHtml, draft, editing]);

  useEffect(() => {
    if (editMode && workspaceView !== 'preview') return;
    setEditing(false);
    setError(null);
    setDraft(currentValue);
    setDraftHtml(currentHtml);
  }, [currentHtml, currentValue, editMode, workspaceView]);

  const stopInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const beginEditing = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!editMode || workspaceView !== 'edit' || editing) return;
    stopInteraction(event);
    setError(null);
    setDraft(draftStore.read() ?? currentValue);
    setDraftHtml(currentHtml);
    setEditing(true);
  };

  const cancel = (event?: React.SyntheticEvent) => {
    if (event) stopInteraction(event);
    if (!confirmAdminLeave(dirty, saving)) return;
    const committed = pendingPropSnapshot.current ?? { value: currentValue, html: currentHtml };
    pendingPropSnapshot.current = null;
    setCurrentValue(committed.value);
    setCurrentHtml(committed.html);
    setDraft(committed.value);
    setDraftHtml(committed.html);
    setError(null);
    setEditing(false);
  };

  const save = async (event: React.MouseEvent | React.KeyboardEvent) => {
    stopInteraction(event);
    if (saving) return;
    setSaving(true);
    setError(null);
    reportStatus('saving', '正在保存 Markdown 正文…');
    try {
      const readResponse = await fetch(`/api/admin/content/${resource.type}`, { cache: 'no-store' });
      const envelope = await readResponse.json().catch(() => null);
      if (!readResponse.ok) throw new Error(getErrorMessage(envelope, '无法读取当前内容'));

      let endpoint = `/api/admin/content/${resource.type}`;
      let method = 'POST';
      let valueToSave: Record<string, unknown>;
      let baseSha = envelope?.sha ?? null;

      if (resource.type === 'about') {
        const remoteValue = String(envelope?.singleton?.content ?? '');
        if (remoteValue.trim() !== currentValue.trim() && remoteValue !== draft) throw new Error('远端正文已变化，请刷新后核对再保存。你的草稿已保留。');
        valueToSave = {
          frontmatter: envelope?.singleton?.frontmatter || {},
          content: draft,
        };
      } else {
        const item = envelope?.items?.find((entry: { id: string }) => entry.id === resource.id);
        if (!item) throw new Error('该内容已不存在或已被其他修改更新，请刷新页面后重试。');
        endpoint = `/api/admin/content/${resource.type}/${encodeURIComponent(resource.id)}`;
        method = 'PUT';
        baseSha = item.sha || envelope?.sha || null;
        valueToSave = { ...item, content: draft };
        if (String(item.content || '').trim() !== currentValue.trim() && item.content !== draft) throw new Error('远端正文已变化，请刷新后核对再保存。你的草稿已保留。');
      }

      const saveResponse = await fetch(endpoint, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          value: valueToSave,
          baseSha,
          message: `content: update ${resource.type} body from inline editor`,
        }),
      });
      const savedResponse = await saveResponse.json().catch(() => null);
      if (!saveResponse.ok) throw new Error(getErrorMessage(savedResponse, '保存失败'));
      const committedValue = draft;
      const committedHtml = await renderInlineMarkdown(committedValue);
      draftStore.clear();
      pendingPropSnapshot.current = null;
      setCurrentValue(committedValue);
      setCurrentHtml(committedHtml);
      setDraft(committedValue);
      setDraftHtml(committedHtml);
      setEditing(false);
      reportStatus('saved', 'Markdown 正文已保存到 GitHub');
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : '保存失败';
      setError(message);
      reportStatus('error', message);
    } finally {
      setSaving(false);
    }
  };

  const renderedContent = (
    <div
      id={id}
      className={className}
      dangerouslySetInnerHTML={{ __html: currentHtml }}
    />
  );

  if (!editMode || workspaceView === 'preview') return renderedContent;

  if (!editing) {
    return (
      <>
        <div
          role="button"
          tabIndex={0}
          onClick={beginEditing}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') beginEditing(event);
          }}
          title="点击编辑 Markdown 正文"
          className="cursor-text rounded-2xl outline-none ring-indigo-400/50 transition hover:bg-indigo-500/5 focus:ring-2"
        >
          {renderedContent}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="rounded-2xl bg-indigo-500/5 outline outline-2 outline-offset-4 outline-indigo-400/80">{renderedContent}</div>
      <AdminSidePanel
        title="编辑 Markdown 正文"
        description="左侧输入 Markdown，右侧会自动显示预览。保存后将立即写入 GitHub。"
        onClose={() => cancel()}
        wide
      >
        <p role="status" className="mb-3 text-xs text-amber-200">{saving ? '保存中…' : dirty ? (draftStore.storageError ? '未保存 · 浏览器未允许储存草稿，请勿刷新' : '未保存 · 草稿已保留在当前浏览器会话') : '没有未保存的修改'}</p>
        <div className="grid min-h-[calc(100vh_-_9rem)] gap-4 md:grid-cols-2">
          <div className="flex min-h-0 flex-col">
            <label htmlFor="admin-markdown-input" className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">Markdown</label>
            <textarea
              id="admin-markdown-input"
              autoFocus
              value={draft}
              onChange={(event) => changeDraft(event.target.value)}
              disabled={saving}
              onKeyDown={(event) => {
                if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') void save(event);
              }}
              className="min-h-96 flex-1 resize-none rounded-2xl border border-white/15 bg-slate-900 p-4 font-mono text-sm leading-relaxed text-slate-100 outline-none ring-indigo-300 transition focus:border-indigo-300 focus:ring-2"
            />
          </div>
          <div className="flex min-h-0 flex-col">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">实时预览</p>
            <div className="min-h-96 flex-1 overflow-y-auto rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: draftHtml }} />
            </div>
          </div>
        </div>
        {error ? <p className="mt-4 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-200">{error}</p> : null}
        <div className="sticky bottom-0 mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 bg-slate-950/95 pt-4">
          <button type="button" onClick={(event) => void save(event)} disabled={saving} className="rounded-xl bg-indigo-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg transition hover:bg-indigo-400 disabled:opacity-50">
            {saving ? '正在保存…' : '保存到 GitHub'}
          </button>
          <button type="button" onClick={() => cancel()} disabled={saving} className="rounded-xl bg-white/10 px-5 py-2.5 text-sm font-bold text-slate-200 transition hover:bg-white/15 disabled:opacity-50">
            关闭
          </button>
          {dirty && <button type="button" disabled={saving} onClick={() => { if (window.confirm('放弃这份未保存的草稿？')) { draftStore.clear(); setDraft(currentValue); setError(null); } }} className="text-sm text-rose-300">放弃草稿</button>}
          <span className="text-xs text-slate-500">Ctrl / ⌘ + Enter 保存</span>
        </div>
      </AdminSidePanel>
    </>
  );
}
