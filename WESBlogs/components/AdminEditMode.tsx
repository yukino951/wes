'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ContentType = 'albums' | 'chatters' | 'moments' | 'posts' | 'projects' | 'friends';

type EditableResource =
  | { type: 'profile'; field: string }
  | { type: ContentType; id: string; field: string; scope?: 'frontmatter' | 'record' };

type MarkdownResource =
  | { type: 'about' }
  | { type: Extract<ContentType, 'chatters' | 'moments' | 'posts'>; id: string };

type AdminEditModeContextValue = {
  editMode: boolean;
  starting: boolean;
  startEditing: () => Promise<void>;
  stopEditing: () => void;
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

  const startEditing = useCallback(async () => {
    setStarting(true);
    try {
      if (await hasAdminSession()) {
        setEditMode(true);
        return;
      }
      window.location.assign(`/api/admin/auth/login?next=${encodeURIComponent(returnToCurrentPage())}`);
    } finally {
      setStarting(false);
    }
  }, []);

  const stopEditing = useCallback(() => setEditMode(false), []);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('edit')) return;
    let cancelled = false;
    void hasAdminSession().then((authenticated) => {
      if (!cancelled && authenticated) {
        setEditMode(true);
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
    <AdminEditModeContext.Provider value={{ editMode, starting, startEditing, stopEditing }}>
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
  return <AdminEditTip />;
}

function AdminEditTip() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(() => setVisible(false), 3000);
    return () => window.clearTimeout(timeout);
  }, []);

  if (!visible) return null;
  return (
    <div role="status" className="fixed right-4 top-4 z-[9999] flex items-center gap-3 rounded-2xl border border-indigo-300/40 bg-slate-950/85 px-4 py-3 text-sm text-white shadow-2xl backdrop-blur-xl">
      <span className="font-bold text-indigo-200">编辑模式已开启</span>
      <span className="hidden text-slate-300 sm:inline">点击带虚线提示的内容即可编辑</span>
    </div>
  );
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
  const { editMode } = useAdminEditMode();
  const [currentValue, setCurrentValue] = useState(value);
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastPropValue = useRef(value);
  const pendingPropValue = useRef<string | null>(null);

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

  const stopInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const beginEditing = (event: React.MouseEvent) => {
    if (!editMode || editing) return;
    stopInteraction(event);
    setError(null);
    setDraft(currentValue);
    setEditing(true);
  };

  const cancel = (event: React.MouseEvent) => {
    stopInteraction(event);
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
    try {
      const readResponse = await fetch(`/api/admin/content/${resource.type}`, { cache: 'no-store' });
      const envelope = await readResponse.json().catch(() => null);
      if (!readResponse.ok) throw new Error(getErrorMessage(envelope, '无法读取当前内容'));

      let endpoint = `/api/admin/content/${resource.type}`;
      let method = 'POST';
      let valueToSave: Record<string, unknown>;
      let baseSha = envelope?.sha ?? null;

      if (resource.type === 'profile') {
        valueToSave = { ...(envelope?.singleton || {}), [resource.field]: draft };
      } else {
        const item = envelope?.items?.find((entry: { id: string }) => entry.id === resource.id);
        if (!item) throw new Error('该内容已不存在或已被其他修改更新，请刷新页面后重试。');
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
      pendingPropValue.current = null;
      setCurrentValue(committedValue);
      setDraft(committedValue);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!editMode) return <Tag className={className}>{currentValue}</Tag>;

  if (!editing) {
    return (
      <Tag
        className={`${className || ''} cursor-text rounded-md decoration-indigo-400 decoration-dashed underline underline-offset-4 transition hover:bg-indigo-500/10`}
        onClick={beginEditing}
        title="点击编辑"
      >
        {currentValue}
      </Tag>
    );
  }

  const editorClass = 'min-w-0 w-full rounded-xl border border-indigo-300/70 bg-slate-950/90 px-3 py-2 text-inherit shadow-xl outline-none ring-indigo-300 focus:ring-2';
  return (
    <Tag className={`${className || ''} relative block !overflow-visible`} onClick={stopInteraction}>
      {multiline ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel(event as unknown as React.MouseEvent);
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void save(event);
          }}
          className={`${editorClass} min-h-24 resize-y text-base leading-relaxed`}
        />
      ) : (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === 'Escape') cancel(event as unknown as React.MouseEvent);
            if (event.key === 'Enter') void save(event);
          }}
          className={editorClass}
        />
      )}
      <span className="mt-2 flex items-center gap-2 text-xs not-italic normal-case tracking-normal">
        <button type="button" onClick={(event) => void save(event)} disabled={saving} className="rounded-lg bg-indigo-500 px-3 py-1.5 font-bold text-white transition hover:bg-indigo-400 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" onClick={cancel} disabled={saving} className="rounded-lg bg-slate-700/90 px-3 py-1.5 font-bold text-slate-100 transition hover:bg-slate-600 disabled:opacity-50">
          取消
        </button>
        {error && <span className="font-medium text-rose-300">{error}</span>}
      </span>
    </Tag>
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
  const { editMode } = useAdminEditMode();
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  const stopInteraction = (event: React.SyntheticEvent) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const beginEditing = (event: React.MouseEvent | React.KeyboardEvent) => {
    if (!editMode || editing) return;
    stopInteraction(event);
    setError(null);
    setSaved(false);
    setDraft(value);
    setEditing(true);
  };

  const cancel = (event: React.MouseEvent | React.KeyboardEvent) => {
    stopInteraction(event);
    setDraft(value);
    setError(null);
    setEditing(false);
  };

  const save = async (event: React.MouseEvent | React.KeyboardEvent) => {
    stopInteraction(event);
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const readResponse = await fetch(`/api/admin/content/${resource.type}`, { cache: 'no-store' });
      const envelope = await readResponse.json().catch(() => null);
      if (!readResponse.ok) throw new Error(getErrorMessage(envelope, '无法读取当前内容'));

      let endpoint = `/api/admin/content/${resource.type}`;
      let method = 'POST';
      let valueToSave: Record<string, unknown>;
      let baseSha = envelope?.sha ?? null;

      if (resource.type === 'about') {
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
      setEditing(false);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const renderedContent = (
    <div
      id={id}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );

  if (!editMode) return renderedContent;

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
        {saved && <p className="mt-3 text-sm font-medium text-emerald-400">正文已保存到 GitHub；Vercel 自动部署完成后会显示新版本。</p>}
      </>
    );
  }

  return (
    <div className="rounded-2xl border border-indigo-300/60 bg-slate-950/90 p-3 shadow-2xl" onClick={stopInteraction}>
      <p className="mb-2 text-sm font-bold text-indigo-200">正在编辑 Markdown 正文</p>
      <textarea
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') cancel(event);
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void save(event);
        }}
        className="min-h-80 w-full resize-y rounded-xl border border-indigo-300/70 bg-slate-950 px-3 py-2 font-mono text-sm leading-relaxed text-slate-100 outline-none ring-indigo-300 focus:ring-2"
      />
      <div className="mt-3 flex items-center gap-2 text-sm">
        <button type="button" onClick={(event) => void save(event)} disabled={saving} className="rounded-lg bg-indigo-500 px-4 py-2 font-bold text-white transition hover:bg-indigo-400 disabled:opacity-50">
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" onClick={cancel} disabled={saving} className="rounded-lg bg-slate-700 px-4 py-2 font-bold text-slate-100 transition hover:bg-slate-600 disabled:opacity-50">
          取消
        </button>
        <span className="text-xs text-slate-400">Ctrl / ⌘ + Enter 保存，Esc 取消</span>
        {error && <span className="font-medium text-sm text-rose-300">{error}</span>}
      </div>
    </div>
  );
}
